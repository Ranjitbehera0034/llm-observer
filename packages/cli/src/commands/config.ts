import { Command } from 'commander';
import chalk from 'chalk';

export function setupConfigCommands(program: Command) {
    program
        .command('config')
        .description('View/edit LLM Observer settings')
        .action(async () => {
            console.log(chalk.blue('Configuration Settings:\\n'));
            console.log(`API URL: ${process.env.DASHBOARD_API_URL || 'http://localhost:4001'}`);
            console.log(`Port: 4000 (Proxy), 4001 (Dashboard)`);
            console.log(chalk.yellow('\\n(Config edits will be supported in future versions)'));
        });
}
