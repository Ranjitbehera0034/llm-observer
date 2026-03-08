import { Request, Response, NextFunction } from 'express';
import { getDb } from '@llm-observer/database';

export const budgetGuard = (req: Request, res: Response, next: NextFunction) => {
    const db = getDb();

    // For MVP, we use the default project. 
    // Later: parse API key from req.headers['x-llm-observer-project-key']
    const projectId = 'default';

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;
    if (!project) return next();

    if (project.daily_budget != null && project.kill_switch) {
        // Calculate today's spend
        const spendStmt = db.prepare(`
      SELECT sum(cost_usd) as total 
      FROM requests 
      WHERE project_id = ? AND date(created_at) = date('now')
    `);

        const spend = (spendStmt.get(projectId) as any).total || 0;

        if (spend >= project.daily_budget) {
            // Log blocked request
            const insertStmt = db.prepare(`
        INSERT INTO requests (
          id, project_id, provider, model, endpoint, cost_usd, latency_ms, 
          status_code, status, error_message
        ) VALUES (
          lower(hex(randomblob(16))), ?, ?, ?, ?, 0, 0, 429, 'blocked_budget', ?
        )
      `);

            const errorMsg = `LLM Observer: Daily budget limit ($${project.daily_budget.toFixed(2)}) reached. $${spend.toFixed(2)} spent today.`;

            insertStmt.run(
                projectId, 'unknown', 'unknown', req.path, errorMsg
            );

            return res.status(429).json({
                error: {
                    message: errorMsg,
                    type: 'budget_exceeded',
                    code: 429
                }
            });
        }
    }

    next();
};
