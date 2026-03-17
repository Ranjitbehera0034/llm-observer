import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getRequests } from '@llm-observer/database';

export function setupLogsCommands(program: Command) {
    program
        .command('logs')
        .description('Fetch or tail recent proxy request logs')
        .option('--tail', 'Stream log output as it occurs from the database')
        .option('--limit <number>', 'Number of past requests to show', '20')
        .action(async (options) => {
            if (options.tail) {
                console.log(chalk.cyan('Tailing live requests from database... Press Ctrl+C to stop.'));

                let lastSeenTimestamp = new Date().toISOString();
                const seenIds = new Set<string>();

                const poll = async () => {
                    try {
                        // Poll for anything newer than what we've seen
                        const reqs = await getRequests({ limit: 50 }) as any[];

                        // Sort by created_at ascending to print in order
                        const sorted = [...reqs].sort((a, b) => a.created_at.localeCompare(b.created_at));

                        for (const r of sorted) {
                            if (seenIds.has(r.id)) continue;
                            if (r.created_at < lastSeenTimestamp && seenIds.size > 0) continue;

                            // Render line
                            const costStr = chalk.green(`$${r.cost_usd.toFixed(4)}`);
                            const timeStr = chalk.gray(new Date(r.created_at).toLocaleTimeString());
                            const statusStr = r.status_code >= 400 ? chalk.red(`[${r.status_code}]`) : chalk.blue(`[${r.status_code}]`);
                            console.log(`${timeStr} ${statusStr} [${r.provider} ${r.model}] ${r.total_tokens} tokens | ${costStr}`);

                            seenIds.add(r.id);
                            lastSeenTimestamp = r.created_at;

                            // Keep set size manageable
                            if (seenIds.size > 100) {
                                const firstKey = seenIds.values().next().value;
                                if (firstKey) seenIds.delete(firstKey);
                            }
                        }
                    } catch (e) { /* ignore db blips */ }
                };

                // Initialize with some history or just wait for new
                await poll();
                setInterval(poll, 1000);

            } else {
                // Fetch recent batch and format in table
                try {
                    const reqs = await getRequests({ limit: parseInt(options.limit) }) as any[];

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
                            statusColor(r.status_code || '???')
                        ]);
                    });

                    console.log(table.toString());

                } catch (err: any) {
                    console.log(chalk.red(`Failed to fetch logs: ${err.message}`));
                }
            }
        });
}
