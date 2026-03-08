import { Command } from 'commander';
import Table from 'cli-table3';
import chalk from 'chalk';
import { getDb, getStatsByProvider } from '@llm-observer/database';

export function setupStatsCommands(program: Command) {
    program
        .command('stats')
        .description('Show terminal stats display with --model and --provider filters')
        .option('--model <model>', 'Filter by model')
        .option('--provider <provider>', 'Filter by provider')
        .action(async (options) => {
            console.log(chalk.blue('Fetching stats...\\n'));
            try {
                let filtered: any = [];
                if (options.provider) {
                    const data = getStatsByProvider('default');
                    filtered = data;
                    if (options.model) {
                        filtered = filtered.filter((d: any) => d.model === options.model);
                    }
                } else {
                    const db = getDb();
                    const modelStmt = db.prepare(`
                        SELECT model, sum(cost_usd) as cost, sum(total_tokens) as tokens, count(*) as requests
                        FROM requests
                        WHERE project_id = ?
                        GROUP BY model
                        ORDER BY cost DESC
                    `);
                    filtered = modelStmt.all('default') as any[];
                    if (options.model) {
                        filtered = filtered.filter((d: any) => d.model === options.model);
                    }
                }

                const table = new Table({
                    head: [chalk.bold.white(options.provider ? 'Provider' : 'Model'), chalk.bold.white('Cost (USD)'), chalk.bold.white('Tokens'), chalk.bold.white('Requests')],
                    style: { head: [], border: [] }
                });

                filtered.forEach((d: any) => {
                    const key = options.provider ? d.provider : d.model;
                    table.push([key, `$${d.cost.toFixed(4)}`, d.tokens.toString(), d.requests.toString()]);
                });

                console.log(table.toString());

            } catch (err: any) {
                console.error(chalk.red(`Failed to fetch stats: ${err.message}`));
            }
        });
}
