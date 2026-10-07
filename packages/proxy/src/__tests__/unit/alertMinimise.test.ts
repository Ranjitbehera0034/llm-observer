const createAlert = jest.fn();
const getAlertRules = jest.fn();
jest.mock('@llm-observer/database', () => ({
    bulkInsertRequests: jest.fn(),
    getAlertRules: (...a: any[]) => getAlertRules(...a),
    createAlert: (...a: any[]) => createAlert(...a),
}));

import { internalLogger, __resetAlertCooldownsForTests } from '../../internalLogger';

const record = (over: Record<string, any> = {}) => ({
    project_id: 'p1', provider: 'openai', model: 'gpt-4', endpoint: '/v1/chat/completions',
    cost_usd: 2, latency_ms: 9000, status_code: 500, status: 'error',
    request_body: '{"messages":[{"content":"my secret prompt"}]}',
    response_body: '{"choices":[{"text":"secret answer"}]}',
    ...over,
});
const settle = () => new Promise(r => setImmediate(r));

beforeEach(() => {
    createAlert.mockClear();
    getAlertRules.mockReset();
    __resetAlertCooldownsForTests();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await internalLogger.flush(); jest.restoreAllMocks(); jest.useRealTimers(); });

describe('alert evaluation', () => {
    it('stores only metadata in alerts.data, never prompt or response bodies', async () => {
        getAlertRules.mockReturnValue([{ id: 'r1', name: 'slow', is_active: 1, condition_type: 'latency_spike', threshold: 100, webhook_url: null }]);
        await internalLogger.add(record() as any);
        await settle();
        expect(createAlert).toHaveBeenCalledTimes(1);
        const raw = createAlert.mock.calls[0][0].data as string;
        const data = JSON.parse(raw);
        expect(Object.keys(data).sort()).toEqual(['cost_usd', 'latency_ms', 'model', 'project_id', 'request_id', 'status']);
        expect(raw).not.toMatch(/secret|request_body|response_body/);
        expect(data).toMatchObject({ project_id: 'p1', model: 'gpt-4', status: 'error', cost_usd: 2, latency_ms: 9000 });
    });

    it('fires a rule at most once per 5 minutes per project', async () => {
        getAlertRules.mockReturnValue([{ id: 'r1', name: 'slow', is_active: 1, condition_type: 'latency_spike', threshold: 100, webhook_url: null }]);
        const now = jest.spyOn(Date, 'now');
        now.mockReturnValue(1_000_000);
        await internalLogger.add(record() as any); await settle();
        await internalLogger.add(record() as any); await settle();
        expect(createAlert).toHaveBeenCalledTimes(1);
        await internalLogger.add(record({ project_id: 'p2' }) as any); await settle();   // other project: independent
        expect(createAlert).toHaveBeenCalledTimes(2);
        now.mockReturnValue(1_000_000 + 5 * 60_000 + 1);
        await internalLogger.add(record() as any); await settle();
        expect(createAlert).toHaveBeenCalledTimes(3);
    });

    it('gives the webhook fetch a timeout', async () => {
        getAlertRules.mockReturnValue([{ id: 'r1', name: 'slow', is_active: 1, condition_type: 'latency_spike', threshold: 100, webhook_url: 'http://example.test/hook' }]);
        const fetchMock = jest.fn(() => Promise.resolve(new Response('ok')));
        (global as any).fetch = fetchMock;
        await internalLogger.add(record() as any); await settle();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((fetchMock.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal);
    });
});
