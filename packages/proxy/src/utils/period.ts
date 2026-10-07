/**
 * Single source of truth for "which day/week/month are we in" for every
 * budget check (project guard, provider/model/global budgets, dashboard).
 *
 * Boundaries are LOCAL midnight (matching the "today" shown across the
 * dashboard); the returned instants are absolute, so they compare correctly
 * against UTC timestamps stored in SQLite.
 */

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

/** Start of the current period (local midnight; Monday for weekly; the 1st for monthly). */
export function getPeriodStartDate(period: string, now: Date = new Date()): Date {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (period === 'weekly') {
        const day = start.getDay();
        start.setDate(start.getDate() - day + (day === 0 ? -6 : 1)); // Adjust to Monday
    } else if (period === 'monthly') {
        start.setDate(1);
    }

    return start;
}

/** Start of the next period, i.e. when the current budget window resets. */
export function getNextPeriodStartDate(period: string, now: Date = new Date()): Date {
    const next = getPeriodStartDate(period, now);

    if (period === 'weekly') {
        next.setDate(next.getDate() + 7);
    } else if (period === 'monthly') {
        next.setMonth(next.getMonth() + 1, 1);
    } else {
        next.setDate(next.getDate() + 1);
    }

    return next;
}

/** ISO string of the period start, for SQL comparisons. */
export function getPeriodStart(period: string, now: Date = new Date()): string {
    return getPeriodStartDate(period, now).toISOString();
}

/**
 * Period start as a calendar-date label, for tables bucketed by UTC day (usage_records from the
 * admin-API sync). Returns '<local y>-<local m>-<local d>T00:00:00.000Z' for the local period
 * start, so "the UTC bucket labelled with today's local date" counts as today in every time zone.
 */
export function getPeriodStartLabel(period: string, now: Date = new Date()): string {
    const start = getPeriodStartDate(period, now);
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(start.getFullYear(), 4)}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T00:00:00.000Z`;
}

export function getSecondsUntilPeriodReset(period: string, now: Date = new Date()): number {
    return Math.max(0, Math.floor((getNextPeriodStartDate(period, now).getTime() - now.getTime()) / 1000));
}

/** Human label for block messages: 'Daily' | 'Weekly' | 'Monthly'. */
export function periodLabel(period: string): string {
    if (period === 'weekly') return 'Weekly';
    if (period === 'monthly') return 'Monthly';
    return 'Daily';
}
