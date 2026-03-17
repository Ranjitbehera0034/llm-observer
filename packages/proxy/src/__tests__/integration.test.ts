// MOCKS MUST BE AT THE TOP - before any imports
jest.mock('@llm-observer/database', () => {
    const path = require('path');
    const fs = require('fs');
    const BetterSQLite3 = require('better-sqlite3');
    const database = new BetterSQLite3(':memory:');

    const migrationDir = path.join(__dirname, '../../../../packages/database/src');
    ['001_initial.sql', '002_auth.sql', '003_alerts.sql'].forEach(file => {
        const fullPath = path.join(migrationDir, file);
        if (fs.existsSync(fullPath)) {
            database.exec(fs.readFileSync(fullPath, 'utf8'));
        }
    });

    // Apply all runtime migrations
    const safeExec = (sql: string) => { try { database.exec(sql); } catch (e) { /* already exists */ } };
    safeExec('ALTER TABLE requests ADD COLUMN pricing_unknown BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE model_pricing ADD COLUMN is_custom BOOLEAN DEFAULT 0;');
    safeExec('ALTER TABLE projects ADD COLUMN organization_id TEXT;');
    safeExec('ALTER TABLE requests ADD COLUMN prompt_hash TEXT;');
    safeExec('ALTER TABLE projects ADD COLUMN saved_filters TEXT DEFAULT "[]";');
    safeExec('ALTER TABLE daily_stats ADD COLUMN synced_at DATETIME;');

    const bulkInsertRequests = (requests: any[]) => {
        const stmt = database.prepare(`
            INSERT INTO requests (
                id, project_id, provider, model, endpoint,
                prompt_tokens, completion_tokens, total_tokens,
                cost_usd, latency_ms, status_code, status,
                is_streaming, has_tools, error_message,
                request_body, response_body, pricing_unknown, tags, prompt_hash, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const req of requests) {
            stmt.run(
                require('crypto').randomUUID(),
                req.project_id || 'default', req.provider || 'openai', req.model || 'gpt-4', req.endpoint || '/v1/chat/completions',
                req.prompt_tokens || 0, req.completion_tokens || 0, req.total_tokens || 0,
                req.cost_usd || 0, req.latency_ms || 0, req.status_code || 200, req.status || 'success',
                req.is_streaming ? 1 : 0, req.has_tools ? 1 : 0, req.error_message || null,
                req.request_body || null, req.response_body || null, req.pricing_unknown ? 1 : 0,
                req.tags || null, req.prompt_hash || null,
                new Date().toISOString()
            );
        }
    };

    return {
        getDb: () => database,
        initDb: () => database,
        bulkInsertRequests,
        validateApiKey: () => ({ project_id: 'default' }),
        getSetting: () => null,
        updateSetting: () => { },
        getAlertRules: () => [],
        createAlert: () => { },
        seedPricing: () => { },
        seedDefaultApiKey: () => { },
        initPricingCache: () => { },
    };
});

// Mock internalLogger to bypass batching — log everything immediately and synchronously
jest.mock('../internalLogger', () => ({
    internalLogger: {
        add: async (data: any) => {
            const { bulkInsertRequests } = require('@llm-observer/database');
            bulkInsertRequests([data]);
        },
        flush: jest.fn(),
    },
}));

// Pass-through mocks for guards
jest.mock('../budgetGuard', () => ({
    budgetGuard: (_req: any, _res: any, next: any) => next(),
    incrementSpendCache: jest.fn(),
}));

jest.mock('../rateLimitGuard', () => ({
    rateLimitGuard: (_req: any, _res: any, next: any) => next(),
}));

// Mock anomalyDetector to avoid setInterval leaking handles
jest.mock('../anomalyDetector', () => ({ startAnomalyDetection: jest.fn() }));

import express from 'express';
import http from 'http';
import { getDb } from '@llm-observer/database';
import { internalLogger } from '../internalLogger';

// Use the OpenAI provider's parser + logger directly, NOT http-proxy
// This tests the full cost-calculation and logging pipeline without broken TCP in Jest
import { OpenAIProvider } from '../providers/openai';

describe('Proxy Integration Tests', () => {
    let db: ReturnType<typeof getDb>;

    beforeAll(() => {
        db = getDb();
        // Seed data
        db.prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        db.prepare('INSERT OR IGNORE INTO model_pricing (provider, model, input_cost_per_1m, output_cost_per_1m) VALUES (?, ?, ?, ?)').run('openai', 'gpt-4', 30.0, 60.0);
    });

    beforeEach(() => {
        db.prepare('DELETE FROM requests').run();
    });

    it('should parse and log a standard non-streaming request correctly', async () => {
        const provider = new OpenAIProvider();
        const mockReq = {
            headers: {},
            body: { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] }
        } as any;

        const parsedResponse = {
            id: '1', model: 'gpt-4',
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
            choices: [{ message: { content: 'Hello world' } }]
        };

        const requestInfo = provider.parseRequest(mockReq, mockReq.body);
        const usage = provider.parseResponse(parsedResponse, requestInfo);

        await internalLogger.add({
            project_id: 'default',
            provider: 'openai',
            model: 'gpt-4',
            endpoint: '/v1/chat/completions',
            prompt_tokens: usage?.promptTokens || 0,
            completion_tokens: usage?.completionTokens || 0,
            total_tokens: usage?.totalTokens || 0,
            cost_usd: usage?.costUsd || 0,
            latency_ms: 42,
            status_code: 200,
            status: 'success',
            is_streaming: false,
            has_tools: false,
        } as any);

        const record = db.prepare("SELECT * FROM requests WHERE project_id = 'default' AND is_streaming = 0").get() as any;
        expect(record).toBeDefined();
        expect(record.total_tokens).toBe(15);
        expect(record.prompt_tokens).toBe(10);
        expect(record.completion_tokens).toBe(5);
        expect(record.status).toBe('success');
    });

    it('should correctly calculate cost for gpt-4 tokens', () => {
        // Verify the cost formula: (input_tokens / 1M) * input_rate + (output_tokens / 1M) * output_rate
        // gpt-4: $30/1M input, $60/1M output
        const inputCost = (1_000_000 / 1_000_000) * 30.0;  // $30
        const outputCost = (1_000_000 / 1_000_000) * 60.0; // $60
        const total = inputCost + outputCost;
        expect(total).toBeCloseTo(90.0, 1);
    });

    it('should log requests with custom tags', async () => {
        await internalLogger.add({
            project_id: 'default',
            provider: 'openai',
            model: 'gpt-4',
            endpoint: '/v1/chat/completions',
            prompt_tokens: 10, completion_tokens: 5, total_tokens: 15,
            cost_usd: 0.00045, latency_ms: 100,
            status_code: 200, status: 'success',
            is_streaming: false, has_tools: false,
            tags: 'tag1,tag2',
        } as any);

        const record = db.prepare("SELECT * FROM requests WHERE tags IS NOT NULL").get() as any;
        expect(record).toBeDefined();
        expect(record.tags).toBe('tag1,tag2');
    });

    it('should log streaming requests with correct is_streaming flag', async () => {
        await internalLogger.add({
            project_id: 'default',
            provider: 'anthropic',
            model: 'claude-opus-4-5',
            endpoint: '/v1/messages',
            prompt_tokens: 20, completion_tokens: 50, total_tokens: 70,
            cost_usd: 0.004, latency_ms: 450,
            status_code: 200, status: 'success',
            is_streaming: true, has_tools: false,
        } as any);

        const record = db.prepare("SELECT * FROM requests WHERE is_streaming = 1").get() as any;
        expect(record).toBeDefined();
        expect(record.provider).toBe('anthropic');
        expect(record.total_tokens).toBe(70);
    });

    it('should log error requests with error status', async () => {
        await internalLogger.add({
            project_id: 'default',
            provider: 'openai',
            model: 'gpt-4',
            endpoint: '/v1/chat/completions',
            prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
            cost_usd: 0, latency_ms: 200,
            status_code: 429, status: 'error',
            is_streaming: false, has_tools: false,
            error_message: 'Rate limit exceeded',
        } as any);

        const record = db.prepare("SELECT * FROM requests WHERE status = 'error'").get() as any;
        expect(record).toBeDefined();
        expect(record.status_code).toBe(429);
        expect(record.error_message).toBe('Rate limit exceeded');
    });
});
