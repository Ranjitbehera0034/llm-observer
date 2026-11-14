import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import checkout from '../../api/checkout/lemonsqueezy.js';
const post=(body:unknown)=>new Request('https://test.invalid/checkout/lemonsqueezy',{method:'POST',body:JSON.stringify(body)});
let mockFetch: ReturnType<typeof vi.fn>;
beforeEach(()=>{
    vi.stubEnv('LEMONSQUEEZY_API_KEY','test-only');vi.stubEnv('LEMONSQUEEZY_STORE_ID','1');vi.stubEnv('LEMONSQUEEZY_VARIANT_IDS','2,3');vi.stubEnv('LEMONSQUEEZY_MONTHLY_VARIANT_ID','2');vi.stubEnv('LEMONSQUEEZY_YEARLY_VARIANT_ID','3');vi.stubEnv('PAYMENTS_TEST_MODE','false');
    mockFetch=vi.fn().mockResolvedValue(Response.json({data:{attributes:{url:'https://example.lemonsqueezy.com/checkout/custom/test'}}}));vi.stubGlobal('fetch',mockFetch);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('international Pro checkout',()=>{
    it.each([['monthly','2'],['yearly','3']])('creates %s from the server-owned variant',async(plan,id)=>{
        const response=await checkout.fetch(post({email:'buyer@example.invalid',plan,variant_id:'999',custom_price:1}));
        expect(response.status).toBe(200);
        const body=JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.data.relationships.variant.data.id).toBe(id);
        expect(body.data.attributes.product_options.enabled_variants).toEqual([Number(id)]);
        expect(body.data.attributes).not.toHaveProperty('custom_price');
        expect(body.data.attributes.checkout_options).toEqual({subscription_preview:true});
        expect(body.data.attributes.test_mode).toBe(false);
    });
    it('fails before requesting checkout when configuration is missing or disallowed',async()=>{
        vi.stubEnv('LEMONSQUEEZY_MONTHLY_VARIANT_ID','999');
        expect((await checkout.fetch(post({email:'buyer@example.invalid',plan:'monthly'}))).status).toBe(503);
        expect(mockFetch).not.toHaveBeenCalled();
    });
    it('keeps sandbox explicit',async()=>{
        vi.stubEnv('PAYMENTS_TEST_MODE','true');await checkout.fetch(post({email:'buyer@example.invalid',plan:'monthly'}));
        expect(JSON.parse(mockFetch.mock.calls[0][1].body).data.attributes.test_mode).toBe(true);
    });
    it.each([null,{plan:'monthly',email:42},{plan:'free',email:'buyer@example.invalid'}])('rejects malformed requests',async body=>{
        expect((await checkout.fetch(post(body))).status).toBe(400);expect(mockFetch).not.toHaveBeenCalled();
    });
    it('rejects an unexpected checkout redirect and handles outages',async()=>{
        mockFetch.mockResolvedValueOnce(Response.json({data:{attributes:{url:'https://evil.example/checkout'}}}));
        expect((await checkout.fetch(post({email:'buyer@example.invalid',plan:'monthly'}))).status).toBe(502);
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        expect((await checkout.fetch(post({email:'buyer@example.invalid',plan:'monthly'}))).status).toBe(502);
    });
});
