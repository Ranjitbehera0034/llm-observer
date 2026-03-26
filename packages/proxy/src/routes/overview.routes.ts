import { Router } from 'express';
import { getDb, getSubscriptions } from '@llm-observer/database';

const router = Router();

/**
 * Calculates the number of days a subscription was active within a date range.
 */
function getActiveDays(startDate: string, endDate: string | null, rangeStart: Date, rangeEnd: Date): number {
    const subStart = new Date(startDate);
    if (isNaN(subStart.getTime())) return 0;
    subStart.setHours(0, 0, 0, 0);

    const subEnd = endDate ? new Date(endDate) : new Date(864000000000000); // Decent future, not maxed out
    if (isNaN(subEnd.getTime())) return 0;
    subEnd.setHours(23, 59, 59, 999);

    const rStart = new Date(rangeStart);
    rStart.setHours(0, 0, 0, 0);
    const rEnd = new Date(rangeEnd);
    rEnd.setHours(23, 59, 59, 999);

    const effectiveStart = new Date(Math.max(subStart.getTime(), rStart.getTime()));
    const effectiveEnd = new Date(Math.min(subEnd.getTime(), rEnd.getTime()));

    if (effectiveStart > effectiveEnd) return 0;

    // Normalize to midnight for day counting
    effectiveStart.setHours(0, 0, 0, 0);
    effectiveEnd.setHours(0, 0, 0, 0);

    const diffTime = effectiveEnd.getTime() - effectiveStart.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * GET /api/overview
 * Main dashboard totals and breakdown.
 * Supports ?period=today|week|month (default: today)
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const period = (req.query.period as string) || 'today';
        
        const now = new Date();
        let rangeStart = new Date(now);
        rangeStart.setHours(0, 0, 0, 0);
        const rangeEnd = new Date(now);
        rangeEnd.setHours(23, 59, 59, 999);

        if (period === 'week') {
            rangeStart.setDate(rangeStart.getDate() - 7);
        } else if (period === 'month') {
            rangeStart.setDate(1); // Start of current month
        }

        const startStr = rangeStart.toISOString();
        const endStr = rangeEnd.toISOString();

        // 1. Get List of active Sync Providers to avoid double counting
        const syncConfigs = db.prepare("SELECT id FROM usage_sync_configs WHERE status = 'active'").all() as any[];
        const syncProviderIds = syncConfigs.map(c => c.id);

        // 2. Aggregate Sync Cost
        const syncData = db.prepare(`
            SELECT provider, SUM(COALESCE(cost_usd, 0)) as total
            FROM usage_records
            WHERE bucket_start BETWEEN ? AND ?
            GROUP BY provider
        `).all(startStr, endStr) as any[];

        // 3. Aggregate Proxy Cost - Deduplicated
        const proxyData = db.prepare(`
            SELECT provider, SUM(cost_usd) as total
            FROM requests
            WHERE created_at BETWEEN ? AND ? AND provider NOT IN (${syncProviderIds.map(() => '?').join(',') || "''"})
            GROUP BY provider
        `).all(startStr, endStr, ...syncProviderIds) as any[];

        // 4. Calculate Subscriptions (Precise Proration)
        const allSubs = getSubscriptions(false);
        const activeSubs = allSubs.filter(s => s.is_active || (s.end_date && new Date(s.end_date) >= rangeStart));
        
        const subTotalInPeriod = activeSubs.reduce((sum, sub) => {
            const activeDays = getActiveDays(sub.start_date, sub.end_date || null, rangeStart, rangeEnd);
            const dailyRate = (sub.monthly_cost_usd || 0) / 30.42;
            const cost = dailyRate * activeDays;
            return sum + (isNaN(cost) ? 0 : cost);
        }, 0);

        const subMonthlyTotal = activeSubs.filter(s => s.is_active).reduce((sum, sub) => sum + (sub.monthly_cost_usd || 0), 0);
        
        // 5. Merge Providers for Breakdown
        const providers: Record<string, { total_usd: number, source: 'sync' | 'proxy' }> = {};
        
        syncData.forEach(r => {
            providers[r.provider] = { total_usd: r.total || 0, source: 'sync' };
        });
        proxyData.forEach(r => {
            providers[r.provider] = { 
                total_usd: (providers[r.provider]?.total_usd || 0) + (r.total || 0), 
                source: providers[r.provider]?.source || 'proxy' 
            };
        });

        const trackedApiTotal = syncData.reduce((s: number, r: any) => s + (r.total || 0), 0) + 
                               proxyData.reduce((s: number, r: any) => s + (r.total || 0), 0);
        const totalInPeriod = trackedApiTotal + subTotalInPeriod;

        res.json({
            period,
            total_usd: totalInPeriod,
            tracked_api: {
                total_usd: trackedApiTotal,
                providers
            },
            subscriptions: {
                total_monthly_commitment_usd: subMonthlyTotal,
                period_cost_usd: subTotalInPeriod,
                active_count: activeSubs.filter(s => s.is_active).length,
                active: activeSubs.filter(s => s.is_active)
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
        const dailySubCost = activeSubs.reduce((sum, s) => sum + (s.monthly_cost_usd / 30.42), 0);

        // Fill timeline
        const timelineMap = new Map<string, any>();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
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
