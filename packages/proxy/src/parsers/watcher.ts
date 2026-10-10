import fs from 'fs';
import path from 'path';

/**
 * Fast path for new usage: watch each adapter's data directories and re-run only that adapter's incremental
 * parse shortly after something in them changes, instead of waiting for the 5-minute full scan (which stays
 * as the safety net).
 *
 * - Recursive `fs.watch` where the platform has it (macOS, Windows, Linux with Node >= 20). Where it throws
 *   (Node 18 on Linux) or later errors (inotify limits), that path is polled instead, every `pollMs`.
 * - Events are debounced per adapter, with a max wait so a constant stream of writes still gets parsed, and a
 *   minimum gap between runs so a busy editor cannot make an adapter re-run back to back.
 * - Runs are serialised per adapter: a change during a run schedules exactly one follow-up run.
 * - Changes inside the database directory are ignored, so our own writes never trigger a parse.
 * - Timers and watchers are unref'd and `stop()` releases all of them.
 */

export interface WatchTarget {
    /** Adapter id. */
    id: string;
    /** Existing directories to watch. */
    paths: string[];
    /** Runs that adapter's incremental parse. Rejections are logged, never thrown. */
    run: () => Promise<void>;
}

interface WatcherHandle {
    on(event: 'error', listener: (err: Error) => void): unknown;
    close(): void;
}
export type WatchFn = (
    root: string,
    options: { recursive: boolean; persistent: boolean },
    listener: (event: string, filename: string | Buffer | null) => void,
) => WatcherHandle;

export interface WatcherOptions {
    /** Quiet period after the last event before running. Default 1500. */
    debounceMs?: number;
    /** Run at the latest this long after the first unhandled event, even if events keep arriving. Default 15000. */
    maxWaitMs?: number;
    /** Minimum gap between the end of one run of an adapter and the start of the next. Default 5000. */
    minIntervalMs?: number;
    /** Polling period for paths that cannot be watched. Default 30000. */
    pollMs?: number;
    /** Directories whose changes are ignored (and which are never watched). Default: the database directory. */
    ignoreDirs?: string[];
    /** `fs.watch` by default; injectable for tests. */
    watch?: WatchFn;
    log?: (message: string) => void;
    /** Safety cap on entries visited by one poll snapshot. Default 50000. */
    maxPollEntries?: number;
}

export interface WatcherInfo {
    id: string;
    path: string;
    mode: 'watch' | 'poll';
}

/** Where the database lives (mirrors packages/database): changes there are our own writes. */
export const defaultIgnoreDirs = (): string[] => {
    const configured = process.env.LLM_OBSERVER_DATA_DIR;
    if (configured) return [configured];
    const home = process.env.HOME || process.env.USERPROFILE;
    return home ? [path.join(home, '.llm-observer')] : [];
};

const caseFold = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p: string): string => {
    const r = path.resolve(p);
    return caseFold ? r.toLowerCase() : r;
};

const isInside = (child: string, parent: string): boolean =>
    child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

interface TargetState {
    target: WatchTarget;
    timer: NodeJS.Timeout | null;
    dirty: boolean;
    firstAt: number;
    lastEventAt: number;
    lastFinished: number;
    running: Promise<void> | null;
}

interface PathState {
    id: string;
    root: string;
    mode: 'watch' | 'poll';
    handle?: WatcherHandle;
    pollTimer?: NodeJS.Timeout;
    snapshot?: string;
    polling: boolean;
}

export class ParserWatcher {
    private readonly debounceMs: number;
    private readonly maxWaitMs: number;
    private readonly minIntervalMs: number;
    private readonly pollMs: number;
    private readonly maxPollEntries: number;
    private readonly ignore: string[];
    private readonly watchFn: WatchFn;
    private readonly log: (message: string) => void;
    private readonly targets = new Map<string, TargetState>();
    private readonly paths = new Map<string, PathState>();
    private stopped = false;

    constructor(opts: WatcherOptions = {}) {
        this.debounceMs = opts.debounceMs ?? 1500;
        this.maxWaitMs = opts.maxWaitMs ?? 15_000;
        this.minIntervalMs = opts.minIntervalMs ?? 5000;
        this.pollMs = opts.pollMs ?? 30_000;
        this.maxPollEntries = opts.maxPollEntries ?? 50_000;
        this.watchFn = opts.watch ?? ((fs.watch as unknown) as WatchFn);
        this.log = opts.log ?? ((m: string) => console.log(m));
        const dirs = opts.ignoreDirs ?? defaultIgnoreDirs();
        // Compare both the configured spelling and its real path (macOS /var vs /private/var).
        this.ignore = [...new Set(dirs.flatMap(d => {
            const forms = [norm(d)];
            try { forms.push(norm(fs.realpathSync(d))); } catch { /* not created yet */ }
            return forms;
        }))];
    }

    /**
     * Make the set of watched paths match `targets`: open watchers for new paths, close those that are gone.
     * Safe to call repeatedly (the manager calls it after every full scan, which also picks up tools installed later).
     */
    sync(targets: WatchTarget[]): void {
        if (this.stopped) return;
        const wanted = new Set<string>();
        const ids = new Set<string>();
        for (const t of targets) {
            ids.add(t.id);
            const existing = this.targets.get(t.id);
            if (existing) existing.target = t;
            else this.targets.set(t.id, { target: t, timer: null, dirty: false, firstAt: 0, lastEventAt: 0, lastFinished: 0, running: null });
            for (const p of t.paths) {
                const root = path.resolve(p);
                if (this.isIgnored(root)) continue;
                const key = `${t.id}\0${root}`;
                wanted.add(key);
                if (this.paths.has(key)) continue;
                if (!fs.existsSync(root)) { wanted.delete(key); continue; }
                const ps: PathState = { id: t.id, root, mode: 'watch', polling: false };
                this.paths.set(key, ps);
                this.open(ps);
            }
        }
        for (const [key, ps] of this.paths) {
            if (!wanted.has(key)) { this.closePath(ps); this.paths.delete(key); }
        }
        for (const [id, st] of this.targets) {
            if (!ids.has(id) && !st.running) { if (st.timer) clearTimeout(st.timer); this.targets.delete(id); }
        }
    }

    describe(): WatcherInfo[] {
        return [...this.paths.values()].map(ps => ({ id: ps.id, path: ps.root, mode: ps.mode }));
    }

    /** Close every watcher and timer, cancel queued runs and wait for runs already in flight. */
    async stop(): Promise<void> {
        this.stopped = true;
        for (const ps of this.paths.values()) this.closePath(ps);
        this.paths.clear();
        const inFlight: Promise<void>[] = [];
        for (const st of this.targets.values()) {
            if (st.timer) clearTimeout(st.timer);
            st.timer = null;
            st.dirty = false;
            if (st.running) inFlight.push(st.running);
        }
        this.targets.clear();
        await Promise.all(inFlight);
    }

    // --- watching ---

    private open(ps: PathState): void {
        try {
            const handle = this.watchFn(ps.root, { recursive: true, persistent: false }, (_event, filename) => this.onEvent(ps, filename));
            handle.on('error', err => {
                if (this.stopped || ps.mode !== 'watch') return;
                try { handle.close(); } catch { /* already closed */ }
                ps.handle = undefined;
                this.startPolling(ps, err);
            });
            ps.handle = handle;
            ps.mode = 'watch';
        } catch (err) {
            this.startPolling(ps, err as Error);
        }
    }

    private onEvent(ps: PathState, filename: string | Buffer | null): void {
        if (this.stopped) return;
        if (filename != null) {
            const full = norm(path.join(ps.root, filename.toString()));
            if (this.isIgnored(full)) return;
        }
        this.trigger(ps.id);
    }

    private isIgnored(p: string): boolean {
        const n = norm(p);
        return this.ignore.some(dir => isInside(n, dir));
    }

    private closePath(ps: PathState): void {
        if (ps.handle) { try { ps.handle.close(); } catch { /* already closed */ } ps.handle = undefined; }
        if (ps.pollTimer) { clearInterval(ps.pollTimer); ps.pollTimer = undefined; }
    }

    // --- polling fallback ---

    private startPolling(ps: PathState, reason: Error & { code?: string }): void {
        ps.mode = 'poll';
        this.log(`[Parser Watcher] ${ps.id}: fs.watch unavailable for ${ps.root} (${reason?.code || reason?.message}); checking it every ${Math.round(this.pollMs / 1000)}s instead`);
        const tick = async () => {
            if (ps.polling || this.stopped || ps.mode !== 'poll') return;
            ps.polling = true;
            try {
                const snap = await this.snapshot(ps.root);
                if (this.stopped || ps.mode !== 'poll') return;
                if (ps.snapshot !== undefined && snap !== ps.snapshot) this.trigger(ps.id);
                ps.snapshot = snap;
            } finally {
                ps.polling = false;
            }
        };
        void tick(); // baseline
        ps.pollTimer = setInterval(() => { void tick(); }, this.pollMs);
        ps.pollTimer.unref?.();
    }

    /**
     * A cheap fingerprint of a directory tree: entry count, newest mtime and total size. Directory mtimes alone
     * would miss an append to an existing file (which is how Claude Code and Codex write), so files are included.
     */
    private async snapshot(root: string): Promise<string> {
        let count = 0;
        let newest = 0;
        let size = 0;
        const queue = [root];
        try {
            while (queue.length > 0 && count < this.maxPollEntries) {
                const dir = queue.pop()!;
                let entries: fs.Dirent[];
                try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
                const stats = await Promise.all(entries.map(async e => {
                    const full = path.join(dir, e.name);
                    if (this.isIgnored(full)) return null;
                    try { return { e, full, st: await fs.promises.stat(full) }; } catch { return null; }
                }));
                for (const s of stats) {
                    if (!s) continue;
                    count++;
                    newest = Math.max(newest, s.st.mtimeMs);
                    if (s.st.isDirectory()) queue.push(s.full); else size += s.st.size;
                }
            }
        } catch (err) {
            return `error:${(err as Error).message}`;
        }
        return `${count}:${newest}:${size}${count >= this.maxPollEntries ? '+' : ''}`;
    }

    // --- scheduling ---

    private trigger(id: string): void {
        const st = this.targets.get(id);
        if (!st || this.stopped) return;
        const now = Date.now();
        st.lastEventAt = now;
        if (!st.dirty) { st.dirty = true; st.firstAt = now; }
        this.arm(st);
    }

    /** When the next run may start: after the quiet period (or the max wait) and the minimum gap. */
    private dueAt(st: TargetState): number {
        return Math.max(
            Math.min(st.lastEventAt + this.debounceMs, st.firstAt + this.maxWaitMs),
            st.lastFinished + this.minIntervalMs,
        );
    }

    private arm(st: TargetState): void {
        if (st.timer || st.running || !st.dirty || this.stopped) return;
        const wait = Math.max(0, this.dueAt(st) - Date.now());
        st.timer = setTimeout(() => { st.timer = null; this.fire(st); }, wait);
        st.timer.unref?.();
    }

    private fire(st: TargetState): void {
        if (this.stopped || !st.dirty || st.running) return;
        if (this.dueAt(st) - Date.now() > 5) { this.arm(st); return; } // more events arrived: keep debouncing
        st.dirty = false;
        st.firstAt = 0;
        const target = st.target;
        st.running = (async () => {
            try {
                await target.run();
            } catch (err) {
                this.log(`[Parser Watcher] ${target.id}: run failed: ${(err as Error)?.message ?? err}`);
            }
        })().finally(() => {
            st.lastFinished = Date.now();
            st.running = null;
            if (st.dirty) this.arm(st);
        });
    }
}
