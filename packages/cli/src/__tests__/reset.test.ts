import { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupResetCommands } from '../commands/reset';

describe('reset command', () => {
    const envBefore = process.env.LLM_OBSERVER_DATA_DIR;
    let dir: string;
    let silence: jest.SpyInstance[];

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-reset-'));
        process.env.LLM_OBSERVER_DATA_DIR = dir;
        silence = [jest.spyOn(console, 'log').mockImplementation(() => {}), jest.spyOn(console, 'error').mockImplementation(() => {})];
    });
    afterEach(() => {
        silence.forEach(s => s.mockRestore());
        if (envBefore === undefined) delete process.env.LLM_OBSERVER_DATA_DIR; else process.env.LLM_OBSERVER_DATA_DIR = envBefore;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const run = async (...args: string[]) => {
        const program = new Command();
        setupResetCommands(program);
        await program.parseAsync(['node', 'llm-observer', 'reset', ...args]);
    };

    it('--force removes the database, its journals, pre-migration backups and .legacy.bak, but nothing else', async () => {
        const wiped = ['data.db', 'data.db-wal', 'data.db-shm', 'data.db.pre-migrate-v016-20260101T000000000Z.bak', 'data.db.legacy.bak'];
        const kept = ['settings.json', 'other.db'];
        for (const f of [...wiped, ...kept]) fs.writeFileSync(path.join(dir, f), 'PROMPT-BODY');
        fs.mkdirSync(path.join(dir, 'logs'));

        await run('--force');

        expect(fs.readdirSync(dir).sort()).toEqual([...kept].sort());
    });

    it('without --force deletes nothing', async () => {
        fs.writeFileSync(path.join(dir, 'data.db'), 'x');
        fs.writeFileSync(path.join(dir, 'data.db.pre-migrate-v016-20260101T000000000Z.bak'), 'x');
        await run();
        expect(fs.readdirSync(dir)).toHaveLength(2);
    });
});
