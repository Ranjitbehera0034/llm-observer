/** Server-created global checkout. Prices and trial policy belong to configured variants. */
async function handler(req: Request): Promise<Response> {
    const headers = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Cache-Control':'no-store' };
    const reply = (body: unknown, status=200) => Response.json(body,{status,headers});
    if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (req.method !== 'POST') return reply({error:'Method not allowed'},405);
    let body: any;
    try { const raw=await req.text(); if(raw.length>2048) return reply({error:'Request too large'},413); body=JSON.parse(raw); } catch { return reply({error:'Invalid JSON'},400); }
    if (!['monthly','yearly'].includes(body?.plan)) return reply({error:'Choose monthly or yearly'},400);
    const email=typeof body.email==='string'?body.email.trim():'';
    if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({error:'A valid license delivery email is required'},400);
    const apiKey=process.env.LEMONSQUEEZY_API_KEY;
    const store=process.env.LEMONSQUEEZY_STORE_ID;
    const variant=process.env[body.plan==='monthly'?'LEMONSQUEEZY_MONTHLY_VARIANT_ID':'LEMONSQUEEZY_YEARLY_VARIANT_ID'];
    const allowed=(process.env.LEMONSQUEEZY_VARIANT_IDS || '').split(',').map(s=>s.trim());
    if (!apiKey || !store || !variant || !/^\d+$/.test(store) || !/^\d+$/.test(variant) || !allowed.includes(variant)) return reply({error:'Checkout setup is incomplete. Please contact support; you have not been charged.'},503);
    try {
        const callback=new URL(process.env.CHECKOUT_CALLBACK_URL || 'https://www.llm-observer.com/thanks');
        if(callback.protocol!=='https:' || callback.username || callback.password) throw new Error('Invalid callback');
        const response=await fetch('https://api.lemonsqueezy.com/v1/checkouts',{
            method:'POST',headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/vnd.api+json','Content-Type':'application/vnd.api+json'},
            body:JSON.stringify({data:{type:'checkouts',attributes:{checkout_data:{email},product_options:{enabled_variants:[Number(variant)],redirect_url:callback.href},checkout_options:{subscription_preview:true},test_mode:process.env.PAYMENTS_TEST_MODE==='true',expires_at:new Date(Date.now()+30*60*1000).toISOString()},relationships:{store:{data:{type:'stores',id:store}},variant:{data:{type:'variants',id:variant}}}}}),
            signal:AbortSignal.timeout(8000),redirect:'error'
        });
        if(!response.ok) return reply({error:'Payment provider could not open checkout. Please retry; no payment was taken.'},502);
        const result=await response.json() as any;
        const url=new URL(result?.data?.attributes?.url);
        if(url.protocol!=='https:' || !url.hostname.endsWith('.lemonsqueezy.com') || url.username || url.password) throw new Error('Invalid checkout URL');
        return reply({url:url.href,test_mode:process.env.PAYMENTS_TEST_MODE==='true'});
    } catch { return reply({error:'Could not open secure checkout. Please retry.'},502); }
}
export default {fetch:handler};
