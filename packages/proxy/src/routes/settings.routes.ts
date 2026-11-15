import { Router } from 'express';
import express from 'express';
import {
    getAlertRules,
    createAlertRule,
    deleteAlertRule,
    getAlerts,
    acknowledgeAlert,
    getAllSettings,
    updateSettings,
    getSetting,
    updateSetting
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

// --- Privacy policy ---
settingsRouter.get('/privacy/local-only', (_req, res) => {
    res.json({ enabled: process.env.LLM_OBSERVER_LOCAL_ONLY === '1' || getSetting('privacy_local_only') === 'true', locked: process.env.LLM_OBSERVER_LOCAL_ONLY === '1' });
});

settingsRouter.put('/privacy/local-only', express.json(), (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean' });
    if (process.env.LLM_OBSERVER_LOCAL_ONLY === '1' && req.body.enabled === false) return res.status(403).json({ error: 'Local-only mode is locked by server configuration' });
    updateSetting('privacy_local_only', String(req.body.enabled));
    return res.json({ enabled: req.body.enabled, locked: process.env.LLM_OBSERVER_LOCAL_ONLY === '1' });
});

// --- Settings ---
// GET /api/settings
settingsRouter.get('/settings', (req, res) => {
    try {
        const settingsMap = getAllSettings();
        // Redact sensitive API key values
        const redacted: Record<string, string> = {};
        for (const [key, value] of Object.entries(settingsMap)) {
            // The billing API exposes only public entitlement status. Never
            // expose saved keys, HMACs, or signed portal links in settings.
            if (key.startsWith('license_') || key.startsWith('activity_') || key === 'privacy_local_only') continue;
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
        // Only verified license activation may change entitlement state.
        if (Object.keys(payload).some(key => key.startsWith('license_') || key.startsWith('activity_') || key === 'privacy_local_only')) {
            return res.status(400).json({ error: 'Protected settings must be changed through their dedicated controls.' });
        }
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
