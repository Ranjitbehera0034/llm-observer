import { getDb, updateSetting } from '@llm-observer/database';
import { getLicenseInfo } from './licenseManager';
import chalk from 'chalk';

export function startRetentionCleanup(intervalMs: number = 24 * 60 * 60 * 1000) {
    console.log(chalk.gray('Starting background retention cleanup task...'));

    // Run immediately then on interval
    runCleanup();
    setInterval(runCleanup, intervalMs);
}

export async function runCleanup() {
    try {
        const retentionDays = await effectiveRetentionDays();

        const db = getDb();
        let requestsPurged = 0;
        let alertsPurged = 0;
        // null: the licence is unresolved, so no log window is trustworthy. Deleting is
        // irreversible; skip it until the licence is confirmed one way or the other.
        if (retentionDays !== null) {
            // datetime() normalises both the ISO and the SQLite timestamp formats.
            requestsPurged = db.prepare(`
                DELETE FROM requests
                WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
            `).run(retentionDays).changes;

            // Alerts follow the same window as the requests that triggered them. Budget
            // alerts are kept: (budget_id, type, period_start) is what stops a budget from
            // re-firing, so purging one would resurrect an acknowledged alert. Their bodies
            // are already minimised.
            alertsPurged = db.prepare(`
                DELETE FROM alerts
                WHERE budget_id IS NULL
                  AND datetime(created_at) < datetime('now', '-' || ? || ' days')
            `).run(retentionDays).changes;
        }

        // Also purge app connections (fixed 30 day window)
        const appDeleteStmt = db.prepare(`
            DELETE FROM app_connections 
            WHERE timestamp < datetime('now', '-30 days')
        `);
        const appResult = appDeleteStmt.run();

        // Expired optimization results (expires_at is written as an ISO string).
        const cacheResult = db.prepare(`
            DELETE FROM optimization_cache
            WHERE datetime(expires_at) < datetime('now')
        `).run();

        if (requestsPurged > 0 || appResult.changes > 0 || alertsPurged > 0 || cacheResult.changes > 0) {
            console.log(chalk.yellow(`[RETENTION] Purged ${requestsPurged} requests, ${alertsPurged} alerts, ${appResult.changes} app connections and ${cacheResult.changes} expired optimization results.`));
        }
    } catch (err) {
        console.error('Retention Cleanup Error:', err);
    }
}

/**
 * How long to keep request logs, or null to delete nothing this run. Deleting is
 * irreversible, so the window only shrinks when the licence is confirmed gone
 * (cancelled/revoked, or never Pro). A licence that merely failed a local check
 * (integrityMismatch) is unresolved: never delete under uncertainty.
 */
async function effectiveRetentionDays(): Promise<number | null> {
    const info = await getLicenseInfo(true); // Force refresh to get latest limits

    if (info.integrityMismatch) {
        console.warn(chalk.yellow(`[RETENTION] ${info.notice} Skipping log deletion until it is resolved.`));
        return null;
    }

    const days = info.limits.logRetentionDays;
    updateSetting('last_good_retention_days', String(days));
    return days;
}
