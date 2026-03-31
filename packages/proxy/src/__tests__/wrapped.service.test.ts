
// ── Database mock ────────────────────────────────────────────────────────────
const { createTestDb } = require('./helpers/testDb');
const { database, getBudgetLimits } = createTestDb();

jest.mock('@llm-observer/database', () => ({
    getDb: () => database,
    initDb: () => database,
    getBudgetLimits,
    createAlert: () => { },
    getSubscriptions: (onlyActive: boolean) => {
        let query = 'SELECT * FROM subscriptions';
        if (onlyActive) query += ' WHERE is_active = 1';
        return database.prepare(query).all();
    }
}));

import { WrappedService } from '../services/wrapped.service';
import { getDb } from '@llm-observer/database';

describe('WrappedService (v1.9.0)', () => {
    let db: any;

    beforeAll(() => {
        db = getDb();
        // Setup preferences table since testDb might not have it yet if migrations aren't auto-run in jest
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS wrapped_preferences (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    show_total_spend BOOLEAN DEFAULT 1,
                    show_per_app BOOLEAN DEFAULT 1,
                    show_subscriptions BOOLEAN DEFAULT 1,
                    show_insights BOOLEAN DEFAULT 1,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                INSERT OR IGNORE INTO wrapped_preferences (id) VALUES (1);
            `);
        } catch (e) {}
    });

    beforeEach(() => {
        WrappedService.clearCache();
        db.prepare('DELETE FROM usage_records').run();
        db.prepare('DELETE FROM subscriptions').run();
        db.prepare('DELETE FROM alerts').run();
    });

    const seedUsage = (provider: string, model: string, cost: number, date: string) => {
        db.prepare(`
            INSERT INTO usage_records (provider, model, bucket_start, bucket_width, cost_usd, input_tokens, output_tokens, num_requests)
            VALUES (?, ?, ?, '1h', ?, 1000, 500, 10)
        `).run(provider, model, date, cost);
    };

    const seedSubscription = (name: string, cost: number, startDate: string) => {
        db.prepare(`
            INSERT INTO subscriptions (service_name, monthly_cost_usd, billing_cycle, is_active, start_date)
            VALUES (?, ?, 'monthly', 1, ?)
        `).run(name, cost, startDate);
    };

    describe('Report Generation', () => {
        it('aggregates monthly data correctly', async () => {
            const month = '2026-03';
            seedUsage('anthropic', 'claude-3-opus', 10.0, '2026-03-05T10:00:00Z');
            seedUsage('openai', 'gpt-4', 5.0, '2026-03-15T12:00:00Z');
            seedSubscription('Cursor Pro', 20.0, '2026-01-01T00:00:00Z');

            const report = await WrappedService.getMonthlyReport(month);

            expect(report.period).toBe(month);
            expect(report.stats.total_spend).toBe(15.0 + 20.0);
            expect(report.breakdowns.by_provider.anthropic).toBe(10.0);
            expect(report.breakdowns.by_provider.openai).toBe(5.0);
            expect(report.stats.days_active).toBe(2);
        });

        it('identifies available periods', async () => {
            seedUsage('anthropic', 'opus', 1.0, '2026-03-01T00:00:00Z');
            seedUsage('openai', 'gpt-4', 1.0, '2025-12-01T00:00:00Z');

            const periods = await WrappedService.getAvailablePeriods();
            expect(periods.months).toContain('2026-03');
            expect(periods.months).toContain('2025-12');
            expect(periods.years).toContain('2026');
            expect(periods.years).toContain('2025');
        });
    });

    describe('Insights Engine', () => {
        it('hides insights when data is insufficient (< 7 days)', async () => {
            // Seed only 3 days of data
            for (let i = 0; i < 3; i++) {
                seedUsage('anthropic', 'claude-3-opus', 0.1, `2026-03-0${i+1}T12:00:00Z`);
            }
            const report = await WrappedService.getMonthlyReport('2026-03');
            expect(report.insights).toHaveLength(0);
        });

        it('suggests model optimization when thresholds met', async () => {
            // Seed 8 days of data, 60 requests total
            for (let i = 0; i < 8; i++) {
                for (let j = 0; j < 8; j++) {
                    db.prepare(`
                        INSERT INTO usage_records (provider, model, bucket_start, bucket_width, cost_usd, input_tokens, output_tokens, num_requests)
                        VALUES ('anthropic', 'claude-3-opus', ?, '1h', 0.15, 1000, 100, 1)
                    `).run(`2026-03-0${i+1}T1${j}:00:00Z`);
                }
            }

            const report = await WrappedService.getMonthlyReport('2026-03');
            const insight = report.insights.find(i => i.type === 'model_optimization');
            expect(insight).toBeDefined();
        });

        it('calculates cache efficiency insight', async () => {
            // Seed 8 days, heavy input, low cache hit
            for (let i = 1; i <= 8; i++) {
                db.prepare(`
                    INSERT INTO usage_records (provider, model, bucket_start, bucket_width, cost_usd, input_tokens, output_tokens, num_requests, cache_read_tokens)
                    VALUES ('anthropic', 'claude-3-sonnet', ?, '1h', 1.0, 50000, 1000, 10, 1000)
                `).run(`2026-03-0${i}T12:00:00Z`);
            }
            const report = await WrappedService.getMonthlyReport('2026-03');
            const insight = report.insights.find(i => i.type === 'cache_efficiency');
            expect(insight).toBeDefined();
        });
    });

    describe('Partial Month Handling', () => {
        it('reports correct coverage for late-month installs', async () => {
            seedUsage('openai', 'gpt-4', 1.0, '2026-03-28T10:00:00Z');
            seedUsage('openai', 'gpt-4', 1.0, '2026-03-30T10:00:00Z');

            const report = await WrappedService.getMonthlyReport('2026-03');
            expect(report.stats.days_active).toBe(2);
            expect(report.stats.period_start).toContain('2026-03-28');
            expect(report.stats.period_end).toContain('2026-03-30');
        });
    });

    describe('Security & Content Safety', () => {
        it('does not leak sensitive data in SVG', async () => {
            // Seed some "sensitive" looking data in provider/model to be sure
            seedUsage('sk-12345-api-key', 'workspace-secret-99', 1.0, '2026-03-05T10:00:00Z');
            
            const report = await WrappedService.getMonthlyReport('2026-03');
            const svg = WrappedService.generateCardSVG(report, {
                show_total_spend: true,
                show_per_app: true,
                show_subscriptions: true,
                show_insights: true
            });

            expect(svg).not.toContain('sk-12345');
            expect(svg).not.toContain('workspace-secret');
            expect(svg).toContain('workspace-***'); // Sanitized
            expect(svg).toContain('AI Wrapped 2026-03');
        });
    });
});
