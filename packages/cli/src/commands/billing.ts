import { Command } from 'commander';
import chalk from 'chalk';

export function setupBillingCommands(program: Command) {
    program
        .command('billing')
        .description('Manage billing (Coming Soon)')
        .action(() => {
            console.log();
            console.log(chalk.bold.cyan('  LLM Observer — Billing'));
            console.log(chalk.gray('  ────────────────────────────────────'));
            console.log(`\n  ${chalk.yellow('Coming Soon!')} We are finalizing our payment integrations for Sprint 6.`);
            console.log('  LLM Observer will remain free and open-source for personal use.');
            console.log();
        });
}
