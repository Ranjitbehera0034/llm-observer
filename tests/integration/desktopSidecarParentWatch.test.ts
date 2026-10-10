/**
 * P1: the desktop sidecar must not outlive the app that started it.
 * The parent-watch preload (packages/proxy/scripts/sidecar-parent-watch.js) is run for real:
 * a "shell" process starts a "sidecar" that preloads it, then the shell is SIGKILLed
 * (so nothing gets a chance to clean up) and the sidecar must go away on its own.
 * Linux/macOS only (uses process groups and SIGKILL semantics).
 */
import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';

const WATCH = path.resolve(__dirname, '../../packages/proxy/scripts/sidecar-parent-watch.js');
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The "shell" prints the pid of the "sidecar" it spawned and then idles.
const SHELL = `
const { spawn } = require('child_process');
const child = spawn(process.execPath, ['--require', ${JSON.stringify(WATCH)}, '-e', 'setInterval(() => {}, 1000)'], {
  env: { ...process.env, LLM_OBSERVER_PARENT_PID: String(process.pid), LLM_OBSERVER_PARENT_WATCH_MS: '100' },
  stdio: 'ignore',
});
console.log(child.pid);
setInterval(() => {}, 1000);
`;

async function startPair(): Promise<{ shell: ReturnType<typeof spawn>; sidecarPid: number }> {
    const shell = spawn(process.execPath, ['-e', SHELL], { stdio: ['ignore', 'pipe', 'ignore'] });
    const sidecarPid = await new Promise<number>((resolve, reject) => {
        shell.stdout!.once('data', (d) => resolve(Number(String(d).trim())));
        shell.once('error', reject);
        setTimeout(() => reject(new Error('shell did not report the sidecar pid')), 5000);
    });
    return { shell, sidecarPid };
}

describe.skipIf(process.platform === 'win32')('sidecar parent watch', () => {
    it('stops the sidecar when its parent is killed without cleanup', async () => {
        const { shell, sidecarPid } = await startPair();
        try {
            await sleep(400);
            expect(isAlive(sidecarPid)).toBe(true); // parent still alive: keeps running
            shell.kill('SIGKILL');
            let gone = false;
            for (let i = 0; i < 50 && !gone; i++) { await sleep(100); gone = !isAlive(sidecarPid); }
            expect(gone).toBe(true);
        } finally {
            try { process.kill(sidecarPid, 'SIGKILL'); } catch { /* already gone */ }
            shell.kill('SIGKILL');
        }
    }, 15000);

    it('does nothing without LLM_OBSERVER_PARENT_PID (npm CLI, Docker)', async () => {
        const child = spawn(process.execPath, ['--require', WATCH, '-e', 'setTimeout(() => process.exit(0), 700)'], {
            env: { PATH: process.env.PATH, LLM_OBSERVER_PARENT_WATCH_MS: '50' },
            stdio: 'ignore',
        });
        const code = await new Promise<number | null>((r) => child.once('exit', r));
        expect(code).toBe(0);
    });
});
