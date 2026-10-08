import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { getPidPath } from '../pidFile';

export interface StopOptions {
    /** The server entry `start` spawns. Defaults to the bundled server.js next to this file. */
    serverPath?: string;
}

function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; }
}

/** The process's command-line arguments, or null where the platform cannot tell us. */
function readCommandLine(pid: number): string[] | null {
    try {
        if (process.platform === 'linux') {
            return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
        }
        if (process.platform === 'darwin') {
            const out = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', timeout: 3000 }).trim();
            return out ? [out] : null;
        }
        if (process.platform === 'win32') {
            // Windows has no /proc and no ps. PowerShell ships with every supported Windows; `pid` is a
            // validated integer, so nothing user-controlled reaches the command string.
            const out = execFileSync(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Math.trunc(pid)}").CommandLine`],
                { encoding: 'utf8', timeout: 15000, windowsHide: true }
            ).trim();
            return out ? [out] : null;
        }
    } catch { /* process vanished, or ps / PowerShell unavailable */ }
    return null;
}

/** Fallback where the command line is unavailable (Windows): does our server answer on its port? */
async function healthAnswersAsObserver(): Promise<boolean> {
    const port = process.env.LLM_OBSERVER_PROXY_PORT || process.env.PROXY_PORT || '4000';
    try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) return false;
        return ((await res.json()) as any)?.service === 'llm-observer-proxy';
    } catch {
        return false;
    }
}

/**
 * Is `pid` the server this CLI's `start` spawned? A pid file survives a crash,
 * SIGKILL or reboot and the pid may since have been reused by something else.
 */
async function isObserverServer(pid: number, serverPath: string): Promise<boolean> {
    const args = readCommandLine(pid);
    if (args) {
        // Windows paths are case-insensitive.
        const norm = (v: string) => (process.platform === 'win32' ? v.toLowerCase() : v);
        const wanted = norm(path.resolve(serverPath));
        return args.some(a => norm(a).includes(wanted));
    }
    return healthAnswersAsObserver();
}

export function setupStopCommands(program: Command, opts: StopOptions = {}) {
    program
        .command('stop')
        .description('Graceful shutdown utilizing local PID file')
        .action(async () => {
            // Same file `llm-observer start` writes (~/.llm-observer/observer.pid)
            const pidPath = getPidPath();
            if (!fs.existsSync(pidPath)) {
                console.log(chalk.gray('No background process found cleanly running from PID file.'));
                return;
            }
            const removePidFile = () => { try { fs.unlinkSync(pidPath); } catch { /* already gone */ } };

            const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
            if (!pid || isNaN(pid)) {
                console.log(chalk.yellow('Removed stale PID file (it did not contain a valid process id).'));
                removePidFile();
                return;
            }

            const serverPath = opts.serverPath ?? path.resolve(__dirname, 'server.js');
            if (!isAlive(pid) || !(await isObserverServer(pid, serverPath))) {
                console.log(chalk.yellow(`Removed stale PID file: process ${pid} is not a running LLM Observer server, so nothing was signalled.`));
                removePidFile();
                return;
            }

            console.log(chalk.yellow(`Stopping LLM Observer process (PID ${pid})...`));
            if (process.platform === 'win32') {
                // Node cannot deliver a catchable signal to a detached Windows process: kill() ends it at once, so up
                // to ~5 seconds of queued proxy rows are not flushed. Ctrl+C in the terminal running `start` is clean.
                console.log(chalk.gray('Note: on Windows this ends the server immediately; press Ctrl+C in the window running "llm-observer start" for a clean shutdown.'));
            }
            try {
                process.kill(pid, 'SIGINT'); // Or SIGTERM
                removePidFile();
                console.log(chalk.green(`Successfully stopped process.`));
            } catch (e: any) {
                console.error(chalk.red(`Failed to kill process ${pid}: ${e.message}`));
                removePidFile();
                process.exitCode = 1;
            }
        });
}
