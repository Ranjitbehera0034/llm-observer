import * as cursorParser from '../cursor';
import * as dbMock from '@llm-observer/database';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(),
    upsertParsedFile: jest.fn(),
    insertSession: jest.fn(() => 1),
    deleteMockCursorSessions: jest.fn(() => 0),
}));

describe('Cursor parser', () => {
    let tmpHome: string;
    let dbPath: string;
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;

    beforeEach(() => {
        jest.clearAllMocks();
        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-parser-'));
        jest.spyOn(os, 'homedir').mockReturnValue(tmpHome);
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        dbPath = path.join(tmpHome, '.cursor', 'ai-tracking', 'ai-code-tracking.db');
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        // Minimal stand-in for the tracking DB: it only needs to exist and be a valid SQLite file.
        const db = new Database(dbPath);
        db.exec('CREATE TABLE ai_events (id TEXT, ts INTEGER)');
        db.exec("INSERT INTO ai_events VALUES ('e1', 1760000000000)");
        db.close();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        Object.defineProperty(process, 'platform', platformDescriptor);
        fs.rmSync(tmpHome, { recursive: true, force: true });
    });

    it('never inserts a mock session (no real data means no row)', async () => {
        expect(cursorParser.detector()).toBe(true);
        await cursorParser.parse();
        expect(dbMock.insertSession).not.toHaveBeenCalled();
    });

    it('records the file as skipped so the unsupported schema is visible, not as a success', async () => {
        await cursorParser.parse();
        const call = (dbMock.upsertParsedFile as jest.Mock).mock.calls[0][0];
        expect(call.provider).toBe('cursor');
        expect(call.status).toBe('skipped');
        expect(call.error_message).toMatch(/not (yet )?supported|not decoded/i);
    });
});
