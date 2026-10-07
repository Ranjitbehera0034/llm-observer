import fs from 'fs';
import path from 'path';
import os from 'os';
import { getParsedFile, upsertParsedFile, deleteMockCursorSessions } from '@llm-observer/database';

const getCursorDbPath = () => {
    const home = os.homedir();
    if (process.platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'ai-code-tracking.db');
    }
    return path.join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
};

export const detector = (): boolean => {
    return fs.existsSync(getCursorDbPath());
};

export interface CursorEvent {
    id: string;
    timestamp: number; // epoch ms
    type: string;
}

/**
 * Groups raw Cursor telemetry events into logical sessions based on a proximity threshold.
 * By default, events closer than 5 minutes (300,000ms) apart are considered the same session.
 */
export const groupCursorEventsIntoSessions = (events: CursorEvent[], proximityMs = 5 * 60 * 1000): CursorEvent[][] => {
    if (events.length === 0) return [];

    // Sort events by timestamp ascending
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    const sessions: CursorEvent[][] = [];
    let currentSession: CursorEvent[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const event = sorted[i];
        const lastEvent = currentSession[currentSession.length - 1];

        if (event.timestamp - lastEvent.timestamp > proximityMs) {
            // Gap is strictly larger than proximity, break session
            sessions.push(currentSession);
            currentSession = [event];
        } else {
            // Gap is within or equal to proximity, append to current session
            currentSession.push(event);
        }
    }
    
    sessions.push(currentSession);
    return sessions;
};

/**
 * Older versions inserted a placeholder `cursor-sync-<timestamp>` session (cost 0) on every pass.
 * Those rows were never real usage, so they are removed.
 */
export const purgeLegacyMockSessions = (): number => {
    try {
        return deleteMockCursorSessions();
    } catch (err) {
        console.error('[Cursor Parser] Failed to remove legacy placeholder sessions:', err);
        return 0;
    }
};

/**
 * Cursor's local tracking database has no decoded schema, and Cursor does not log token counts
 * or prices locally, so this parser extracts no usage and inserts no sessions. It only records
 * that the file was seen, as 'skipped', so the gap is visible instead of showing as a success.
 * Never insert placeholder rows here: they feed cost-based rules as if they were real usage.
 */
/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, tool counts). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const dbPath = getCursorDbPath();
    if (!fs.existsSync(dbPath)) return;

    const mtime = fs.statSync(dbPath).mtimeMs;
    const registryEntry = getParsedFile(dbPath);
    if (registryEntry && registryEntry.last_modified_at >= mtime) return; // Unchanged

    if (onProgress) onProgress(0, 1);
    upsertParsedFile({
        file_path: dbPath,
        provider: 'cursor',
        last_modified_at: mtime,
        last_parsed_at: new Date().toISOString(),
        status: 'skipped',
        error_message: 'Cursor tracking database schema is not decoded yet; no usage extracted.'
    });
    if (onProgress) onProgress(1, 1);
};
