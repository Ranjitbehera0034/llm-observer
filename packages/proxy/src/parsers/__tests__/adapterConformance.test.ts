import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDb, closeDb, getDb } from '@llm-observer/database';
import { ADAPTERS } from '../registry';
import { createParserManager } from '../manager';
import type { ParserAdapter } from '../adapter';

/**
 * Conformance suite: every adapter in the registry must pass every test here, so a contributor adding an
 * agent gets the checklist enforced instead of read. Real files and a real (in-memory) database are used;
 * only the home directory is redirected to a temp dir.
 *
 * To add an agent: write the adapter, list it in registry.ts, and (for a 'verified' adapter) add a seeder below
 * that copies its recording into the layout the tool writes. Adapters without a seeder are still checked on an
 * empty home.
 */

const FIXTURES = path.join(__dirname, 'fixtures');
const matrix = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'format-matrix.json'), 'utf8'));
const matrixKeys = Object.keys(matrix).filter(k => !k.startsWith('_'));

const copyTree = (from: string, to: string, keep: (name: string) => boolean = () => true) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, e.name);
        const dest = path.join(to, e.name);
        if (e.isDirectory()) copyTree(src, dest, keep);
        else if (keep(e.name)) fs.copyFileSync(src, dest);
    }
};

const vscodeStorage = (home: string) =>
    process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage')
        : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage')
            : path.join(home, '.config', 'Code', 'User', 'globalStorage');

const windsurfStorage = (home: string) =>
    process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage')
        : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Windsurf', 'User', 'globalStorage')
            : path.join(home, '.config', 'Windsurf', 'User', 'globalStorage');

/** Put the adapter's sample data into `home`. Verified adapters must use their recording, never a hand-written file. */
const SEEDERS: Record<string, (home: string) => void> = {
    'claude-code': home => copyTree(
        path.join(FIXTURES, 'claude', 'recorded', 'claude-code-2.1.291-linux'),
        path.join(home, '.claude', 'projects', '-fixture-project'),
        name => name.endsWith('.jsonl')),
    'aider': home => {
        fs.mkdirSync(path.join(home, '.aider'), { recursive: true });
        fs.copyFileSync(path.join(FIXTURES, 'aider', 'recorded', 'aider-0.86.2', 'analytics.jsonl'), path.join(home, '.aider', 'analytics.jsonl'));
    },
    'codex': home => copyTree(
        path.join(FIXTURES, 'codex', 'recorded', 'codex-0.162.1', 'sessions'),
        path.join(home, '.codex', 'sessions')),
    // Hand-written fixtures: they only prove idempotence and wiring here, never verification.
    'cline': home => {
        const dir = path.join(vscodeStorage(home), 'saoudrizwan.claude-dev', 'tasks', '1700000000000');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(FIXTURES, 'cline-task', 'api_conversation_history.json'), path.join(dir, 'api_conversation_history.json'));
    },
    'copilot': home => {
        const dir = path.join(vscodeStorage(home), 'github.copilot-chat');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(FIXTURES, 'copilot-state.vscdb'), path.join(dir, 'state.vscdb'));
    },
    'windsurf': home => {
        const dir = path.join(windsurfStorage(home), 'ext');
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(path.join(FIXTURES, 'windsurf-state.vscdb'), path.join(dir, 'state.vscdb'));
    },
    'cursor': home => {
        const dir = process.platform === 'darwin'
            ? path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage')
            : path.join(home, '.cursor', 'ai-tracking');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'ai-code-tracking.db'), 'not a real database; the Cursor parser only records that the file exists');
    },
};

const counts = () => {
    const db = getDb();
    const n = (table: string) => (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
    return { sessions: n('sessions'), subagents: n('subagents'), parsedFiles: n('parsed_files_registry') };
};

describe('parser adapter conformance', () => {
    let tmpHome: string;
    const savedEnv = { CODEX_HOME: process.env.CODEX_HOME, APPDATA: process.env.APPDATA };

    beforeEach(() => {
        delete process.env.CODEX_HOME;
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-conformance-'));
        if (process.platform === 'win32') process.env.APPDATA = path.join(tmpHome, 'AppData', 'Roaming');
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        jest.spyOn(console, 'log').mockImplementation(() => undefined); // migration chatter
        closeDb();
        initDb(':memory:');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        closeDb();
        for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('registers the built-in adapters, with unique ids, in the order the providers endpoint always listed them', () => {
        expect(ADAPTERS.map(a => a.id)).toEqual(['claude-code', 'cursor', 'aider', 'codex', 'cline', 'windsurf', 'copilot']);
        expect(new Set(ADAPTERS.map(a => a.id)).size).toBe(ADAPTERS.length);
        expect(new Set(ADAPTERS.map(a => a.displayName)).size).toBe(ADAPTERS.length);
    });

    it('every recording in format-matrix.json belongs to exactly one verified adapter (nothing else counts)', () => {
        const claimed = ADAPTERS.filter(a => a.verification.level === 'verified').map(a => a.verification.recording);
        expect([...claimed].sort()).toEqual([...matrixKeys].sort());
    });

    it('every verified adapter has a seeder in this file so its recording is exercised here', () => {
        for (const a of ADAPTERS.filter(x => x.verification.level === 'verified')) expect(SEEDERS[a.id]).toBeDefined();
    });

    describe.each(ADAPTERS.map(a => [a.id, a] as [string, ParserAdapter]))('%s', (_id, adapter) => {
        it('declares id, displayName and a verification level with a real note', () => {
            expect(adapter.id).toMatch(/^[a-z][a-z0-9-]*$/);
            expect(adapter.displayName.trim().length).toBeGreaterThan(1);
            expect(['verified', 'unverified', 'experimental']).toContain(adapter.verification.level);
            expect(adapter.verification.note.trim().length).toBeGreaterThan(30);
            expect(typeof adapter.detect).toBe('function');
            expect(typeof adapter.watchPaths).toBe('function');
            expect(typeof adapter.parse).toBe('function');
        });

        it('a verified adapter names a recorded (not synthetic) fixture in format-matrix.json; anything else names none', () => {
            const v = adapter.verification;
            if (v.level !== 'verified') {
                expect(v.recording).toBeUndefined();
                return;
            }
            expect(v.recording).toBeTruthy();
            expect(matrixKeys).toContain(v.recording);
            const entries = matrix[v.recording!] as { fixture: string }[];
            expect(entries.length).toBeGreaterThan(0);
            for (const { fixture } of entries) {
                expect(fixture).toMatch(/^recorded\//);
                expect(fixture).not.toMatch(/synthetic/i);
                const dir = path.join(FIXTURES, v.recording!, fixture);
                expect(fs.statSync(dir).isDirectory()).toBe(true);
                // A recording says which tool version produced it and on what OS.
                const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
                expect(readme).toMatch(/\d+\.\d+\.\d+/);
                expect(readme).toMatch(/Linux|macOS|Windows/);
            }
        });

        it('detect() and watchPaths() work with the home directory missing', async () => {
            jest.spyOn(os, 'homedir').mockReturnValue(path.join(tmpHome, 'does', 'not', 'exist'));
            await expect(adapter.detect()).resolves.toEqual({ found: false, paths: [] });
            expect(adapter.watchPaths()).toEqual([]);
            await expect(adapter.parse()).resolves.toBeUndefined();
        });

        it('detect() and watchPaths() do not throw when os.homedir() itself throws', async () => {
            jest.spyOn(os, 'homedir').mockImplementation(() => { throw new Error('no home'); });
            await expect(adapter.detect()).resolves.toEqual({ found: false, paths: [] });
            expect(adapter.watchPaths()).toEqual([]);
        });

        it('with sample data present detect() finds it and watchPaths() are existing paths', async () => {
            const seed = SEEDERS[adapter.id];
            if (!seed) return;
            seed(tmpHome);
            const found = await adapter.detect();
            expect(found.found).toBe(true);
            expect(found.paths.length).toBeGreaterThan(0);
            for (const p of found.paths) expect(fs.existsSync(p)).toBe(true);
            const watch = adapter.watchPaths();
            expect(watch.length).toBeGreaterThan(0);
            for (const p of watch) {
                expect(path.isAbsolute(p)).toBe(true);
                expect(fs.statSync(p).isDirectory()).toBe(true);
            }
        });

        it('parse() twice yields identical row counts (idempotent)', async () => {
            const seed = SEEDERS[adapter.id];
            if (seed) seed(tmpHome);
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            await adapter.parse();
            const first = counts();
            await adapter.parse();
            const second = counts();
            expect(second).toEqual(first);
            if (adapter.verification.level === 'verified') {
                // A verified adapter must actually produce data from its recording.
                expect(first.sessions).toBeGreaterThan(0);
            }
        });

        it('parse() reports progress through opts.onProgress without requiring it', async () => {
            const seed = SEEDERS[adapter.id];
            if (seed) seed(tmpHome);
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const seen: [number, number][] = [];
            await adapter.parse({ onProgress: (c, t) => seen.push([c, t]) });
            for (const [c, t] of seen) {
                expect(c).toBeLessThanOrEqual(t);
            }
        });
    });

    describe('the manager', () => {
        const fake = (id: string, parse: ParserAdapter['parse'], found = true): ParserAdapter => ({
            id,
            displayName: id,
            verification: { level: 'unverified', note: 'A test double that stands in for a real agent adapter.' },
            detect: async () => ({ found, paths: found ? [tmpHome] : [] }),
            watchPaths: () => (found ? [tmpHome] : []),
            parse,
        });

        it('keeps running the other adapters when one throws, and marks only that one as error', async () => {
            const ran: string[] = [];
            const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const manager = createParserManager({
                adapters: [
                    fake('first', async () => { ran.push('first'); }),
                    fake('boom', async () => { ran.push('boom'); throw new Error('adapter exploded'); }),
                    fake('last', async () => { ran.push('last'); }),
                ],
                aggregate: () => undefined,
                watch: false,
            });
            await manager.triggerParseCycle();
            expect(ran).toEqual(['first', 'boom', 'last']);
            const status = manager.getProviderStatus() as Record<string, any>;
            expect(status.first.status).toBe('success');
            expect(status.boom.status).toBe('error');
            expect(status.last.status).toBe('success');
            expect(errors).toHaveBeenCalled();
            // and the manager is still usable afterwards
            await manager.triggerParseCycle();
            expect(ran.length).toBe(6);
        });

        it('treats a rejecting detect() as not found and still runs the rest', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const ran: string[] = [];
            const broken: ParserAdapter = { ...fake('broken-detect', async () => { ran.push('broken-detect'); }), detect: async () => { throw new Error('detect failed'); } };
            const manager = createParserManager({
                adapters: [broken, fake('ok', async () => { ran.push('ok'); })],
                aggregate: () => undefined,
                watch: false,
            });
            await manager.triggerParseCycle();
            expect(ran).toEqual(['ok']);
            expect((manager.getProviderStatus() as any)['broken-detect'].status).toBe('not found');
        });

        it('still aggregates tool usage after an adapter failed, and survives the aggregator throwing', async () => {
            jest.spyOn(console, 'error').mockImplementation(() => undefined);
            const aggregate = jest.fn(() => { throw new Error('aggregate failed'); });
            const manager = createParserManager({
                adapters: [fake('boom', async () => { throw new Error('x'); })],
                aggregate,
                watch: false,
            });
            await expect(manager.triggerParseCycle()).resolves.toBeUndefined();
            expect(aggregate).toHaveBeenCalledTimes(1);
        });

        it('does not run adapters that were not found, and logs per-adapter timing for those that ran', async () => {
            const parse = jest.fn(async () => undefined);
            const logs: string[] = [];
            const manager = createParserManager({
                adapters: [fake('absent', parse, false), fake('present', async () => undefined)],
                aggregate: () => undefined,
                watch: false,
                log: (m: string) => logs.push(m),
            });
            await manager.triggerParseCycle();
            expect(parse).not.toHaveBeenCalled();
            expect(logs.some(l => /present/.test(l) && /\d+ ?ms/.test(l))).toBe(true);
            expect(logs.some(l => /absent/.test(l))).toBe(false);
        });

        it('serialises runs of the same adapter (a full cycle and a watcher run never overlap)', async () => {
            let active = 0;
            let maxActive = 0;
            const manager = createParserManager({
                adapters: [fake('slow', async () => {
                    active++; maxActive = Math.max(maxActive, active);
                    await new Promise(r => setTimeout(r, 40));
                    active--;
                })],
                aggregate: () => undefined,
                watch: false,
            });
            await Promise.all([manager.triggerParseCycle(), manager.runAdapter('slow'), manager.runAdapter('slow')]);
            expect(maxActive).toBe(1);
        });
    });
});
