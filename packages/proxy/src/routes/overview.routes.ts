import { Router } from 'express';
import { getDb, getSubscriptions } from '@llm-observer/database';

const router = Router();

/**
 * GET /api/overview
 * Main dashboard totals and breakdown.
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const today = new Date().toISOString().split('T')[0];
        
        // 1. Get List of active Sync Providers to avoid double counting
        const syncConfigs = db.prepare("SELECT id FROM usage_sync_configs WHERE status = 'active'").all() as any[];
        const syncProviderIds = syncConfigs.map(c => c.id);

        // 2. Aggregate Sync Cost (Today)
        const syncToday = db.prepare(`
            SELECT provider, SUM(COALESCE(cost_usd, 0)) as total
            FROM usage_records
            WHERE date(bucket_start) = ?
            GROUP BY provider
        `).all(today) as any[];

        // 3. Aggregate Proxy Cost (Today) - Deduplicated
        // Only include providers that are NOT in the sync list
        const proxyToday = db.prepare(`
            SELECT provider, SUM(cost_usd) as total
            FROM requests
            WHERE date(created_at) = ? AND provider NOT IN (${syncProviderIds.map(() => '?').join(',') || "''"})
            GROUP BY provider
        `).all(today, ...syncProviderIds) as any[];

        // 4. Calculate Subscriptions (Daily Proration)
        const activeSubs = getSubscriptions(true);
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const subDailyTotal = activeSubs.reduce((sum, sub) => {
            // Very simple daily proration: monthly_cost / days_in_month
            return sum + (sub.monthly_cost_usd / daysInMonth);
        }, 0);

        // Calculate Monthly Sub Total
        const subMonthlyTotal = activeSubs.reduce((sum, sub) => sum + sub.monthly_cost_usd, 0);

        // 5. Merge Providers for Breakdown
        const providers: Record<string, { total_usd: number, source: 'sync' | 'proxy' | 'manual' }> = {};
        
        syncToday.forEach(r => {
            providers[r.provider] = { total_usd: r.total, source: 'sync' };
        });
        proxyToday.forEach(r => {
            providers[r.provider] = { total_usd: r.total, source: 'proxy' };
        });

        const trackedApiTotal = syncToday.reduce((s, r) => s + r.total, 0) + proxyToday.reduce((s, r) => s + r.total, 0);
        const totalToday = trackedApiTotal + subDailyTotal;

        res.json({
            total_today_usd: totalToday,
            tracked_api: {
                total_usd: trackedApiTotal,
                providers
            },
            subscriptions: {
                total_monthly_usd: subMonthlyTotal,
                daily_equivalent_usd: subDailyTotal,
                active: activeSubs
            }
        });

    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/overview/timeline
 * Daily cost time series for the last 30 days.
 */
router.get('/timeline', (req, res) => {
    try {
        const days = Math.min(parseInt(req.query.days as string) || 30, 90);
        const db = getDb();
        
        const syncConfigs = db.prepare("SELECT id FROM usage_sync_configs WHERE status = 'active'").all() as any[];
        const syncProviderIds = syncConfigs.map(c => c.id);

        // Tracked API Cost (Daily)
        const syncDaily = db.prepare(`
            SELECT date(bucket_start) as date, SUM(COALESCE(cost_usd, 0)) as total
            FROM usage_records
            WHERE bucket_start >= date('now', ?)
            GROUP BY date(bucket_start)
        `).all(`-${days} days`) as any[];

        const proxyDaily = db.prepare(`
            SELECT date(created_at) as date, SUM(cost_usd) as total
            FROM requests
            WHERE created_at >= date('now', ?) AND provider NOT IN (${syncProviderIds.map(() => '?').join(',') || "''"})
            GROUP BY date(created_at)
        `).all(`-${days} days`, ...syncProviderIds) as any[];

        // Subscriptions (Flat daily average per month)
        const activeSubs = getSubscriptions(true);
        const dailySubCost = activeSubs.reduce((sum, s) => sum + (s.monthly_cost_usd / 30.42), 0); // Using avg days in month

        // Fill timeline
        const timelineMap = new Map<string, any>();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            timelineMap.set(dateStr, { 
                date: dateStr, 
                tracked_api_usd: 0, 
                subscriptions_daily_usd: dailySubCost, 
                total_usd: dailySubCost 
            });
        }

        syncDaily.forEach(r => {
            if (timelineMap.has(r.date)) {
                const entry = timelineMap.get(r.date);
                entry.tracked_api_usd += r.total;
                entry.total_usd += r.total;
            }
        });
        proxyDaily.forEach(r => {
            if (timelineMap.has(r.date)) {
                const entry = timelineMap.get(r.date);
                entry.tracked_api_usd += r.total;
                entry.total_usd += r.total;
            }
        });

        res.json(Array.from(timelineMap.values()));

    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
