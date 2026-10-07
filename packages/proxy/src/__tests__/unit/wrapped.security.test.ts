/**
 * RM-5: the Wrapped card is an image/svg+xml response that can be navigated to
 * top-level, so every interpolated value must be validated/escaped and the
 * response must be sandboxed.
 */
import request from 'supertest';
import { initDb, getDb } from '@llm-observer/database';
import { createDashboardApp } from '../../app';
import { WrappedService } from '../../services/wrapped.service';

const PAYLOAD = '2025"/><script>alert(1)</script><x a="';

describe('RM-5 Wrapped card hardening', () => {
    const app = createDashboardApp();
    // supertest only fills String(res.body) for text/json types, so collect the SVG body ourselves.
    const get = (url: string) => request(app).get(url).set('Host', 'localhost:4001').buffer(true).parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => cb(null, data));
    });

    beforeAll(() => {
        initDb(':memory:');
    });

    beforeEach(() => {
        WrappedService.clearCache();
    });

    describe('period validation', () => {
        it.each(['monthly', 'yearly'])('rejects a script payload as period for type=%s', async (type) => {
            const res = await get(`/api/wrapped/card?type=${type}&period=${encodeURIComponent(PAYLOAD)}`);
            expect(res.status).toBe(400);
            expect(String(res.body)).not.toContain('<script');
        });

        it('rejects a monthly period with a valid prefix and a payload suffix', async () => {
            const res = await get(`/api/wrapped/card?type=monthly&period=${encodeURIComponent('2025-03' + PAYLOAD)}`);
            expect(res.status).toBe(400);
        });

        it.each(['2025-13', '2025-00', '25-03', '2025-3', '20255', '2025-03-01', ''])('rejects malformed period %p', async (period) => {
            expect((await get(`/api/wrapped/card?type=monthly&period=${period}`)).status).toBe(400);
        });

        it('rejects a yearly period that is not four digits', async () => {
            expect((await get('/api/wrapped/card?type=yearly&period=2025-03')).status).toBe(400);
        });

        it('rejects an unknown type instead of treating it as yearly', async () => {
            expect((await get('/api/wrapped/card?type=weekly&period=2025')).status).toBe(400);
        });

        it('rejects a repeated period query parameter (array)', async () => {
            expect((await get('/api/wrapped/card?type=yearly&period=2025&period=2026')).status).toBe(400);
        });

        it('validates the JSON endpoints too', async () => {
            expect((await get(`/api/wrapped/monthly?month=${encodeURIComponent(PAYLOAD)}`)).status).toBe(400);
            expect((await get(`/api/wrapped/yearly?year=${encodeURIComponent(PAYLOAD)}`)).status).toBe(400);
        });

        it.each([['monthly', '2025-03'], ['yearly', '2025']])('still renders a valid %s period', async (type, period) => {
            const res = await get(`/api/wrapped/card?type=${type}&period=${period}&format=svg`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('image/svg+xml');
            expect(String(res.body)).toContain(`AI Wrapped ${period}`);
        });

        it('still serves the JSON reports for valid and default periods', async () => {
            expect((await get('/api/wrapped/monthly?month=2025-03')).status).toBe(200);
            expect((await get('/api/wrapped/monthly')).status).toBe(200);
            expect((await get('/api/wrapped/yearly?year=2025')).status).toBe(200);
            expect((await get('/api/wrapped/yearly')).status).toBe(200);
        });
    });

    describe('response headers', () => {
        it('sandboxes the SVG with nosniff, frame denial and a script-blocking CSP', async () => {
            const res = await get('/api/wrapped/card?type=yearly&period=2025');
            expect(res.status).toBe(200);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-frame-options']).toBe('DENY');
            const csp = res.headers['content-security-policy'];
            expect(csp).toContain('sandbox');
            expect(csp).toContain("default-src 'none'");
        });
    });

    describe('generateCardSVG escaping', () => {
        const prefs = { show_total_spend: true, show_per_app: true, show_subscriptions: true, show_insights: true };
        const report = (over: Record<string, any> = {}): any => ({
            period: '2025',
            type: 'yearly',
            stats: { total_spend: 1.5, total_requests: 3, days_active: 2 },
            breakdowns: { by_model: [{ model: '<script>alert(1)</script>' }] },
            ...over,
        });

        it('escapes markup in the top model name', () => {
            const svg = WrappedService.generateCardSVG(report(), prefs);
            expect(svg).not.toContain('<script>');
            expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        });

        it('escapes markup in the period', () => {
            const svg = WrappedService.generateCardSVG(report({ period: '"><script>x</script>' }), prefs);
            expect(svg).not.toContain('<script>');
            expect(svg).toContain('&quot;&gt;&lt;script&gt;');
        });

        it('keeps plain model names readable', () => {
            const svg = WrappedService.generateCardSVG(report({ breakdowns: { by_model: [{ model: 'gpt-4o' }] } }), prefs);
            expect(svg).toContain('>gpt-4o<');
        });
    });

    describe('report cache', () => {
        it('stays bounded', async () => {
            for (let m = 1; m <= 12; m++) {
                for (let y = 2000; y < 2020; y++) {
                    await WrappedService.getMonthlyReport(`${y}-${String(m).padStart(2, '0')}`);
                }
            }
            expect(WrappedService._cacheSizeForTest()).toBeLessThanOrEqual(64);
        });
    });
});
