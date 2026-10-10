/**
 * The pollers send their requests to the host chosen by the LLM_OBSERVER_*_ADMIN_BASE_URL overrides
 * (and to the real vendor hosts when unset), and an injected fetch is used instead of node-fetch.
 * Uses the same mocked database / node-fetch harness as usage-sync-idempotency.test.ts.
 */
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
jest.mock('node-fetch', () => jest.fn());

import { getDb } from '@llm-observer/database';
import { AnthropicPoller } from '../sync/anthropic-poller';
import { OpenAIPoller } from '../sync/open-ai-poller';
import { ANTHROPIC_BASE_URL_ENV, OPENAI_BASE_URL_ENV } from '../sync/admin-endpoints';

const fetchMock = require('node-fetch') as jest.Mock;
const empty = { data: [], has_more: false, next_page: null };
const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });

describe('poller base URLs and fetch injection', () => {
    let db: any;
    beforeAll(() => { db = getDb(); jest.spyOn(console, 'warn').mockImplementation(() => { }); });
    beforeEach(() => {
        for (const t of ['usage_records', 'usage_sync_configs', 'poll_checkpoints']) db.prepare(`DELETE FROM ${t}`).run();
        for (const id of ['anthropic', 'openai']) {
            db.prepare("INSERT INTO usage_sync_configs (id, display_name, admin_key_enc, status, error_count) VALUES (?, ?, ?, 'active', 0)").run(id, id, `enc:key-${id}`);
        }
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => ok(empty));
        delete process.env[ANTHROPIC_BASE_URL_ENV];
        delete process.env[OPENAI_BASE_URL_ENV];
    });
    afterAll(() => { delete process.env[ANTHROPIC_BASE_URL_ENV]; delete process.env[OPENAI_BASE_URL_ENV]; });

    async function pollOnce(poller: any) { await poller.poll(); poller.stop(); }
    const urls = () => fetchMock.mock.calls.map((c: any[]) => c[0] as string);

    it('uses the real vendor hosts by default', async () => {
        await pollOnce(new AnthropicPoller({ id: 'anthropic' }));
        await pollOnce(new OpenAIPoller({ id: 'openai' }));
        expect(urls().filter((u: string) => u.startsWith('https://api.anthropic.com/v1/organizations/'))).toHaveLength(2);
        expect(urls().filter((u: string) => u.startsWith('https://api.openai.com/v1/organization/'))).toHaveLength(2);
    });

    it('uses the overrides when set', async () => {
        process.env[ANTHROPIC_BASE_URL_ENV] = 'http://127.0.0.1:16999';
        process.env[OPENAI_BASE_URL_ENV] = 'http://127.0.0.1:16998/';
        await pollOnce(new AnthropicPoller({ id: 'anthropic' }));
        await pollOnce(new OpenAIPoller({ id: 'openai' }));
        const u = urls();
        expect(u.filter((x: string) => x.startsWith('http://127.0.0.1:16999/v1/organizations/'))).toHaveLength(2);
        expect(u.filter((x: string) => x.startsWith('http://127.0.0.1:16998/v1/organization/'))).toHaveLength(2);
    });

    it('syncOnce runs the real usage + cost sync with an injected fetch and never touches node-fetch', async () => {
        const usage = {
            data: [{ starting_at: '2026-07-01T00:00:00Z', ending_at: '2026-07-02T00:00:00Z', results: [{ model: 'claude-x', uncached_input_tokens: 5, output_tokens: 7 }] }],
            has_more: false, next_page: null,
        };
        const injected = jest.fn(async (url: string) => ok(url.includes('cost_report') ? empty : usage)) as any;
        const poller = new AnthropicPoller({ id: 'anthropic' }, { fetch: injected });
        await poller.syncOnce('key-123', { usageStart: '2026-07-01T00:00:00.000Z', costStart: '2026-07-01' });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(injected).toHaveBeenCalledTimes(2); // usage + cost
        const first = injected.mock.calls[0];
        expect(first[1].headers['x-api-key']).toBe('key-123');
        const row = db.prepare("SELECT * FROM usage_records WHERE provider = 'anthropic'").get() as any;
        expect(row.input_tokens).toBe(5);
        expect(row.output_tokens).toBe(7);
    });
});
