import { getDb, getSetting } from '@llm-observer/database';
import { getLicenseInfo } from './licenseManager';
import chalk from 'chalk';

export function startRetentionCleanup(intervalMs: number = 24 * 60 * 60 * 1000) {
    console.log(chalk.gray('Starting background retention cleanup task...'));

    // Run immediately then on interval
    runRetentionCleanup();
    setInterval(runRetentionCleanup, intervalMs);
}

export async function runRetentionCleanup() {
    try {
        const info = await getLicenseInfo(true); // Force refresh to get latest limits
        // Revoking Pro access must not destroy previously retained local history.
        // A saved license survives an outage, expiry, refund, or legacy-key
        // migration. Keep that installation's 90-day history window even when
        // its current feature tier is free; never extend retention indefinitely.
        // Fresh free installations continue using the 7-day retention window.
        const savedLicense = getSetting('license_key')?.trim();
        const hasLicenseHistory = !!savedLicense && /^(PRO_|sk_live_)/.test(savedLicense);
        const retentionDays = hasLicenseHistory ? 90 : info.limits.logRetentionDays;

        const db = getDb();
        const deleteStmt = db.prepare(`
            DELETE FROM requests 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `);

        const result = deleteStmt.run(retentionDays);

        // Also purge app connections (fixed 30 day window)
        const appDeleteStmt = db.prepare(`
            DELETE FROM app_connections 
            WHERE timestamp < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
              AND julianday(timestamp) < julianday('now', '-30 days')
        `);
        const appResult = appDeleteStmt.run();

        if (result.changes > 0 || appResult.changes > 0) {
            console.log(chalk.yellow(`[RETENTION] Purged ${result.changes} requests and ${appResult.changes} app connections.`));
        }
    } catch (err) {
        console.error('Retention Cleanup Error:', err);
    }
}
