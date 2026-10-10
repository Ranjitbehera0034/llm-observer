/**
 * The toggle as the dashboard uses it: PUT /api/settings on the real dashboard app starts and stops the
 * OTLP listener, GET /api/otlp/status describes it, and a restart honours the stored setting.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { initDb, closeDb, updateSetting } from '@llm-observer/database';
import { createDashboardApp } from '../../app';
import { initOtlpReceiver, shutdownOtlp, OTLP_SETTING } from '../index';
import { send, isListening, freePort } from './helpers';

let dashboard: http.Server;
let dashboardPort: number;
let otlpPort: number;
const envBefore = process.env.LLM_OBSERVER_OTLP_PORT;

const putSettings = (body: Record<string, string>) =>
    send(dashboardPort, { method: 'PUT', path: '/api/settings', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
    closeDb();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    initDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-otlp-wire-')), 'data.db'));
    otlpPort = await freePort();
    process.env.LLM_OBSERVER_OTLP_PORT = String(otlpPort);
    dashboardPort = await freePort();
    dashboard = await new Promise<http.Server>(resolve => { const s = createDashboardApp().listen(dashboardPort, '127.0.0.1', () => resolve(s)); });
});

afterEach(async () => {
    await shutdownOtlp();
    await new Promise<void>(resolve => { (dashboard as any).closeAllConnections?.(); dashboard.close(() => resolve()); });
    closeDb();
    if (envBefore === undefined) delete process.env.LLM_OBSERVER_OTLP_PORT; else process.env.LLM_OBSERVER_OTLP_PORT = envBefore;
    jest.restoreAllMocks();
});

it('is off until the dashboard flips the setting, and flipping it back stops the listener', async () => {
    await initOtlpReceiver();
    expect(await isListening(otlpPort)).toBe(false);

    expect((await putSettings({ [OTLP_SETTING]: 'true' })).status).toBe(200);
    expect(await isListening(otlpPort)).toBe(true);

    expect((await putSettings({ [OTLP_SETTING]: 'false' })).status).toBe(200);
    expect(await isListening(otlpPort)).toBe(false);
});

it('GET /api/otlp/status reports state and the exact env vars to paste', async () => {
    let r = await send(dashboardPort, { method: 'GET', path: '/api/otlp/status' });
    expect(r.status).toBe(200);
    let body = JSON.parse(r.body).data;
    expect(body).toMatchObject({ enabled: false, listening: false, port: otlpPort, host: '127.0.0.1' });

    await putSettings({ [OTLP_SETTING]: 'true' });
    r = await send(dashboardPort, { method: 'GET', path: '/api/otlp/status' });
    body = JSON.parse(r.body).data;
    expect(body).toMatchObject({ enabled: true, listening: true, endpoint: `http://127.0.0.1:${otlpPort}` });
    for (const line of [
        'CLAUDE_CODE_ENABLE_TELEMETRY=1',
        'OTEL_METRICS_EXPORTER=otlp',
        'OTEL_LOGS_EXPORTER=otlp',
        'OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:${otlpPort}`,
    ]) expect(body.envSnippet).toContain(`export ${line}`);
    expect(body.envSnippet).not.toMatch(/OTEL_LOG_USER_PROMPTS|OTEL_LOG_TOOL_DETAILS/);
});

it('a restart honours the stored setting', async () => {
    updateSetting(OTLP_SETTING, 'true');
    await initOtlpReceiver();
    expect(await isListening(otlpPort)).toBe(true);
});
