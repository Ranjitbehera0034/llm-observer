import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { ParserWatcher, WatchTarget } from '../watcher';
import { waitFor, sleep } from './watchHelpers';

/** A stand-in for fs.watch that records what was watched and lets the test emit events. */
const fakeWatch = () => {
    const watchers: (EventEmitter & { root: string; closed: boolean; close(): void; listener: (ev: string, name: string | null) => void })[] = [];
    const watch: any = (root: string, _opts: any, listener: (ev: string, name: string | null) => void) => {
        const w: any = new EventEmitter();
        w.root = root;
        w.closed = false;
        w.listener = listener;
        w.close = () => { w.closed = true; };
        watchers.push(w);
        return w;
    };
    return { watch, watchers };
};

const quiet = () => undefined;
const FAST = { debounceMs: 40, maxWaitMs: 400, minIntervalMs: 0, pollMs: 60, log: quiet };

describe('ParserWatcher', () => {
    let dir: string;
    let watcher: ParserWatcher | undefined;

    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-watcher-')); });
    afterEach(async () => {
        await watcher?.stop();
        watcher = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const target = (id: string, paths: string[], run: () => Promise<void>): WatchTarget => ({ id, paths, run });

    it('coalesces a burst of events into one run of only the affected adapter', async () => {
        const { watch, watchers } = fakeWatch();
        const a = jest.fn(async () => undefined);
        const b = jest.fn(async () => undefined);
        const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-watcher-b-'));
        try {
            watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
            watcher.sync([target('a', [dir], a), target('b', [dirB], b)]);
            expect(watchers.map(w => w.root).sort()).toEqual([dir, dirB].sort());
            for (let i = 0; i < 50; i++) watchers.find(w => w.root === dir)!.listener('change', `f${i}.jsonl`);
            await waitFor(() => a.mock.calls.length >= 1, 2000);
            await sleep(150);
            expect(a).toHaveBeenCalledTimes(1);
            expect(b).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(dirB, { recursive: true, force: true });
        }
    });

    it('opens recursive watchers that do not keep the process alive', () => {
        const calls: any[] = [];
        const watch: any = (root: string, opts: any) => { calls.push([root, opts]); const w: any = new EventEmitter(); w.close = () => undefined; return w; };
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], async () => undefined)]);
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toMatchObject({ recursive: true, persistent: false });
    });

    it('never runs one adapter concurrently: events during a run cause exactly one follow-up run', async () => {
        const { watch, watchers } = fakeWatch();
        let active = 0;
        let maxActive = 0;
        let runs = 0;
        const run = async () => {
            runs++; active++; maxActive = Math.max(maxActive, active);
            await sleep(150);
            active--;
        };
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], run)]);
        const w = watchers[0];
        w.listener('change', 'x');
        await waitFor(() => runs === 1, 2000);
        // events while the first run is in flight
        for (let i = 0; i < 20; i++) { w.listener('change', 'y'); await sleep(5); }
        await waitFor(() => runs === 2 && active === 0, 3000);
        await sleep(200);
        expect(runs).toBe(2);
        expect(maxActive).toBe(1);
    });

    it('still runs under a constant stream of events (max wait), instead of debouncing forever', async () => {
        const { watch, watchers } = fakeWatch();
        const run = jest.fn(async () => undefined);
        watcher = new ParserWatcher({ ...FAST, debounceMs: 100, maxWaitMs: 300, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], run)]);
        const stop = Date.now() + 1500;
        while (Date.now() < stop && run.mock.calls.length === 0) { watchers[0].listener('change', 'x'); await sleep(20); }
        expect(run).toHaveBeenCalled();
    });

    it('spaces runs by minIntervalMs so a busy editor cannot make an adapter run back to back', async () => {
        const { watch, watchers } = fakeWatch();
        const starts: number[] = [];
        watcher = new ParserWatcher({ ...FAST, minIntervalMs: 300, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], async () => { starts.push(Date.now()); })]);
        watchers[0].listener('change', 'x');
        await waitFor(() => starts.length === 1, 2000);
        watchers[0].listener('change', 'x');
        await waitFor(() => starts.length === 2, 3000);
        expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(280);
    });

    it('ignores changes inside ignored directories (the database directory) and does not watch a root inside one', () => {
        const { watch, watchers } = fakeWatch();
        const dbDir = path.join(dir, 'db');
        fs.mkdirSync(dbDir);
        const run = jest.fn(async () => undefined);
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [dbDir] });
        watcher.sync([target('a', [dir, dbDir], run)]);
        expect(watchers.map(w => w.root)).toEqual([dir]);
        watchers[0].listener('change', path.join('db', 'data.db-wal'));
        watchers[0].listener('change', path.join('db', 'sub', 'x'));
        return sleep(200).then(() => expect(run).not.toHaveBeenCalled());
    });

    it('treats an event without a filename as a change', async () => {
        const { watch, watchers } = fakeWatch();
        const run = jest.fn(async () => undefined);
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], run)]);
        watchers[0].listener('rename', null);
        await waitFor(() => run.mock.calls.length === 1, 2000);
    });

    it('survives a failing run: the error is logged and the next change runs again', async () => {
        const { watch, watchers } = fakeWatch();
        const logs: string[] = [];
        let n = 0;
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [], log: (m: string) => logs.push(m) });
        watcher.sync([target('a', [dir], async () => { n++; if (n === 1) throw new Error('parse failed'); })]);
        watchers[0].listener('change', 'x');
        await waitFor(() => n === 1, 2000);
        await sleep(80);
        watchers[0].listener('change', 'x');
        await waitFor(() => n === 2, 2000);
        expect(logs.join('\n')).toMatch(/parse failed/);
    });

    it('sync() is idempotent and drops watchers for targets that went away', () => {
        const { watch, watchers } = fakeWatch();
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        const t = target('a', [dir], async () => undefined);
        watcher.sync([t]);
        watcher.sync([t]);
        expect(watchers).toHaveLength(1);
        watcher.sync([]);
        expect(watchers[0].closed).toBe(true);
        expect(watcher.describe()).toEqual([]);
    });

    it('skips paths that do not exist instead of throwing', () => {
        const { watch, watchers } = fakeWatch();
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [path.join(dir, 'missing')], async () => undefined)]);
        expect(watchers).toHaveLength(0);
        expect(watcher.describe()).toEqual([]);
    });

    it('stop() closes every watcher, cancels pending runs, and waits for one in flight', async () => {
        const { watch, watchers } = fakeWatch();
        let finished = false;
        let started = 0;
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], async () => { started++; await sleep(100); finished = true; })]);
        watchers[0].listener('change', 'x');
        await waitFor(() => started === 1, 2000);
        watchers[0].listener('change', 'x'); // queues a follow-up that stop() must cancel
        await watcher.stop();
        expect(finished).toBe(true);
        expect(watchers[0].closed).toBe(true);
        await sleep(200);
        expect(started).toBe(1);
        // events after stop are ignored
        watchers[0].listener('change', 'x');
        await sleep(100);
        expect(started).toBe(1);
        expect(watcher.describe()).toEqual([]);
    });

    it('stop(timeoutMs) gives up on a run that never finishes, after releasing the watchers', async () => {
        const { watch, watchers } = fakeWatch();
        let started = 0;
        watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
        watcher.sync([target('a', [dir], () => { started++; return new Promise<void>(() => undefined); })]);
        watchers[0].listener('change', 'x');
        await waitFor(() => started === 1, 2000);
        const t0 = Date.now();
        await watcher.stop(200);
        expect(Date.now() - t0).toBeLessThan(1000);
        expect(watchers[0].closed).toBe(true);
        expect(watcher.describe()).toEqual([]);
    });

    describe('polling fallback', () => {
        const throwing: any = () => { const e: any = new Error('recursive watch unsupported'); e.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'; throw e; };

        it('falls back to polling when fs.watch throws, and a changed file triggers the run', async () => {
            const file = path.join(dir, 'session.jsonl');
            fs.writeFileSync(file, 'one\n');
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch: throwing, ignoreDirs: [] });
            watcher.sync([target('a', [dir], run)]);
            expect(watcher.describe()).toEqual([{ id: 'a', path: dir, mode: 'poll' }]);
            await sleep(150);
            expect(run).not.toHaveBeenCalled(); // the first snapshot is a baseline, not a change
            fs.appendFileSync(file, 'two\n'); // an append changes a file's mtime but not its directory's
            const future = new Date(Date.now() + 5000);
            fs.utimesSync(file, future, future);
            await waitFor(() => run.mock.calls.length >= 1, 3000);
        });

        it('a new file in a new subdirectory is noticed by polling', async () => {
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch: throwing, ignoreDirs: [] });
            watcher.sync([target('a', [dir], run)]);
            await sleep(150);
            fs.mkdirSync(path.join(dir, 'proj', 'deeper'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'proj', 'deeper', 'new.jsonl'), 'x\n');
            await waitFor(() => run.mock.calls.length >= 1, 3000);
        });

        it('does not run when nothing changed', async () => {
            fs.writeFileSync(path.join(dir, 'a.jsonl'), 'x');
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch: throwing, ignoreDirs: [] });
            watcher.sync([target('a', [dir], run)]);
            await sleep(400);
            expect(run).not.toHaveBeenCalled();
        });

        it('ignores changes inside the ignored database directory when polling', async () => {
            const dbDir = path.join(dir, 'db');
            fs.mkdirSync(dbDir);
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch: throwing, ignoreDirs: [dbDir] });
            watcher.sync([target('a', [dir], run)]);
            await sleep(150);
            fs.writeFileSync(path.join(dbDir, 'data.db'), 'x');
            await sleep(400);
            expect(run).not.toHaveBeenCalled();
        });

        it('switches a path to polling when the live watcher later emits an error (for example inotify limits)', async () => {
            const { watch, watchers } = fakeWatch();
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch, ignoreDirs: [] });
            watcher.sync([target('a', [dir], run)]);
            expect(watcher.describe()[0].mode).toBe('watch');
            watchers[0].emit('error', Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
            expect(watchers[0].closed).toBe(true);
            expect(watcher.describe()).toEqual([{ id: 'a', path: dir, mode: 'poll' }]);
            await sleep(150);
            fs.writeFileSync(path.join(dir, 'late.jsonl'), 'x');
            await waitFor(() => run.mock.calls.length >= 1, 3000);
        });

        it('stop() ends the poll timers', async () => {
            const run = jest.fn(async () => undefined);
            watcher = new ParserWatcher({ ...FAST, watch: throwing, ignoreDirs: [] });
            watcher.sync([target('a', [dir], run)]);
            await sleep(100);
            await watcher.stop();
            fs.writeFileSync(path.join(dir, 'after-stop.jsonl'), 'x');
            await sleep(300);
            expect(run).not.toHaveBeenCalled();
        });
    });
});
