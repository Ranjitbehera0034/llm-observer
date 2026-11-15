import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || `http://127.0.0.1:${process.env.LLM_OBSERVER_PORT || '4001'}`;

export function setupBillingCommands(program: Command) {
    program
        .command('billing')
        .description('Show license status and billing info')
        .action(async () => {
            console.log();
            console.log(chalk.bold.cyan('  LLM Observer — Billing'));
            console.log(chalk.gray('  ────────────────────────────────────'));

            try {
                const res = await fetch(`${DASHBOARD_API_URL}/api/license/status`);
                if (!res.ok) throw new Error('Could not load billing');
                const { data } = await res.json() as any;

                if (data?.isPro) {
                    console.log(`\n  ${chalk.yellow('★')} Plan: ${chalk.bold.yellow('Pro')} (${data.status})`);
                    console.log(`  Projects: ${chalk.bold(String(data.limits.maxProjects))}`);
                    console.log(`  Log retention: ${chalk.bold(data.limits.logRetentionDays + ' days')}`);
                } else {
                    console.log(`\n  Plan: ${chalk.bold('Free')}`);
                    console.log(`  Projects: ${chalk.bold(data?.limits?.maxProjects ?? 1)}`);
                    console.log(`  Log retention: ${chalk.bold((data?.limits?.logRetentionDays ?? 7) + ' days')}`);
                    console.log(`\n  Upgrade to Pro ($9/mo or $79/year) at ${chalk.cyan('https://www.llm-observer.com/#pricing')}`);
                    console.log(`  Then run ${chalk.cyan('llm-observer activate <key>')} with the key emailed to you.`);
                }
            } catch (err) {
                console.log(chalk.red('\n  ✗ Could not reach LLM Observer.'));
                console.log(chalk.gray(`    Is it running? Start it with ${chalk.cyan('llm-observer start')} first.`));
                process.exitCode = 1;
            }
            console.log();
        });
}
