import request from 'supertest';
import express from 'express';
import http from 'http';
import { handleProxyRequest } from '../proxy';
import { initDb, getDb, updateSetting } from '@llm-observer/database';

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
    (req as any).customTargetUrl = 'http://127.0.0.1:5006';
    handleProxyRequest(req as any, res as any, 'openai');
});

describe('PII redaction — proxy integration (opt-in, not silent by default)', () => {
    let mockTarget: http.Server;
    let lastReceivedBody: any = null;

    beforeAll(async () => {
        initDb(':memory:');
        getDb().prepare('INSERT INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);

        mockTarget = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (chunk) => { raw += chunk; });
            req.on('end', () => {
                try { lastReceivedBody = JSON.parse(raw); } catch { lastReceivedBody = raw; }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    choices: [{ message: { content: 'ok' } }],
                    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
                }));
            });
        });
        mockTarget.listen(5006);
    });

    afterAll(() => mockTarget.close());

    it('does NOT redact by default (setting unset)', (done) => {
        request(app)
            .post('/v1/chat/completions')
            .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'email me at leak@example.com' }] })
            .expect(200)
            .end((err) => {
                if (err) return done(err);
                setTimeout(() => {
                    expect(lastReceivedBody.messages[0].content).toBe('email me at leak@example.com');
                    done();
                }, 50);
            });
    });

    it('redacts the request body BEFORE it reaches the provider once enabled', (done) => {
        updateSetting('pii_redaction_enabled', 'true');
        request(app)
            .post('/v1/chat/completions')
            .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'email me at leak@example.com' }] })
            .expect(200)
            .end((err) => {
                if (err) return done(err);
                setTimeout(() => {
                    expect(lastReceivedBody.messages[0].content).toBe('email me at [REDACTED_EMAIL]');
                    expect(lastReceivedBody.messages[0].content).not.toContain('leak@example.com');
                    done();
                }, 50);
            });
    });

    it('stops redacting once disabled again', (done) => {
        updateSetting('pii_redaction_enabled', 'false');
        request(app)
            .post('/v1/chat/completions')
            .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'email me at leak@example.com' }] })
            .expect(200)
            .end((err) => {
                if (err) return done(err);
                setTimeout(() => {
                    expect(lastReceivedBody.messages[0].content).toContain('leak@example.com');
                    done();
                }, 50);
            });
    });
});
