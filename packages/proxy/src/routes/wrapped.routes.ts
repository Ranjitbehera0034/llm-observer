import { Router } from 'express';
import { WrappedService } from '../services/wrapped.service';

const router = Router();

/**
 * GET /api/wrapped/available-periods
 * Returns list of months and years with usage data.
 */
router.get('/available-periods', async (req, res) => {
    try {
        const periods = await WrappedService.getAvailablePeriods();
        res.json(periods);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wrapped/monthly
 * params: ?month=YYYY-MM
 */
router.get('/monthly', async (req, res) => {
    try {
        const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
        const report = await WrappedService.getMonthlyReport(month);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wrapped/yearly
 * params: ?year=YYYY
 */
router.get('/yearly', async (req, res) => {
    try {
        const year = (req.query.year as string) || new Date().toISOString().slice(0, 4);
        const report = await WrappedService.getYearlyReport(year);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wrapped/preferences
 */
router.get('/preferences', async (req, res) => {
    try {
        const prefs = await WrappedService.getPreferences();
        res.json(prefs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PUT /api/wrapped/preferences
 */
router.put('/preferences', async (req, res) => {
    try {
        await WrappedService.updatePreferences(req.body);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/wrapped/card
 * params: ?period=...&type=monthly|yearly
 */
router.get('/card', async (req, res) => {
    try {
        const period = req.query.period as string;
        const type = (req.query.type as 'monthly' | 'yearly') || 'monthly';
        
        if (!period) {
            return res.status(400).json({ error: 'Missing period' });
        }

        const report = type === 'monthly' 
            ? await WrappedService.getMonthlyReport(period)
            : await WrappedService.getYearlyReport(period);
        
        const prefs = await WrappedService.getPreferences();
        const svg = WrappedService.generateCardSVG(report, prefs);
        
        const format = req.query.format || 'svg';
        if (format === 'svg') {
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(svg);
        } else {
            // Placeholder for PNG conversion if needed
            // For now, return SVG as fallback
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.send(svg);
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
