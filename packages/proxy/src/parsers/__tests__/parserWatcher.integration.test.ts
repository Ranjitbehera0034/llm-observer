import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { initDb, closeDb } from '@llm-observer/database';
import sessionsRoutes from '../../routes/sessions.routes';
import { ADAPTERS } from '../registry';
import { createParserManager, ParserManager } from '../manager';
import { waitFor, sleep } from './watchHelpers';

/**
 * End to end for the fast path: a real temp "home", real fs.watch, the real Claude adapter, a real (in-memory)
 * database and the real /api/sessions route. The 5-minute safety-net timer is far longer than this test, so a
 * session that appears can only have come from the watcher.
 */

/** Recursive fs.watch is Node 20+ on Linux; if this platform lacks it the watcher falls back to polling, which has its own test. */
const recursiveWatchSupported = (): boolean => {
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-probe-'));
    try {
        const w = fs.watch(probe, { recursive: true }, () => undefined);
        w.close();
        return true;
    } catch {
        return false;
    } finally {
        fs.rmSync(probe, { recursive: true, force: true });
    }
};
const supported = recursiveWatchSupported();
const maybe = supported ? describe : describe.skip;
if (!supported) console.warn('[parserWatcher.integration] recursive fs.watch is unsupported on this platform; skipping the real-watcher tests');

const app = express();
app.use('/api/sessions', sessionsRoutes);

const claudeLine = (n: number, session: string) => JSON.stringify({
    type: 'assistant',
    timestamp: new Date(Date.UTC(2026, 6, 1, 10, 0, n)).toISOString(),
    sessionId: session,
    requestId: `req_${session}_${n}`,
    message: {
        id: `msg_${session}_${n}`,
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'x' }],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
}) + '\n';

const sessionList = async (): Promise<any[]> => (await request(app).get('/api/sessions?limit=100')).body.data ?? [];

maybe('fast path: file watcher to sessions API', () => {
    let home: string;
    let projects: string;
    let manager: ParserManager | undefined;
    const savedWatch = process.env.LLM_OBSERVER_WATCH;

    beforeEach(() => {
        delete process.env.LLM_OBSERVER_WATCH;
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-e2e-'));
        projects = path.join(home, '.claude', 'projects');
        fs.mkdirSync(path.join(projects, '-proj-a'), { recursive: true });
        jest.spyOn(os, 'homedir').mockReturnValue(home);
        jest.spyOn(console, 'log').mockImplementation(() => undefined); // migration and parser chatter
        closeDb();
        initDb(':memory:');
    });

    afterEach(async () => {
        await manager?.stop();
        manager = undefined;
        jest.restoreAllMocks();
        closeDb();
        if (savedWatch === undefined) delete process.env.LLM_OBSERVER_WATCH; else process.env.LLM_OBSERVER_WATCH = savedWatch;
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('shows a line appended to a Claude log, and a brand new session in a new project directory, within seconds', async () => {
        const file = path.join(projects, '-proj-a', 'sess-one.jsonl');
        fs.writeFileSync(file, claudeLine(1, 'sess-one'));

        manager = createParserManager({ adapters: ADAPTERS.filter(a => a.id === 'claude-code'), intervalMs: 5 * 60 * 1000 });
        manager.init();
        // initial full parse
        await waitFor(async () => (await sessionList()).length === 1, 10_000, 100);
        expect((await sessionList())[0].input_tokens).toBe(100);
        await waitFor(() => manager!.watcherInfo().length > 0, 5000, 50);
        expect(manager.watcherInfo()[0]).toMatchObject({ id: 'claude-code', mode: 'watch' });

        // 1. append a line to the existing log
        const t0 = Date.now();
        fs.appendFileSync(file, claudeLine(2, 'sess-one'));
        const appendedAfter = await waitFor(async () => {
            const s = await sessionList();
            return s.length === 1 && s[0].input_tokens === 200;
        }, 12_000, 100);
        console.warn(`[parserWatcher.integration] appended line visible in the sessions API after ${Date.now() - t0}ms`);
        expect(appendedAfter).toBeLessThan(10_000);

        // 2. a new project directory with a new session (recursive watch must see directories created after start)
        fs.mkdirSync(path.join(projects, '-proj-b'));
        fs.writeFileSync(path.join(projects, '-proj-b', 'sess-two.jsonl'), claudeLine(1, 'sess-two'));
        await waitFor(async () => (await sessionList()).length === 2, 12_000, 100);
    }, 40_000);

    it('LLM_OBSERVER_WATCH=0 turns the watcher off: nothing is watched and a change is not picked up', async () => {
        process.env.LLM_OBSERVER_WATCH = '0';
        const file = path.join(projects, '-proj-a', 'sess-one.jsonl');
        fs.writeFileSync(file, claudeLine(1, 'sess-one'));
        manager = createParserManager({ adapters: ADAPTERS.filter(a => a.id === 'claude-code'), intervalMs: 5 * 60 * 1000 });
        manager.init();
        await waitFor(async () => (await sessionList()).length === 1, 10_000, 100);
        expect(manager.watcherInfo()).toEqual([]);
        fs.appendFileSync(file, claudeLine(2, 'sess-one'));
        await sleep(3500);
        expect((await sessionList())[0].input_tokens).toBe(100);
    }, 30_000);

    it('stop() closes the watchers: later changes are not parsed', async () => {
        const file = path.join(projects, '-proj-a', 'sess-one.jsonl');
        fs.writeFileSync(file, claudeLine(1, 'sess-one'));
        manager = createParserManager({ adapters: ADAPTERS.filter(a => a.id === 'claude-code'), intervalMs: 5 * 60 * 1000 });
        manager.init();
        await waitFor(async () => (await sessionList()).length === 1, 10_000, 100);
        await waitFor(() => manager!.watcherInfo().length > 0, 5000, 50);
        await manager.stop();
        expect(manager.watcherInfo()).toEqual([]);
        fs.appendFileSync(file, claudeLine(2, 'sess-one'));
        await sleep(3500);
        expect((await sessionList())[0].input_tokens).toBe(100);
    }, 30_000);

    it('does not react to writes inside the database directory even when it sits inside a watched tree', async () => {
        const dataDir = path.join(projects, '.llm-observer-data');
        fs.mkdirSync(dataDir);
        const savedDataDir = process.env.LLM_OBSERVER_DATA_DIR;
        process.env.LLM_OBSERVER_DATA_DIR = dataDir;
        try {
            const parse = jest.fn(async () => undefined);
            const adapter = {
                ...ADAPTERS.find(a => a.id === 'claude-code')!,
                id: 'probe',
                parse,
            };
            manager = createParserManager({ adapters: [adapter], intervalMs: 5 * 60 * 1000 });
            manager.init();
            await waitFor(() => manager!.watcherInfo().length > 0 && parse.mock.calls.length >= 1, 10_000, 50);
            const before = parse.mock.calls.length;
            for (let i = 0; i < 5; i++) { fs.appendFileSync(path.join(dataDir, 'data.db-wal'), 'x'.repeat(100)); await sleep(100); }
            await sleep(3500);
            expect(parse.mock.calls.length).toBe(before);
            // but a real change next to it still triggers
            fs.writeFileSync(path.join(projects, '-proj-a', 'new.jsonl'), claudeLine(1, 'new'));
            await waitFor(() => parse.mock.calls.length > before, 10_000, 100);
        } finally {
            if (savedDataDir === undefined) delete process.env.LLM_OBSERVER_DATA_DIR; else process.env.LLM_OBSERVER_DATA_DIR = savedDataDir;
        }
    }, 40_000);
});
