import express from 'express';
import request from 'supertest';
import http from 'http';
import { initDb, updateSetting } from '@llm-observer/database';
import { handleProxyRequest } from '../proxy';
import { localOllamaTargetAllowed } from '../security/localOnly';
import { settingsRouter } from '../routes/settings.routes';

jest.mock('../budgetGuard', () => ({ incrementSpendCache: jest.fn() }));

describe('local-only prompt boundary', () => {
    let target: http.Server;
    let received = 0;
    const app = express();
    app.use(express.json());
    app.use('/api', settingsRouter);
    app.post('/cloud', (req,res) => { (req as any).customTargetUrl='http://127.0.0.1:5007'; void handleProxyRequest(req,res,'openai'); });
    app.post('/local', (req,res) => { (req as any).customTargetUrl='http://127.0.0.1:5007'; void handleProxyRequest(req,res,'ollama'); });
    beforeAll(async () => {
        initDb(':memory:');
        target = http.createServer((req,res) => { received++; req.resume(); req.on('end', () => { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ model:'local-test', usage:{ prompt_tokens:1,completion_tokens:1 },choices:[] })); }); });
        await new Promise<void>(resolve => target.listen(5007,'127.0.0.1',resolve));
    });
    afterAll(async () => { await new Promise<void>(resolve => target.close(() => resolve())); });
    it('rejects cloud traffic before any payload reaches a target', async () => {
        expect((await request(app).put('/api/privacy/local-only').send({enabled:true})).body).toMatchObject({enabled:true});
        const result=await request(app).post('/cloud').send({model:'gpt-4o',messages:[{role:'user',content:'private prompt'}]});
        expect(result.status).toBe(403);
        expect(received).toBe(0);
    });
    it('allows Ollama only at loopback and rejects custom or remote targets', async () => {
        expect(localOllamaTargetAllowed('ollama','https://example.com')).toBe(false);
        expect(localOllamaTargetAllowed('custom','http://127.0.0.1:5007')).toBe(false);
        const result=await request(app).post('/local').send({model:'local-test',messages:[{role:'user',content:'private prompt'}]});
        expect(result.status).toBe(200);
        expect(received).toBe(1);
    });
    it('blocks generic settings bypass and validates dedicated toggle', async () => {
        expect((await request(app).put('/api/settings').send({privacy_local_only:'false'})).status).toBe(400);
        expect((await request(app).put('/api/privacy/local-only').send({enabled:'false'})).status).toBe(400);
        expect((await request(app).get('/api/privacy/local-only')).body.enabled).toBe(true);
        expect((await request(app).put('/api/privacy/local-only').send({enabled:false})).status).toBe(200);
        updateSetting('privacy_local_only','false');
    });
    it('honors the server lock over the local setting', async () => {
        process.env.LLM_OBSERVER_LOCAL_ONLY='1';
        try {
            expect((await request(app).put('/api/privacy/local-only').send({enabled:false})).status).toBe(403);
            expect((await request(app).post('/cloud').send({model:'test',messages:[{role:'user',content:'private'}]})).status).toBe(403);
            expect(received).toBe(1);
        } finally { delete process.env.LLM_OBSERVER_LOCAL_ONLY; }
    });
});
