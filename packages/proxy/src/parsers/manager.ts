import type { ParserAdapter } from './adapter';
import { ADAPTERS } from './registry';
import { purgeLegacyMockSessions } from './cursor';
import { aggregateToolUsage } from './toolAggregator';
import { ParserWatcher, WatcherOptions, WatcherInfo, WatchTarget } from './watcher';

/** What /api/sessions/providers returns for one adapter. */
export interface ProviderStatus {
    status: 'not found' | 'found' | 'parsing' | 'success' | 'error';
    sessionCount: number;
    progress: { current: number; total: number };
    verification: ParserAdapter['verification']['level'];
    note: string;
}

export interface ParserManagerOptions {
    adapters: readonly ParserAdapter[];
    /** Full-scan safety-net period. Default 5 minutes. */
    intervalMs?: number;
    /** Cross-provider aggregation run after a full scan and after a watcher-triggered parse. */
    aggregate?: () => void;
    /** Runs once at init, before the first scan. */
    onStart?: () => void;
    /** Fast-path file watching: `false` disables it, an object tunes it. LLM_OBSERVER_WATCH=0 also disables it. */
    watch?: false | WatcherOptions;
    log?: (message: string) => void;
}

export interface ParserManager {
    init(): void;
    /** Stop the timer and the watchers and wait (briefly) for parses in flight. Never throws. */
    stop(): Promise<void>;
    /** One full scan of every adapter, then aggregation. Skipped if one is already running. */
    triggerParseCycle(): Promise<void>;
    /** Incremental parse of one adapter, serialised with every other run of that adapter. */
    runAdapter(id: string): Promise<void>;
    getProviderStatus(): Record<string, ProviderStatus>;
    watcherInfo(): WatcherInfo[];
}

const FULL_SCAN_MS = 5 * 60 * 1000;
const STOP_WAIT_MS = 3000; // shorter than the server's 5 s shutdown grace

/** LLM_OBSERVER_WATCH=0 (also false/off/no) turns the file watcher off; the 5-minute scan still runs. */
export const isWatchEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
    !/^(0|false|off|no)$/i.test((env.LLM_OBSERVER_WATCH ?? '').trim());

export const createParserManager = (options: ParserManagerOptions): ParserManager => {
    const { adapters } = options;
    const log = options.log ?? ((m: string) => console.log(m));
    const aggregate = options.aggregate ?? aggregateToolUsage;
    const intervalMs = options.intervalMs ?? FULL_SCAN_MS;

    const providers: Record<string, ProviderStatus> = {};
    for (const a of adapters) {
        providers[a.id] = {
            status: 'not found',
            sessionCount: 0,
            progress: { current: 0, total: 0 },
            verification: a.verification.level,
            note: a.verification.note,
        };
    }

    let initialised = false;
    let stopped = false;
    let cycleRunning = false;
    let intervalHandle: NodeJS.Timeout | null = null;
    let watcher: ParserWatcher | null = null;
    const chains = new Map<string, Promise<void>>();

    const safeDetect = async (adapter: ParserAdapter): Promise<boolean> => {
        try {
            return (await adapter.detect()).found;
        } catch (e) {
            console.error(`[Parser Manager] Detection failed for ${adapter.id}:`, e);
            return false;
        }
    };

    /** Detect, then parse one adapter. Never throws: a failure marks that adapter as 'error' and nothing else. */
    const execute = async (adapter: ParserAdapter, found?: boolean): Promise<void> => {
        if (stopped) return;
        const state = providers[adapter.id];
        if (!(found ?? await safeDetect(adapter))) {
            state.status = 'not found';
            return;
        }
        state.status = 'parsing';
        const started = Date.now();
        try {
            await adapter.parse({ onProgress: (c, t) => { state.progress = { current: c, total: t }; } });
            state.status = 'success';
            log(`[Parser Manager] ${adapter.id}: parsed in ${Date.now() - started} ms`);
        } catch (e) {
            console.error(`[Parser Manager] Error parsing ${adapter.id}:`, e);
            state.status = 'error';
            log(`[Parser Manager] ${adapter.id}: failed after ${Date.now() - started} ms`);
        }
    };

    /** Runs of one adapter never overlap; different adapters may. */
    const enqueue = (adapter: ParserAdapter, found?: boolean): Promise<void> => {
        const prev = chains.get(adapter.id) ?? Promise.resolve();
        const next = prev.then(() => execute(adapter, found));
        chains.set(adapter.id, next);
        void next.then(() => { if (chains.get(adapter.id) === next) chains.delete(adapter.id); });
        return next;
    };

    const runAggregation = () => {
        try {
            aggregate();
        } catch (e) {
            console.error('[Parser Manager] Tool aggregation failed:', e);
        }
    };

    const safeWatchPaths = (adapter: ParserAdapter): string[] => {
        try { return adapter.watchPaths(); } catch { return []; }
    };

    const syncWatcher = (foundIds: Set<string>) => {
        if (!watcher || stopped) return;
        const targets: WatchTarget[] = [];
        for (const a of adapters) {
            if (!foundIds.has(a.id)) continue;
            const paths = safeWatchPaths(a);
            if (paths.length === 0) continue;
            targets.push({
                id: a.id,
                paths,
                run: async () => {
                    await enqueue(a);
                    if (!cycleRunning) runAggregation(); // a running full scan aggregates when it finishes
                },
            });
        }
        try {
            watcher.sync(targets);
        } catch (e) {
            console.error('[Parser Manager] Could not start file watchers; the periodic scan still runs:', e);
        }
    };

    const triggerParseCycle = async (): Promise<void> => {
        if (cycleRunning || stopped) {
            if (cycleRunning) console.log('[Parser Manager] Parse already in progress, skipping.');
            return;
        }
        cycleRunning = true;
        try {
            // Detect first so every present tool reads 'found' while the earlier ones are still parsing.
            const found = new Set<string>();
            await Promise.all(adapters.map(async a => {
                if (await safeDetect(a)) {
                    found.add(a.id);
                    if (providers[a.id].status === 'not found') providers[a.id].status = 'found';
                } else {
                    providers[a.id].status = 'not found';
                }
            }));
            // Watch before the (possibly long) scan, so changes made during it queue a follow-up run.
            syncWatcher(found);
            for (const a of adapters) {
                if (found.has(a.id)) await enqueue(a, true);
            }
            runAggregation();
        } finally {
            cycleRunning = false;
        }
    };

    const init = (): void => {
        if (initialised) return;
        initialised = true;
        try {
            options.onStart?.();
        } catch (e) {
            console.error('[Parser Manager] Startup cleanup failed:', e);
        }
        if (options.watch !== false && isWatchEnabled()) {
            watcher = new ParserWatcher({ log, ...(options.watch ?? {}) });
        }
        // Initial parse without blocking startup, then the 5-minute safety-net scan.
        triggerParseCycle().catch(err => {
            console.error('[Parser Manager] Initial parse error:', err);
        });
        intervalHandle = setInterval(() => {
            triggerParseCycle().catch(err => {
                console.error('[Parser Manager] Background parse error:', err);
            });
        }, intervalMs);
        intervalHandle.unref?.();
    };

    const stop = async (): Promise<void> => {
        stopped = true;
        if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
        // One cap covers watcher-triggered runs and full scans alike: stopping the watcher closes it at once,
        // and only the wait for its in-flight runs is bounded.
        const stoppingWatcher = (async () => {
            try {
                await watcher?.stop(STOP_WAIT_MS);
            } catch (e) {
                console.error('[Parser Manager] Error stopping file watchers:', e);
            }
        })();
        const inFlight = Promise.all([stoppingWatcher, ...chains.values()]).then(() => undefined, () => undefined);
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<void>(resolve => { timer = setTimeout(resolve, STOP_WAIT_MS); timer.unref?.(); });
        await Promise.race([inFlight, timeout]);
        if (timer) clearTimeout(timer);
    };

    return {
        init,
        stop,
        triggerParseCycle,
        runAdapter: async (id: string) => {
            const adapter = adapters.find(a => a.id === id);
            if (adapter) await enqueue(adapter);
        },
        getProviderStatus: () => providers,
        watcherInfo: () => watcher?.describe() ?? [],
    };
};

// The process-wide manager over the built-in adapters. Existing callers keep using these functions.
const defaultManager = createParserManager({ adapters: ADAPTERS, onStart: () => { purgeLegacyMockSessions(); } });

export const initParsers = (): void => defaultManager.init();
export const triggerParseCycle = (): Promise<void> => defaultManager.triggerParseCycle();
export const getProviderStatus = () => defaultManager.getProviderStatus();
/** Stop the periodic scan and the file watchers (called from the shutdown handler). */
export const stopParsers = (): Promise<void> => defaultManager.stop();
