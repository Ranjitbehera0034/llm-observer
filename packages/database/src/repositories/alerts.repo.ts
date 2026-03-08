import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface AlertRecord {
    id: string;
    project_id: string;
    type: string;
    severity: string;
    message: string;
    data?: string;
    notified_via?: string;
    acknowledged: boolean;
    created_at: string;
}

export const getAlerts = (projectId: string = 'default'): AlertRecord[] => {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM alerts WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId) as AlertRecord[];
};

export const createAlert = (alert: Omit<AlertRecord, 'id' | 'acknowledged' | 'created_at'>): string => {
    const db = getDb();
    const id = randomUUID();
    const stmt = db.prepare(`
        INSERT INTO alerts (id, project_id, type, severity, message, data, notified_via, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
        id,
        alert.project_id,
        alert.type,
        alert.severity,
        alert.message,
        alert.data || null,
        alert.notified_via || null
    );
    return id;
};

export const acknowledgeAlert = (id: string) => {
    const db = getDb();
    const stmt = db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?');
    stmt.run(id);
};
