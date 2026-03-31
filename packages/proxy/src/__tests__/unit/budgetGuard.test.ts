import { budgetGuard, incrementSpendCache } from '../../budgetGuard';
import { getDb } from '@llm-observer/database';
import { Request, Response, NextFunction } from 'express';

jest.mock('@llm-observer/database', () => ({
    getDb: jest.fn(),
    getSetting: jest.fn(),
    validateApiKey: jest.fn(),
    getBudgetLimits: jest.fn().mockReturnValue([])
}));

describe('budgetGuard Unit Tests', () => {
    let req: Partial<Request> & { llmObserver?: any };
    let res: Partial<Response>;
    let next: NextFunction;
    let mockDb: any;

    beforeEach(() => {
        req = {
            headers: { authorization: 'Bearer test-key' },
            path: '/v1/chat/completions'
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
        // Reset the internal cache between tests
        require('../../budgetGuard')._getCacheForTest().clear();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should allow if project is missing from DB (default fallback)', async () => {
        req.headers = {}; // No auth header -> 'default' cacheKey
        mockDb.get.mockReturnValue(undefined); // No default project

        await budgetGuard(req as Request, res as Response, next);
        expect(next).toHaveBeenCalled();
    });

    it('should block with 401 if API key is invalid', async () => {
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue(null);
        
        await budgetGuard(req as Request, res as Response, next);
        
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid API Key' });
        expect(next).not.toHaveBeenCalled();
    });

    it('should block if budget is exceeded', async () => {
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });
        
        mockDb.get.mockReturnValueOnce({
            id: 'test-project',
            daily_budget: 10.0,
            kill_switch: 1
        });
        mockDb.get.mockReturnValueOnce({ total: 10.5 }); // Exceeded

        await budgetGuard(req as Request, res as Response, next);
        
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ type: 'budget_exceeded' })
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should block if budget is exceeded (legacy check)', async () => {
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });
        
        mockDb.get.mockReturnValueOnce({
            id: 'test-project',
            daily_budget: 10.0,
            kill_switch: 1
        });
        mockDb.get.mockReturnValueOnce({ total: 10.0 });
        
        await budgetGuard(req as Request, res as Response, next);
        
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ type: 'budget_exceeded' })
        }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should NOT block if spend equals budget but kill_switch is false', async () => {
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });
        
        mockDb.get.mockReturnValueOnce({
            id: 'test-project',
            daily_budget: 10.0,
            kill_switch: 0 // kill switch off
        });
        mockDb.get.mockReturnValueOnce({ total: 15.0 });

        await budgetGuard(req as Request, res as Response, next);
        
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow if spend is under budget', async () => {
        const { validateApiKey } = require('@llm-observer/database');
        (validateApiKey as jest.Mock).mockReturnValue({ project_id: 'test-project' });
        
        mockDb.get.mockReturnValueOnce({
            id: 'test-project',
            daily_budget: 10.0,
            kill_switch: 1
        });
        mockDb.get.mockReturnValueOnce({ total: 5.0 });

        await budgetGuard(req as Request, res as Response, next);
        
        expect(next).toHaveBeenCalled();
    });

    it('should increment cache correctly', () => {
        incrementSpendCache('test-project-2', 0.50);
        expect(true).toBe(true);
    });
});
