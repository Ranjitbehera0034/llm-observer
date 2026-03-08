import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';
import Table from 'cli-table3';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupProjectsCommands(program: Command) {
    program
        .command('projects')
        .description('List all active LLM projects and budget statuses')
        .action(async () => {
            try {
                const res = await fetch(`${DASHBOARD_API_URL}/api/projects`);

                if (!res.ok) {
                    console.log(chalk.red(`Failed to fetch projects. Status: ${res.status}`));
                    return;
                }

                const data = await res.json() as any;
                const projects = data.data;

                if (!projects || projects.length === 0) {
                    console.log(chalk.yellow('No active projects found.'));
                    return;
                }

                const table = new Table({
                    head: [
                        chalk.cyan('Project Name'),
                        chalk.cyan('ID'),
                        chalk.cyan('Requests Today'),
                        chalk.cyan('Spend Today'),
                        chalk.cyan('Daily Budget')
                    ],
                    style: { compact: true }
                });

                projects.forEach((p: any) => {
                    table.push([
                        p.name,
                        p.id,
                        p.total_requests_today.toLocaleString(),
                        `$${p.total_spend_today.toFixed(4)}`,
                        `$${p.daily_budget.toFixed(2)}`
                    ]);
                });

                console.log(chalk.bold('\n Active Projects:\n'));
                console.log(table.toString());

            } catch (err: any) {
                console.log(chalk.red(`Error reaching dashboard API: ${err.message}`));
                console.log(chalk.gray('Is the LLM proxy server running?'));
            }
        });
}
