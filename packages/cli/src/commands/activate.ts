import { Command } from 'commander';
import chalk from 'chalk';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:4001';

export function setupActivateCommands(program: Command) {
    program
        .command('activate <key>')
        .description('Activate a Pro license key')
        .action(async (key: string) => {
            console.log(chalk.bold.blue('LLM Observer Activation\n'));

            try {
                // FIX FUNC-01: Call REST API instead of importing proxy directly
                const response = await fetch(`${DASHBOARD_URL}/api/license/activate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });

                const data = await response.json() as any;

                if (response.ok && data.success) {
                    console.log(`${chalk.green('✓')} ${data.message}`);
                    process.exit(0);
                } else {
                    const msg = data.error || data.message || 'Activation failed';
                    console.error(`${chalk.red('✗')} ${msg}`);
                    if (response.status === 409) {
                        console.log(chalk.yellow('\nTo deactivate on another machine, run: llm-observer deactivate'));
                    }
                    process.exit(1);
                }
            } catch (err: any) {
                if (err.code === 'ECONNREFUSED') {
                    console.error(`${chalk.red('✗')} LLM Observer is not running. Start it first: ${chalk.cyan('llm-observer start')}`);
                } else {
                    console.error(`${chalk.red('✗')} Activation failed: ${err.message}`);
                }
                process.exit(1);
            }
        });
}
