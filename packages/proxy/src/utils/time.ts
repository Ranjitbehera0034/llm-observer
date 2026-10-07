/**
 * Timestamp helpers for comparing stored ISO-8601 text ('2026-10-07T00:30:00.000Z')
 * against a cutoff.
 *
 * Never compare an ISO column against SQLite's datetime('now', ...) as text:
 * datetime() yields '2026-10-07 02:00:00' and 'T' sorts after ' ', so every row
 * on the cutoff's calendar date passes. Compute the cutoff in JS and bind it,
 * and wrap both sides in datetime() so rows written by a column DEFAULT
 * (CURRENT_TIMESTAMP, space-separated) still compare correctly.
 */

/** ISO-8601 timestamp `ms` before `nowMs` (default: now). */
export function isoAgo(ms: number, nowMs: number = Date.now()): string {
    return new Date(nowMs - ms).toISOString();
}

/** ISO-8601 timestamp for 00:00:00 UTC of the day containing `nowMs`. */
export function startOfUtcDayIso(nowMs: number = Date.now()): string {
    const d = new Date(nowMs);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
}

/**
 * SQL predicate `col >= <bound ISO cutoff>` that is safe for both ISO and
 * SQLite-format values in `col`. Bind exactly one ISO string for the `?`.
 * `col` must be a trusted column identifier, never user input.
 */
export function sqlAtOrAfter(col: string): string {
    return `datetime(${col}) >= datetime(?)`;
}

/** SQL predicate `col > <bound ISO cutoff>`; see sqlAtOrAfter. */
export function sqlAfter(col: string): string {
    return `datetime(${col}) > datetime(?)`;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
