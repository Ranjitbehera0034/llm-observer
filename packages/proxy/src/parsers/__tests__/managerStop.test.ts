import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createParserManager } from '../manager';
import type { ParserAdapter } from '../adapter';
import { ADAPTERS } from '../registry';
import { waitFor } from './watchHelpers';

/**
 * Shutdown must never be held up by a parse that does not finish (a SQLite busy retry loop, a huge first backlog):
 * stop() is bounded by its wait cap for watcher-triggered runs as well as for full scans.
 */
describe('ParserManager.stop() with a parse that never finishes', () => {
    const STOP_WAIT_MS = 3000; // manager.ts
    const MARGIN_MS = 1000;
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-stop-'));
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const fakeWatch = () => {
        const listeners: ((ev: string, name: string | null) => void)[] = [];
        const watch: any = (_root: string, _opts: any, listener: (ev: string, name: string | null) => void) => {
            const w: any = new EventEmitter();
            w.close = () => undefined;
            listeners.push(listener);
            return w;
        };
        return { watch, listeners };
    };

    const hangingAdapter = (parse: ParserAdapter['parse']): ParserAdapter => ({
        ...ADAPTERS[0],
        id: 'probe',
        detect: async () => ({ found: true } as any),
        watchPaths: () => [dir],
        parse,
    });

    it('a watcher-triggered parse that hangs does not make stop() wait longer than the cap', async () => {
        const { watch, listeners } = fakeWatch();
        let calls = 0;
        const parse = jest.fn(() => (++calls === 1 ? Promise.resolve() : new Promise<void>(() => undefined)));
        const manager = createParserManager({
            adapters: [hangingAdapter(parse as any)],
            intervalMs: 60 * 60 * 1000,
            watch: { watch, debounceMs: 20, maxWaitMs: 100, minIntervalMs: 0, ignoreDirs: [], log: () => undefined },
        });
        manager.init();
        await waitFor(() => calls >= 1 && listeners.length > 0, 5000, 20);
        listeners[0]('change', 'x.jsonl'); // watcher-triggered run, which never resolves
        await waitFor(() => calls >= 2, 5000, 20);

        const t0 = Date.now();
        await manager.stop();
        expect(Date.now() - t0).toBeLessThan(STOP_WAIT_MS + MARGIN_MS);
    }, 20_000);

    it('a full-scan parse that hangs does not make stop() wait longer than the cap', async () => {
        const parse = jest.fn(() => new Promise<void>(() => undefined));
        const manager = createParserManager({ adapters: [hangingAdapter(parse as any)], intervalMs: 60 * 60 * 1000, watch: false });
        manager.init();
        await waitFor(() => parse.mock.calls.length >= 1, 5000, 20);
        const t0 = Date.now();
        await manager.stop();
        expect(Date.now() - t0).toBeLessThan(STOP_WAIT_MS + MARGIN_MS);
    }, 20_000);
});
