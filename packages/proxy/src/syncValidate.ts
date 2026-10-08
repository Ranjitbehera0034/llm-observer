/**
 * Bundle entry used only by scripts/validate-admin-sync.js (built to dist/syncValidate.js).
 *
 * The validator needs the REAL pollers' sync code, a database it controls and the response
 * normalisers inside ONE bundle so they share module state (tsup copies modules into each entry).
 * Nothing imports this file and it is not part of the published CLI.
 *
 * The recording fetch below is a pass-through: it performs the real HTTP request with node-fetch,
 * keeps a copy of what came back, and hands the poller an equivalent response. It does not change
 * or invent responses.
 */
import nodeFetch, { Response } from 'node-fetch';
import { AnthropicPoller } from './sync/anthropic-poller';
import { OpenAIPoller } from './sync/open-ai-poller';

export { initDb, closeDb, getDb } from '@llm-observer/database';
export { adminBaseUrl, isBaseUrlOverridden, ANTHROPIC_BASE_URL_ENV, OPENAI_BASE_URL_ENV } from './sync/admin-endpoints';
export {
    SyncShapeError,
    normalizeAnthropicUsage,
    normalizeAnthropicCost,
    normalizeOpenAIUsage,
    normalizeOpenAICost,
} from './sync/response-shapes';

/** One request/response pair as the poller saw it. */
export interface Exchange {
    url: string;
    /** HTTP status, or null when the request failed before a response (DNS, refused, timeout). */
    status: number | null;
    /** Response body text exactly as received (empty when there was no response). */
    bodyText: string;
    /** Network-level error message, when status is null. */
    error?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

export function createRecordingFetch(sink: (e: Exchange) => void, opts: { maxRequests?: number } = {}): typeof nodeFetch {
    const maxRequests = opts.maxRequests ?? 500;
    let count = 0;
    const recording = async (url: any, init?: any) => {
        if (++count > maxRequests) {
            throw new Error(`validator stopped after ${maxRequests} requests (pagination that never ends?)`);
        }
        let res;
        try {
            res = await nodeFetch(url, { timeout: REQUEST_TIMEOUT_MS, ...(init || {}) });
        } catch (err: any) {
            sink({ url: String(url), status: null, bodyText: '', error: String(err?.message ?? err) });
            throw err;
        }
        const bodyText = await res.text();
        sink({ url: String(url), status: res.status, bodyText });
        return new Response(bodyText, { status: res.status, headers: res.headers as any });
    };
    return recording as unknown as typeof nodeFetch;
}

export interface SyncWindow {
    /** Start of the window, epoch milliseconds (a UTC midnight). */
    startMs: number;
}

/** Run the real poller sync (usage, then cost) once for a provider against the open database. */
export async function runProviderSync(
    provider: 'anthropic' | 'openai',
    apiKey: string,
    window: SyncWindow,
    fetchImpl: typeof nodeFetch,
): Promise<void> {
    if (provider === 'anthropic') {
        const poller = new AnthropicPoller({ id: 'anthropic' }, { fetch: fetchImpl });
        await poller.syncOnce(apiKey, {
            usageStart: new Date(window.startMs).toISOString(),
            costStart: new Date(window.startMs).toISOString().split('T')[0],
        });
    } else {
        const poller = new OpenAIPoller({ id: 'openai' }, { fetch: fetchImpl });
        const seconds = Math.floor(window.startMs / 1000);
        await poller.syncOnce(apiKey, { usageStart: seconds, costStart: seconds });
    }
}
