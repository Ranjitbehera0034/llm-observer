import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import activity from '../../api/activity/index.js';
import admin from '../../api/admin/customers.js';
const { store, entitlement, decode } = vi.hoisted(() => ({ store: vi.fn(), entitlement: vi.fn(), decode: vi.fn() }));
vi.mock('../../src/customerStore.js', () => ({ customerStore: store }));
vi.mock('../../src/entitlement.js', () => ({ getEntitlement: entitlement }));
vi.mock('../../src/keyGenerator.js', () => ({ decodeLicenseKey: decode }));
const installation_id = 'c0dbebde-82b4-4cab-af7a-5988ec2c7955';
const body = { installation_id, token:'a'.repeat(64), version:'2.1.0-beta.1', consent:true };
const request = (value: unknown, method = 'POST') => new Request('https://test.invalid/activity', {method,body:JSON.stringify(value)});
beforeEach(() => { vi.clearAllMocks(); store.mockResolvedValue(true); decode.mockReturnValue({provider:'lemonsqueezy',id:'123'}); });
afterEach(() => vi.unstubAllEnvs());
describe('isolated free, trial and premium customer journeys', () => {
    it('records consenting free installation without a payment or email', async () => {
        expect((await activity.fetch(request(body))).status).toBe(200);
        expect(entitlement).not.toHaveBeenCalled();
        expect(store.mock.calls[0][2]).toMatchObject({plan_name:'free',customer_ref:null});
        expect(JSON.stringify(store.mock.calls)).not.toContain(body.token);
    });
    it.each([['active','pro'],['on_trial','trial']])('distinguishes %s from free as %s', async(status,plan) => {
        entitlement.mockResolvedValue({valid:true,status,valid_until:'2030-01-01'});
        expect((await activity.fetch(request({...body,license_key:'test-license'}))).status).toBe(200);
        expect(store.mock.calls[0][2]).toMatchObject({plan_name:plan,customer_ref:'lemonsqueezy:123'});
        expect(JSON.stringify(store.mock.calls)).not.toContain('test-license');
    });
    it('does not trust a client claim of pro', async () => {
        await activity.fetch(request({...body,plan:'pro'}));
        expect(store.mock.calls[0][2].plan_name).toBe('free');
    });
    it('requires consent and rejects invalid identities', async () => {
        expect((await activity.fetch(request({...body,consent:false}))).status).toBe(400);
        expect((await activity.fetch(request({...body,installation_id:'wrong'}))).status).toBe(400);
        expect(store).not.toHaveBeenCalled();
    });
    it('does not overwrite an existing installation with another secret', async () => {
        store.mockResolvedValue(false);
        expect((await activity.fetch(request(body))).status).toBe(403);
    });
    it('can forget an installation without sending a license', async () => {
        expect((await activity.fetch(request(body,'DELETE'))).status).toBe(200);
        expect(store.mock.calls[0][0]).toBe('rpc/forget_observer_installation');
        expect(entitlement).not.toHaveBeenCalled();
    });
    it('returns retryable failure on provider outage instead of recording free', async () => {
        entitlement.mockRejectedValue(new Error('offline'));
        expect((await activity.fetch(request({...body,license_key:'test-license'}))).status).toBe(503);
        expect(store).not.toHaveBeenCalled();
    });
});
describe('owner-only reporting', () => {
    it('fails closed when not configured or unauthorized', async () => {
        vi.stubEnv('CUSTOMER_ADMIN_TOKEN','');
        expect((await admin.fetch(new Request('https://test.invalid'))).status).toBe(503);
        vi.stubEnv('CUSTOMER_ADMIN_TOKEN','z'.repeat(40));
        expect((await admin.fetch(new Request('https://test.invalid'))).status).toBe(401);
        expect(store).not.toHaveBeenCalled();
    });
    it('returns no installation secret and prevents cache storage', async () => {
        vi.stubEnv('CUSTOMER_ADMIN_TOKEN','z'.repeat(40));store.mockResolvedValue([]);
        const response=await admin.fetch(new Request('https://test.invalid',{headers:{Authorization:'Bearer '+'z'.repeat(40)}}));
        expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
        expect(store.mock.calls[1][0]).not.toContain('token_hash');
    });
});
