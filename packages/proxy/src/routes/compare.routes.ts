import { Router } from 'express';
import { getComparisonValues, getComparisonMetrics } from '@llm-observer/database';
import { compareMeans, compareProportions } from '../analysis/compareStats';

const router = Router();
const VALID_DIMENSIONS = ['model', 'provider', 'tags'];

// GET /api/compare/options?dimension=model — values available to compare
router.get('/options', (req, res) => {
    try {
        const dimension = (req.query.dimension as string) || 'model';
        if (!VALID_DIMENSIONS.includes(dimension)) {
            return res.status(400).json({ error: `Invalid dimension. Must be one of: ${VALID_DIMENSIONS.join(', ')}` });
        }
        const values = getComparisonValues(dimension);
        res.json({ dimension, values });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/compare?dimension=model&a=X&b=Y&days=30 — head-to-head comparison
router.get('/', (req, res) => {
    try {
        const dimension = (req.query.dimension as string) || 'model';
        const a = req.query.a as string;
        const b = req.query.b as string;
        const days = parseInt(req.query.days as string) || 30;

        if (!VALID_DIMENSIONS.includes(dimension)) {
            return res.status(400).json({ error: `Invalid dimension. Must be one of: ${VALID_DIMENSIONS.join(', ')}` });
        }
        if (!a || !b) {
            return res.status(400).json({ error: 'Both "a" and "b" values are required.' });
        }
        if (a === b) {
            return res.status(400).json({ error: 'Choose two different values to compare.' });
        }

        const since = new Date();
        since.setDate(since.getDate() - days);
        const sinceIso = since.toISOString();

        const metricsA = getComparisonMetrics(dimension, a, sinceIso);
        const metricsB = getComparisonMetrics(dimension, b, sinceIso);

        if (metricsA.n === 0 || metricsB.n === 0) {
            return res.status(404).json({ error: `No requests found for "${metricsA.n === 0 ? a : b}" in the last ${days} days.` });
        }

        res.json({
            dimension, a, b, days,
            sampleSizes: { a: metricsA.n, b: metricsB.n },
            cost: compareMeans(metricsA.costValues, metricsB.costValues),
            latency: compareMeans(metricsA.latencyValues, metricsB.latencyValues),
            tokens: compareMeans(metricsA.tokenValues, metricsB.tokenValues),
            errorRate: compareProportions(metricsA.n, metricsA.errorCount, metricsB.n, metricsB.errorCount)
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
