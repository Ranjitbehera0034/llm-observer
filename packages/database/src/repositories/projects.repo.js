"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSavedFilters = exports.getSavedFilters = exports.deleteProject = exports.updateBudget = exports.getProjectByApiKey = exports.getProject = exports.createProject = void 0;
const db_1 = require("../db");
const crypto_1 = require("crypto");
const createProject = (project) => {
    const db = (0, db_1.getDb)();
    const id = (0, crypto_1.randomUUID)();
    const apiKey = project.api_key || `pk_${(0, crypto_1.randomUUID)().replace(/-/g, '')}`;
    const stmt = db.prepare(`
    INSERT INTO projects(
        id, name, api_key, organization_id, daily_budget, weekly_budget, monthly_budget,
        alert_threshold, kill_switch, webhook_url
    ) VALUES(
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
    stmt.run(id, project.name, apiKey, project.organization_id || 'default', project.daily_budget || null, project.weekly_budget || null, project.monthly_budget || null, project.alert_threshold ?? 0.8, project.kill_switch === false ? 0 : 1, project.webhook_url || null);
    return id;
};
exports.createProject = createProject;
const getProject = (id) => {
    const db = (0, db_1.getDb)();
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
};
exports.getProject = getProject;
const getProjectByApiKey = (apiKey) => {
    const db = (0, db_1.getDb)();
    return db.prepare('SELECT * FROM projects WHERE api_key = ?').get(apiKey);
};
exports.getProjectByApiKey = getProjectByApiKey;
const updateBudget = (id, budget) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare(`
    UPDATE projects 
    SET daily_budget = coalesce(?, daily_budget),
    weekly_budget = coalesce(?, weekly_budget),
    monthly_budget = coalesce(?, monthly_budget)
    WHERE id = ?
  `);
    stmt.run(budget.daily || null, budget.weekly || null, budget.monthly || null, id);
};
exports.updateBudget = updateBudget;
const deleteProject = (id) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('DELETE FROM projects WHERE id = ?');
    stmt.run(id);
};
exports.deleteProject = deleteProject;
const getSavedFilters = (id) => {
    const db = (0, db_1.getDb)();
    const result = db.prepare('SELECT saved_filters FROM projects WHERE id = ?').get(id);
    if (!result || !result.saved_filters)
        return [];
    try {
        return JSON.parse(result.saved_filters);
    }
    catch {
        return [];
    }
};
exports.getSavedFilters = getSavedFilters;
const updateSavedFilters = (id, filters) => {
    const db = (0, db_1.getDb)();
    const stmt = db.prepare('UPDATE projects SET saved_filters = ? WHERE id = ?');
    stmt.run(JSON.stringify(filters), id);
};
exports.updateSavedFilters = updateSavedFilters;
//# sourceMappingURL=projects.repo.js.map