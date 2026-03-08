import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const PROXY_URL = process.env.PROXY_URL || 'http://localhost:4000';
const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupStatusCommands(program: Command) {
    program
        .command('status')
        .description('Check if the proxy and dashboard server are online')
        .action(async () => {
            console.log(chalk.blue('Checking services...\\n'));

            try {
                // Check Proxy
                const proxyRes = await fetch(`${PROXY_URL}/health`);
                if (proxyRes.ok) {
                    console.log(chalk.green('✓ Proxy Server:     Online') + chalk.gray(` (${PROXY_URL})`));
                } else {
                    console.log(chalk.red('✗ Proxy Server:     Degraded'));
                }
            } catch (err) {
                console.log(chalk.red('✗ Proxy Server:     Offline'));
            }

            try {
                // Check Dashboard API
                const dashRes = await fetch(`${DASHBOARD_API_URL}/api/stats/overview`);
                if (dashRes.ok) {
                    console.log(chalk.green('✓ Dashboard API:    Online') + chalk.gray(` (${DASHBOARD_API_URL})`));

                    const stats = await dashRes.json() as any;
                    console.log(chalk.cyan('\n--- Today\'s Stats ---'));
                    console.log(`Total Spend:   ${chalk.bold('$' + stats.todaySpendUsd.toFixed(4))}`);
                    console.log(`Total Tokens:  ${stats.totalTokensToday.toLocaleString()}`);
                    console.log(`Requests:      ${stats.totalRequestsToday.toLocaleString()}`);

                } else {
                    console.log(chalk.red('✗ Dashboard API:    Degraded'));
                }
            } catch (err) {
                console.log(chalk.red('✗ Dashboard API:    Offline'));
            }
        });
}
