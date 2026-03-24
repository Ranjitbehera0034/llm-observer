import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface AlertRecord {
    id: string;
    project_id?: string;
    budget_id?: number;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    scope?: 'global' | 'provider' | 'model';
    scope_value?: string;
    message: string;
    data?: string; // Legacy data blob
    current_spend_usd?: number;
    limit_usd?: number;
    period_start?: string;
    metadata?: string; // JSON blob for v1.4.0+
    notified_via?: string;
    acknowledged: boolean;
    created_at: string;
}

export const getAlerts = (projectId: string = 'default'): AlertRecord[] => {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM alerts WHERE project_id = ? OR budget_id IS NOT NULL ORDER BY created_at DESC');
    return stmt.all(projectId).map((a: any) => ({
        ...a,
        acknowledged: !!a.acknowledged
    })) as AlertRecord[];
};

export const createAlert = (alert: Omit<AlertRecord, 'id' | 'acknowledged' | 'created_at'>): string => {
    const db = getDb();
    const id = randomUUID();
    const stmt = db.prepare(`
        INSERT INTO alerts (
            id, project_id, budget_id, type, severity, scope, scope_value, 
            message, data, current_spend_usd, limit_usd, period_start, metadata, notified_via, acknowledged
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
        id,
        alert.project_id || null,
        alert.budget_id || null,
        alert.type,
        alert.severity,
        alert.scope || null,
        alert.scope_value || null,
        alert.message,
        alert.data || null,
        alert.current_spend_usd || null,
        alert.limit_usd || null,
        alert.period_start || null,
        alert.metadata || null,
        alert.notified_via || null
    );
    return id;
};

export const acknowledgeAlert = (id: string) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?');
    stmt.run(id);
};
