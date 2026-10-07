import { getDb, getSessions, getSubagentsBySession, getSubscriptions, getBudgetLimits, getRequests } from '@llm-observer/database';
import { RuleContext } from './types';
import { DAY_MS } from '../utils/time';

export async function buildRuleContext(days: number = 30): Promise<RuleContext> {
    const db = getDb();
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);
    const dateStr = dateLimit.toISOString();

    // Fetch sessions in the period
    const sessions = getSessions({ from: dateStr, limit: 5000 }) as any[];

    // Fetch all subagents for these sessions
    // For performance in a real app, we might want a bulk fetcher, 
    // but for now we'll fetch what we need or all recent subagents.
    const subagents = db.prepare('SELECT * FROM subagents WHERE started_at >= ?').all(dateStr) as any[];

    // Tool usage summary
    const toolUsage = db.prepare(`
        SELECT tool_name, SUM(call_count) as total_calls, SUM(estimated_cost_usd) as total_cost
        FROM tool_usage_daily
        WHERE date >= ?
        GROUP BY tool_name
    `).all(dateStr.split('T')[0]) as any[];

    // Usage records (sync data)
    const usageRecords = getRequests({ created_at: dateStr, limit: 10000 }) as any[];

    // Budget alerts
    const budgetAlerts = db.prepare(`
        SELECT * FROM alerts WHERE created_at >= ? AND type = 'BUDGET_THRESHOLD'
    `).all(dateStr) as any[];

    // Daily costs
    const dailyCosts = db.prepare(`
        SELECT date(created_at) as date, SUM(cost_usd) as cost
        FROM requests
        WHERE created_at >= ?
        GROUP BY date(created_at)
    `).all(dateStr) as any[];

    // Active subscriptions
    const subscriptions = getSubscriptions(true);

    // ROI data: real daily spend series (reusing the query above rather than
    // a placeholder) — the base signal rules and the dashboard need to reason
    // about spend trends over time.
    const roiData = dailyCosts.map((d: any) => ({
        date: d.date,
        spend_usd: d.cost || 0
    }));

    // Days of data actually present: span back to the oldest session or request
    // in the window (at least 1 once any data exists), capped at the window.
    // Rules are gated on this, not on the requested window, so a fresh install
    // asked for 30 days is still a one-day install.
    const stamps = [
        ...sessions.map(s => Date.parse(s.started_at)),
        ...usageRecords.map(r => Date.parse(r.created_at as string)),
    ].filter(t => Number.isFinite(t));
    const dataDays = stamps.length === 0
        ? 0
        : Math.min(days, Math.max(1, Math.ceil((Date.now() - Math.min(...stamps)) / DAY_MS)));

    const anthropicSpendUsd = (db.prepare(`
        SELECT COALESCE(SUM(cost_usd), 0) as cost FROM requests
        WHERE provider = 'anthropic' AND created_at >= ?
    `).get(dateStr) as any)?.cost || 0;

    return {
        days,
        dataDays,
        anthropicSpendUsd,
        sessions,
        subagents,
        toolUsage,
        usageRecords,
        roiData,
        budgetAlerts,
        dailyCosts,
        subscriptions
    };
}
