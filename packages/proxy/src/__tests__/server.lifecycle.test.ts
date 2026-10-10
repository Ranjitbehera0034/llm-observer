/**
 * RM-2: server lifecycle. A busy port must produce an actionable message and a
 * non-zero exit, and SIGTERM/SIGINT must flush queued request rows to SQLite
 * before the database is closed.
 */
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import express from 'express';
import Database from 'better-sqlite3';
import { initDb, getDb, closeDb } from '@llm-observer/database';
import { EventEmitter } from 'events';
import { listenOrExit, createShutdownHandler, installSignalHandlers, flushOnShutdown } from '../server';
import * as parserManager from '../parsers/manager';
import { internalLogger } from '../internalLogger';

const listening = (server: net.Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
const closed = (server: net.Server) => new Promise<void>(resolve => server.close(() => resolve()));

describe('listenOrExit', () => {
    it('prints an actionable message and exits 1 when the port is taken', async () => {
        const blocker = net.createServer();
        const port = await listening(blocker);
        const errors: string[] = [];
        const spy = jest.spyOn(console, 'error').mockImplementation((m: any) => { errors.push(String(m)); });
        try {
            const exitCode = await new Promise<number>(resolve => {
                listenOrExit(express(), 'LLM Observer Proxy', port, '127.0.0.1', 'LLM_OBSERVER_PROXY_PORT', () => resolve(-1), resolve);
            });
            expect(exitCode).toBe(1);
            expect(errors.join('\n')).toMatch(new RegExp(`port ${port} on 127\\.0\\.0\\.1 is already in use`));
            expect(errors.join('\n')).toContain('LLM_OBSERVER_PROXY_PORT');
            expect(errors.join('\n')).toContain('llm-observer stop');
        } finally {
            spy.mockRestore();
            await closed(blocker);
        }
    });

    it('calls onListening and does not exit on a free port', async () => {
        const exit = jest.fn();
        const server = await new Promise<http.Server>(resolve => {
            const s: http.Server = listenOrExit(express(), 'x', 0, '127.0.0.1', 'X', () => resolve(s), exit);
        });
        expect(exit).not.toHaveBeenCalled();
        await closed(server);
    });
});

describe('createShutdownHandler', () => {
    let dbFile: string;
    beforeEach(() => {
        closeDb();
        dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-shutdown-')), 'data.db');
        jest.spyOn(console, 'log').mockImplementation(() => {});
        initDb(dbFile);
        getDb().prepare("INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES ('default', 'Default Project', 5)").run();
        jest.spyOn(console, 'log').mockRestore();
    });
    afterEach(() => { closeDb(); jest.restoreAllMocks(); });

    const queueRows = async (n: number) => {
        // Below the batch size and before the 5s timer: these rows exist only in memory.
        for (let i = 0; i < n; i++) {
            await internalLogger.add({
                project_id: 'default', provider: 'openai', model: 'gpt-4', endpoint: '/v1/chat/completions',
                cost_usd: 0.01, status_code: 200, status: 'success',
            } as any);
        }
    };
    const rowCount = () => {
        const reader = new Database(dbFile, { readonly: true });
        try { return (reader.prepare('SELECT count(*) AS n FROM requests').get() as { n: number }).n; } finally { reader.close(); }
    };

    it('flushes queued rows to SQLite, closes the database, then exits 0', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        await queueRows(3);
        expect(rowCount()).toBe(0); // still only in the in-memory queue

        const server = http.createServer();
        await listening(server);
        const order: string[] = [];
        const exit = jest.fn((code: number) => { order.push(`exit:${code}`); });
        const shutdown = createShutdownHandler({
            servers: [server],
            flush: async () => { order.push('flush'); await internalLogger.flush(); },
            closeDatabase: () => { order.push('close'); closeDb(); },
            exit,
        });
        await shutdown('SIGTERM');

        expect(order).toEqual(['flush', 'close', 'exit:0']);
        expect(rowCount()).toBe(3);
        expect(server.listening).toBe(false);
    });

    it('runs only once when signalled twice', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const flush = jest.fn(async () => {});
        const exit = jest.fn();
        const shutdown = createShutdownHandler({ servers: [], flush, closeDatabase: () => {}, exit });
        await Promise.all([shutdown('SIGINT'), shutdown('SIGTERM')]);
        expect(flush).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });

    it('still closes the database and exits non-zero when the flush fails', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const close = jest.fn();
        const exit = jest.fn();
        const shutdown = createShutdownHandler({
            servers: [], flush: async () => { throw new Error('disk full'); }, closeDatabase: close, exit,
        });
        await shutdown('SIGTERM');
        expect(close).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
    });
});

describe('installSignalHandlers (the wiring main() uses)', () => {
    let dbFile: string;
    beforeEach(() => {
        closeDb();
        dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-signals-')), 'data.db');
        jest.spyOn(console, 'log').mockImplementation(() => {});
        initDb(dbFile);
        getDb().prepare("INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES ('default', 'Default Project', 5)").run();
    });
    afterEach(() => { closeDb(); jest.restoreAllMocks(); });

    const rowCount = () => {
        const reader = new Database(dbFile, { readonly: true });
        try { return (reader.prepare('SELECT count(*) AS n FROM requests').get() as { n: number }).n; } finally { reader.close(); }
    };
    const exited = (exit: jest.Mock) => new Promise<number>(resolve => { exit.mockImplementation(resolve); });

    it.each(['SIGTERM', 'SIGINT'])('%s flushes the real logger queue to SQLite and exits 0', async (signal) => {
        await internalLogger.add({
            project_id: 'default', provider: 'openai', model: 'gpt-4', endpoint: '/v1/chat/completions',
            cost_usd: 0.01, status_code: 200, status: 'success',
        } as any);
        expect(rowCount()).toBe(0); // queued in memory only

        const proc = new EventEmitter();
        const exit = jest.fn();
        const done = exited(exit);
        installSignalHandlers(proc, exit);
        expect(proc.listenerCount('SIGTERM')).toBe(1);
        expect(proc.listenerCount('SIGINT')).toBe(1);

        proc.emit(signal);
        expect(await done).toBe(0);
        expect(rowCount()).toBe(1);
        expect(() => getDb()).toThrow(); // database closed after the flush
    });

    it('writes queued rows to SQLite while a parser stop is still pending, so a stuck parse cannot delay the flush', async () => {
        let releaseParsers!: () => void;
        const stopParsers = jest.spyOn(parserManager, 'stopParsers').mockImplementation(
            () => new Promise<void>(resolve => { releaseParsers = resolve; }),
        );
        await internalLogger.add({
            project_id: 'default', provider: 'openai', model: 'gpt-4', endpoint: '/v1/chat/completions',
            cost_usd: 0.01, status_code: 200, status: 'success',
        } as any);
        expect(rowCount()).toBe(0);

        let finished = false;
        const shutdown = flushOnShutdown().then(() => { finished = true; });
        await new Promise(r => setTimeout(r, 300));
        expect(stopParsers).toHaveBeenCalledTimes(1);
        expect(rowCount()).toBe(1); // flushed although the parsers have not stopped
        expect(finished).toBe(false); // the database is not closed under a parse still in flight
        releaseParsers();
        await shutdown;
        expect(finished).toBe(true);
    });
});
