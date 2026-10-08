/**
 * Spend the database cannot see yet.
 *
 * The kill switch compares a budget with what has been spent. SQLite only knows about requests
 * whose log row has been flushed (internalLogger writes in batches of 10 rows or every 5 seconds),
 * and a request's real cost is only known once its response has finished. Without help, a burst of
 * requests is admitted before any of them counts. This module supplies the two missing pieces:
 *
 *   queued    completed requests whose row is still waiting in the internalLogger batch. Their cost
 *             is final. They are read straight from that queue (never copied), so a flush moves a
 *             row from "queued" to "recorded" in a single synchronous step: it is counted once.
 *
 *   reserved  requests that were admitted and are still running. Each holds its pre-flight estimate
 *             (costEstimator) from admission until it completes, is aborted, or fails. On completion
 *             the proxy puts the final-cost row on the queue and then releases the reservation in
 *             the same synchronous block, so the money is never in both places and never in neither.
 *
 * What is NOT here, on purpose:
 *  - It is not keyed by budget. A reservation is one record (provider, model, project, amount) and
 *    is matched against every budget at read time. Budgets can be created, edited or deleted while
 *    a request is in flight; there is nothing to keep consistent, and a request that matches a
 *    global, a provider and a model budget is reserved once, not three times.
 *  - There is no per-period bucketing of reservations. A request that is in flight at midnight is
 *    recorded with its completion time, i.e. in the NEW period, so it correctly counts there.
 *    Queued rows carry their own created_at and are filtered by the same period start the SQL uses,
 *    so a row queued at 23:59 and flushed at 00:01 belongs to yesterday on both sides.
 *
 * Everything is in process memory: it covers traffic sent through THIS proxy process only.
 */
import { internalLogger } from '../internalLogger';

export type SpendScope = 'global' | 'provider' | 'model' | 'project';

export interface SpendTarget {
    scope: SpendScope | string;
    value?: string | null;
}

export interface ReservationInput {
    provider: string;
    model: string;
    projectId: string;
    /** The pre-flight estimate, in USD. Non-finite or negative values reserve 0. */
    amountUsd: number;
}

export interface Reservation {
    readonly id: number;
    readonly amountUsd: number;
    /** Gives the money back. Idempotent. */
    release(): void;
}

interface Entry {
    provider: string;
    model: string;
    projectId: string;
    amountUsd: number;
}

const matches = (target: SpendTarget, row: { provider?: string | null; model?: string | null; project_id?: string | null }): boolean => {
    switch (target.scope) {
        case 'provider': return row.provider === target.value;
        case 'model': return row.model === target.value;
        case 'project': return row.project_id === target.value;
        default: return true; // 'global'
    }
};

/** created_at as epoch ms. Proxy rows are ISO; tolerate SQLite's 'YYYY-MM-DD HH:MM:SS' (UTC) and absent values. */
const toMs = (v: unknown): number => {
    if (typeof v === 'string' && v) {
        const iso = /(?:Z|[+-]\d\d:?\d\d)$/.test(v) ? v : `${v.replace(' ', 'T')}Z`;
        const ms = Date.parse(iso);
        if (!Number.isNaN(ms)) return ms;
    }
    return Date.now(); // a row without a time is stamped at flush time, i.e. "now"
};

const inFlight = new Map<number, Entry>();
let nextId = 1;
const byRequest = new WeakMap<object, Reservation>();

export const spendLedger = {
    /**
     * Holds `amountUsd` against every budget this request matches until release() is called.
     * Synchronous: the guard calls this in the same tick as its check, so two requests can never
     * both see the same headroom.
     */
    reserve(input: ReservationInput): Reservation {
        const id = nextId++;
        const amountUsd = Number.isFinite(input.amountUsd) && input.amountUsd > 0 ? input.amountUsd : 0;
        inFlight.set(id, { provider: input.provider, model: input.model, projectId: input.projectId, amountUsd });
        return {
            id,
            amountUsd,
            release: () => { inFlight.delete(id); },
        };
    },

    release(reservation: Reservation | undefined | null): void {
        reservation?.release();
    },

    /** Estimated cost of the requests currently running that fall under `target`. */
    reservedUsd(target: SpendTarget): number {
        let total = 0;
        for (const e of inFlight.values()) {
            if (matches(target, { provider: e.provider, model: e.model, project_id: e.projectId })) total += e.amountUsd;
        }
        return total;
    },

    /**
     * Final cost of completed requests under `target` that are still waiting in the internalLogger
     * batch, created at or after `sinceMs`. `excludeProviders` mirrors the SQL in
     * BudgetService.calculateCurrentSpend: providers whose spend is read from the admin-API sync
     * are not counted from proxy rows, queued or not.
     */
    queuedUsd(target: SpendTarget, sinceMs: number, excludeProviders: readonly string[] = []): number {
        let total = 0;
        for (const row of internalLogger.getQueued()) {
            if (row.status === 'blocked_budget') continue;
            if (!matches(target, row)) continue;
            if (excludeProviders.length > 0 && excludeProviders.includes(row.provider)) continue;
            if (toMs(row.created_at) < sinceMs) continue;
            const cost = Number(row.cost_usd);
            if (Number.isFinite(cost) && cost > 0) total += cost;
        }
        return total;
    },

    /** Ties a reservation to the request/response pair so it can never outlive the response. */
    bindToRequest(req: object, res: { once?(event: string, cb: () => void): unknown }, reservation: Reservation): void {
        byRequest.set(req, reservation);
        // 'finish' covers a response that completed (or was refused by a later guard); 'close' covers a
        // client that went away first. Whichever comes first wins; release() is idempotent. (A real
        // http.ServerResponse always has once(); the check only spares hand-rolled test doubles.)
        if (typeof res.once !== 'function') return;
        res.once('finish', reservation.release);
        res.once('close', reservation.release);
    },

    /** Releases whatever is reserved for this request. Called after the final-cost row is queued. */
    releaseForRequest(req: object): void {
        const r = byRequest.get(req);
        if (r) {
            r.release();
            byRequest.delete(req);
        }
    },

    /** Number of requests currently holding a reservation. */
    inFlight(): number {
        return inFlight.size;
    },

    totalReservedUsd(): number {
        return spendLedger.reservedUsd({ scope: 'global' });
    },

    /** Test hook. */
    _resetForTests(): void {
        inFlight.clear();
    },
};
