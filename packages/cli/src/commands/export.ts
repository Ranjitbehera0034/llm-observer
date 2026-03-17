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
            console.log(chalk.blue(`Exporting data for the last ${options.range} in ${options.format} format...\n`));
            try {
                const days = parseInt(options.range.replace(/\D/g, '')) || 30;
                const res = await fetch(`${DASHBOARD_API_URL}/api/stats/export?format=${options.format}&days=${days}`);

                if (!res.ok) {
                    throw new Error(`Integration error (${res.status})`);
                }

                const body = await res.text();
                console.log(body);

            } catch (err: any) {
                console.error(chalk.red(`Failed to export data: ${err.message}`));
            }
        });
}
