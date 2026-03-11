import { getDb, createAlert } from '@llm-observer/database';
import chalk from 'chalk';

export function startAnomalyDetection(intervalMs: number = 60 * 60 * 1000) {
    console.log(chalk.gray('Starting background anomaly detector...'));

    // Run immediately then on interval
    _detectAnomalies();
    setInterval(_detectAnomalies, intervalMs);
}

export async function _detectAnomalies() {
    try {
        const db = getDb();

        // 1. Fetch webhook_url alongside id and name
        const projects = db.prepare('SELECT id, name, webhook_url FROM projects').all() as any[];

        for (const project of projects) {
            // 1. Get avg hourly spend for this project over last 2 days
            const avgStmt = db.prepare(`
                SELECT AVG(hourly_cost) as avg_cost
                FROM (
                    SELECT strftime('%Y-%m-%d %H:00:00', created_at) as hour, sum(cost_usd) as hourly_cost
                    FROM requests
                    WHERE project_id = ? AND created_at >= datetime('now', '-2 days')
                    GROUP BY hour
                )
            `);
            const avgResult = avgStmt.get(project.id) as any;
            const avgHourlySpend = avgResult?.avg_cost || 0;

            // 2. Get current hour spend
            const currentStmt = db.prepare(`
                SELECT sum(cost_usd) as current_cost
                FROM requests
                WHERE project_id = ? AND created_at >= datetime('now', '-1 hour')
            `);
            const currentResult = currentStmt.get(project.id) as any;
            const currentHourSpend = currentResult?.current_cost || 0;

            // 3. Compare and alert
            // Threshold: 5x average AND at least $0.01 (to avoid noise on tiny spends)
            if (avgHourlySpend > 0 && currentHourSpend > (avgHourlySpend * 5) && currentHourSpend > 0.01) {
                console.log(chalk.red(`[ANOMALY] Spike detected in project ${project.name}: $${currentHourSpend.toFixed(4)} vs avg $${avgHourlySpend.toFixed(4)}`));

                createAlert({
                    project_id: project.id,
                    type: 'anomaly',
                    severity: 'critical',
                    message: `Spend spike detected: Current hour spend ($${currentHourSpend.toFixed(4)}) is >5x the average ($${avgHourlySpend.toFixed(4)}).`,
                    data: JSON.stringify({
                        current: currentHourSpend,
                        average: avgHourlySpend,
                        timestamp: new Date().toISOString()
                    })
                });

                // 2. Fire the webhook if it exists (Slack/Discord compatible payload)
                if (project.webhook_url) {
                    try {
                        await fetch(project.webhook_url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                text: `🚨 *LLM Observer Anomaly Alert* 🚨\n*Project:* ${project.name}\nSpend spike detected: Current hour spend ($${currentHourSpend.toFixed(4)}) is >5x the average ($${avgHourlySpend.toFixed(4)}).`
                            })
                        });
                        console.log(chalk.green(`✓ Webhook fired for ${project.name}`));
                    } catch (webhookErr) {
                        console.error(chalk.yellow(`Failed to fire webhook for ${project.name}:`), webhookErr);
                    }
                }
            }
        }
    } catch (err) {
        console.error('Anomaly Detection Error:', err);
    }
}
