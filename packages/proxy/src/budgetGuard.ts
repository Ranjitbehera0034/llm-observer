import { Request, Response, NextFunction } from 'express';
import { getDb, validateApiKey, getPricingForModel } from '@llm-observer/database';
import { randomUUID } from 'crypto';
import { BudgetService } from './services/budget.service';
import './types';

interface ProjectCache {
  id: string;
  daily_budget: number | null;
  kill_switch: boolean;
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
      spent_today: getSpendFromDb(dbProject.id),
      last_sync: now
    };
    cache.set(cacheKey, project);
  }

  req.projectId = project.id;
  req.cacheKey = cacheKey;

  // 1. LEGACY: Project-level Budget Check (v1.0.x)
  if (project.daily_budget != null && project.kill_switch && project.spent_today >= project.daily_budget) {
      const errorMsg = `Project budget reached ($${project.daily_budget.toFixed(2)}). $${project.spent_today.toFixed(2)} spent today.`;
      console.log(`[ALERT] PROJECT_BUDGET_EXCEEDED: ${errorMsg}`);
      logBlockedRequest(db, project.id, req.path, errorMsg);
      return res.status(429).json({ error: { message: errorMsg, type: 'budget_exceeded', scope: 'project', code: 429 } });
  }

  // 2. V1.4.0: Provider/Model Budgets + Kill Switch + Pre-estimation
  const provider = (req.headers['x-provider'] as string) || (req.body?.provider) || 'unknown';
  const model = (req.body?.model) || (req.headers['x-model'] as string) || 'unknown';

  // Pre-estimation logic (v1.4.0 simplified)
  let estimatedCost = 0;
  if (provider !== 'unknown' && model !== 'unknown') {
      const pricing = getPricingForModel(provider, model);
      if (pricing) {
          const bodyStr = JSON.stringify(req.body || {});
          const approxTokens = bodyStr.length / 4;
          // Safety factor of 3 to account for response tokens (as per plan)
          estimatedCost = (approxTokens / 1_000_000) * pricing.input * 3;
      }
  }

  const budgetCheck = await BudgetService.checkKillSwitch(provider, model, estimatedCost);
  
  if (budgetCheck.blocked) {
      const details = budgetCheck.details;
      const errorMsg = `${budgetCheck.reason}. Limit: $${details.limit.toFixed(2)}, Current: $${details.current.toFixed(2)}${details.estimated > 0 ? `, Estimated Request: $${details.estimated.toFixed(4)}` : ''}.`;
      logBlockedRequest(db, project.id, req.path, errorMsg, provider, model);
      return res.status(429).json({
          error: {
              type: 'budget_exceeded',
              scope: details.scope,
              message: errorMsg,
              budget_limit: details.limit,
              current_spend: details.current,
              estimated_cost: details.estimated,
              retry_after: details.retry_after
          }
      });
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
