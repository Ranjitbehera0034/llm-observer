import { Command } from 'commander';
import chalk from 'chalk';

export function setupUpgradeCommands(program: Command) {
    program
        .command('upgrade')
        .description('Upgrade to Pro to unlock unlimited projects and longer retention')
        .action(() => {
            const pricingUrl = 'https://llmobserver.com/pricing';
            console.log(chalk.bold.blue('LLM Observer Upgrade\n'));
            console.log('Unlock the full power of LLM Observer:');
            console.log(`${chalk.green('✓')} Unlimited Projects (Free: 1)`);
            console.log(`${chalk.green('✓')} 90-Day Log Retention (Free: 7 days)`);
            console.log(`${chalk.green('✓')} Priority Support`);
            console.log(`${chalk.green('✓')} Advanced Insights`);
            console.log('\nReady to upgrade? Visit:');
            console.log(chalk.underline.bold.cyan(pricingUrl));
            console.log(`\nAfter purchasing, use ${chalk.yellow('llm-observer activate <key>')} to enable Pro features.`);
        });
}
