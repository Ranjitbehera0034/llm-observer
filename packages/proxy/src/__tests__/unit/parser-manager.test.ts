const providers = ['claude', 'cursor', 'aider', 'codex', 'cline', 'windsurf', 'copilot'];
const parserEnv = process.env.LLM_OBSERVER_DISABLE_PARSERS;

beforeEach(() => {
    jest.resetModules();
    delete process.env.LLM_OBSERVER_DISABLE_PARSERS;
    jest.doMock('@llm-observer/database', () => ({
        getDb: jest.fn(() => ({ prepare: () => ({ get: () => ({ count: 0 }) }) }))
    }));
    jest.doMock('../../parsers/toolAggregator', () => ({ aggregateToolUsage: jest.fn() }));
    for (const provider of providers) {
        jest.doMock(`../../parsers/${provider}`, () => ({ detector: jest.fn(() => false), parse: jest.fn(async () => {}) }));
    }
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    if (parserEnv === undefined) delete process.env.LLM_OBSERVER_DISABLE_PARSERS;
    else process.env.LLM_OBSERVER_DISABLE_PARSERS = parserEnv;
});

it('detects a tool whose first session appears after the app starts', async () => {
    const { triggerParseCycle, getProviderStatus } = require('../../parsers/manager');
    const claude = require('../../parsers/claude');
    await triggerParseCycle();
    expect(getProviderStatus()['claude-code'].status).toBe('not found');
    claude.detector.mockReturnValue(true);
    await triggerParseCycle();
    expect(claude.parse).toHaveBeenCalledTimes(1);
    expect(getProviderStatus()['claude-code'].status).toBe('success');
});

it('allows another import after database initialization fails', async () => {
    const { triggerParseCycle } = require('../../parsers/manager');
    const { getDb } = require('@llm-observer/database');
    const claude = require('../../parsers/claude');
    claude.detector.mockReturnValue(true);
    getDb.mockImplementationOnce(() => { throw new Error('database unavailable'); });
    await expect(triggerParseCycle()).rejects.toThrow('database unavailable');
    await triggerParseCycle();
    expect(claude.parse).toHaveBeenCalledTimes(1);
});

it('reports unsupported formats and avoids retrying them on every idle cycle', async () => {
    const { triggerParseCycle, getProviderStatus } = require('../../parsers/manager');
    const cursor = require('../../parsers/cursor');
    cursor.detector.mockReturnValue(true);
    cursor.parse.mockRejectedValue(Object.assign(new Error('Unsupported local format'), { code: 'UNSUPPORTED_FORMAT' }));
    await triggerParseCycle();
    await triggerParseCycle();
    expect(cursor.parse).toHaveBeenCalledTimes(1);
    expect(getProviderStatus().cursor).toMatchObject({ status: 'unsupported', error: 'Unsupported local format' });
});

it('honors import isolation for manual as well as scheduled refreshes', async () => {
    process.env.LLM_OBSERVER_DISABLE_PARSERS = '1';
    const { triggerParseCycle } = require('../../parsers/manager');
    const claude = require('../../parsers/claude');
    claude.detector.mockReturnValue(true);
    await triggerParseCycle();
    expect(claude.detector).not.toHaveBeenCalled();
    expect(claude.parse).not.toHaveBeenCalled();
});
