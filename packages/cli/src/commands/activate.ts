import { Command } from 'commander';
import chalk from 'chalk';

export function setupActivateCommands(program: Command) {
    program
        .command('activate <key>')
        .description('Activate a license key (Coming Soon)')
        .action(() => {
            console.log(chalk.bold.blue('LLM Observer Activation\n'));
            console.log(chalk.yellow('  License activation is planned for v2.0 (Sprint 6).'));
            console.log('  Currently, all features in v1.x are available for free.');
            console.log();
        });
}
