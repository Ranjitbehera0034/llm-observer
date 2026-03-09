"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAlertRule = exports.createAlertRule = exports.getAlertRules = void 0;
const db_1 = require("../db");
const crypto_1 = require("crypto");
const getAlertRules = (projectId = 'default') => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('SELECT * FROM alert_rules WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId);
};
exports.getAlertRules = getAlertRules;
const createAlertRule = (rule) => {
    const db = (0, db_1.getDb)();
    const id = (0, crypto_1.randomUUID)();
    const stmt = db.prepare(`
        INSERT INTO alert_rules (id, project_id, organization_id, name, condition_type, threshold, time_window_minutes, webhook_url, email_notification, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    stmt.run(id, rule.project_id, rule.organization_id, rule.name, rule.condition_type, rule.threshold, rule.time_window_minutes || null, rule.webhook_url || null, rule.email_notification || null);
    return id;
};
exports.createAlertRule = createAlertRule;
const deleteAlertRule = (id) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('DELETE FROM alert_rules WHERE id = ?');
    stmt.run(id);
};
exports.deleteAlertRule = deleteAlertRule;
//# sourceMappingURL=alertRules.repo.js.map