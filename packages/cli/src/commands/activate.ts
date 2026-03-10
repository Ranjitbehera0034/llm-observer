import { Command } from 'commander';
import chalk from 'chalk';
import { activateLicense } from '@llm-observer/proxy';

export function setupActivateCommands(program: Command) {
    program
        .command('activate <key>')
        .description('Activate a Pro license key')
        .action(async (key: string) => {
            console.log(chalk.bold.blue('LLM Observer Activation\n'));

            try {
                const result = await activateLicense(key);

                if (result.success) {
                    console.log(`${chalk.green('✓')} ${result.message}`);
                    process.exit(0);
                } else {
                    console.error(`${chalk.red('✗')} ${result.message}`);
                    process.exit(1);
                }
            } catch (err: any) {
                console.error(`${chalk.red('✗')} An error occurred during activation:`, err.message);
                process.exit(1);
            }
        });
}
