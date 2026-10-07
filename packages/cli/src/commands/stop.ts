import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import { getPidPath } from '../pidFile';

export function setupStopCommands(program: Command) {
    program
        .command('stop')
        .description('Graceful shutdown utilizing local PID file')
        .action(async () => {
            // Same file `llm-observer start` writes (~/.llm-observer/observer.pid)
            const pidPath = getPidPath();
            if (fs.existsSync(pidPath)) {
                const pidStr = fs.readFileSync(pidPath, 'utf8');
                const pid = parseInt(pidStr.trim(), 10);
                if (pid && !isNaN(pid)) {
                    console.log(chalk.yellow(`Stopping LLM Observer process (PID ${pid})...`));
                    try {
                        process.kill(pid, 'SIGINT'); // Or SIGTERM
                        fs.unlinkSync(pidPath);
                        console.log(chalk.green(`Successfully stopped process.`));
                    } catch (e: any) {
                        console.error(chalk.red(`Failed to kill process ${pid} or already closed: ${e.message}`));
                        fs.unlinkSync(pidPath);
                    }
                }
            } else {
                console.log(chalk.gray('No background process found cleanly running from PID file.'));
            }
        });
}
