/**
 * Base URLs and request URLs of the admin-API pollers.
 *
 * The URL builders are shared by the pollers and scripts/validate-admin-sync.js, so the validator
 * cannot drift from what the app really requests. The base URL env overrides exist so a local fake
 * vendor server can stand in for the real hosts; the defaults must stay the real hosts.
 */
import {
    ANTHROPIC_BASE_URL_ENV,
    OPENAI_BASE_URL_ENV,
    adminBaseUrl,
    anthropicUsageUrl,
    anthropicCostUrl,
    openaiUsageUrl,
    openaiCostUrl,
} from '../sync/admin-endpoints';

describe('admin API base URLs', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const k of [ANTHROPIC_BASE_URL_ENV, OPENAI_BASE_URL_ENV]) { saved[k] = process.env[k]; delete process.env[k]; }
    });
    afterEach(() => {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    });

    it('has the documented env var names', () => {
        expect(ANTHROPIC_BASE_URL_ENV).toBe('LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL');
        expect(OPENAI_BASE_URL_ENV).toBe('LLM_OBSERVER_OPENAI_ADMIN_BASE_URL');
    });

    it('defaults to the real vendor hosts', () => {
        expect(adminBaseUrl('anthropic')).toBe('https://api.anthropic.com');
        expect(adminBaseUrl('openai')).toBe('https://api.openai.com');
    });

    it('treats an empty or whitespace override as unset', () => {
        process.env[ANTHROPIC_BASE_URL_ENV] = '   ';
        expect(adminBaseUrl('anthropic')).toBe('https://api.anthropic.com');
    });

    it('honours an override and trims trailing slashes', () => {
        process.env[ANTHROPIC_BASE_URL_ENV] = 'http://127.0.0.1:16050/';
        process.env[OPENAI_BASE_URL_ENV] = 'https://gateway.example.com/openai//';
        expect(adminBaseUrl('anthropic')).toBe('http://127.0.0.1:16050');
        expect(adminBaseUrl('openai')).toBe('https://gateway.example.com/openai');
    });

    it.each(['http://127.0.0.1:1', 'http://localhost:2', 'http://[::1]:3'])('allows plain http only on loopback (%s)', (url) => {
        process.env[OPENAI_BASE_URL_ENV] = url;
        expect(adminBaseUrl('openai')).toBe(url);
    });

    it('refuses plain http to a non-loopback host, so an admin key is never sent in clear text', () => {
        process.env[OPENAI_BASE_URL_ENV] = 'http://api.openai.com.evil.example';
        expect(() => adminBaseUrl('openai')).toThrow(/https/i);
    });

    it.each(['not a url', 'ftp://example.com', 'https://user:pw@example.com'])('rejects an unusable override (%s)', (value) => {
        process.env[ANTHROPIC_BASE_URL_ENV] = value;
        expect(() => adminBaseUrl('anthropic')).toThrow(new RegExp(ANTHROPIC_BASE_URL_ENV));
    });
});

describe('admin API request URLs (unchanged from the pollers before the refactor)', () => {
    const base = 'https://example.test';

    it('Anthropic usage', () => {
        expect(anthropicUsageUrl(base, '2026-07-01T00:00:00.000Z', null))
            .toBe('https://example.test/v1/organizations/usage_report/messages?starting_at=2026-07-01T00%3A00%3A00.000Z&bucket_width=1d&group_by[]=model');
        expect(anthropicUsageUrl(base, '2026-07-01T00:00:00.000Z', 'page_abc'))
            .toContain('&page=page_abc');
    });

    it('Anthropic cost', () => {
        expect(anthropicCostUrl(base, '2026-07-01T00:00:00Z', '2026-07-03T00:00:01Z', null))
            .toBe('https://example.test/v1/organizations/cost_report?starting_at=2026-07-01T00%3A00%3A00Z&ending_at=2026-07-03T00%3A00%3A01Z&group_by[]=description');
        expect(anthropicCostUrl(base, '2026-07-01T00:00:00Z', '2026-07-03T00:00:01Z', 'a b')).toContain('&page=a%20b');
    });

    it('OpenAI usage and costs', () => {
        expect(openaiUsageUrl(base, 1782864000, null))
            .toBe('https://example.test/v1/organization/usage/completions?start_time=1782864000&bucket_width=1d&group_by[]=model');
        expect(openaiCostUrl(base, 1782864000, 'p1'))
            .toBe('https://example.test/v1/organization/costs?start_time=1782864000&bucket_width=1d&group_by[]=line_item&page=p1');
    });
});
