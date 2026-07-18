import request from 'supertest';
import express from 'express';
import { initDb, getDb, bulkInsertRequests } from '@llm-observer/database';
import { requestsRouter } from '../routes/requests.routes';

const app = express();
app.use(express.json());
app.use('/api/requests', requestsRouter);

describe('GET /api/requests/:id — reasoningChain field', () => {
    beforeAll(() => {
        initDb(':memory:');
        getDb().prepare('INSERT OR IGNORE INTO projects (id, name, daily_budget) VALUES (?, ?, ?)').run('default', 'Default Project', 100.0);
    });

    it('attaches a fully parsed reasoning chain for a non-streaming request with a tool call', () => {
        const requestBody = JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'What is the weather in Tokyo?' }
            ]
        });
        const responseBody = JSON.stringify({
            choices: [{
                message: {
                    role: 'assistant', content: null,
                    tool_calls: [{ id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }]
                }
            }]
        });

        bulkInsertRequests([{
            project_id: 'default', provider: 'openai', model: 'gpt-4o',
            cost_usd: 0.01, is_streaming: false,
            request_body: requestBody, response_body: responseBody,
            created_at: new Date().toISOString()
        }] as any);

        const row = getDb().prepare('SELECT id FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;

        return request(app).get(`/api/requests/${row.id}`).then((res) => {
            expect(res.status).toBe(200);
            const chain = res.body.data.reasoningChain;
            expect(chain.responseParsed).toBe(true);
            expect(chain.steps.some((s: any) => s.type === 'text' && s.role === 'system')).toBe(true);
            expect(chain.steps.some((s: any) => s.type === 'text' && s.role === 'user')).toBe(true);
            const toolUse = chain.steps.find((s: any) => s.type === 'tool_use');
            expect(toolUse.toolName).toBe('get_weather');
            expect(toolUse.toolInput).toEqual({ city: 'Tokyo' });
        });
    });

    it('honestly reports responseParsed: false for a streaming request, without dropping the request-side steps', () => {
        const requestBody = JSON.stringify({ messages: [{ role: 'user', content: 'stream this' }] });
        const streamedResponse = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: [DONE]\n\n';

        bulkInsertRequests([{
            project_id: 'default', provider: 'openai', model: 'gpt-4o',
            cost_usd: 0.01, is_streaming: true,
            request_body: requestBody, response_body: streamedResponse,
            created_at: new Date().toISOString()
        }] as any);

        const row = getDb().prepare('SELECT id FROM requests ORDER BY created_at DESC LIMIT 1').get() as any;

        return request(app).get(`/api/requests/${row.id}`).then((res) => {
            expect(res.status).toBe(200);
            const chain = res.body.data.reasoningChain;
            expect(chain.responseParsed).toBe(false);
            expect(chain.steps).toHaveLength(1);
            expect(chain.steps[0].text).toBe('stream this');
        });
    });

    it('404s for a nonexistent request id (unaffected by the new field)', async () => {
        const res = await request(app).get('/api/requests/does-not-exist');
        expect(res.status).toBe(404);
    });
});
