import { getDb } from '@llm-observer/database';

export interface AppSpend {
    process_name: string;
    display_name: string;
    estimated_cost_usd: number;
    connection_count: number;
    pct: number;
    is_subscription?: boolean;
}

/**
 * AppCorrelator — Probabilistic attribution engine.
 * Connects "which app" (from NetworkMonitor) to "how much" (from Usage Sync).
 */
export class AppCorrelator {
    static async getAppSpend(period: 'today' | 'week' | 'month' | 'custom', customStart?: string, providerFilter?: string): Promise<{
        period: string;
        apps: AppSpend[];
        unattributed_usd: number;
        note: string;
    }> {
        const db = getDb();
        const start = customStart || this.getPeriodStart(period as any);
        
        // 1. Get total sync cost in period (optionally filtered by provider)
        let syncQuery = `SELECT SUM(cost_usd) as total FROM usage_records WHERE bucket_start >= ?`;
        const syncParams: any[] = [start];
        if (providerFilter) {
            syncQuery += ' AND provider = ?';
            syncParams.push(providerFilter);
        }
        const syncRow = db.prepare(syncQuery).get(...syncParams) as any;
        const totalSyncCostInPeriod = syncRow?.total || 0;

        // 2. Get connection counts per app and provider in period
        let connQuery = `
            SELECT c.process_name, a.display_name, COUNT(*) as count, c.provider
            FROM app_connections c
            LEFT JOIN app_aliases a ON c.process_name = a.process_name
            WHERE c.timestamp >= ?
        `;
        const connParams: any[] = [start];
        if (providerFilter) {
            connQuery += ' AND c.provider = ?';
            connParams.push(providerFilter);
        }
        connQuery += ' GROUP BY c.process_name, c.provider';
        
        const connRows = db.prepare(connQuery).all(...connParams) as any[];

        // 3. Group connections by provider for proportional attribution
        const providerConns: Record<string, { total: number, apps: any[] }> = {};
        for (const row of connRows) {
            if (!providerConns[row.provider]) {
                providerConns[row.provider] = { total: 0, apps: [] };
            }
            providerConns[row.provider].total += row.count;
            providerConns[row.provider].apps.push(row);
        }

        // 4. Calculate cost per app by matching with provider-level sync cost
        const appTotals: Record<string, { cost: number, count: number, display_name: string, sub_conns: number }> = {};
        let totalAttributedCost = 0;

        for (const [provider, data] of Object.entries(providerConns)) {
            // Get sync cost for this specific provider in this period
            const pSyncRow = db.prepare(`SELECT SUM(cost_usd) as total FROM usage_records WHERE bucket_start >= ? AND provider = ?`).get(start, provider) as any;
            const pSyncCost = pSyncRow?.total || 0;

            if (pSyncCost > 0 && data.total > 0) {
                for (const app of data.apps) {
                    const appCost = (app.count / data.total) * pSyncCost;
                    const name = app.process_name;
                    if (!appTotals[name]) {
                        appTotals[name] = { cost: 0, count: 0, display_name: app.display_name || name, sub_conns: 0 };
                    }
                    appTotals[name].cost += appCost;
                    appTotals[name].count += app.count;
                    totalAttributedCost += appCost;
                }
            } else if (data.total > 0) {
                // Connections exist but no sync cost -> Subscription mode
                for (const app of data.apps) {
                    const name = app.process_name;
                    if (!appTotals[name]) {
                        appTotals[name] = { cost: 0, count: 0, display_name: app.display_name || name, sub_conns: 0 };
                    }
                    appTotals[name].count += app.count;
                    appTotals[name].sub_conns += app.count;
                }
            }
        }

        // 5. Final assembly and sorting
        const apps: AppSpend[] = Object.entries(appTotals).map(([name, data]) => ({
            process_name: name,
            display_name: data.display_name,
            estimated_cost_usd: data.cost,
            connection_count: data.count,
            pct: totalSyncCostInPeriod > 0 ? (data.cost / totalSyncCostInPeriod) * 100 : 0,
            is_subscription: data.cost === 0 && data.sub_conns > 0
        })).sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd || b.connection_count - a.connection_count);

        return {
            period,
            apps,
            unattributed_usd: Math.max(0, totalSyncCostInPeriod - totalAttributedCost),
            note: "Attribution is estimated based on connection frequency. Accuracy: ~85-90%."
        };
    }

    /**
     * Get detailed info for a specific app, including daily timeline.
     */
    static async getAppDetail(processName: string, days: number = 30): Promise<{
        timeline: any[];
        providers: Record<string, number>;
        connection_frequency: number;
        display_name: string;
    }> {
        const db = getDb();
        const start = new Date();
        start.setDate(start.getDate() - days);
        const startStr = start.toISOString();

        // 1. Get alias
        const aliasRow = db.prepare('SELECT display_name FROM app_aliases WHERE process_name = ?').get(processName) as any;
        const displayName = aliasRow?.display_name || processName;

        // 2. Get connection timeline (daily)
        const connTimeline = db.prepare(`
            SELECT date(timestamp) as date, provider, COUNT(*) as count
            FROM app_connections
            WHERE process_name = ? AND timestamp >= ?
            GROUP BY date(timestamp), provider
        `).all(processName, startStr) as any[];

        // 3. Get provider-level costs and total connections in same period to do attribution
        const providers = Array.from(new Set(connTimeline.map(c => c.provider)));
        const providerData: Record<string, { total_sync: number, total_conns: number }> = {};
        
        for (const p of providers) {
            const syncRow = db.prepare(`SELECT SUM(cost_usd) as total FROM usage_records WHERE provider = ? AND bucket_start >= ?`).get(p, startStr) as any;
            const connRow = db.prepare(`SELECT COUNT(*) as total FROM app_connections WHERE provider = ? AND timestamp >= ?`).get(p, startStr) as any;
            providerData[p] = {
                total_sync: syncRow?.total || 0,
                total_conns: connRow?.total || 1 // Avoid div by zero
            };
        }

        // 4. Group timeline by date
        const timelineMap = new Map<string, { date: string, cost_usd: number, connections: number }>();
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            timelineMap.set(dateStr, { date: dateStr, cost_usd: 0, connections: 0 });
        }

        const providerBreakdown: Record<string, number> = {};
        let totalConns = 0;

        for (const row of connTimeline) {
            const pData = providerData[row.provider];
            const attributedCost = (row.count / pData.total_conns) * pData.total_sync;
            
            if (timelineMap.has(row.date)) {
                const entry = timelineMap.get(row.date)!;
                entry.cost_usd += attributedCost;
                entry.connections += row.count;
            }
            
            providerBreakdown[row.provider] = (providerBreakdown[row.provider] || 0) + attributedCost;
            totalConns += row.count;
        }

        return {
            timeline: Array.from(timelineMap.values()),
            providers: providerBreakdown,
            connection_frequency: totalConns / days,
            display_name: displayName
        };
    }

    private static getPeriodStart(period: string): string {
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);
        if (period === 'week') {
            const day = now.getUTCDay();
            const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
            now.setUTCDate(diff);
        } else if (period === 'month') {
            now.setUTCDate(1);
        }
        return now.toISOString();
    }
}
