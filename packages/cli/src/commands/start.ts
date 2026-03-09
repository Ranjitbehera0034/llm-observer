import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { banner } from '../index';

export function setupStartCommands(program: Command) {
    program
        .command('start')
        .description('Boot up the Proxy Server and Dashboard UI concurrently')
        .action(() => {
            console.log(banner);
            console.log(chalk.blue('Starting LLM Observer Services...\n'));

            let proxyPath: string;
            try {
                // Look for the built proxy script
                proxyPath = require.resolve('@llm-observer/proxy');
            } catch (e: any) {
                console.error(chalk.red('Could not find @llm-observer/proxy. Have you built it?'));
                return;
            }

            // Spawn the compiled node proxy directly
            const child = spawn('node', [proxyPath], {
                stdio: 'inherit',
                shell: true,
                env: process.env
            });

            const pidPath = path.join(process.cwd(), '.llm-observer.pid');
            if (child.pid) {
                fs.writeFileSync(pidPath, child.pid.toString());
            }

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
                if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
                child.kill('SIGINT');
                process.exit(0);
            });

            process.on('exit', () => {
                if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
            });
        });
}
