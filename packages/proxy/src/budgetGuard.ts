import { Request, Response, NextFunction } from 'express';
import { getDb } from '@llm-observer/database';
import { randomUUID } from 'crypto';

interface ProjectCache {
  id: string;
  daily_budget: number | null;
  kill_switch: boolean;
  spent_today: number;
  last_sync: number;
}

const cache = new Map<string, ProjectCache>();

const getSpendFromDb = (projectId: string) => {
  const db = getDb();
  const spendStmt = db.prepare(`
      SELECT sum(cost_usd) as total 
      FROM requests 
      WHERE project_id = ? AND date(created_at) = date('now')
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

  // Populate cache if missing or if last sync was > 60 seconds ago
  if (!project || now - project.last_sync > 60000) {
    let dbProject;
    if (cacheKey === 'default') {
      dbProject = db.prepare('SELECT * FROM projects WHERE id = ?').get('default') as any;
    } else {
      dbProject = db.prepare('SELECT * FROM projects WHERE api_key = ?').get(apiKey) as any;
    }

    if (!dbProject) {
      if (cacheKey === 'default') return next();
      return res.status(401).json({ error: 'Invalid API Key or Project not found' });
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

  (req as any).projectId = project.id;
  (req as any).cacheKey = cacheKey;

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
      insertStmt.run(randomUUID(), project.id, 'unknown', 'unknown', req.path, errorMsg);

      return res.status(429).json({
        error: { message: errorMsg, type: 'budget_exceeded', code: 429 }
      });
    }
  }

  next();
};

export const incrementSpendCache = (cacheKey: string, costUsd: number) => {
  const project = cache.get(cacheKey);
  if (project) {
    project.spent_today += costUsd;
  }
};
