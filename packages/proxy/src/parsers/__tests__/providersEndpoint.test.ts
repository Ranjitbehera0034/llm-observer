import express from 'express';
import request from 'supertest';
import { initDb, closeDb } from '@llm-observer/database';
import sessionsRoutes from '../../routes/sessions.routes';
import { ADAPTERS } from '../registry';
import { PARSER_VERIFICATION } from '../verification';

const app = express();
app.use('/api/sessions', sessionsRoutes);

describe('GET /api/sessions/providers is derived from the adapter registry', () => {
    beforeAll(() => { closeDb(); initDb(':memory:'); });
    afterAll(() => closeDb());

    it('lists every registered adapter, in registry order, with the same shape as before', async () => {
        const res = await request(app).get('/api/sessions/providers').expect(200);
        expect(Object.keys(res.body)).toEqual(ADAPTERS.map(a => a.id));
        for (const a of ADAPTERS) {
            expect(res.body[a.id]).toEqual({
                status: expect.stringMatching(/^(not found|found|parsing|success|error)$/),
                sessionCount: 0,
                progress: { current: 0, total: 0 },
                verification: a.verification.level,
                note: a.verification.note,
            });
        }
    });

    it('the legacy PARSER_VERIFICATION export is just a view of the adapters', () => {
        expect(Object.keys(PARSER_VERIFICATION)).toEqual(ADAPTERS.map(a => a.id));
        for (const a of ADAPTERS) {
            expect(PARSER_VERIFICATION[a.id]).toEqual({ verification: a.verification.level, note: a.verification.note });
        }
    });
});
