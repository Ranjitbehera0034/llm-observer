import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface AlertRuleRecord {
    id: string;
    project_id: string;
    organization_id: string;
    name: string;
    condition_type: string;
    threshold: number;
    time_window_minutes: number | null;
    webhook_url: string | null;
    email_notification: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export const getAlertRules = (projectId: string = 'default'): AlertRuleRecord[] => {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM alert_rules WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId) as AlertRuleRecord[];
};

export const createAlertRule = (rule: Pick<AlertRuleRecord, 'name' | 'project_id' | 'organization_id' | 'condition_type' | 'threshold' | 'time_window_minutes' | 'webhook_url' | 'email_notification'>): string => {
    const db = getDb();
    const id = randomUUID();
    const stmt = db.prepare(`
        INSERT INTO alert_rules (id, project_id, organization_id, name, condition_type, threshold, time_window_minutes, webhook_url, email_notification, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    stmt.run(
        id,
        rule.project_id,
        rule.organization_id,
        rule.name,
        rule.condition_type,
        rule.threshold,
        rule.time_window_minutes || null,
        rule.webhook_url || null,
        rule.email_notification || null
    );
    return id;
};

export const deleteAlertRule = (id: string) => {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM alert_rules WHERE id = ?');
    stmt.run(id);
};
