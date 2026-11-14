import { safeReadSQLite, calculateCost, estimateTokens } from '../utils';
import path from 'path';
import Database from 'better-sqlite3';

jest.mock('@llm-observer/database', () => ({
    getPricingForModel: jest.fn((provider: string, model: string) => {
        if (model === 'claude-test') return { input: 3, output: 15, cached: 0.3 };
        if (model === 'free-cache') return { input: 10, output: 30, cached: 0 };
        if (model === 'gpt-4') return { input: 10, output: 30, cached: 5 };
        return undefined;
    })
}));

describe('Parser Utils', () => {
    it('should correctly estimate tokens from string length (char/4)', () => {
        expect(estimateTokens('abcd')).toBe(1);
        expect(estimateTokens('abcdefgh')).toBe(2);
    });

    it('should calculate cost properly including generic cache rules', () => {
        const { costUsd, isEstimated } = calculateCost('gpt-4', 1_000_000, 1_000_000, 500_000);
        // input = 1M * 10 = $10
        // output = 1M * 30 = $30
        // cached_discount = (500k/1M) * (10 - 5) = 2.5
        // total = 40 - 2.5 = 37.5
        expect(costUsd).toBeCloseTo(37.5);
        expect(isEstimated).toBe(false);
    });

    it('should flag cost as estimated if pricing defaults occur', () => {
        const { costUsd, isEstimated } = calculateCost('unknown-model', 1_000_000, 1_000_000);
        expect(costUsd).toBeNull(); // Unknown pricing must never invent a dollar amount.
        expect(isEstimated).toBe(true);
    });

    it('adds Anthropic cache reads and cache writes to uncached input', () => {
        const result = calculateCost('claude-test', 1_000_000, 1_000_000, 500_000, 200_000);
        expect(result.costUsd).toBeCloseTo(18.9); // 3 + 15 + .15 + .75
        expect(result.isEstimated).toBe(true); // Write TTL was not supplied.
    });

    it('accepts a legitimate zero cached-input price', () => {
        expect(calculateCost('free-cache', 1_000_000, 0, 500_000).costUsd).toBe(5);
    });

    it.each([-1, NaN, Infinity])('does not price invalid token counts: %s', tokens => {
        expect(calculateCost('gpt-4', tokens, 0).costUsd).toBeNull();
    });

    it('does not price impossible inclusive cache totals', () => {
        expect(calculateCost('gpt-4', 1, 0, 2).costUsd).toBeNull();
    });

    it('safeReadSQLite should seamlessly read an unlocked valid SQLite database', async () => {
        const fixturePath = path.join(__dirname, 'fixtures', 'copilot-state.vscdb');
        const db = await safeReadSQLite(fixturePath);
        expect(db).toBeDefined();
        db?.close();
    });

    it('safeReadSQLite should fallback to duplication strategy under heavy write locks', async () => {
        const fixturePath = path.join(__dirname, 'fixtures', 'windsurf-state.vscdb');
        const lockerDb = new Database(fixturePath);
        // Force an exclusive system lock
        lockerDb.prepare('BEGIN EXCLUSIVE').run();

        try {
            const start = Date.now();
            const readDb = await safeReadSQLite(fixturePath);
            expect(readDb).toBeDefined();
            // Verifies the timeout sequence initiated
            expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
            
            const row = readDb?.prepare('SELECT 1').get();
            expect(row).toBeDefined();
            readDb?.close();
        } finally {
            lockerDb.prepare('ROLLBACK').run();
            lockerDb.close();
        }
    }, 15000);
});
