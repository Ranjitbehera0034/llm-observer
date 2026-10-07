/**
 * Normalisers for the admin usage/cost API responses.
 *
 * Both vendors document time-bucketed responses: `data` is a list of buckets and each bucket carries
 * a `results` list (Anthropic buckets use starting_at/ending_at RFC 3339 strings, OpenAI buckets use
 * start_time/end_time Unix seconds). The pollers originally assumed a flat shape instead (one record
 * per model, with the time on the record itself). Both are accepted here. Anything else raises
 * SyncShapeError so the poller surfaces a visible error rather than silently storing nothing.
 */

/** The response parsed, but is not a shape we know how to read. Retrying will not help. */
export class SyncShapeError extends Error {
    constructor(public readonly provider: string, public readonly report: 'usage' | 'cost', detail: string) {
        super(`Unrecognised ${provider} ${report} report response: ${detail}`);
        this.name = 'SyncShapeError';
    }
}

export interface NormalizedUsage {
    model: string;
    /** Bucket start exactly as the poller will store it. */
    bucketStart: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    numRequests: number;
    raw: unknown;
}

export interface NormalizedCost {
    /** YYYY-MM-DD of the bucket start. */
    date: string;
    model: string;
    usd: number;
}

function isObject(v: unknown): v is Record<string, any> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? n : 0;
}

function dataList(provider: string, report: 'usage' | 'cost', body: unknown): any[] {
    if (!isObject(body) || !Array.isArray(body.data)) {
        throw new SyncShapeError(provider, report, 'expected an object with a "data" array');
    }
    return body.data;
}

function requireResults(provider: string, report: 'usage' | 'cost', bucket: Record<string, any>): any[] {
    if (!Array.isArray(bucket.results)) {
        throw new SyncShapeError(provider, report, 'time bucket has no "results" array');
    }
    return bucket.results;
}

function addUsage(into: Map<string, NormalizedUsage>, u: NormalizedUsage) {
    const key = `${u.model}\u0000${u.bucketStart}`;
    const prev = into.get(key);
    if (!prev) { into.set(key, u); return; }
    // The same model-day appearing twice in one response is the same bucket split by an ungrouped
    // dimension; the day's total is the sum.
    prev.inputTokens += u.inputTokens;
    prev.outputTokens += u.outputTokens;
    prev.cacheReadTokens += u.cacheReadTokens;
    prev.cacheWriteTokens += u.cacheWriteTokens;
    prev.numRequests += u.numRequests;
}

function addCost(into: Map<string, NormalizedCost>, c: NormalizedCost) {
    const key = `${c.model}\u0000${c.date}`;
    const prev = into.get(key);
    if (prev) prev.usd += c.usd; else into.set(key, c);
}

// -- Anthropic -----------------------------------------------------------------

function anthropicUsageRecord(bucketStart: string, rec: Record<string, any>): NormalizedUsage {
    const cc = isObject(rec.cache_creation) ? rec.cache_creation : {};
    return {
        model: typeof rec.model === 'string' && rec.model ? rec.model : 'unknown',
        bucketStart,
        // Documented field is uncached_input_tokens; the flat shape called it input_tokens.
        inputTokens: num(rec.uncached_input_tokens ?? rec.input_tokens),
        outputTokens: num(rec.output_tokens),
        cacheReadTokens: num(rec.cache_read_input_tokens),
        cacheWriteTokens: num(cc.ephemeral_1h_input_tokens) + num(cc.ephemeral_5m_input_tokens),
        numRequests: num(rec.num_requests),
        raw: rec,
    };
}

export function normalizeAnthropicUsage(body: unknown): NormalizedUsage[] {
    const out = new Map<string, NormalizedUsage>();
    for (const item of dataList('Anthropic', 'usage', body)) {
        if (!isObject(item)) throw new SyncShapeError('Anthropic', 'usage', 'data entry is not an object');
        if (typeof item.starting_at === 'string') {
            for (const rec of requireResults('Anthropic', 'usage', item)) {
                if (!isObject(rec)) throw new SyncShapeError('Anthropic', 'usage', 'result is not an object');
                addUsage(out, anthropicUsageRecord(item.starting_at, rec));
            }
        } else if (typeof item.bucket_start === 'string' && typeof item.model === 'string') {
            addUsage(out, anthropicUsageRecord(item.bucket_start, item));
        } else {
            throw new SyncShapeError('Anthropic', 'usage', 'data entry is neither a time bucket nor a flat usage record');
        }
    }
    return [...out.values()];
}

/** Anthropic cost amounts are decimal strings in cents (documented); the old flat shape used USD. */
export function normalizeAnthropicCost(body: unknown): NormalizedCost[] {
    const out = new Map<string, NormalizedCost>();
    for (const item of dataList('Anthropic', 'cost', body)) {
        if (!isObject(item)) throw new SyncShapeError('Anthropic', 'cost', 'data entry is not an object');
        if (typeof item.starting_at === 'string') {
            const date = item.starting_at.split('T')[0];
            for (const rec of requireResults('Anthropic', 'cost', item)) {
                if (!isObject(rec) || rec.amount === undefined) {
                    throw new SyncShapeError('Anthropic', 'cost', 'cost result has no "amount"');
                }
                const model = rec.model || (rec.description ? parseModelFromDescription(rec.description) : null);
                if (!model) continue; // non-token costs (web search, code execution) have no model
                addCost(out, { date, model, usd: num(rec.amount) / 100 });
            }
        } else if (typeof item.start_time === 'string' && item.cost !== undefined) {
            const model = item.model || (item.description ? parseModelFromDescription(item.description) : null);
            if (!model) continue;
            addCost(out, { date: item.start_time.split('T')[0], model, usd: num(item.cost) });
        } else {
            throw new SyncShapeError('Anthropic', 'cost', 'data entry is neither a time bucket nor a flat cost record');
        }
    }
    return [...out.values()];
}

/** Attempts to extract a model name from an Anthropic cost report description string */
export function parseModelFromDescription(description: string): string | null {
    // Description format varies, but typically looks like "claude-sonnet-4" or contains the model slug
    const match = description.match(/claude-[\w.-]+/i);
    return match ? match[0].toLowerCase() : null;
}

// -- OpenAI --------------------------------------------------------------------

function openaiUsageRecord(startSeconds: number, rec: Record<string, any>): NormalizedUsage {
    return {
        model: typeof rec.model === 'string' && rec.model ? rec.model : 'unknown',
        bucketStart: new Date(startSeconds * 1000).toISOString(),
        inputTokens: num(rec.input_tokens),
        outputTokens: num(rec.output_tokens),
        cacheReadTokens: num(rec.input_cached_tokens),
        cacheWriteTokens: 0, // the completions usage endpoint does not expose cache writes
        numRequests: num(rec.num_model_requests),
        raw: rec,
    };
}

export interface OpenAIUsageResult {
    records: NormalizedUsage[];
    /** Largest bucket start seen, Unix seconds (0 when the response had no buckets). */
    latestBucketStart: number;
}

export function normalizeOpenAIUsage(body: unknown): OpenAIUsageResult {
    const out = new Map<string, NormalizedUsage>();
    let latest = 0;
    for (const item of dataList('OpenAI', 'usage', body)) {
        if (!isObject(item) || typeof item.start_time !== 'number') {
            throw new SyncShapeError('OpenAI', 'usage', 'data entry has no numeric "start_time"');
        }
        latest = Math.max(latest, item.start_time);
        if (Array.isArray(item.results)) {
            for (const rec of item.results) {
                if (!isObject(rec)) throw new SyncShapeError('OpenAI', 'usage', 'result is not an object');
                addUsage(out, openaiUsageRecord(item.start_time, rec));
            }
        } else if (typeof item.model === 'string') {
            addUsage(out, openaiUsageRecord(item.start_time, item));
        } else {
            throw new SyncShapeError('OpenAI', 'usage', 'data entry is neither a time bucket nor a flat usage record');
        }
    }
    return { records: [...out.values()], latestBucketStart: latest };
}

export interface OpenAICostResult {
    costs: NormalizedCost[];
    /** Largest bucket start seen, Unix seconds (0 when the response had no buckets). */
    latestBucketStart: number;
}

/**
 * OpenAI cost amounts are dollars. Costs can be split over several line items per day; callers
 * match on `model`, which here is the line item with a trailing ", input" / ", output" style
 * qualifier removed so the parts of one model add up. (Whether live line items carry such a
 * qualifier is unverified; see docs/RELEASE_CHECKLIST.md.)
 */
export function normalizeOpenAICost(body: unknown): OpenAICostResult {
    const out = new Map<string, NormalizedCost>();
    let latest = 0;
    const add = (start: number, rec: Record<string, any>) => {
        if (typeof rec.line_item !== 'string' || !rec.line_item) return; // not attributable to a model
        const value = isObject(rec.amount) ? rec.amount.value : undefined;
        if (value === undefined) throw new SyncShapeError('OpenAI', 'cost', 'cost result has no "amount.value"');
        const model = rec.line_item.split(',')[0].trim();
        addCost(out, { date: new Date(start * 1000).toISOString().split('T')[0], model, usd: num(value) });
    };
    for (const item of dataList('OpenAI', 'cost', body)) {
        if (!isObject(item) || typeof item.start_time !== 'number') {
            throw new SyncShapeError('OpenAI', 'cost', 'data entry has no numeric "start_time"');
        }
        latest = Math.max(latest, item.start_time);
        if (Array.isArray(item.results)) {
            for (const rec of item.results) {
                if (!isObject(rec)) throw new SyncShapeError('OpenAI', 'cost', 'result is not an object');
                add(item.start_time, rec);
            }
        } else if ('amount' in item) {
            add(item.start_time, item);
        } else {
            throw new SyncShapeError('OpenAI', 'cost', 'data entry is neither a time bucket nor a flat cost record');
        }
    }
    return { costs: [...out.values()], latestBucketStart: latest };
}
