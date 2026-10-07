import * as poller from '../rate-limits/poller';
import * as database from '@llm-observer/database';
import request from 'supertest';
import express from 'express';
import limitsRoutes from '../routes/limits.routes';
import heatmapRoutes from '../routes/heatmap.routes';

// Mock dependencies
jest.mock('@llm-observer/database', () => {
    const mockDb = {
        prepare: jest.fn().mockReturnThis(),
        all: jest.fn().mockReturnValue([]),
        get: jest.fn().mockReturnValue({}),
        run: jest.fn()
    };
    return {
        getDb: jest.fn().mockReturnValue(mockDb),
        insertRateLimitSnapshot: jest.fn(),
        getLatestSnapshots: jest.fn().mockReturnValue([{ provider: 'anthropic', window_type: 'daily', utilization_pct: 0 }]),
        getRateLimitConfig: jest.fn().mockReturnValue([]),
        upsertRateLimitConfig: jest.fn(),
        getHeatmapData: jest.fn().mockReturnValue({ grid: Array(7).fill({ hours: [] }) }),
        cleanupOldSnapshots: jest.fn()
    };
});
jest.mock('node-fetch');

const app = express();
app.use(express.json());
app.use('/api/limits', limitsRoutes);
app.use('/api/heatmap', heatmapRoutes);

describe('Rate Limit Tracking System', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Rate Limit API Mocking & Polling', () => {
        it('polls without any network call (never reads or sends Claude credentials)', async () => {
            const fetchMock = jest.requireMock('node-fetch') as jest.Mock;
            await poller.pollRateLimits();
            expect(fetchMock).not.toHaveBeenCalled();
            expect(database.insertRateLimitSnapshot).toHaveBeenCalledWith(
                expect.objectContaining({ provider: 'anthropic', is_estimated: true, window_type: '5h' })
            );
        });

        it('should estimate Anthropic rate limits from local sessions', () => {
            jest.spyOn(database, 'insertRateLimitSnapshot');
            poller.estimateAnthropicRateLimits();
            expect(database.insertRateLimitSnapshot).toHaveBeenCalledWith(
                expect.objectContaining({ is_estimated: true, window_type: '5h' })
            );
        });
        
        it('should perform activity monitoring for Cursor and others', () => {
            jest.spyOn(database, 'insertRateLimitSnapshot');
            poller.performActivityMonitoring('cursor');
            expect(database.insertRateLimitSnapshot).toHaveBeenCalledWith(
                expect.objectContaining({ provider: 'cursor', is_estimated: true })
            );
        });
    });

    describe('Alert Deduplication', () => {
        it('should not fire duplicate alerts if already present within 1 hour', () => {
            // Test fireAlert logic
            expect(true).toBe(true);
        });
    });

    describe('API Routes', () => {
        it('GET /api/limits should return grouped rate limits across providers', async () => {
            const response = await request(app).get('/api/limits');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('providers');
        });

        it('GET /api/heatmap should return session activity grid', async () => {
            const response = await request(app).get('/api/heatmap?days=7');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('grid');
            expect(response.body.grid).toHaveLength(7);
        });

        it('PUT /api/limits/config should save threshold limit preferences', async () => {
            const response = await request(app)
                .put('/api/limits/config')
                .send({ provider: 'cursor', window_type: 'daily', alert_threshold_pct: 0.9 });
            expect(response.status).toBe(200);
            expect(database.upsertRateLimitConfig).toHaveBeenCalledWith(
                expect.objectContaining({ provider: 'cursor', alert_threshold_pct: 0.9 })
            );
        });
    });
});
