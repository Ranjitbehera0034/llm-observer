import { getDb, Budget, getBudgetLimits, createAlert } from '@llm-observer/database';
import { estimateOutputTokens } from './costEstimator';
import { getPeriodStart, getPeriodStartDate, getPeriodStartLabel, getSecondsUntilPeriodReset, periodLabel } from '../utils/period';
import { spendLedger, Reservation } from './spendLedger';

/** What the guard sees for one budget: the three places spend can be. */
export interface SpendBreakdown {
    /** Rows in SQLite (proxy rows, plus admin-API sync rows) */
    recorded: number;
    /** Completed requests whose row is still waiting in the internalLogger batch (final cost) */
    queued: number;
    /** Estimated cost of admitted requests that are still running */
    reserved: number;
    /** recorded + queued + reserved */
    total: number;
}

export type AdmitResult = {
    blocked: boolean;
    type?: 'budget_exceeded' | 'budget_buffer' | 'budget_insufficient';
    reason?: string;
    details?: any;
    /** Present when the request was admitted: its estimate is held until release() */
    reservation?: Reservation;
};

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
        
        const periodStart = getPeriodStart(budget.period);

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
     * Implements Budget Guard v2 with three layers of protection, on committed spend
     * (recorded + queued + in-flight estimates). Does not reserve anything: use admit() on the
     * request path. Kept async for existing callers; it has no real await.
     */
    static async checkKillSwitch(
        provider: string, 
        model: string, 
        inputTokens: number,
        estimatedCost: number,
        maxOutputTokens?: number
    ): Promise<{ blocked: boolean, type?: 'budget_exceeded' | 'budget_buffer' | 'budget_insufficient', reason?: string, details?: any }> {
        return this.checkKillSwitchSync(provider, model, inputTokens, estimatedCost, maxOutputTokens);
    }

    /**
     * Check and reserve in one synchronous step. There is deliberately no await anywhere between
     * reading the spend and holding the estimate, so on a single event loop two requests can never
     * be admitted against the same headroom. The caller owns the returned reservation and must
     * release it when the request ends (the guard binds it to the response).
     */
    static admit(
        provider: string,
        model: string,
        projectId: string,
        inputTokens: number,
        estimatedCost: number,
        maxOutputTokens?: number
    ): AdmitResult {
        const check = this.checkKillSwitchSync(provider, model, inputTokens, estimatedCost, maxOutputTokens);
        if (check.blocked) return check;
        return { blocked: false, reservation: spendLedger.reserve({ provider, model, projectId, amountUsd: estimatedCost }) };
    }

    static checkKillSwitchSync(
        provider: string,
        model: string,
        inputTokens: number,
        estimatedCost: number,
        maxOutputTokens?: number
    ): AdmitResult {
        const budgets = getBudgetLimits(true).filter(b => b.kill_switch);
        
        for (const budget of budgets) {
            // Check if budget applies to this request
            const isMatch = (budget.scope === 'global') || 
                            (budget.scope === 'provider' && budget.scope_value === provider) ||
                            (budget.scope === 'model' && budget.scope_value === model);
            
            if (!isMatch) continue;

            const breakdown = this.spendBreakdown(budget.scope, budget.scope_value, budget.period);
            const spent = breakdown.total;
            const limit = budget.limit_usd;
            const buffer = budget.safety_buffer_usd || 0.05;
            const effectiveLimit = limit - buffer;
            const utilization = spent / limit;
            const parts = { recorded: breakdown.recorded, queued: breakdown.queued, in_flight_estimated: breakdown.reserved };
            // Budgets reconciled from the team policy say so, so a developer knows who to ask.
            const by = budget.source === 'team' ? ' This limit was set by your team.' : '';

            // Layer 1: Already Exceeded
            if (spent >= limit) {
                return { 
                    blocked: true, 
                    type: 'budget_exceeded',
                    reason: `${periodLabel(budget.period)} budget exceeded: $${spent.toFixed(2)} spent of $${limit.toFixed(2)} limit.${by}`,
                    details: { limit, spent, ...parts, scope: budget.scope, scope_value: budget.scope_value, retry_after: getSecondsUntilPeriodReset(budget.period) }
                };
            }

            // Layer 2: Safety Buffer Check
            if (spent >= effectiveLimit) {
                return {
                    blocked: true,
                    type: 'budget_buffer',
                    reason: `${periodLabel(budget.period)} budget nearly exhausted. $${(limit - spent).toFixed(2)} remaining (safety buffer: $${buffer.toFixed(2)}).${by}`,
                    details: { limit, spent, ...parts, remaining: limit - spent, buffer, scope: budget.scope, scope_value: budget.scope_value, retry_after: getSecondsUntilPeriodReset(budget.period) }
                };
            }

            // Layer 3: Pre-estimation Check
            // Only runs if utilization > 60% (Estimation threshold)
            if (utilization >= 0.60 && estimatedCost > 0) {
                if (spent + estimatedCost >= limit) {
                    return {
                        blocked: true,
                        type: 'budget_insufficient',
                        reason: `Insufficient ${budget.period} budget for this request. $${(limit - spent).toFixed(2)} remaining, estimated cost ~$${estimatedCost.toFixed(4)}.${by}`,
                        details: { 
                            limit, spent, ...parts, estimated: estimatedCost, 
                            input_tokens: inputTokens, 
                            output_tokens: estimateOutputTokens(inputTokens, budget.estimate_multiplier || 3.0, maxOutputTokens),
                            model, scope: budget.scope, scope_value: budget.scope_value, 
                            retry_after: getSecondsUntilPeriodReset(budget.period) 
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
     *
     * Recorded + queued spend: money that has actually been spent. In-flight estimates are NOT
     * included (this feeds the dashboard and alerts, which should show real spend). The kill switch
     * uses committedSpend() instead.
     */
    public static async calculateCurrentSpend(scope: string, value: string | undefined, period: string): Promise<number> {
        const b = this.spendBreakdown(scope, value, period);
        return b.recorded + b.queued;
    }

    /** What the kill switch compares with the limit: recorded + queued + in-flight estimates. */
    public static committedSpend(scope: string, value: string | undefined | null, period: string): number {
        return this.spendBreakdown(scope, value, period).total;
    }

    public static spendBreakdown(scope: string, value: string | undefined | null, period: string): SpendBreakdown {
        const db = getDb();
        const start = getPeriodStart(period);
        
        // 1. Get Sync costs in period. Sync buckets are UTC-day labels, so match them by calendar
        // date against the local period start rather than by instant against local midnight.
        let syncQuery = `SELECT SUM(cost_usd) as total FROM usage_records WHERE date(bucket_start) >= date(?)`;
        const syncParams: any[] = [getPeriodStartLabel(period)];
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
        const recorded = syncTotal + (proxyRows?.total || 0);

        // 4. Rows the proxy has completed but not flushed yet (same period start, same sync exclusion)
        const target = { scope, value };
        const queued = spendLedger.queuedUsd(target, getPeriodStartDate(period).getTime(), activeSyncProviders);

        // 5. Estimates of requests still running. These are held for every provider, including
        // sync-active ones: a running request's cost is not in any report yet.
        const reserved = spendLedger.reservedUsd(target);

        return { recorded, queued, reserved, total: recorded + queued + reserved };
    }

    /**
     * Returns the budget with the highest utilization for the given request context.
     * Used for informational headers (X-Budget-Warning).
     */
    static async getBudgetStatus(provider: string, model: string): Promise<{ percent: number, spent: number, limit: number, name: string, period: string } | null> {
        return this.getBudgetStatusSync(provider, model);
    }

    static getBudgetStatusSync(provider: string, model: string): { percent: number, spent: number, limit: number, name: string, period: string } | null {
        const budgets = getBudgetLimits(true);
        let maxUtilization = -1;
        let worstBudget: any = null;

        for (const budget of budgets) {
            const isMatch = (budget.scope === 'global') || 
                            (budget.scope === 'provider' && budget.scope_value === provider) ||
                            (budget.scope === 'model' && budget.scope_value === model);
            
            if (!isMatch) continue;

            const spent = this.committedSpend(budget.scope, budget.scope_value, budget.period);
            const utilization = spent / budget.limit_usd;
            
            if (utilization > maxUtilization) {
                maxUtilization = utilization;
                worstBudget = { percent: utilization, spent, limit: budget.limit_usd, name: budget.name, period: budget.period };
            }
        }

        return worstBudget;
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
