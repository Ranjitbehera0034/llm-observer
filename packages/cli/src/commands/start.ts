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

      // Resolve the bundled server relative to this file's location
      // Works both locally (dist/server.js) and after npm install
      const serverPath = path.resolve(__dirname, 'server.js');

      if (!fs.existsSync(serverPath)) {
        console.error(chalk.red(`Could not find server at: ${serverPath}`));
        console.error(chalk.yellow('Try reinstalling: npm install -g llm-observer'));
        return;
      }

      const child = spawn('node', [serverPath], {
        stdio: 'inherit',
        env: process.env
      });

      const pidPath = path.join(
        process.env.HOME || process.env.USERPROFILE || '',
        '.llm-observer',
        'observer.pid'
      );

      if (child.pid) {
        fs.mkdirSync(path.dirname(pidPath), { recursive: true });
        fs.writeFileSync(pidPath, child.pid.toString());
      }

      child.on('error', (err) => {
        console.error(chalk.red(`Failed to start: ${err.message}`));
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          console.log(chalk.yellow(`\nServices exited with code ${code}`));
        }
      });

      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nShutting down LLM Observer...'));
        if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
        child.kill('SIGINT');
        process.exit(0);
      });

      process.on('exit', () => {
        if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
      });
    });
}
