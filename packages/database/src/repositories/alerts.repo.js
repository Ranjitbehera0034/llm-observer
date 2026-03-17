"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acknowledgeAlert = exports.createAlert = exports.getAlerts = void 0;
const db_1 = require("../db");
const crypto_1 = require("crypto");
const getAlerts = (projectId = 'default') => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('SELECT * FROM alerts WHERE project_id = ? ORDER BY created_at DESC');
    return stmt.all(projectId);
};
exports.getAlerts = getAlerts;
const createAlert = (alert) => {
    const db = (0, db_1.getDb)();
    const id = (0, crypto_1.randomUUID)();
    const stmt = db.prepare(`
        INSERT INTO alerts (id, project_id, type, severity, message, data, notified_via, acknowledged)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    stmt.run(id, alert.project_id, alert.type, alert.severity, alert.message, alert.data || null, alert.notified_via || null);
    return id;
};
exports.createAlert = createAlert;
const acknowledgeAlert = (id) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?');
    stmt.run(id);
};
exports.acknowledgeAlert = acknowledgeAlert;
//# sourceMappingURL=alerts.repo.js.map