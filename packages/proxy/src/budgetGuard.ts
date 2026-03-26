import { Request, Response, NextFunction } from 'express';
import { getDb, validateApiKey } from '@llm-observer/database';
import { randomUUID } from 'crypto';
import { BudgetService } from './services/budget.service';
import { estimateTokenCount, estimateRequestCost } from './services/costEstimator';
import './types';

interface ProjectCache {
  id: string;
  daily_budget: number | null;
  kill_switch: boolean;
  safety_buffer: number;
  estimate_multiplier: number;
  spent_today: number;
  last_sync: number;
}

const cache = new Map<string, ProjectCache>();
const CACHE_TTL_MS = 10_000;

const getSpendFromDb = (projectId: string) => {
  const db = getDb();
  const spendStmt = db.prepare(`
      SELECT sum(cost_usd) as total 
      FROM requests 
      WHERE project_id = ? AND date(created_at, 'localtime') = date('now', 'localtime')
        AND status != 'blocked_budget'
    `);
  const row = spendStmt.get(projectId) as any;
  return row?.total || 0;
};

export const budgetGuard = async (req: Request, res: Response, next: NextFunction) => {
  const db = getDb();
  let authHeader = req.headers['authorization'] || req.headers['x-api-key'] || '';
  if (Array.isArray(authHeader)) authHeader = authHeader[0];
  const apiKey = authHeader.replace('Bearer ', '').trim();

  let cacheKey = apiKey || 'default';
  let project = cache.get(cacheKey);
  const now = Date.now();

  if (!project || now - project.last_sync > CACHE_TTL_MS) {
    let dbProject;
    if (cacheKey === 'default') {
      dbProject = db.prepare('SELECT * FROM projects WHERE id = ?').get('default') as any;
      if (!dbProject) return next();
    } else {
      const authRecord = validateApiKey(apiKey);
      if (!authRecord) return res.status(401).json({ error: 'Invalid API Key' });
      dbProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(authRecord.project_id) as any;
      if (!dbProject) return res.status(401).json({ error: 'Project not found' });
    }

    project = {
      id: dbProject.id,
      daily_budget: dbProject.daily_budget,
      kill_switch: dbProject.kill_switch === 1,
      safety_buffer: dbProject.safety_buffer ?? 0.05,
      estimate_multiplier: dbProject.estimate_multiplier ?? 3.0,
      spent_today: getSpendFromDb(dbProject.id),
      last_sync: now
    };
    cache.set(cacheKey, project);
  }

  req.projectId = project.id;
  req.cacheKey = cacheKey;

  const provider = (req.headers['x-provider'] as string) || (req.body?.provider) || 'unknown';
  const model = (req.body?.model) || (req.headers['x-model'] as string) || 'unknown';
  
  // v1.7.0: Enhanced Token and Cost Estimation
  const inputTokens = estimateTokenCount(req.body?.messages || []);
  const estimatedCost = estimateRequestCost(provider, model, inputTokens, project.estimate_multiplier);

  // 1. LEGACY: Project-level Budget Check (v1.0.x)
  if (project.daily_budget != null && project.kill_switch) {
      const spent = project.spent_today;
      const limit = project.daily_budget;
      const buffer = project.safety_buffer;
      const utilization = spent / limit;

      // Layer 1: Exceeded
      if (spent >= limit) {
          const msg = `Project budget exceeded: $${spent.toFixed(2)} spent of $${limit.toFixed(2)} limit.`;
          logBlockedRequest(db, project.id, req.path, msg, provider, model);
          return res.status(429).json({ 
              error: { 
                  type: 'budget_exceeded', scope: 'project', message: msg, 
                  spent_usd: spent, limit_usd: limit, 
                  suggestion: "Budget resets at midnight. Switch to a cheaper model or wait."
              } 
          });
      }

      // Layer 2: Buffer
      if (spent >= (limit - buffer)) {
          const msg = `Project budget nearly exhausted. $${(limit - spent).toFixed(4)} remaining (buffer: $${buffer.toFixed(2)}).`;
          logBlockedRequest(db, project.id, req.path, msg, provider, model);
          return res.status(429).json({
              error: {
                  type: 'budget_buffer', scope: 'project', message: msg,
                  spent_usd: spent, limit_usd: limit, remaining_usd: limit - spent, safety_buffer_usd: buffer,
                  suggestion: "Remaining budget is within safety buffer. Reduce buffer in Settings to allow smaller requests."
              }
          });
      }

      // Layer 3: Pre-estimation (Threshold 60%)
      if (utilization >= 0.60 && spent + estimatedCost >= limit) {
          const msg = `Insufficient project budget. $${(limit - spent).toFixed(4)} remaining, estimated cost ~$${estimatedCost.toFixed(4)}.`;
          logBlockedRequest(db, project.id, req.path, msg, provider, model);
          return res.status(429).json({
              error: {
                  type: 'budget_insufficient', scope: 'project', message: msg,
                  spent_usd: spent, limit_usd: limit, remaining_usd: limit - spent, estimated_cost_usd: estimatedCost,
                  suggestion: "Try a shorter prompt or switch to a cheaper model."
              }
          });
      }
  }

  // 2. V1.7.0: Multi-layer Provider/Model Budgets
  const budgetCheck = await BudgetService.checkKillSwitch(provider, model, inputTokens, estimatedCost);
  
  if (budgetCheck.blocked) {
      const details = budgetCheck.details;
      logBlockedRequest(db, project.id, req.path, budgetCheck.reason || 'Blocked by budget', provider, model);

      let suggestion = "Try a cheaper model or wait for reset.";
      if (budgetCheck.type === 'budget_buffer') suggestion = "Remaining budget is within safety buffer. Reduce it in Settings.";
      if (budgetCheck.type === 'budget_insufficient') suggestion = "Try a shorter prompt or a cheaper model.";

      return res.status(429).json({
          error: {
              type: budgetCheck.type,
              scope: details.scope,
              scope_value: details.scope_value,
              message: budgetCheck.reason,
              limit_usd: details.limit,
              spent_usd: details.spent,
              remaining_usd: details.remaining,
              safety_buffer_usd: details.buffer,
              estimated_cost_usd: details.estimated,
              estimated_input_tokens: details.input_tokens,
              estimated_output_tokens: details.output_tokens,
              model: details.model,
              resets_in_seconds: details.retry_after,
              suggestion
          }
      });
  }

  // 3. Informational Warning Headers (Utilization > 80%)
  try {
      const status = await BudgetService.getBudgetStatus(provider, model);
      if (status && status.percent >= 0.80) {
          res.setHeader('X-Budget-Warning', `${status.name} spend at ${(status.percent * 100).toFixed(0)}% of daily budget ($${status.spent.toFixed(2)} / $${status.limit.toFixed(2)})`);
          res.setHeader('X-Budget-Spent', status.spent.toFixed(2));
          res.setHeader('X-Budget-Limit', status.limit.toFixed(2));
          res.setHeader('X-Budget-Remaining', (status.limit - status.spent).toFixed(2));
      }
  } catch (err) {
      console.warn('[BudgetGuard] Failed to set warning headers:', err);
  }

  next();
};

function logBlockedRequest(db: any, projectId: string, path: string, message: string, provider = 'unknown', model = 'unknown') {
    db.prepare(`
        INSERT INTO requests (id, project_id, provider, model, endpoint, cost_usd, latency_ms, status_code, status, error_message)
        VALUES (?, ?, ?, ?, ?, 0, 0, 429, 'blocked_budget', ?)
    `).run(randomUUID(), projectId, provider, model, path, message);
}

export const incrementSpendCache = (cacheKey: string, costUsd: number) => {
  const project = cache.get(cacheKey);
  if (project && costUsd > 0) {
    project.spent_today += costUsd;
    if (project.daily_budget != null && project.spent_today >= project.daily_budget * 0.95) {
      project.last_sync = 0;
    }
  }
};

/** Expose for testing */
export const _getCacheForTest = () => cache;
