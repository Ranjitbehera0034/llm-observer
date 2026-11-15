import fs from 'fs';
import path from 'path';
import os from 'os';

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
 * Cursor's local database schema has not been verified for session imports.
 * Detect the store, but never invent sessions or mark an unsupported import as
 * successful. The manager exposes this explicit failure in provider status.
 */
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    if (!detector()) return;
    onProgress?.(0, 1);
    throw Object.assign(new Error(
        'Cursor session import is not supported for this local format. No session data was imported. Use subscription tracking or provider billing sync instead.'
    ), { code: 'UNSUPPORTED_FORMAT' });
};
