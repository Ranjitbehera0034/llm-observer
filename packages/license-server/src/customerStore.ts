// Optional durable PostgREST store. Never use an ephemeral serverless filesystem.
export function customerStoreConfigured(): boolean {
    return !!process.env.CUSTOMER_STORE_URL && !!process.env.CUSTOMER_STORE_SERVICE_KEY;
}
export async function customerStore(path: string, method = 'GET', body?: unknown): Promise<any> {
    if (!customerStoreConfigured()) throw new Error('Customer reporting is not configured');
    const base = new URL(process.env.CUSTOMER_STORE_URL!);
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Invalid customer store URL');
    const response = await fetch(`${base.href.replace(/\/$/, '')}/${path}`, {
        method, headers: { apikey: process.env.CUSTOMER_STORE_SERVICE_KEY!, Authorization: `Bearer ${process.env.CUSTOMER_STORE_SERVICE_KEY!}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000), redirect: 'error'
    });
    if (!response.ok) throw new Error('Customer store unavailable');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}
