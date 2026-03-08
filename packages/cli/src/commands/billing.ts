import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || 'http://localhost:4001';

export function setupBillingCommands(program: Command) {
    program
        .command('billing')
        .description('Manage Stripe enterprise subscription and billing session')
        .action(async () => {
            console.log(chalk.blue('Fetching secure Stripe checkout session...'));

            try {
                const res = await fetch(`${DASHBOARD_API_URL}/api/billing/stripe/session?plan=enterprise`);
                const data = await res.json() as any;

                if (data.url) {
                    console.log(chalk.green(`✓ Session Created Successfully!`));
                    console.log(`Open this URL to manage billing: ${chalk.underline(data.url)}`);
                } else {
                    console.log(chalk.yellow('Billing endpoint unavailable. Check your proxy server.'));
                }
            } catch (err: any) {
                console.error(chalk.red(`Failed to fetch billing session: ${err.message}`));
            }
        });
}
