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
            console.log(chalk.bold.blue('LLM Observer Status\n'));

            try {
                // Check Proxy
                const proxyRes = await fetch(`${PROXY_URL}/health`);
                if (proxyRes.ok) {
                    console.log(`${chalk.green('✓')} Proxy Server:    ${chalk.bold('Online')}  on port 4000`);
                } else {
                    console.log(`${chalk.yellow('⚠')} Proxy Server:    ${chalk.bold('Degraded')} on port 4000`);
                }
            } catch (err) {
                console.log(`${chalk.red('✗')} Proxy Server:    ${chalk.bold('Offline')}  (expected port 4000)`);
            }

            try {
                // Check Dashboard API
                const dashRes = await fetch(`${DASHBOARD_API_URL}/api/stats/overview`);
                if (dashRes.ok) {
                    console.log(`${chalk.green('✓')} Dashboard UI:   ${chalk.bold('Online')}  on port 4001`);

                    const stats = await dashRes.json() as any;
                    console.log(chalk.cyan('\n--- Today\'s Performance ---'));
                    console.log(`Spend:         ${chalk.bold.green('$' + stats.todaySpendUsd.toFixed(4))}`);
                    console.log(`Requests:      ${stats.totalRequestsToday.toLocaleString()}`);
                    console.log(`Tokens:        ${stats.totalTokensToday.toLocaleString()}`);

                } else {
                    console.log(`${chalk.yellow('⚠')} Dashboard UI:   ${chalk.bold('Degraded')} on port 4001`);
                }
            } catch (err) {
                console.log(`${chalk.red('✗')} Dashboard UI:   ${chalk.bold('Offline')}  (expected port 4001)`);
            }
        });
}
