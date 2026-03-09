"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSettings = exports.updateSetting = exports.getAllSettings = exports.getSetting = void 0;
const db_1 = require("../db");
const getSetting = (key) => {
    const db = (0, db_1.getDb)();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
};
exports.getSetting = getSetting;
const getAllSettings = () => {
    const db = (0, db_1.getDb)();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
};
exports.getAllSettings = getAllSettings;
const updateSetting = (key, value) => {
    const db = (0, db_1.getDb)();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};
exports.updateSetting = updateSetting;
const updateSettings = (settings) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
        for (const [key, value] of Object.entries(data)) {
            stmt.run(key, String(value));
        }
    });
    transaction(settings);
};
exports.updateSettings = updateSettings;
//# sourceMappingURL=settings.repo.js.map