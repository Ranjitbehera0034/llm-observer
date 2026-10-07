/**
 * Admin-API billing sync: idempotency and response-shape conformance.
 *
 * Runs the real AnthropicPoller / OpenAIPoller against a mocked node-fetch. The fixtures in
 * ./fixtures are SYNTHETIC (derived from the vendors' published docs, see fixtures/README.md),
 * not recordings of a live admin key.
 */

// -- Database mock ------------------------------------------------------------
jest.mock('@llm-observer/database', () => {
    const { createTestDb } = require('./helpers/testDb');
    const { database, getBudgetLimits } = createTestDb();
    return {
        getDb: () => database,
        initDb: () => database,
        getBudgetLimits,
        encrypt: (v: string) => `enc:${v}`,
        decrypt: (v: string) => v.replace('enc:', ''),
        getSetting: () => null,
        updateSetting: () => { },
        getAlertRules: () => [],
        createAlert: () => { },
    };
});

// -- node-fetch mock -----------------------------------------------------------
jest.mock('node-fetch', () => jest.fn());

import fs from 'fs';
import path from 'path';
import { getDb } from '@llm-observer/database';
import { AnthropicPoller } from '../sync/anthropic-poller';
import { OpenAIPoller } from '../sync/open-ai-poller';
import { BudgetService } from '../services/budget.service';

const fetchMock = require('node-fetch') as jest.Mock;

function fixture(name: string): any {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

function okResponse(body: any) {
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
}

/** Routes each request to a canned body by URL substring; records the URLs it saw. */
function routeFetch(routes: Record<string, any | any[]>) {
    const urls: string[] = [];
    const counters: Record<string, number> = {};
    fetchMock.mockImplementation(async (url: string) => {
        urls.push(url);
        for (const key of Object.keys(routes)) {
            if (url.includes(key)) {
                const entry = routes[key];
                if (Array.isArray(entry)) {
                    const i = counters[key] = (counters[key] ?? -1) + 1;
                    return okResponse(entry[Math.min(i, entry.length - 1)]);
                }
                return okResponse(entry);
            }
        }
        throw new Error(`unexpected URL ${url}`);
    });
    return urls;
}

async function pollOnce(poller: any) {
    await poller.poll();
    poller.stop(); // poll() always re-arms a timer
}

const ANTHROPIC = {
    usage: 'usage_report/messages',
    cost: 'cost_report',
};

function seedConfig(db: any, id: 'anthropic' | 'openai') {
    db.prepare(`INSERT OR REPLACE INTO usage_sync_configs (id, display_name, admin_key_enc, status, error_count)
                VALUES (?, ?, ?, 'active', 0)`).run(id, id, `enc:key-${id}`);
}

function rows(db: any, provider: string) {
    return db.prepare('SELECT * FROM usage_records WHERE provider = ? ORDER BY model').all(provider) as any[];
}

function sumCost(db: any, provider: string): number {
    return (db.prepare('SELECT SUM(cost_usd) AS t FROM usage_records WHERE provider = ?').get(provider) as any).t;
}

describe('usage sync idempotency and shapes', () => {
    let db: any;
    let anthropic: any;
    let openai: any;

    beforeAll(() => { db = getDb(); jest.spyOn(console, 'error').mockImplementation(() => { }); jest.spyOn(console, 'warn').mockImplementation(() => { }); });
    beforeEach(() => {
        for (const t of ['usage_records', 'usage_sync_configs', 'poll_checkpoints']) db.prepare(`DELETE FROM ${t}`).run();
        fetchMock.mockReset();
        seedConfig(db, 'anthropic');
        seedConfig(db, 'openai');
        anthropic = new AnthropicPoller({ id: 'anthropic' });
        openai = new OpenAIPoller({ id: 'openai' });
    });
    afterEach(() => { anthropic.stop(); openai.stop(); });

    describe('Anthropic', () => {
        it('polling the same flat response twice leaves one row and an unchanged cost sum', async () => {
            routeFetch({ [ANTHROPIC.usage]: fixture('anthropic-usage-report.flat.json'), [ANTHROPIC.cost]: fixture('anthropic-cost-report.flat.json') });

            await pollOnce(anthropic);
            expect(rows(db, 'anthropic')).toHaveLength(1);
            expect(sumCost(db, 'anthropic')).toBeCloseTo(4, 6);

            await pollOnce(anthropic);
            expect(rows(db, 'anthropic')).toHaveLength(1);
            expect(sumCost(db, 'anthropic')).toBeCloseTo(4, 6);
        });

        it('ingests the documented nested shape with correct tokens and cents converted to USD', async () => {
            routeFetch({ [ANTHROPIC.usage]: fixture('anthropic-usage-report.nested.json'), [ANTHROPIC.cost]: fixture('anthropic-cost-report.nested.json') });

            await pollOnce(anthropic);

            const r = rows(db, 'anthropic');
            expect(r.map(x => x.model)).toEqual(['claude-3-5-haiku-20241022', 'claude-sonnet-4-20250514']);
            const sonnet = r.find(x => x.model === 'claude-sonnet-4-20250514');
            expect(sonnet.bucket_start).toBe('2026-07-01T00:00:00Z');
            expect(sonnet.input_tokens).toBe(10000);
            expect(sonnet.output_tokens).toBe(5000);
            expect(sonnet.cache_read_tokens).toBe(2000);
            expect(sonnet.cache_write_tokens).toBe(500);
            // (150.5 + 250) cents across two token types of the same model-day
            expect(sonnet.cost_usd).toBeCloseTo(4.005, 6);
            expect(r.find(x => x.model === 'claude-3-5-haiku-20241022').cost_usd).toBeCloseTo(0.2, 6);
        });

        it('polling the nested shape twice is idempotent', async () => {
            routeFetch({ [ANTHROPIC.usage]: fixture('anthropic-usage-report.nested.json'), [ANTHROPIC.cost]: fixture('anthropic-cost-report.nested.json') });

            await pollOnce(anthropic);
            const first = sumCost(db, 'anthropic');
            await pollOnce(anthropic);
            await pollOnce(anthropic);

            expect(rows(db, 'anthropic')).toHaveLength(2);
            expect(sumCost(db, 'anthropic')).toBeCloseTo(first, 9);
        });

        it('sends the documented pagination parameter and follows next_page', async () => {
            const page1 = { ...fixture('anthropic-usage-report.nested.json'), has_more: true, next_page: 'page_abc' };
            const page2 = {
                data: [{ starting_at: '2026-07-02T00:00:00Z', ending_at: '2026-07-03T00:00:00Z', results: [{ model: 'claude-sonnet-4-20250514', uncached_input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 0, cache_creation: {} }] }],
                has_more: false, next_page: null,
            };
            const urls = routeFetch({ [ANTHROPIC.usage]: [page1, page2], [ANTHROPIC.cost]: { data: [], has_more: false } });

            await pollOnce(anthropic);

            const usageUrls = urls.filter(u => u.includes(ANTHROPIC.usage));
            expect(usageUrls).toHaveLength(2);
            expect(usageUrls[1]).toContain('page=page_abc');
            expect(usageUrls[1]).not.toContain('next_page=');
            expect(rows(db, 'anthropic')).toHaveLength(3);
        });

        it.each([
            ['data is not an array', { data: { oops: true } }],
            ['usage entry is neither a bucket nor a flat record', { data: [{ hello: 'world' }] }],
            ['bucket has no results array', { data: [{ starting_at: '2026-07-01T00:00:00Z', ending_at: '2026-07-02T00:00:00Z' }] }],
            ['body is not an object', 'maintenance page'],
        ])('an unrecognised usage shape (%s) sets a visible error instead of inserting zero rows', async (_label, body) => {
            routeFetch({ [ANTHROPIC.usage]: body, [ANTHROPIC.cost]: { data: [], has_more: false } });

            await pollOnce(anthropic);

            expect(rows(db, 'anthropic')).toHaveLength(0);
            const cfg = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
            expect(cfg.status).toBe('error');
            expect(cfg.last_error).toMatch(/unrecognised|unrecognized/i);
        });

        it('an unrecognised cost shape sets a visible error', async () => {
            routeFetch({ [ANTHROPIC.usage]: fixture('anthropic-usage-report.nested.json'), [ANTHROPIC.cost]: { data: [{ weird: 1 }] } });

            await pollOnce(anthropic);

            const cfg = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
            expect(cfg.status).toBe('error');
            expect(cfg.last_error).toMatch(/cost/i);
        });

        it('an empty but well-formed response is not an error', async () => {
            routeFetch({ [ANTHROPIC.usage]: { data: [], has_more: false }, [ANTHROPIC.cost]: { data: [], has_more: false } });

            await pollOnce(anthropic);

            const cfg = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'anthropic'").get() as any;
            expect(cfg.status).toBe('active');
            expect(cfg.last_error).toBeNull();
        });

        it('BudgetService reports the same spend after 1 poll and after 60 polls', async () => {
            const today = new Date(); today.setUTCHours(0, 0, 0, 0);
            const usage = fixture('anthropic-usage-report.nested.json');
            const cost = fixture('anthropic-cost-report.nested.json');
            usage.data[0].starting_at = today.toISOString();
            cost.data[0].starting_at = today.toISOString();
            routeFetch({ [ANTHROPIC.usage]: usage, [ANTHROPIC.cost]: cost });

            await pollOnce(anthropic);
            const afterOne = await BudgetService.calculateCurrentSpend('global', undefined, 'daily');
            expect(afterOne).toBeCloseTo(4.205, 6);

            for (let i = 0; i < 59; i++) await pollOnce(anthropic);
            const afterSixty = await BudgetService.calculateCurrentSpend('global', undefined, 'daily');
            expect(afterSixty).toBeCloseTo(afterOne, 9);
        });

        it('upserts when api_key_id / workspace_id are populated, and treats NULL and empty as one key', () => {
            const insert = (apiKey: string | null, tokens: number) => db.prepare(`
                INSERT INTO usage_records (provider, model, bucket_start, bucket_width, input_tokens, api_key_id, workspace_id)
                VALUES ('anthropic', 'm', '2026-07-01T00:00:00Z', '1d', ?, ?, NULL)
                ON CONFLICT(provider, model, bucket_start, COALESCE(api_key_id, ''), COALESCE(workspace_id, ''))
                DO UPDATE SET input_tokens = excluded.input_tokens`).run(tokens, apiKey);
            insert('key1', 1); insert('key1', 2);
            insert(null, 3); insert('', 4);
            const r = rows(db, 'anthropic');
            expect(r).toHaveLength(2);
            expect(r.map(x => x.input_tokens).sort()).toEqual([2, 4]);
        });
    });

    describe('OpenAI', () => {
        const OPENAI = { usage: 'organization/usage/completions', cost: 'organization/costs' };

        it('polling the same flat response twice leaves one row and an unchanged cost sum', async () => {
            routeFetch({ [OPENAI.usage]: fixture('openai-usage-completions.flat.json'), [OPENAI.cost]: fixture('openai-costs.flat.json') });

            await pollOnce(openai);
            expect(rows(db, 'openai')).toHaveLength(1);
            await pollOnce(openai);
            expect(rows(db, 'openai')).toHaveLength(1);
            expect(sumCost(db, 'openai')).toBeCloseTo(0.06, 9);
        });

        it('ingests the documented nested shape and is idempotent', async () => {
            routeFetch({ [OPENAI.usage]: fixture('openai-usage-completions.nested.json'), [OPENAI.cost]: fixture('openai-costs.nested.json') });

            await pollOnce(openai);
            await pollOnce(openai);

            const r = rows(db, 'openai');
            expect(r).toHaveLength(1);
            expect(r[0].model).toBe('gpt-4o-2024-08-06');
            expect(r[0].bucket_start).toBe('2026-07-01T00:00:00.000Z');
            expect(r[0].input_tokens).toBe(1000);
            expect(r[0].output_tokens).toBe(500);
            expect(r[0].cache_read_tokens).toBe(800);
            expect(r[0].num_requests).toBe(5);
            expect(r[0].cost_usd).toBeCloseTo(0.06, 9);
        });

        it('re-polls the open bucket (checkpoint is the bucket start, not its end)', async () => {
            // Retime the fixture to today so its bucket is newer than the default look-back window.
            const todayStart = Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000);
            const usage = fixture('openai-usage-completions.nested.json');
            usage.data[0].start_time = todayStart;
            usage.data[0].end_time = todayStart + 86400;
            const urls = routeFetch({ [OPENAI.usage]: usage, [OPENAI.cost]: { data: [], has_more: false } });

            await pollOnce(openai);
            await pollOnce(openai);

            const usageUrls = urls.filter(u => u.includes(OPENAI.usage));
            expect(usageUrls[1]).toContain(`start_time=${todayStart}`);
            expect(rows(db, 'openai')).toHaveLength(1);
        });

        it('sums several cost line items of one model-day instead of keeping the last', async () => {
            const cost = fixture('openai-costs.nested.json');
            cost.data[0].results = [
                { object: 'organization.costs.result', amount: { value: 0.04, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, input', project_id: null },
                { object: 'organization.costs.result', amount: { value: 0.02, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, output', project_id: null },
            ];
            routeFetch({ [OPENAI.usage]: fixture('openai-usage-completions.nested.json'), [OPENAI.cost]: cost });

            await pollOnce(openai);

            expect(rows(db, 'openai')[0].cost_usd).toBeCloseTo(0.06, 9);
        });

        it('sends the documented pagination parameter', async () => {
            const page1 = { ...fixture('openai-usage-completions.nested.json'), has_more: true, next_page: 'page_xyz' };
            const urls = routeFetch({ [OPENAI.usage]: [page1, fixture('openai-usage-completions.nested.json')], [OPENAI.cost]: { data: [], has_more: false } });

            await pollOnce(openai);

            const usageUrls = urls.filter(u => u.includes(OPENAI.usage));
            expect(usageUrls[1]).toContain('page=page_xyz');
            expect(usageUrls[1]).not.toContain('next_page=');
        });

        it('an unrecognised usage shape sets a visible error instead of inserting zero rows', async () => {
            routeFetch({ [OPENAI.usage]: { data: [{ hello: 'world' }] }, [OPENAI.cost]: { data: [], has_more: false } });

            await pollOnce(openai);

            expect(rows(db, 'openai')).toHaveLength(0);
            const cfg = db.prepare("SELECT * FROM usage_sync_configs WHERE id = 'openai'").get() as any;
            expect(cfg.status).toBe('error');
            expect(cfg.last_error).toMatch(/unrecognised|unrecognized/i);
        });
    });
});
