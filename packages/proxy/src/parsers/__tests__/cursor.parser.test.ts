import * as cursorParser from '../cursor';
import * as dbMock from '@llm-observer/database';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    getPricingForModel: jest.fn()
}));

// Mirrors the platform branch in cursor.ts getCursorDbPath
const cursorDbPath = (home: string): string =>
    process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage', 'ai-code-tracking.db')
        : path.join(home, '.cursor', 'ai-tracking', 'ai-code-tracking.db');

const MIN = 60 * 1000;
const event = (id: string, timestamp: number): cursorParser.CursorEvent => ({ id, timestamp, type: 'generation' });

describe('Cursor Parser', () => {
    let tmpHome: string;
    let dbPath: string;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-parser-test-'));
        dbPath = cursorDbPath(tmpHome);
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const db = new Database(dbPath);
        db.exec('CREATE TABLE ai_events (id TEXT, timestamp INTEGER, type TEXT)');
        db.prepare('INSERT INTO ai_events VALUES (?, ?, ?)').run('e1', Date.now(), 'generation');
        db.close();
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('detects the cursor tracking database', () => {
        expect(cursorParser.detector()).toBe(true);
        fs.rmSync(dbPath);
        expect(cursorParser.detector()).toBe(false);
    });

    it('parses the tracking database and registers the file as parsed', async () => {
        await cursorParser.parse();

        expect(dbMock.insertSession).toHaveBeenCalledTimes(1);
        const session = (dbMock.insertSession as jest.Mock).mock.calls[0][0];
        expect(session.provider).toBe('cursor');
        expect(session.session_id).toMatch(/^cursor-sync-\d+$/);
        expect(session.file_path).toBe(dbPath);
        expect(session.file_modified_at).toBe(fs.statSync(dbPath).mtimeMs);

        expect(dbMock.upsertParsedFile).toHaveBeenCalledWith(
            expect.objectContaining({ file_path: dbPath, provider: 'cursor', status: 'success' })
        );
    });

    it('skips the database when it has not changed since the last parse', async () => {
        (dbMock.getParsedFile as jest.Mock).mockReturnValue({
            last_modified_at: fs.statSync(dbPath).mtimeMs
        });

        await cursorParser.parse();

        expect(dbMock.insertSession).not.toHaveBeenCalled();
        expect(dbMock.upsertParsedFile).not.toHaveBeenCalled();
    });

    it('records an error status when the database file is not valid SQLite', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        fs.writeFileSync(dbPath, 'this is not a sqlite database');

        await cursorParser.parse();

        expect(dbMock.insertSession).not.toHaveBeenCalled();
        expect(dbMock.upsertParsedFile).toHaveBeenCalledWith(
            expect.objectContaining({ file_path: dbPath, provider: 'cursor', status: 'error' })
        );
    });

    // Core grouping behavior is covered in src/__tests__/unit/cursor-parser.test.ts;
    // these pin the edge cases that suite does not exercise.
    describe('groupCursorEventsIntoSessions', () => {
        it('keeps events exactly at the 5-minute threshold in one session', () => {
            const atThreshold = [event('a', 0), event('b', 5 * MIN)];
            expect(cursorParser.groupCursorEventsIntoSessions(atThreshold)).toHaveLength(1);

            const pastThreshold = [event('a', 0), event('b', 5 * MIN + 1)];
            expect(cursorParser.groupCursorEventsIntoSessions(pastThreshold)).toEqual([
                [pastThreshold[0]],
                [pastThreshold[1]]
            ]);
        });

        it('honors a custom proximity threshold', () => {
            const events = [event('a', 0), event('b', 30 * 1000)];
            expect(cursorParser.groupCursorEventsIntoSessions(events, 10 * 1000)).toHaveLength(2);
        });
    });
});
