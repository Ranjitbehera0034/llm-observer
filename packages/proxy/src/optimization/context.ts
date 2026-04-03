import { getDb, getSessions, getSubagentsBySession, getSubscriptions, getBudgetLimits, getRequests } from '@llm-observer/database';
import { RuleContext } from './types';

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

    // ROI Data (placeholders for now if not fully implemented in DB)
    const roiData: any[] = []; 

    return {
        days,
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
