import { getDb } from '../db';

export interface Budget {
    id: number;
    name: string;
    scope: 'global' | 'provider' | 'model';
    scope_value?: string;
    period: 'daily' | 'weekly' | 'monthly';
    limit_usd: number;
    warning_pct_1: number;
    warning_pct_2: number;
    kill_switch: boolean;
    safety_buffer_usd: number;
    estimate_multiplier: number;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export const getBudgetLimits = (onlyActive = false): Budget[] => {
    const db = getDb();
    let query = 'SELECT * FROM budgets';
    if (onlyActive) query += ' WHERE is_active = 1';
    return db.prepare(query).all().map((b: any) => ({
        ...b,
        kill_switch: !!b.kill_switch,
        is_active: !!b.is_active
    })) as Budget[];
};

export const getBudgetLimitById = (id: number): Budget | undefined => {
    const db = getDb();
    const b = db.prepare('SELECT * FROM budgets WHERE id = ?').get(id) as any;
    if (!b) return undefined;
    return {
        ...b,
        kill_switch: !!b.kill_switch,
        is_active: !!b.is_active
    };
};

export const createBudgetLimit = (budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): number => {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO budgets (name, scope, scope_value, period, limit_usd, warning_pct_1, warning_pct_2, kill_switch, safety_buffer_usd, estimate_multiplier, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        budget.name,
        budget.scope,
        budget.scope_value || null,
        budget.period,
        budget.limit_usd,
        budget.warning_pct_1,
        budget.warning_pct_2,
        budget.kill_switch ? 1 : 0,
        budget.safety_buffer_usd,
        budget.estimate_multiplier || 3.0,
        budget.is_active ? 1 : 0
    );
    return result.lastInsertRowid as number;
};

export const updateBudgetLimit = (id: number, budget: Partial<Budget>): void => {
    const db = getDb();
    const entries = Object.entries(budget).filter(([k]) => !['id', 'created_at', 'updated_at'].includes(k));
    if (entries.length === 0) return;

    const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
    const params = entries.map(([_, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    
    db.prepare(`UPDATE budgets SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...params, id);
};

export const deleteBudgetLimit = (id: number): void => {
    const db = getDb();
    // Delete associated alerts first (cascade)
    db.prepare('DELETE FROM alerts WHERE budget_id = ?').run(id);
    // Delete the budget
    db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
};
