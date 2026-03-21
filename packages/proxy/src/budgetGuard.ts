import { Request, Response, NextFunction } from 'express';
import { getDb, validateApiKey } from '@llm-observer/database';
import { randomUUID } from 'crypto';
import './types';

interface ProjectCache {
  id: string;
  daily_budget: number | null;
  kill_switch: boolean;
  spent_today: number;
  last_sync: number;
}

const cache = new Map<string, ProjectCache>();

// FIX BUG-01: Reduced from 60s to 10s to prevent burst bypass
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

export const budgetGuard = (req: Request, res: Response, next: NextFunction) => {
  const db = getDb();
  let authHeader = req.headers['authorization'] || req.headers['x-api-key'] || '';
  if (Array.isArray(authHeader)) authHeader = authHeader[0];
  const apiKey = authHeader.replace('Bearer ', '').trim();

  // Fallback to "default" if no API key is specified (for local dev MVP)
  let cacheKey = apiKey || 'default';

  let project = cache.get(cacheKey);
  const now = Date.now();

  // Refresh cache if missing or stale
  if (!project || now - project.last_sync > CACHE_TTL_MS) {
    let dbProject;

    if (cacheKey === 'default') {
      dbProject = db.prepare('SELECT * FROM projects WHERE id = ?').get('default') as any;
      if (!dbProject) return next();
    } else {
      const authRecord = validateApiKey(apiKey);
      if (!authRecord) {
        return res.status(401).json({ error: 'Invalid API Key' });
      }
      dbProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(authRecord.project_id) as any;
      if (!dbProject) {
        return res.status(401).json({ error: 'Project associated with this API Key not found' });
      }
    }

    const spent = getSpendFromDb(dbProject.id);

    project = {
      id: dbProject.id,
      daily_budget: dbProject.daily_budget,
      kill_switch: dbProject.kill_switch === 1,
      spent_today: spent,
      last_sync: now
    };
    cache.set(cacheKey, project);
  }

  req.projectId = project.id;
  req.cacheKey = cacheKey;

  if (project.daily_budget != null && project.kill_switch) {
    if (project.spent_today >= project.daily_budget) {
      // Log blocked request
      const insertStmt = db.prepare(`
                INSERT INTO requests (
                  id, project_id, provider, model, endpoint, cost_usd, latency_ms, 
                  status_code, status, error_message
                ) VALUES (
                  ?, ?, ?, ?, ?, 0, 0, 429, 'blocked_budget', ?
                )
            `);

      const errorMsg = `LLM Observer: Daily budget limit ($${project.daily_budget.toFixed(2)}) reached. $${project.spent_today.toFixed(2)} spent today.`;
      console.log(`[ALERT] BUDGET_EXCEEDED: ${errorMsg}`);
      insertStmt.run(randomUUID(), project.id, 'unknown', 'unknown', req.path, errorMsg);

      return res.status(429).json({
        error: { message: errorMsg, type: 'budget_exceeded', code: 429 }
      });
    }
  }

  next();
};

/**
 * FIX BUG-02: Call this IMMEDIATELY after cost is known (in proxy.ts res.end)
 * Updates the in-memory spend cache atomically so the next request sees updated spent_today.
 */
export const incrementSpendCache = (cacheKey: string, costUsd: number) => {
  const project = cache.get(cacheKey);
  if (project && costUsd > 0) {
    project.spent_today += costUsd;
    // Force re-sync from DB on next request if we're near the budget
    if (project.daily_budget != null && project.spent_today >= project.daily_budget * 0.95) {
      project.last_sync = 0; // Force DB refresh on next request
    }
  }
};

/** Expose for testing */
export const _getCacheForTest = () => cache;
