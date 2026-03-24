import { Router } from 'express';
import { 
    getSubscriptions, 
    createSubscription, 
    updateSubscription, 
    deleteSubscription, 
    getSubscription 
} from '@llm-observer/database';

const router = Router();

// GET /api/subscriptions
router.get('/', (req, res) => {
    try {
        const onlyActive = req.query.active === 'true';
        const subs = getSubscriptions(onlyActive);
        res.json(subs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/subscriptions
router.post('/', (req, res) => {
    try {
        const { service_name, monthly_cost_usd, billing_cycle, start_date, notes, provider } = req.body;
        
        if (!service_name || monthly_cost_usd === undefined) {
            return res.status(400).json({ error: 'service_name and monthly_cost_usd are required.' });
        }

        const id = createSubscription({
            service_name,
            provider: provider || null,
            monthly_cost_usd: Number(monthly_cost_usd),
            billing_cycle: billing_cycle || 'monthly',
            is_active: 1,
            start_date: start_date || new Date().toISOString(),
            notes: notes || null
        });

        const newSub = getSubscription(id);
        res.status(201).json(newSub);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/subscriptions/:id
router.put('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updates = req.body;
        
        updateSubscription(id, updates);
        const updated = getSubscription(id);
        res.json(updated);
    } catch (err: any) {
        if (err.message === 'Subscription not found') {
            return res.status(404).json({ error: err.message });
        }
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/subscriptions/:id
router.delete('/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        deleteSubscription(id);
        res.json({ success: true, message: 'Subscription deleted.' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
