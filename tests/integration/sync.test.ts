import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import path from 'path';
import { initDb, getDb, encrypt } from '@llm-observer/database';
import syncRoutes from '../../packages/proxy/src/routes/sync.routes';
import { usageSyncManager } from '../../packages/proxy/src/sync';

// Mock fetch for Anthropic API
vi.mock('node-fetch', () => ({
    default: vi.fn(),
}));

import fetch from 'node-fetch';

describe('Anthropic Usage Sync Tests', () => {
    let app: express.Application;

    beforeEach(async () => {
        // Fix for migration path in tests
        const dbDir = path.join(__dirname, '../../packages/database/src');
        await initDb(':memory:'); 
        
        const db = getDb();
        db.prepare('DELETE FROM usage_sync_configs').run();
        db.prepare('DELETE FROM usage_records').run();

        app = express();
        app.use(express.json());
        app.use('/api/sync', syncRoutes);
        
        // Mock success response for key validation
        (fetch as any).mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'org_123', name: 'Test Org' })
        });
    });

    it('successfully adds and encrypts a valid Anthropic Admin Key', async () => {
        const adminKey = 'sk-ant-admin-test-key-123';
        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey });

        expect(res.status).toBe(200);
        expect(res.body.orgName).toBe('Test Org');

        const db = getDb();
        const config = db.prepare('SELECT * FROM usage_sync_configs WHERE id = \'anthropic\'').get() as any;
        expect(config.status).toBe('active');
        expect(config.org_id).toBe('org_123');
        expect(config.admin_key_enc).toContain(':'); // iv:tag:data format
    });

    it('rejects keys without sk-ant-admin prefix', async () => {
        // Mock a 403 Forbidden which is what Anthropic returns for standard keys
        (fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 403,
            text: async () => 'Forbidden'
        });

        const res = await request(app)
            .post('/api/sync/providers/anthropic/key')
            .send({ adminKey: 'sk-ant-api-wrong-prefix' });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Standard Anthropic API keys');
    });

    it('stores usage records correctly after polling', async () => {
        const db = getDb();
        
        // Mock usage API response
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'org_123', name: 'Test Org' })
        }).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                data: [
                    {
                        model: 'claude-sonnet-4',
                        bucket_start: '2026-03-22T00:00:00Z',
                        input_tokens: 1000,
                        output_tokens: 500,
                        num_requests: 10
                    }
                ],
                has_more: false
            })
        });

        // 1. Setup Key
        await request(app).post('/api/sync/providers/anthropic/key').send({ adminKey: 'sk-ant-admin-valid' });

        // 2. Wait for poller (manually trigger via refreshConfig is better in unit tests)
        await usageSyncManager.refreshConfig('anthropic');
        
        // We'll give it a bit more time for the async poll loop to hit the DB
        await new Promise(resolve => setTimeout(resolve, 1000));

        const records = db.prepare('SELECT * FROM usage_records').all() as any[];
        expect(records.length).toBe(1);
        expect(records[0].model).toBe('claude-sonnet-4');
        expect(records[0].input_tokens).toBe(1000);
    });

    it('soft-dehydrates key on removal but preserves stats', async () => {
        const db = getDb();
        
        // Add key and record
        db.prepare('INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status) VALUES (?, ?, ?, ?)')
          .run('anthropic', 'Anthropic', 'some-enc-key', 'active');
        db.prepare('INSERT INTO usage_records (provider, model, bucket_start, bucket_width) VALUES (?, ?, ?, ?)')
          .run('anthropic', 'claude-test', '2026-01-01', '1d');

        const res = await request(app).delete('/api/sync/providers/anthropic/key');
        expect(res.status).toBe(200);

        const config = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
        expect(config.status).toBe('inactive');
        expect(config.admin_key_enc).toBeNull();

        const records = db.prepare('SELECT count(*) as count FROM usage_records').get() as any;
        expect(records.count).toBe(1); // Stats preserved
    });

    it('handles paginated responses and merges records', async () => {
        const db = getDb();
        (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'org_123' }) }) // Init
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ model: 'm1', bucket_start: '2026-01-01T00:00:00Z', input_tokens: 100 }],
                    has_more: true,
                    next_page: 'cursor-1'
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ model: 'm2', bucket_start: '2026-01-02T00:00:00Z', input_tokens: 200 }],
                    has_more: false
                })
            });

        await request(app).post('/api/sync/providers/anthropic/key').send({ adminKey: 'sk-ant-admin-valid' });
        await usageSyncManager.refreshConfig('anthropic');
        await new Promise(r => setTimeout(r, 1500));

        const records = db.prepare('SELECT * FROM usage_records ORDER BY model').all() as any[];
        expect(records.length).toBe(2);
        expect(records[0].model).toBe('m1');
        expect(records[1].model).toBe('m2');
    });

    it('resumes from checkpoint on restart and prevents duplicates', async () => {
        const db = getDb();
        // 1. Manually insert checkpoint
        db.prepare('INSERT OR REPLACE INTO poll_checkpoints (provider, last_usage_bucket) VALUES (?, ?)')
            .run('anthropic', '2026-01-01T00:00:00Z');
        
        // 2. Mock fetch to return data AFTER checkpoint
        (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'org_123' }) }) // Init
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    data: [{ model: 'm2', bucket_start: '2026-01-02T00:00:00Z', input_tokens: 500 }],
                    has_more: false
                })
            });

        await request(app).post('/api/sync/providers/anthropic/key').send({ adminKey: 'sk-ant-admin-valid' });
        await usageSyncManager.refreshConfig('anthropic');
        await new Promise(r => setTimeout(r, 1000));

        const records = db.prepare('SELECT * FROM usage_records').all() as any[];
        expect(records.length).toBe(1);
        expect(records[0].model).toBe('m2');
        
        // Verify checkpoint was updated
        const cp = db.prepare("SELECT last_usage_bucket FROM poll_checkpoints WHERE provider = 'anthropic'").get() as any;
        expect(cp.last_usage_bucket).toBe('2026-01-02T00:00:00Z');
    });

    it('does NOT leak encrypted key material in status endpoint', async () => {
        // Add active config
        const db = getDb();
        db.prepare('INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status) VALUES (?, ?, ?, ?)')
            .run('anthropic', 'Anthropic', 'SUPER-SECRET-IV:TAG:DATA', 'active');

        const res = await request(app).get('/api/sync/status');
        expect(res.status).toBe(200);
        
        const content = JSON.stringify(res.body);
        expect(content).not.toContain('SUPER-SECRET');
        expect(content).not.toContain('admin_key_enc');
        expect(content).not.toContain('sk-ant-admin');
        
        // Verify expected fields exist
        expect(res.body[0].id).toBe('anthropic');
        expect(res.body[0].status).toBe('active');
    });
});
