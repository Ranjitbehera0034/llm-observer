/**
 * The contract every session-log parser implements. An adapter is the single source of truth for one agent:
 * its name, how far its format has been verified, where its files live and how to read them. The manager,
 * the file watcher, the /api/sessions/providers endpoint and the conformance tests are all driven from the
 * registry of adapters (registry.ts); nothing else lists the agents.
 *
 * Adding an agent: write `parsers/<agent>.ts` exporting `adapter`, add one line to registry.ts, add a
 * recording (see CONTRIBUTING.md, "Adding a parser").
 */

/**
 * How far the parser's format has been checked against a real recording of the tool.
 *
 * - verified:     golden-output tests (formatMatrix.test.ts) against a real recording of the tool's own files,
 *                 scrubbed to a small excerpt, named by `recording` below. It does NOT mean costs were checked
 *                 against a bill, that every OS and tool version was recorded, or that the model behind the
 *                 recording was real (the Aider and Codex recordings used a mock model endpoint).
 * - unverified:   the parser reads data, but its fixtures are hand-written from the tool's docs or source, so it
 *                 may disagree with what the real tool writes.
 * - experimental: unverified, and it also has a known gap (no usable data source, or the log must be enabled by hand).
 *
 * Only a recording from the real tool, registered in fixtures/format-matrix.json, earns 'verified'.
 */
export type VerificationLevel = 'verified' | 'unverified' | 'experimental';

export interface AdapterVerification {
    level: VerificationLevel;
    /** What the level means for this adapter: tool version, OS, what was mocked, what is not covered. Shown in the dashboard. */
    note: string;
    /** Required when `level` is 'verified', forbidden otherwise: the top-level key of the recording in fixtures/format-matrix.json. */
    recording?: string;
}

export interface DetectResult {
    found: boolean;
    /** Existing files or directories the adapter reads from. */
    paths: string[];
}

export interface ParseOptions {
    onProgress?: (current: number, total: number) => void;
}

export interface ParserAdapter {
    /** Stable provider id; it is the key in /api/sessions/providers and the `provider` column of the rows it writes. */
    id: string;
    /** Human name, used verbatim in the README table (a test keeps them in sync). */
    displayName: string;
    verification: AdapterVerification;
    /** Is the tool's data on this machine? Must resolve (never throw) even when the home directory is missing. */
    detect(): Promise<DetectResult>;
    /** Existing directories whose changes mean new data (files are watched through their directory). Never throws. */
    watchPaths(): string[];
    /** Incremental parse: reads only what changed since the last run and is idempotent. */
    parse(opts?: ParseOptions): Promise<void>;
}

/**
 * Build `detect` and `watchPaths` from one function that lists where the tool's data is. `locate` may throw
 * (for example when `os.homedir()` does); that reads as "not found".
 *
 * `paths` are the data locations (files or directories). `watchDirs` maps them to the directories to watch; it
 * defaults to the paths themselves, so an adapter whose data is a single file passes `paths => paths.map(dirname)`.
 */
export const locator = (locate: () => string[], watchDirs?: (paths: string[]) => string[]) => {
    const safe = (): string[] => {
        try { return locate(); } catch { return []; }
    };
    return {
        detect: async (): Promise<DetectResult> => {
            const paths = safe();
            return { found: paths.length > 0, paths };
        },
        watchPaths: (): string[] => {
            try {
                const paths = safe();
                return watchDirs ? watchDirs(paths) : paths;
            } catch {
                return [];
            }
        },
    };
};
