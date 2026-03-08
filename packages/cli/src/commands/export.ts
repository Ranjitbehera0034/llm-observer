import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupExportCommands(program: Command) {
    program
        .command('export')
        .description('Export metrics data e.g. --format csv/json --range 30d')
        .option('--format <format>', 'Export format (json, csv)', 'json')
        .option('--range <range>', 'Time range (e.g. 30d)', '30d')
        .action(async (options) => {
            console.log(chalk.blue(`Exporting data for the last ${options.range} in ${options.format} format...\\n`));
            try {
                const res = await fetch(`${DASHBOARD_API_URL}/api/stats/chart`);
                const { data } = await res.json() as any;

                if (options.format === 'csv') {
                    console.log('Date,Cost,Requests');
                    data.forEach((d: any) => {
                        console.log(`${d.date},${d.cost},${d.requests}`);
                    });
                } else {
                    console.log(JSON.stringify(data, null, 2));
                }
            } catch (err: any) {
                console.error(chalk.red(`Failed to export data: ${err.message}`));
            }
        });
}
