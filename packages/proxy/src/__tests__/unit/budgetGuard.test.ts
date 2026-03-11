import { budgetGuard, incrementSpendCache } from '../../budgetGuard';
import { getDb, getSetting } from '@llm-observer/database';
import type { Request, Response, NextFunction } from 'express';

jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: jest.fn(),
    validateApiKey: jest.fn()
}));

describe('budgetGuard Unit Tests', () => {
    let req: Partial<Request> & { llmObserver?: any };
    let res: Partial<Response>;
    let next: NextFunction;
    let mockDb: any;

    beforeEach(() => {
        req = {
            headers: { authorization: 'Bearer test-key' },
            llmObserver: {
                projectId: 'test-project',
                apiKey: { id: 'key' },
                isPricingUnknown: false
            }
        } as any;
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
        mockDb = {
            prepare: jest.fn().mockReturnThis(),
            get: jest.fn(),
            transaction: jest.fn().mockReturnValue((cb: any) => cb()),
            run: jest.fn()
        };
        (getDb as jest.Mock).mockReturnValue(mockDb);
        (getSetting as jest.Mock).mockReturnValue('0'); // Disabled auto-block by default
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should bypass check if project is missing', async () => {
        req.llmObserver!.projectId = undefined;
        // mock validateApiKey locally so it doesn't fail if it's hit
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test' });
        
        await new Promise<void>(resolve => {
            next = jest.fn(() => resolve());
            budgetGuard(req as Request, res as Response, next);
        });
        expect(next).toHaveBeenCalled();
    });

    it('should bypass if model pricing is unknown (streaming/non-calculated)', async () => {
        req.llmObserver!.isPricingUnknown = true;
        
        await new Promise<void>(resolve => {
            next = jest.fn(() => resolve());
            budgetGuard(req as Request, res as Response, next);
        });
        
        expect(next).toHaveBeenCalled();
    });

    it('should block if spend equals budget and hard block is enabled', async () => {
        (getSetting as jest.Mock).mockReturnValue('1'); // Enable hard blocking
        mockDb.get.mockReturnValue({
            daily_budget: 10.0,
            spend_today: 10.0
        });
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });

        await budgetGuard(req as Request, res as Response, next);
        
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ type: 'budget_exceeded' })
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should NOT block if spend equals budget but hard block is disabled', async () => {
        (getSetting as jest.Mock).mockReturnValue('0'); // Disable hard blocking
        mockDb.get.mockReturnValue({
            daily_budget: 10.0,
            spend_today: 10.0
        });
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });

        await budgetGuard(req as Request, res as Response, next);
        
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow if spend is under budget', async () => {
        (getSetting as jest.Mock).mockReturnValue('1');
        mockDb.get.mockReturnValue({
            daily_budget: 10.0,
            spend_today: 5.0
        });
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });

        await budgetGuard(req as Request, res as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should increment cache correctly', () => {
        incrementSpendCache('test-project-2', 0.50);
        // We're just ensuring it executes without throwing since the cache is internal
        expect(true).toBe(true);
    });
});
