import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface ProjectRecord {
    id: string;
    name: string;
    api_key?: string;
    daily_budget?: number;
    weekly_budget?: number;
    monthly_budget?: number;
    alert_threshold?: number;
    kill_switch?: boolean;
    webhook_url?: string;
    created_at?: string;
}

export const createProject = (project: Omit<ProjectRecord, 'id'>): string => {
    const db = getDb();
    const id = randomUUID();
    const apiKey = project.api_key || `pk_${randomUUID().replace(/-/g, '')}`;

    const stmt = db.prepare(`
    INSERT INTO projects(
        id, name, api_key, daily_budget, weekly_budget, monthly_budget,
        alert_threshold, kill_switch, webhook_url
    ) VALUES(
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

    stmt.run(
        id, project.name, apiKey, project.daily_budget || null,
        project.weekly_budget || null, project.monthly_budget || null,
        project.alert_threshold ?? 0.8, project.kill_switch === false ? 0 : 1,
        project.webhook_url || null
    );

    return id;
};

export const getProject = (id: string): ProjectRecord | undefined => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRecord | undefined;
};

export const getProjectByApiKey = (apiKey: string): ProjectRecord | undefined => {
    const db = getDb();
    return db.prepare('SELECT * FROM projects WHERE api_key = ?').get(apiKey) as ProjectRecord | undefined;
};

export const updateBudget = (
    id: string,
    budget: { daily?: number; weekly?: number; monthly?: number }
) => {
    const db = getDb();
    const stmt = db.prepare(`
    UPDATE projects 
    SET daily_budget = coalesce(?, daily_budget),
    weekly_budget = coalesce(?, weekly_budget),
    monthly_budget = coalesce(?, monthly_budget)
    WHERE id = ?
  `);
    stmt.run(budget.daily || null, budget.weekly || null, budget.monthly || null, id);
};

export const deleteProject = (id: string) => {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
};

export const getSavedFilters = (id: string): any[] => {
    const db = getDb();
    const result = db.prepare('SELECT saved_filters FROM projects WHERE id = ?').get(id) as any;
    if (!result || !result.saved_filters) return [];
    try {
        return JSON.parse(result.saved_filters);
    } catch {
        return [];
    }
};

export const updateSavedFilters = (id: string, filters: any[]) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE projects SET saved_filters = ? WHERE id = ?');
    stmt.run(JSON.stringify(filters), id);
};
