import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';
import Table from 'cli-table3';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupLogsCommands(program: Command) {
    program
        .command('logs')
        .description('Fetch or tail recent proxy request logs')
        .option('--tail', 'Stream log output as it occurs via SSE')
        .option('--limit <number>', 'Number of past requests to show', '20')
        .action(async (options) => {
            if (options.tail) {
                console.log(chalk.cyan('Tailing live requests... Press Ctrl+C to stop.'));
                // Note: fetch in node doesn't natively support easy text/event-stream parsing like EventSource in browser.
                // For a robust CLI tail, we would typically stream the res.body chunks manually or use a library like 'eventsource'.
                // For simplicity in Day 4, we will mock the tail by polling the regular REST endpoint if tail is enabled.

                let lastSeenId = '';

                const poll = async () => {
                    try {
                        const res = await fetch(`${DASHBOARD_API_URL}/api/requests?limit=10`);
                        if (res.ok) {
                            const data = await res.json() as any;
                            const reqs = data.data;

                            // Iterate backwards to print oldest first
                            for (let i = reqs.length - 1; i >= 0; i--) {
                                const r = reqs[i];
                                if (r.id > lastSeenId) {
                                    // Render line
                                    const costStr = chalk.green(`$${r.cost_usd.toFixed(4)}`);
                                    const timeStr = chalk.gray(new Date(r.created_at).toLocaleTimeString());
                                    const statusStr = r.status_code >= 400 ? chalk.red(`[${r.status_code}]`) : chalk.blue(`[${r.status_code}]`);
                                    console.log(`${timeStr} ${statusStr} [${r.provider} ${r.model}] ${r.total_tokens} tokens | ${costStr}`);

                                    lastSeenId = r.id;
                                }
                            }
                        }
                    } catch (e) { /* ignore network blips while polling */ }
                };

                // Seed it immediately, then poll
                await poll();
                setInterval(poll, 1500);

            } else {
                // Fetch recent batch and format in table
                try {
                    const res = await fetch(`${DASHBOARD_API_URL}/api/requests?limit=${options.limit}`);
                    if (!res.ok) throw new Error(`Status ${res.status}`);

                    const data = await res.json() as any;
                    const reqs = data.data;

                    const table = new Table({
                        head: [
                            chalk.cyan('ID'),
                            chalk.cyan('Time'),
                            chalk.cyan('Model'),
                            chalk.cyan('Tokens'),
                            chalk.cyan('Cost'),
                            chalk.cyan('Status')
                        ],
                        style: { compact: true }
                    });

                    reqs.forEach((r: any) => {
                        const statusColor = r.status_code >= 400 ? chalk.red : chalk.green;
                        table.push([
                            r.id.split('-')[0], // Abbreviate ID
                            new Date(r.created_at).toLocaleTimeString(),
                            r.model,
                            r.total_tokens,
                            `$${r.cost_usd.toFixed(4)}`,
                            statusColor(r.status_code)
                        ]);
                    });

                    console.log(table.toString());

                } catch (err: any) {
                    console.log(chalk.red(`Failed to fetch logs: ${err.message}`));
                }
            }
        });
}
