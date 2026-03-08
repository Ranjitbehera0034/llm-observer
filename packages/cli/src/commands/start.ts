import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';

export function setupStartCommands(program: Command) {
    program
        .command('start-all')
        .description('Boot up the Proxy Server and Dashboard UI concurrently')
        .action(() => {
            console.log(chalk.blue('Starting LLM Observer Services...\\n'));

            // Spawn the root dev:all script which uses concurrently
            const child = spawn('npm', ['run', 'dev:all'], {
                stdio: 'inherit',
                shell: true
            });

            child.on('error', (err) => {
                console.error(chalk.red(`Failed to start processes: ${err.message}`));
            });

            child.on('exit', (code) => {
                if (code !== 0) {
                    console.log(chalk.yellow(`\nServices exited with code ${code}`));
                }
            });

            // Handle graceful shutdown of child processes on Ctrl+C
            process.on('SIGINT', () => {
                console.log(chalk.yellow('\\nShutting down LLM Observer processes...'));
                child.kill('SIGINT');
                process.exit(0);
            });
        });
}
