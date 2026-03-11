import { Router } from 'express';
import express from 'express';
import { getLicenseInfo, activateLicense } from '../licenseManager';

export const licenseRouter = Router();

// GET /api/license/status
licenseRouter.get('/status', async (req, res) => {
    try {
        const info = await getLicenseInfo();
        res.json({ data: info });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch license status' });
    }
});

// POST /api/license/activate
licenseRouter.post('/activate', express.json(), async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });

        const result = await activateLicense(key);
        if (result.success) {
            res.json({ success: true, message: result.message });
        } else {
            res.status(400).json({ error: result.message });
        }
    } catch (err) {
        console.error('License Activation Error:', err);
        res.status(500).json({ error: 'Failed to activate license' });
    }
});
