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
        const month = req.query.month ?? new Date().toISOString().slice(0, 7);
        if (!WrappedService.isValidPeriod('monthly', month)) {
            return res.status(400).json({ error: 'Invalid month, expected YYYY-MM' });
        }
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
        const year = req.query.year ?? new Date().toISOString().slice(0, 4);
        if (!WrappedService.isValidPeriod('yearly', year)) {
            return res.status(400).json({ error: 'Invalid year, expected YYYY' });
        }
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
        const period = req.query.period;
        const type = req.query.type ?? 'monthly';

        if (!period) {
            return res.status(400).json({ error: 'Missing period' });
        }
        if (type !== 'monthly' && type !== 'yearly') {
            return res.status(400).json({ error: 'Invalid type, expected monthly or yearly' });
        }
        if (!WrappedService.isValidPeriod(type, period)) {
            return res.status(400).json({ error: type === 'monthly' ? 'Invalid period, expected YYYY-MM' : 'Invalid period, expected YYYY' });
        }

        const report = type === 'monthly' 
            ? await WrappedService.getMonthlyReport(period)
            : await WrappedService.getYearlyReport(period);
        
        const prefs = await WrappedService.getPreferences();
        const svg = WrappedService.generateCardSVG(report, prefs);
        
        // The card is a standalone image. If it is ever opened as a document (top-level
        // navigation) it must not be able to run script, be framed, or be sniffed as HTML.
        // Placeholder for PNG conversion if needed; for now every format returns the SVG.
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        return res.send(svg);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
