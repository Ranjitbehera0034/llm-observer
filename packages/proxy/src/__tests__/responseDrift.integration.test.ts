import request from 'supertest';
import express from 'express';
import http from 'http';
import { handleProxyRequest } from '../proxy';
import { initDb, getDb, updateSetting } from '@llm-observer/database';
import { internalLogger } from '../internalLogger';

jest.mock('../budgetGuard', () => ({
    budgetGuard: (req: any, res: any, next: any) => next(),
    incrementSpendCache: jest.fn()
}));
jest.mock('../rateLimitGuard', () => ({
    rateLimitGuard: (req: any, res: any, next: any) => next()
}));

const app = express();
app.use(express.json());
app.all('/*', (req, res) => {
    (req as any).customTargetUrl = 'http://127.0.0.1:5007';
    handleProxyRequest(req as any, res as any, 'openai');
});

// Responses the mock provider will hand back, in order
const RESPONSES = [
    'The garden needs watering every morning with fresh water.',
    'Water the garden every morning using fresh clean water.',
    'Every morning the garden requires fresh water for watering.',
    'Fresh water every morning keeps the garden well watered.',
    'The garden morning routine needs fresh watering water.',
    'Morning garden care requires fresh water for watering.',
    'Watering the garden each morning needs fresh clean water.',
    'Fresh morning water keeps the garden watered well.',
    'The garden requires morning watering with fresh water.',
    'Every garden morning needs fresh watering water routine.',
    'Morning watering keeps the fresh garden water routine.',
    // this one should be flagged as an outlier once warmed up
    'Quantum spacecraft blockchain jurisprudence neural economics cryptography.'
];

describe('Response drift — proxy integration (opt-in)', () => {
    let mockTarget: http.Server;
    let callIndex = 0;

    beforeAll(async () => {
        initDb(':memory:');
        getDb().prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        updateSetting('response_drift_detection_enabled', 'true');

        mockTarget = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                const content = RESPONSES[Math.min(callIndex, RESPONSES.length - 1)];
                callIndex++;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content } }],
                    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
                }));
            });
        });
        mockTarget.listen(5007);
    });

    afterAll(() => mockTarget.close());

    const sendOne = () => request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'tell me something' }] })
        .expect(200);

    it('attaches a null drift_score to the very first request for a model (establishing baseline)', async () => {
        await sendOne();
        await internalLogger.flush();
        const log = getDb().prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;
        expect(log.drift_score).toBeNull();
        expect(log.drift_flag).toBe(0);
    });

    it('does not flag the next several similar responses (still within warmup)', async () => {
        for (let i = 0; i < 9; i++) {
            await sendOne();
            await internalLogger.flush();
        }
        const log = getDb().prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;
        expect(log.drift_flag).toBe(0);
    });

    it('flags a genuinely anomalous response once the baseline has warmed up', async () => {
        await sendOne(); // consistent, pushes sample count past warmup
        await internalLogger.flush();
        await sendOne(); // the outlier response (last entry in RESPONSES)
        await internalLogger.flush();

        const log = getDb().prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;
        expect(log.drift_score).not.toBeNull();
        expect(log.drift_flag).toBe(1);

        const alert = getDb().prepare("SELECT * FROM alerts WHERE type = 'response_drift' ORDER BY created_at DESC LIMIT 1").get() as any;
        expect(alert).toBeDefined();
        expect(alert.message).toContain('gpt-4o');
    });
});

describe('Response drift — off by default', () => {
    let mockTarget: http.Server;

    beforeAll(async () => {
        initDb(':memory:');
        getDb().prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
        // initDb(':memory:') reuses the same singleton connection across describe
        // blocks in this file, so explicitly turn the setting back off here rather
        // than relying on it being unset.
        updateSetting('response_drift_detection_enabled', 'false');
        // Same reused in-memory DB carries state from the previous describe block —
        // clear it so this block's "stays empty" assertion is meaningful.
        getDb().prepare('DELETE FROM response_drift_baselines').run();

        mockTarget = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: 'anything' } }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
                }));
            });
        });
        mockTarget.listen(5008);
    });

    afterAll(() => mockTarget.close());

    it('never computes or persists a drift score when the setting is off', async () => {
        const localApp = express();
        localApp.use(express.json());
        localApp.all('/*', (req, res) => {
            (req as any).customTargetUrl = 'http://127.0.0.1:5008';
            handleProxyRequest(req as any, res as any, 'openai');
        });

        await request(localApp)
            .post('/v1/chat/completions')
            .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
            .expect(200);
        await internalLogger.flush();

        const log = getDb().prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;
        expect(log.drift_score).toBeNull();
        expect(log.drift_flag).toBe(0);

        const baseline = getDb().prepare('SELECT * FROM response_drift_baselines').all();
        expect(baseline).toHaveLength(0);
    });
});
