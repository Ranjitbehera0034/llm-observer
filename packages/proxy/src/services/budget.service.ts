import { getDb } from '@llm-observer/database';
import { Budget, getBudgetLimits } from '../../../database/src/repositories/budgets.repo';
import { createAlert } from '../../../database/src/repositories/alerts.repo';

export class BudgetService {
    
    /**
     * Context A: Periodic evaluation (e.g. after sync)
     * Checks all budgets and creates alerts if thresholds are hit.
     */
    static async evaluateAll() {
        const budgets = getBudgetLimits(true);
        for (const budget of budgets) {
            await this.evaluateBudget(budget);
        }
    }

    /**
     * Evaluate a specific budget and fire alerts if thresholds are crossed.
     */
    static async evaluateBudget(budget: Budget) {
        const spend = await this.calculateCurrentSpend(budget.scope, budget.scope_value, budget.period);
        const percent = spend / budget.limit_usd;
        
        const periodStart = this.getPeriodStart(budget.period);

        // Check thresholds: 100%, 90%, 80% (Each fires independently)
        if (percent >= 1.0) {
            await this.fireAlert(budget, 'budget_exceeded', 'critical', spend, periodStart);
        }
        if (percent >= (budget.warning_pct_2 || 0.90)) {
            await this.fireAlert(budget, 'budget_warning_90', 'warning', spend, periodStart);
        }
        if (percent >= (budget.warning_pct_1 || 0.80)) {
            await this.fireAlert(budget, 'budget_warning_80', 'info', spend, periodStart);
        }
    }

    /**
     * Context B: Real-time kill switch check for proxy requests.
     * Implements Budget Guard v2 with three layers of protection.
     */
    static async checkKillSwitch(
        provider: string, 
        model: string, 
        inputTokens: number,
        estimatedCost: number
    ): Promise<{ blocked: boolean, type?: 'budget_exceeded' | 'budget_buffer' | 'budget_insufficient', reason?: string, details?: any }> {
        const budgets = getBudgetLimits(true).filter(b => b.kill_switch);
        
        for (const budget of budgets) {
            // Check if budget applies to this request
            const isMatch = (budget.scope === 'global') || 
                            (budget.scope === 'provider' && budget.scope_value === provider) ||
                            (budget.scope === 'model' && budget.scope_value === model);
            
            if (!isMatch) continue;

            const spent = await this.calculateCurrentSpend(budget.scope, budget.scope_value, budget.period);
            const limit = budget.limit_usd;
            const buffer = budget.safety_buffer_usd || 0.05;
            const effectiveLimit = limit - buffer;
            const utilization = spent / limit;

            // Layer 1: Already Exceeded
            if (spent >= limit) {
                return { 
                    blocked: true, 
                    type: 'budget_exceeded',
                    reason: `Daily budget exceeded: $${spent.toFixed(2)} spent of $${limit.toFixed(2)} limit.`,
                    details: { limit, spent, scope: budget.scope, scope_value: budget.scope_value, retry_after: this.getSecondsUntilPeriodReset(budget.period) }
                };
            }

            // Layer 2: Safety Buffer Check
            if (spent >= effectiveLimit) {
                return {
                    blocked: true,
                    type: 'budget_buffer',
                    reason: `Budget nearly exhausted. $${(limit - spent).toFixed(2)} remaining (safety buffer: $${buffer.toFixed(2)}).`,
                    details: { limit, spent, remaining: limit - spent, buffer, scope: budget.scope, scope_value: budget.scope_value, retry_after: this.getSecondsUntilPeriodReset(budget.period) }
                };
            }

            // Layer 3: Pre-estimation Check
            // Only runs if utilization > 60% (Estimation threshold)
            if (utilization >= 0.60 && estimatedCost > 0) {
                if (spent + estimatedCost >= limit) {
                    return {
                        blocked: true,
                        type: 'budget_insufficient',
                        reason: `Insufficient budget for this request. $${(limit - spent).toFixed(2)} remaining, estimated cost ~$${estimatedCost.toFixed(4)}.`,
                        details: { 
                            limit, spent, estimated: estimatedCost, 
                            input_tokens: inputTokens, 
                            output_tokens: inputTokens * (budget.estimate_multiplier || 3.0),
                            model, scope: budget.scope, scope_value: budget.scope_value, 
                            retry_after: this.getSecondsUntilPeriodReset(budget.period) 
                        }
                    };
                }
            }
        }

        return { blocked: false };
    }

    /**
     * Dual-source spend aggregator (Sync preferred over Proxy)
     * Matches logic from Overview Routes v1.3.1
     */
    public static async calculateCurrentSpend(scope: string, value: string | undefined, period: string): Promise<number> {
        const db = getDb();
        const start = this.getPeriodStart(period);
        
        // 1. Get Sync costs in period
        let syncQuery = `SELECT SUM(cost_usd) as total FROM usage_records WHERE bucket_start >= ?`;
        const syncParams: any[] = [start];
        if (scope === 'provider') { syncQuery += ' AND provider = ?'; syncParams.push(value); }
        if (scope === 'model') { syncQuery += ' AND model = ?'; syncParams.push(value); }
        
        const syncRows = db.prepare(syncQuery).get(...syncParams) as any;
        const syncTotal = syncRows?.total || 0;

        // 2. Get Sync-active providers to deduplicate proxy logs
        const activeSyncProviders = db.prepare("SELECT id FROM usage_sync_configs WHERE status = 'active'").all().map((r: any) => r.id);

        // 3. Get Proxy costs in period (excluding sync-active providers)
        let proxyQuery = `SELECT SUM(cost_usd) as total FROM requests WHERE datetime(created_at) >= datetime(?)`;
        const proxyParams: any[] = [start];
        
        if (activeSyncProviders.length > 0) {
            proxyQuery += ` AND provider NOT IN (${activeSyncProviders.map(() => '?').join(',')})`;
            proxyParams.push(...activeSyncProviders);
        }

        if (scope === 'provider') { proxyQuery += ' AND provider = ?'; proxyParams.push(value); }
        if (scope === 'model') { proxyQuery += ' AND model = ?'; proxyParams.push(value); }

        const proxyRows = db.prepare(proxyQuery).get(...proxyParams) as any;
        const proxyTotal = proxyRows?.total || 0;

        return syncTotal + proxyTotal;
    }

    /**
     * Returns the budget with the highest utilization for the given request context.
     * Used for informational headers (X-Budget-Warning).
     */
    static async getBudgetStatus(provider: string, model: string): Promise<{ percent: number, spent: number, limit: number, name: string } | null> {
        const budgets = getBudgetLimits(true);
        let maxUtilization = -1;
        let worstBudget: any = null;

        for (const budget of budgets) {
            const isMatch = (budget.scope === 'global') || 
                            (budget.scope === 'provider' && budget.scope_value === provider) ||
                            (budget.scope === 'model' && budget.scope_value === model);
            
            if (!isMatch) continue;

            const spent = await this.calculateCurrentSpend(budget.scope, budget.scope_value, budget.period);
            const utilization = spent / budget.limit_usd;
            
            if (utilization > maxUtilization) {
                maxUtilization = utilization;
                worstBudget = { percent: utilization, spent, limit: budget.limit_usd, name: budget.name };
            }
        }

        return worstBudget;
    }

    private static getPeriodStart(period: string): string {
        const now = new Date();
        now.setUTCHours(0, 0, 0, 0);

        if (period === 'weekly') {
            const day = now.getUTCDay();
            const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
            now.setUTCDate(diff);
        } else if (period === 'monthly') {
            now.setUTCDate(1);
        }
        
        return now.toISOString();
    }

    private static getSecondsUntilPeriodReset(period: string): number {
        const now = new Date();
        const next = new Date(now);
        next.setUTCHours(23, 59, 59, 999);
        
        if (period === 'weekly') {
            const day = now.getUTCDay();
            const daysUntilMonday = day === 0 ? 0 : 8 - day;
            next.setUTCDate(now.getUTCDate() + daysUntilMonday);
        } else if (period === 'monthly') {
            next.setUTCMonth(now.getUTCMonth() + 1, 0); // Last day of month
        }
        
        return Math.floor((next.getTime() - now.getTime()) / 1000);
    }

    private static async fireAlert(budget: Budget, type: string, severity: 'info' | 'warning' | 'critical', spend: number, periodStart: string) {
        try {
            const message = `${budget.name} (${budget.scope}) is at ${(spend / budget.limit_usd * 100).toFixed(0)}% of its ${budget.period} limit ($${spend.toFixed(2)} / $${budget.limit_usd.toFixed(2)}).`;
            
            const db = getDb();
            const exists = db.prepare('SELECT 1 FROM alerts WHERE budget_id = ? AND type = ? AND period_start = ?').get(budget.id, type, periodStart);
            if (exists) return;

            db.prepare(`
                INSERT INTO alerts (budget_id, type, severity, scope, scope_value, message, current_spend_usd, limit_usd, period_start, acknowledged)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            `).run(
                budget.id, 
                type, 
                severity, 
                budget.scope, 
                budget.scope_value || null, 
                message, 
                spend, 
                budget.limit_usd, 
                periodStart
            );
        } catch (err: any) {
            if (!err.message.includes('UNIQUE constraint failed')) {
                console.error('[BudgetService] Failed to fire alert:', err.message);
            }
        }
    }
}
