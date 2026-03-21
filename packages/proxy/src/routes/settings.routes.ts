import { Router } from 'express';
import express from 'express';
import {
    getAlertRules,
    createAlertRule,
    deleteAlertRule,
    getAlerts,
    acknowledgeAlert,
    getAllSettings,
    updateSettings
} from '@llm-observer/database';

export const settingsRouter = Router();

// --- Alert Rules ---
// GET /api/alert-rules
settingsRouter.get('/alert-rules', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const rules = getAlertRules(projectId);
        res.json({ data: rules });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch alert rules' });
    }
});

// POST /api/alert-rules
settingsRouter.post('/alert-rules', express.json(), (req, res) => {
    try {
        const { projectId } = req.body;
        const targetProject = projectId || 'default';
        const id = createAlertRule({ ...req.body, project_id: targetProject, organization_id: 'default' });
        res.json({ data: { id } });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create alert rule' });
    }
});

// DELETE /api/alert-rules/:id
settingsRouter.delete('/alert-rules/:id', (req, res) => {
    try {
        deleteAlertRule(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete alert rule' });
    }
});

// --- Alerts ---
// GET /api/alerts
settingsRouter.get('/alerts', (req, res) => {
    try {
        const projectId = (req.query.projectId as string) || 'default';
        const data = getAlerts(projectId);
        res.json({ data });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PUT /api/alerts/:id/ack
settingsRouter.put('/alerts/:id/ack', (req, res) => {
    try {
        acknowledgeAlert(req.params.id);
        res.json({ message: 'Alert acknowledged' });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Settings ---
// GET /api/settings
settingsRouter.get('/settings', (req, res) => {
    try {
        const settingsMap = getAllSettings();
        // Redact sensitive API key values
        const redacted: Record<string, string> = {};
        for (const [key, value] of Object.entries(settingsMap)) {
            if (key.endsWith('_api_key') && value && (value as string).length > 8) {
                const v = value as string;
                redacted[key] = v.substring(0, 4) + '****' + v.substring(v.length - 4);
            } else {
                redacted[key] = value as string;
            }
        }
        res.json({ data: redacted });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// PUT /api/settings
settingsRouter.put('/settings', express.json(), (req, res) => {
    try {
        const payload = req.body;
        const filteredPayload: Record<string, string> = {};
        for (const [key, value] of Object.entries(payload)) {
            // Ignore any values that contain the redact mask "****"
            if (typeof value === 'string' && value.includes('****')) {
                continue;
            }
            filteredPayload[key] = String(value);
        }
        updateSettings(filteredPayload);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});
