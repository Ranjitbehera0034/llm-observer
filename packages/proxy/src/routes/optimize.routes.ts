import { Router } from 'express';
import { runOptimizationEngine } from '../optimization/engine';
import { allRules } from '../optimization/rules';
import { setAnalystKey, clearAnalystKey, hasAnalystKey, runAnalysis, getLastResult } from '../services/aiAnalyst';

const router = Router();

// ── AI Analyst (agentic analysis via the user's own Anthropic API key) ──────

// GET /api/optimize/ai/key — is a key configured? (never returns the key)
router.get('/ai/key', (_req, res) => {
    res.json({ configured: hasAnalystKey() });
});

// POST /api/optimize/ai/key — store an Anthropic API key, encrypted at rest
router.post('/ai/key', (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey || typeof apiKey !== 'string') {
        return res.status(400).json({ error: 'No key provided.' });
    }
    if (apiKey.startsWith('sk-ant-admin')) {
        return res.status(400).json({ error: 'Admin keys cannot call the Messages API. Use a standard API key (sk-ant-api...).' });
    }
    if (!apiKey.startsWith('sk-ant-')) {
        return res.status(400).json({ error: 'That does not look like an Anthropic API key (expected sk-ant-...).' });
    }
    setAnalystKey(apiKey);
    res.json({ configured: true });
});

// DELETE /api/optimize/ai/key — remove the stored key
router.delete('/ai/key', (_req, res) => {
    clearAnalystKey();
    res.json({ configured: false });
});

// GET /api/optimize/ai/last — last analysis result, if any
router.get('/ai/last', (_req, res) => {
    res.json({ result: getLastResult() });
});

// POST /api/optimize/ai/analyze — run a fresh analysis (sends aggregates only)
router.post('/ai/analyze', async (_req, res) => {
    try {
        const result = await runAnalysis();
        res.json({ result });
    } catch (error: any) {
        if (error.code === 'NO_KEY') {
            return res.status(400).json({ error: 'Add an Anthropic API key first.' });
        }
        res.status(502).json({ error: error.message });
    }
});

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
        res.json({ score: result.score, totalSavingsUsd: result.totalSavingsUsd, planValue: result.planValue });
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
