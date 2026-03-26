import { getDb } from '@llm-observer/database';
import { getLicenseInfo } from './licenseManager';
import chalk from 'chalk';

export function startRetentionCleanup(intervalMs: number = 24 * 60 * 60 * 1000) {
    console.log(chalk.gray('Starting background retention cleanup task...'));

    // Run immediately then on interval
    runCleanup();
    setInterval(runCleanup, intervalMs);
}

async function runCleanup() {
    try {
        const info = await getLicenseInfo(true); // Force refresh to get latest limits
        const retentionDays = info.limits.logRetentionDays;

        const db = getDb();
        const deleteStmt = db.prepare(`
            DELETE FROM requests 
            WHERE created_at < datetime('now', '-' || ? || ' days')
        `);

        const result = deleteStmt.run(retentionDays);

        // Also purge app connections (fixed 30 day window)
        const appDeleteStmt = db.prepare(`
            DELETE FROM app_connections 
            WHERE timestamp < datetime('now', '-30 days')
        `);
        const appResult = appDeleteStmt.run();

        if (result.changes > 0 || appResult.changes > 0) {
            console.log(chalk.yellow(`[RETENTION] Purged ${result.changes} requests and ${appResult.changes} app connections.`));
        }
    } catch (err) {
        console.error('Retention Cleanup Error:', err);
    }
}
