import fs from 'fs';
import os from 'os';
import path from 'path';
import { parse } from '../aider';
import { insertSession } from '@llm-observer/database';

jest.mock('@llm-observer/database', () => ({
    getParsedFile: jest.fn(), upsertParsedFile: jest.fn(),
    insertSession: jest.fn(), getPricingForModel: jest.fn()
}));

let testHome: string;
let analyticsPath: string;
beforeEach(() => {
    jest.clearAllMocks();
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'aider-parser-test-'));
    fs.mkdirSync(path.join(testHome, '.aider'));
    analyticsPath = path.join(testHome, '.aider', 'analytics.jsonl');
    jest.spyOn(os, 'homedir').mockReturnValue(testHome);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(testHome, { recursive: true, force: true }); });

it('reuses fallback event identities when an analytics file grows', async () => {
    const event = JSON.stringify({ timestamp: '2026-10-01T10:00:00Z', input_tokens: 100, output_tokens: 20, model: 'test', cost: .02 });
    fs.writeFileSync(analyticsPath, event + '\n' + event + '\n');
    await parse();
    const firstIds = (insertSession as jest.Mock).mock.calls.map(([session]) => session.session_id);
    expect(new Set(firstIds).size).toBe(2);
    (insertSession as jest.Mock).mockClear();
    fs.appendFileSync(analyticsPath, event + '\n');
    await parse();
    const replayedIds = (insertSession as jest.Mock).mock.calls.map(([session]) => session.session_id);
    expect(replayedIds.slice(0, 2)).toEqual(firstIds);
    expect(new Set(replayedIds).size).toBe(3);
});

it('keeps source-supplied IDs for idempotent imports', async () => {
    fs.writeFileSync(analyticsPath, JSON.stringify({ id: 'recorded-event-1', input_tokens: 100, cost: .01 }) + '\n');
    await parse();
    expect(insertSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'recorded-event-1' }));
});
