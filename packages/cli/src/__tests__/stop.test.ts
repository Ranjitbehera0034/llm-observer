import { Command } from 'commander';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupStopCommands } from '../commands/stop';
import { getPidPath } from '../pidFile';

function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitForExit(pid: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (!isAlive(pid)) return true;
        await new Promise(r => setTimeout(r, 25));
    }
    return !isAlive(pid);
}

describe('llm-observer stop', () => {
    const origHome = process.env.HOME;
    const origProfile = process.env.USERPROFILE;
    let tmpHome: string;
    let child: ReturnType<typeof spawn> | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-stop-'));
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
    });

    afterEach(() => {
        if (child?.pid && isAlive(child.pid)) child.kill('SIGKILL');
        child = undefined;
        process.env.HOME = origHome;
        if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('terminates the process recorded in the pid file that `start` writes', async () => {
        // Same location and format start.ts uses: <home>/.llm-observer/observer.pid
        child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        const pid = child.pid!;
        const pidPath = getPidPath();
        expect(pidPath).toBe(path.join(tmpHome, '.llm-observer', 'observer.pid'));
        fs.mkdirSync(path.dirname(pidPath), { recursive: true });
        fs.writeFileSync(pidPath, pid.toString());
        expect(isAlive(pid)).toBe(true);

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const program = new Command();
            setupStopCommands(program);
            await program.parseAsync(['node', 'llm-observer', 'stop']);
        } finally {
            logSpy.mockRestore();
        }

        expect(await waitForExit(pid, 5000)).toBe(true);
        expect(fs.existsSync(pidPath)).toBe(false);
    });

    it('reports cleanly when nothing is running', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
            const program = new Command();
            setupStopCommands(program);
            await program.parseAsync(['node', 'llm-observer', 'stop']);
            expect(logSpy.mock.calls.flat().join('\n')).toMatch(/No background process/);
        } finally {
            logSpy.mockRestore();
        }
    });
});
