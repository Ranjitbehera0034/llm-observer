import { _detectAnomalies } from '../../anomalyDetector';
import { getDb, createAlert } from '@llm-observer/database';
import { internalLogger } from '../../internalLogger';

jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: jest.fn().mockReturnValue('1'), // Ensure email is "enabled"
    createAlert: jest.fn()
}));

jest.mock('../../internalLogger', () => ({
    internalLogger: {
        add: jest.fn(),
        flush: jest.fn()
    }
}));

// Mock fetch for Resend email validation
global.fetch = jest.fn(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'mock-resend-id' }),
    })
) as jest.Mock;

describe('anomalyDetector Unit Tests', () => {
    let mockDb: any;

    beforeEach(() => {
        mockDb = {
            prepare: jest.fn().mockReturnThis(),
            all: jest.fn().mockReturnValue([{ id: 'proj-1', name: 'Project 1', webhook_url: 'http://test.com' }]),
            get: jest.fn()
        };
        (getDb as jest.Mock).mockReturnValue(mockDb);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should detect a 5x volume spike and insert an alert', async () => {
        // Return baseline = 10, recent = 55 (>5x)
        mockDb.get.mockReturnValueOnce({ avg_cost: 10 });
        mockDb.get.mockReturnValueOnce({ current_cost: 55 });

        await _detectAnomalies();

        // Should have created an alert for proj-1
        expect(createAlert).toHaveBeenCalledWith(expect.objectContaining({
            project_id: 'proj-1',
            type: 'anomaly'
        }));
    });

    it('should NOT trigger an alert under 5x volume spike', async () => {
        // Return baseline = 10, recent = 20 (2x)
        mockDb.get.mockReturnValueOnce({ avg_cost: 10 });
        mockDb.get.mockReturnValueOnce({ current_cost: 20 });

        await _detectAnomalies();

        // Should NOT have created an alert for proj-1
        expect(mockDb.prepare).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'));
    });

    it('should NOT trigger an alert if baseline or recent volume is below noise threshold (<10)', async () => {
        // Return baseline = 1, recent = 8 (8x spike, but raw numbers too low)
        mockDb.get.mockReturnValueOnce({ avg_cost: 0.001 });
        mockDb.get.mockReturnValueOnce({ current_cost: 0.008 });

        await _detectAnomalies();

        // Should NOT have created an alert for proj-1
        expect(mockDb.prepare).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO alerts'));
    });
});
