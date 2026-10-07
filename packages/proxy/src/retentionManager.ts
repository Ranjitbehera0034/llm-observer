import { getDb, getSetting, updateSetting } from '@llm-observer/database';
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
        const deleteStmt = db.prepare(`
            DELETE FROM requests 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `);

        const result = deleteStmt.run(retentionDays);

        // Alerts follow the same window as the requests that triggered them.
        // datetime() normalises both the ISO and the SQLite timestamp formats.
        const alertResult = db.prepare(`
            DELETE FROM alerts
            WHERE datetime(created_at) < datetime('now', '-' || ? || ' days')
        `).run(retentionDays);

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

        if (result.changes > 0 || appResult.changes > 0 || alertResult.changes > 0 || cacheResult.changes > 0) {
            console.log(chalk.yellow(`[RETENTION] Purged ${result.changes} requests, ${alertResult.changes} alerts, ${appResult.changes} app connections and ${cacheResult.changes} expired optimization results.`));
        }
    } catch (err) {
        console.error('Retention Cleanup Error:', err);
    }
}

/**
 * How long to keep request logs. Deleting is irreversible, so the window only
 * shrinks when the licence is confirmed gone (cancelled/revoked, or never Pro);
 * a licence that merely failed a local check keeps the last window known good.
 */
async function effectiveRetentionDays(): Promise<number> {
    const info = await getLicenseInfo(true); // Force refresh to get latest limits
    const days = info.limits.logRetentionDays;

    if (info.integrityMismatch) {
        const lastGood = parseInt(getSetting('last_good_retention_days') || '', 10);
        if (lastGood > days) {
            console.warn(chalk.yellow(`[RETENTION] ${info.notice} Keeping the ${lastGood}-day log window until it is resolved.`));
            return lastGood;
        }
        return days;
    }

    updateSetting('last_good_retention_days', String(days));
    return days;
}
