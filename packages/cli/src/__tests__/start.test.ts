import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';

// start.ts imports the banner from the CLI entry point, which parses process.argv.
jest.mock('../index', () => ({ banner: '' }));

import { setupStartCommands } from '../commands/start';
import { getPidPath } from '../pidFile';

function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(fn: () => boolean, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await new Promise(r => setTimeout(r, 25));
    }
    return fn();
}

describe('llm-observer start: signal handling', () => {
    const origHome = process.env.HOME;
    const origProfile = process.env.USERPROFILE;
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    let tmpHome: string;
    let serverPath: string;
    let baseline: Record<string, NodeJS.SignalsListener[]>;
    let exitSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;
    let childPid: number | undefined;

    beforeEach(() => {
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-start-'));
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        // Fake server: ignores nothing, exits on SIGINT/SIGTERM like the real one.
        serverPath = path.join(tmpHome, 'server.js');
        fs.writeFileSync(serverPath, `
            process.on('SIGINT', () => process.exit(0));
            process.on('SIGTERM', () => process.exit(0));
            console.log('fake server up');
            setInterval(() => {}, 1000);
        `);
        baseline = {};
        for (const s of signals) baseline[s] = process.listeners(s) as NodeJS.SignalsListener[];
        exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        if (childPid && isAlive(childPid)) { try { process.kill(childPid, 'SIGKILL'); } catch { /* gone */ } }
        childPid = undefined;
        for (const s of signals) {
            for (const l of process.listeners(s)) {
                if (!baseline[s].includes(l as NodeJS.SignalsListener)) process.removeListener(s, l as NodeJS.SignalsListener);
            }
        }
        exitSpy.mockRestore();
        logSpy.mockRestore();
        process.env.HOME = origHome;
        if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    async function startFakeServer(): Promise<number> {
        const program = new Command();
        setupStartCommands(program, { serverPath });
        await program.parseAsync(['node', 'llm-observer', 'start']);
        const pidPath = getPidPath();
        expect(await waitFor(() => fs.existsSync(pidPath), 5000)).toBe(true);
        childPid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
        expect(isAlive(childPid)).toBe(true);
        return childPid;
    }

    it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('forwards %s to the server, removes the pid file and exits', async (sig) => {
        const pid = await startFakeServer();
        const pidPath = getPidPath();

        process.emit(sig as any, sig as any);

        expect(await waitFor(() => !isAlive(pid), 5000)).toBe(true);
        expect(fs.existsSync(pidPath)).toBe(false);
        expect(await waitFor(() => exitSpy.mock.calls.length > 0, 5000)).toBe(true);
        expect(exitSpy).toHaveBeenCalledWith(0);
    });
});
