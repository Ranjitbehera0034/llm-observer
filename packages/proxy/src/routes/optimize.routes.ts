import { Router } from 'express';
import { runOptimizationEngine } from '../optimization/engine';
import { allRules } from '../optimization/rules';

const router = Router();

// GET /api/optimize?days=30 — Run optimization engine, return all results + score
router.get('/', async (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const useCache = req.query.refresh !== 'true';
        
        const result = await runOptimizationEngine(days, useCache);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/optimize/score — Return only the score (for Overview page badge)
router.get('/score', async (req, res) => {
    try {
        const days = parseInt(req.query.days as string) || 30;
        const result = await runOptimizationEngine(days, true);
        res.json({ score: result.score, totalSavingsUsd: result.totalSavingsUsd });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/optimize/rules — List all available rules with descriptions
router.get('/rules', (_req, res) => {
    try {
        const rules = allRules.map(rule => ({
            id: rule.id,
            name: rule.name,
            category: rule.category,
            minDataDays: rule.minDataDays,
        }));
        res.json({ rules, total: rules.length });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/optimize/rule/:id — Detail for a single rule with its last fired result
router.get('/rule/:id', async (req, res) => {
    try {
        const rule = allRules.find(r => r.id === req.params.id);
        if (!rule) {
            return res.status(404).json({ error: `Rule '${req.params.id}' not found` });
        }

        // Get latest cached run and find this rule's result in it (if any)
        const run = await runOptimizationEngine(30, true);
        const result = run.results.find(r => r.ruleId === req.params.id) ?? null;

        res.json({
            rule: {
                id: rule.id,
                name: rule.name,
                category: rule.category,
                minDataDays: rule.minDataDays,
            },
            result,
            firedAt: result ? run.computedAt : null,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/optimize/refresh — Force re-computation (invalidate cache)
router.post('/refresh', async (req, res) => {
    try {
        const days = parseInt(req.body.days as string) || 30;
        const result = await runOptimizationEngine(days, false);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
