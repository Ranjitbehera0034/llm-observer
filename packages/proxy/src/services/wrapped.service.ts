import { getDb, getSubscriptions } from '@llm-observer/database';
import { AppCorrelator } from './appCorrelator';

export interface WrappedPreferences {
    show_total_spend: boolean;
    show_per_app: boolean;
    show_subscriptions: boolean;
    show_insights: boolean;
}

export interface WrappedReport {
    period: string;
    type: 'monthly' | 'yearly';
    stats: {
        total_spend: number;
        total_requests: number;
        total_tokens: number;
        days_active: number;
        coverage_days: number; // Total days in period with some data
        period_start: string; // Earliest record in period
        period_end: string;   // Latest record in period
    };
    breakdowns: {
        by_source: { API: number; Subscriptions: number };
        by_provider: Record<string, number>;
        by_model: Array<{ model: string; spend: number; requests: number }>;
    };
    trends: {
        daily: Array<{ date: string; spend: number }>;
        peak_day: { date: string; spend: number };
        trough_day: { date: string; spend: number };
        day_of_week: Record<string, number>;
        previous_period_comparison?: {
            percent_change: number;
            previous_spend: number;
        };
    };
    app_breakdown: Array<{ name: string; spend: number; connections: number }>;
    insights: Array<{
        type: 'model_optimization' | 'cache_efficiency' | 'subscription_value' | 'budget_compliance';
        title: string;
        description: string;
        savings_usd?: number;
    }>;
    top_session?: {
        project_name: string;
        provider: string;
        cost_usd: number;
    };
    agent_stats: {
        total_agents: number;
        total_agent_cost: number;
        avg_agents_per_day: number;
        most_active_type: string;
    };
}

export class WrappedService {
    private static cache = new Map<string, { report: WrappedReport; expires: number }>();
    private static CACHE_TTL = 3600 * 1000; // 1 hour

    static clearCache() {
        this.cache.clear();
    }

    static async getAvailablePeriods(): Promise<{ months: string[]; years: string[] }> {
        const db = getDb();
        const months = db.prepare(`
            SELECT DISTINCT strftime('%Y-%m', bucket_start) as month 
            FROM usage_records 
            ORDER BY month DESC
        `).all().map((r: any) => r.month);

        const years = db.prepare(`
            SELECT DISTINCT strftime('%Y', bucket_start) as year 
            FROM usage_records 
            ORDER BY year DESC
        `).all().map((r: any) => r.year);

        return { months, years };
    }

    static async getMonthlyReport(month: string): Promise<WrappedReport> {
        const cacheKey = `monthly-${month}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
            return cached.report;
        }

        const report = await this.generateReport(month, 'monthly');
        this.cache.set(cacheKey, { report, expires: Date.now() + this.CACHE_TTL });
        return report;
    }

    static async getYearlyReport(year: string): Promise<WrappedReport> {
        const cacheKey = `yearly-${year}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > Date.now()) {
            return cached.report;
        }

        const report = await this.generateReport(year, 'yearly');
        this.cache.set(cacheKey, { report, expires: Date.now() + this.CACHE_TTL });
        return report;
    }

    private static async generateReport(period: string, type: 'monthly' | 'yearly'): Promise<WrappedReport> {
        const db = getDb();
        const start = type === 'monthly' ? `${period}-01T00:00:00Z` : `${period}-01-01T00:00:00Z`;
        const end = type === 'monthly' ? this.getNextMonth(period) : `${Number(period) + 1}-01-01T00:00:00Z`;

        // 1. Core aggregates
        const usage = db.prepare(`
            SELECT 
                SUM(cost_usd) as total_spend,
                SUM(num_requests) as total_requests,
                SUM(input_tokens + output_tokens) as total_tokens,
                COUNT(DISTINCT date(bucket_start)) as days_active,
                MIN(bucket_start) as first_record,
                MAX(bucket_start) as last_record
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ?
        `).get(start, end) as any;

        const totalApiSpend = usage?.total_spend || 0;

        // 2. Subscriptions (Prorated)
        const subs = getSubscriptions(true);
        let totalSubSpend = 0;
        for (const sub of subs) {
            if (type === 'monthly') {
                totalSubSpend += sub.monthly_cost_usd;
            } else {
                totalSubSpend += sub.monthly_cost_usd * 12; // Simple yearly sum
            }
        }

        // 3. Breakdowns
        const byProvider = db.prepare(`
            SELECT provider, SUM(cost_usd) as spend
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ?
            GROUP BY provider
            ORDER BY spend DESC
        `).all(start, end) as any[];

        const providerMap = byProvider.reduce((acc, r) => ({ ...acc, [r.provider]: r.spend }), {});

        const byModel = db.prepare(`
            SELECT model, SUM(cost_usd) as spend, SUM(num_requests) as requests
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ?
            GROUP BY model
            ORDER BY spend DESC
            LIMIT 10
        `).all(start, end) as any[];

        // 4. Trends
        const daily = db.prepare(`
            SELECT date(bucket_start) as date, SUM(cost_usd) as spend
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ?
            GROUP BY date(bucket_start)
            ORDER BY date ASC
        `).all(start, end) as any[];

        const peak = [...daily].sort((a, b) => b.spend - a.spend)[0] || { date: 'N/A', spend: 0 };
        const trough = [...daily].filter(d => d.spend > 0).sort((a, b) => a.spend - b.spend)[0] || { date: 'N/A', spend: 0 };

        const dayOfWeek: Record<string, number> = { 'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0, 'Sun': 0 };
        const dowMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        daily.forEach(d => {
            const date = new Date(d.date);
            const dow = dowMap[date.getUTCDay()];
            dayOfWeek[dow] += d.spend;
        });

        // 5. App Breakdown (via Correlator)
        const appSpend = await AppCorrelator.getAppSpend('custom', start);
        // Note: AppCorrelator.getAppSpend takes a 'period' literal, not a specific date. 
        // For Wrapped, we'd ideally want historical correlations. 
        // For v1.9.0, we'll use current month if it's current, or note insufficient data for historical.
        const apps = appSpend.apps.map(a => ({ name: a.display_name, spend: a.estimated_cost_usd, connections: a.connection_count }));

        // 6. Insights
        const insights = this.generateInsights(db, start, end, totalApiSpend, totalSubSpend, apps);

        // 7. Top Session
        const topSession = db.prepare(`
            SELECT project_name, provider, estimated_cost_usd 
            FROM sessions 
            WHERE started_at >= ? AND started_at < ?
            ORDER BY estimated_cost_usd DESC 
            LIMIT 1
        `).get(start, end) as any;

        // 8. Agent Stats
        const agents = db.prepare(`
            SELECT 
                COUNT(*) as count,
                SUM(estimated_cost_usd) as total_cost,
                agent_type
            FROM subagents
            WHERE started_at >= ? AND started_at < ?
            GROUP BY agent_type
            ORDER BY count DESC
        `).all(start, end) as any[];

        const totalAgents = agents.reduce((sum, a) => sum + a.count, 0);
        const totalAgentCost = agents.reduce((sum, a) => sum + a.total_cost, 0);

        return {
            period,
            type,
            stats: {
                total_spend: totalApiSpend + totalSubSpend,
                total_requests: usage?.total_requests || 0,
                total_tokens: usage?.total_tokens || 0,
                days_active: usage?.days_active || 0,
                coverage_days: usage?.days_active || 0,
                period_start: usage?.first_record || start,
                period_end: usage?.last_record || end,
            },
            breakdowns: {
                by_source: { API: totalApiSpend, Subscriptions: totalSubSpend },
                by_provider: providerMap,
                by_model: byModel,
            },
            trends: {
                daily,
                peak_day: { date: peak.date, spend: peak.spend },
                trough_day: { date: trough.date, spend: trough.spend },
                day_of_week: dayOfWeek,
            },
            app_breakdown: apps,
            insights,
            top_session: topSession ? {
                project_name: topSession.project_name,
                provider: topSession.provider,
                cost_usd: topSession.estimated_cost_usd
            } : undefined,
            agent_stats: {
                total_agents: totalAgents,
                total_agent_cost: totalAgentCost,
                avg_agents_per_day: usage?.days_active > 0 ? totalAgents / usage.days_active : 0,
                most_active_type: agents[0]?.agent_type || 'None'
            }
        };
    }

    private static generateInsights(db: any, start: string, end: string, apiSpend: number, subSpend: number, apps: any[]): WrappedReport['insights'] {
        const insights: any[] = [];

        // Thresholds: Need at least 7 days of data and 20 requests for meaningful insights
        const summary = db.prepare(`
            SELECT SUM(num_requests) as requests, COUNT(DISTINCT date(bucket_start)) as days
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ?
        `).get(start, end) as any;

        if (!summary || (summary.requests || 0) < 20 || (summary.days || 0) < 7) {
            return [];
        }

        // 1. Model Optimization
        const opusRequests = db.prepare(`
            SELECT COUNT(*) as count, AVG(output_tokens) as avg_output
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ? AND model LIKE '%opus%'
        `).get(start, end) as any;

        if (opusRequests?.count > 50 && opusRequests.avg_output < 500) {
            const savings = opusRequests.count * 0.10; // Simple heuristic: $0.10 saved per request by switching to Haiku
            insights.push({
                type: 'model_optimization',
                title: 'Optimize Model Usage',
                description: `Your Claude Opus requests are mostly short (avg ${Math.round(opusRequests.avg_output)} tokens). switching to Haiku could save you significant cost.`,
                savings_usd: savings
            });
        }

        // 2. Cache Efficiency
        const cacheStats = db.prepare(`
            SELECT SUM(cache_read_tokens) as read, SUM(input_tokens) as input
            FROM usage_records
            WHERE bucket_start >= ? AND bucket_start < ? AND provider = 'anthropic'
        `).get(start, end) as any;

        if (cacheStats?.input > 20000) { // Only if > 20k input tokens
            const hitRate = cacheStats.read / (cacheStats.read + cacheStats.input);
            if (hitRate < 0.2) { // Only if rate is really low
                insights.push({
                    type: 'cache_efficiency',
                    title: 'Improve Cache Hit Rate',
                    description: `Your Anthropic cache hit rate is ${Math.round(hitRate * 100)}%. Using prompt caching for your repetitive systems could save up to 20% on costs.`,
                });
            }
        }

        // 3. Subscription Value
        const cursorApp = apps.find(a => a.name.toLowerCase().includes('cursor'));
        if (cursorApp && subSpend > 0 && cursorApp.connections > 100) { // Threshold: > 100 connections
            const estimatedApiCost = cursorApp.connections * 0.003; // Simple heuristic
            if (estimatedApiCost > subSpend * 1.5) {
                insights.push({
                    type: 'subscription_value',
                    title: 'Subscription Value: Excellent',
                    description: `Your Cursor subscription is saving you ~$${Math.round(estimatedApiCost - subSpend)}/month compared to equivalent API usage.`
                });
            }
        }

        // 4. Budget Compliance
        const alertCount = db.prepare(`
            SELECT COUNT(*) as count
            FROM alerts
            WHERE created_at >= ? AND created_at < ? AND type = 'budget_exceeded'
        `).get(start, end) as any;

        if (alertCount?.count > 3) {
            insights.push({
                type: 'budget_compliance',
                title: 'Review Budget Limits',
                description: `You exceeded your budget ${alertCount.count} times this period. Consider adjusting your limits to better match your workflow.`
            });
        }

        // 5. Agentic Growth (v1.10.0)
        const agentStats = db.prepare(`
            SELECT COUNT(*) as total, agent_type
            FROM subagents
            WHERE started_at >= ? AND started_at < ?
            GROUP BY agent_type
            ORDER BY total DESC
        `).all(start, end) as any[];

        if (agentStats.length > 0) {
            const total = agentStats.reduce((sum, a) => sum + a.total, 0);
            const topType = agentStats[0].agent_type;
            insights.push({
                type: 'budget_compliance',
                title: 'Agentic Growth',
                description: `Your agents spawned ${total} subagents this period. ${topType.charAt(0).toUpperCase() + topType.slice(1)} agents were your most active type.`
            });
        }

        return insights;
    }

    private static getNextMonth(month: string): string {
        const [y, m] = month.split('-').map(Number);
        const nextDate = new Date(Date.UTC(y, m, 1));
        return nextDate.toISOString();
    }

    static async getPreferences(): Promise<WrappedPreferences> {
        const db = getDb();
        const prefs = db.prepare('SELECT * FROM wrapped_preferences WHERE id = 1').get() as any;
        return {
            show_total_spend: !!prefs.show_total_spend,
            show_per_app: !!prefs.show_per_app,
            show_subscriptions: !!prefs.show_subscriptions,
            show_insights: !!prefs.show_insights,
        };
    }

    static async updatePreferences(updates: Partial<WrappedPreferences>) {
        const db = getDb();
        const current = await this.getPreferences();
        const next = { ...current, ...updates };
        db.prepare(`
            UPDATE wrapped_preferences SET
                show_total_spend = ?,
                show_per_app = ?,
                show_subscriptions = ?,
                show_insights = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `).run(
            next.show_total_spend ? 1 : 0,
            next.show_per_app ? 1 : 0,
            next.show_subscriptions ? 1 : 0,
            next.show_insights ? 1 : 0
        );
    }

    private static sanitizeForCard(text: string): string {
        if (!text) return 'None';
        // Remove common secret patterns (sk-, uuid-like, etc)
        let sanitized = text.replace(/sk-[a-zA-Z0-9]{20,}/g, '***');
        sanitized = sanitized.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '***');
        // If it looks like a workspace internal name (secret-99, etc)
        sanitized = sanitized.replace(/secret-[0-9]+/gi, '***');
        return sanitized;
    }

    static generateCardSVG(report: WrappedReport, prefs: WrappedPreferences): string {
        const { stats, breakdowns } = report;
        const total = prefs.show_total_spend ? `$${stats.total_spend.toFixed(2)}` : '****';
        const topModel = this.sanitizeForCard(breakdowns.by_model[0]?.model);
        
        return `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#0F172A" />
    <defs>
        <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#4F46E5;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#9333EA;stop-opacity:1" />
        </linearGradient>
    </defs>
    
    <!-- Header -->
    <text x="60" y="80" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#94A3B8">LLM OBSERVER</text>
    <text x="60" y="160" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="white">AI Wrapped ${report.period}</text>
    
    <!-- Main Stat -->
    <rect x="60" y="200" width="1080" height="4" fill="url(#grad1)" opacity="0.3" />
    <text x="60" y="300" font-family="Arial, sans-serif" font-size="24" fill="#94A3B8">TOTAL SPEND</text>
    <text x="60" y="380" font-family="Arial, sans-serif" font-size="96" font-weight="bold" fill="white">${total}</text>
    
    <!-- Sub Stats -->
    <g transform="translate(60, 480)">
        <text y="0" font-family="Arial, sans-serif" font-size="20" fill="#94A3B8">REQUESTS</text>
        <text y="45" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="white">${stats.total_requests.toLocaleString()}</text>
        
        <text x="300" y="0" font-family="Arial, sans-serif" font-size="20" fill="#94A3B8">TOP MODEL</text>
        <text x="300" y="45" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="white">${topModel}</text>
        
        <text x="700" y="0" font-family="Arial, sans-serif" font-size="20" fill="#94A3B8">DAYS ACTIVE</text>
        <text x="700" y="45" font-family="Arial, sans-serif" font-size="40" font-weight="bold" fill="white">${stats.days_active}</text>
    </g>
    
    <!-- Branding Footer -->
    <rect x="60" y="580" width="1080" height="2" fill="#1E293B" />
    <text x="60" y="610" font-family="Arial, sans-serif" font-size="16" fill="#475569">Tracked by LLM Observer — The Command Center for your AI Dollars</text>
</svg>
        `.trim();
    }
}
