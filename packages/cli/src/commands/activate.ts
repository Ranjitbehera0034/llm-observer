import { Command } from 'commander';
import fetch from 'node-fetch';
import chalk from 'chalk';

const DASHBOARD_API_URL = process.env.DASHBOARD_API_URL || `http://127.0.0.1:${process.env.LLM_OBSERVER_PORT || '4001'}`;

export function setupActivateCommands(program: Command) {
    program
        .command('activate <key>')
        .description('Activate a Pro license key')
        .action(async (key: string) => {
            console.log(chalk.bold.blue('LLM Observer Activation\n'));

            try {
                const res = await fetch(`${DASHBOARD_API_URL}/api/license/activate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key }),
                });
                const data = await res.json() as any;

                if (res.ok && data.success) {
                    console.log(chalk.green('✓'), data.message || 'License activated successfully!');
                } else {
                    console.log(chalk.red('✗'), data.error || 'Activation failed.');
                    process.exitCode = 1;
                }
            } catch (err) {
                console.log(chalk.red('✗'), 'Could not reach LLM Observer.');
                console.log(chalk.gray(`  Is it running? Start it with ${chalk.cyan('llm-observer start')} first.`));
                process.exitCode = 1;
            }
            console.log();
        });
}
