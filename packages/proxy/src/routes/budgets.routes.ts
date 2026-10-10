import { Router } from 'express';
import { getBudgetLimits, createBudgetLimit, updateBudgetLimit, deleteBudgetLimit, getBudgetLimitById } from '@llm-observer/database';
import { BudgetService } from '../services/budget.service';

const router = Router();

/** Budgets reconciled from the team policy are read-only here: the policy is the only thing that changes them. */
const TEAM_BUDGET_MESSAGE = 'This budget was set by your team and is read-only. Ask a team admin to change the policy.';

/** Only these columns may be changed through the API (the keys end up in the SQL, so never pass req.body through). */
const EDITABLE = ['name', 'scope', 'scope_value', 'period', 'limit_usd', 'warning_pct_1', 'warning_pct_2', 'kill_switch', 'safety_buffer_usd', 'estimate_multiplier', 'is_active'] as const;

// GET /api/budgets - List all budgets with current spend %
router.get('/', async (req, res) => {
    try {
        const budgets = getBudgetLimits();
        
        // Enhance with current spend for v1.4.0 UI
        const enhancedBudgets = await Promise.all(budgets.map(async (b) => {
            const current_spend = await BudgetService.calculateCurrentSpend(b.scope, b.scope_value, b.period);
            return {
                ...b,
                current_spend
            };
        }));
        
        res.json(enhancedBudgets);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/budgets - Create a budget
router.post('/', async (req, res) => {
    try {
        const { name, scope, scope_value, period, limit_usd, warning_pct_1, warning_pct_2, kill_switch, safety_buffer_usd, estimate_multiplier } = req.body;
        
        if (!name || !scope || !period || !limit_usd) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (limit_usd <= 0) {
            return res.status(400).json({ error: 'Limit must be greater than 0' });
        }

        const id = createBudgetLimit({
            name,
            scope,
            scope_value,
            period,
            limit_usd,
            warning_pct_1: warning_pct_1 || 0.8,
            warning_pct_2: warning_pct_2 || 0.9,
            kill_switch: !!kill_switch,
            safety_buffer_usd: safety_buffer_usd || 0.05,
            estimate_multiplier: estimate_multiplier || 3.0,
            is_active: true
        });

        const newBudget = getBudgetLimitById(id);
        res.status(201).json(newBudget);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/budgets/:id - Update a budget
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const existing = getBudgetLimitById(id);
        if (!existing) return res.status(404).json({ error: 'Budget not found' });
        if (existing.source === 'team') return res.status(403).json({ error: TEAM_BUDGET_MESSAGE });

        const changes: Record<string, unknown> = {};
        for (const key of EDITABLE) {
            if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) changes[key] = req.body[key];
        }
        updateBudgetLimit(id, changes);
        const updated = getBudgetLimitById(id);
        res.json(updated);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/budgets/:id - Delete a budget
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid budget ID' });
        }
        if (getBudgetLimitById(id)?.source === 'team') return res.status(403).json({ error: TEAM_BUDGET_MESSAGE });
        deleteBudgetLimit(id);
        res.status(204).send();
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
