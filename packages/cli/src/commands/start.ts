import { Command } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { banner } from '../index';
import { getPidPath } from '../pidFile';

// How long the server gets to shut down gracefully after a signal before it is killed.
const SHUTDOWN_GRACE_MS = 10000;

export interface StartOptions {
  /** Server entry to spawn. Defaults to the bundled server.js next to this file. */
  serverPath?: string;
}

export function setupStartCommands(program: Command, opts: StartOptions = {}) {
  program
    .command('start')
    .description('Boot up the Proxy Server and Dashboard UI concurrently')
    .action(() => {
      console.log(banner);
      console.log(chalk.blue('Starting LLM Observer Services...\n'));

      // Resolve the bundled server relative to this file's location
      // Works both locally (dist/server.js) and after npm install
      const serverPath = opts.serverPath ?? path.resolve(__dirname, 'server.js');

      if (!fs.existsSync(serverPath)) {
        console.error(chalk.red(`Could not find server at: ${serverPath}`));
        console.error(chalk.yellow('Try reinstalling: npm install -g llm-observer'));
        return;
      }

      const child = spawn('node', [serverPath], {
        stdio: 'inherit',
        env: process.env
      });

      const pidPath = getPidPath();

      if (child.pid) {
        fs.mkdirSync(path.dirname(pidPath), { recursive: true });
        fs.writeFileSync(pidPath, child.pid.toString());
      }

      child.on('error', (err) => {
        console.error(chalk.red(`Failed to start: ${err.message}`));
      });

      let childExited = false;
      child.on('exit', (code) => {
        childExited = true;
        if (code !== 0) {
          console.log(chalk.yellow(`\nServices exited with code ${code}`));
        }
      });

      const removePidFile = () => {
        try { fs.unlinkSync(pidPath); } catch { /* already gone */ }
      };

      // SIGTERM (docker stop, systemd, kill) and SIGHUP (terminal closed) get the
      // same treatment as Ctrl-C: forward the signal so the server shuts down
      // gracefully, then leave. Without this the CLI dies by default disposition
      // and orphans the server, which keeps holding its ports.
      let shuttingDown = false;
      const shutdown = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(chalk.yellow('\nShutting down LLM Observer...'));
        removePidFile();
        if (childExited) process.exit(0);
        child.once('exit', () => process.exit(0));
        child.kill(signal);
        setTimeout(() => {
          child.kill('SIGKILL');
          process.exit(0);
        }, SHUTDOWN_GRACE_MS).unref();
      };
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.on(signal, () => shutdown(signal));
      }

      process.on('exit', removePidFile);
    });
}
