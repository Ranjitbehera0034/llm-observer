import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { insertSession, getPricingForModel } from '@llm-observer/database';
import { estimateTokens, findFilesRecursive, shouldParseFile, markFileParsed, getProviderForModel } from './utils';
import { ParserAdapter, locator } from './adapter';

/**
 * OpenAI Codex CLI session logs: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`
 * (CODEX_HOME defaults to ~/.codex).
 *
 * Format as written by Codex CLI 0.162.1 (recorded, see __tests__/fixtures/codex/recorded/codex-0.162.1/):
 * every line is an envelope `{timestamp, ordinal, type, payload}`.
 *   - `session_meta`                      payload.cwd, payload.cli_version, payload.id
 *   - `turn_context`                      payload.model (the model of that turn)
 *   - `event_msg` / `token_count`         payload.info.{total_token_usage, last_token_usage}: ONE per API
 *                                         response. `last_token_usage` is that response; `total_token_usage` is
 *                                         the running total of the thread. The same total can be written again,
 *                                         and `info` can be null.
 *   - `token_usage_record`                the same usage a second time (per response); ignored so nothing is counted twice
 *   - `event_msg` / `item_completed`      payload.item.type UserMessage | AgentMessage are the conversation turns
 *   - `response_item` / `function_call`   a tool call, payload.name
 * Usage follows the OpenAI convention: `input_tokens` INCLUDES `cached_input_tokens`, and `output_tokens` INCLUDES
 * `reasoning_output_tokens`. The log holds no cost. A request that failed leaves no usage, only an `error` on `task_complete`.
 *
 * The hand-written format this parser started with (top-level `message` / `tool_call` lines with `usage`
 * on the event) was never seen from a real Codex; it is still read so existing logs keep working.
 */
const getCodexDir = () => {
    const configured = process.env.CODEX_HOME && process.env.CODEX_HOME.trim();
    if (configured) return path.join(path.resolve(configured), 'sessions');
    // os.homedir() is USERPROFILE on Windows and HOME elsewhere (the same place Codex itself uses).
    return path.join(os.homedir(), '.codex', 'sessions');
};

export const detector = (): boolean => {
    return fs.existsSync(getCodexDir());
};

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const codexDir = getCodexDir();
    if (!fs.existsSync(codexDir)) return;

    const jsonlFiles = findFilesRecursive(codexDir, /\.jsonl$/);
    const total = jsonlFiles.length;
    let current = 0;

    for (const filePath of jsonlFiles) {
        current++;
        if (onProgress) onProgress(current, total);

        try {
            await parseSessionFile(filePath);
        } catch (err) {
            console.error(`[Codex Parser] Failed to parse ${filePath}:`, err);
            markFileParsed(filePath, 'codex', fs.statSync(filePath).mtimeMs, 'error', String(err));
        }
    }
};

interface Bucket { input: number; cacheRead: number; output: number }
type CostSource = 'pricing_table' | 'estimated' | 'unpriced';
const SOURCE_RANK: Record<CostSource, number> = { pricing_table: 0, estimated: 1, unpriced: 2 };

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
const isoOrNull = (v: unknown): string | null => {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const t = new Date(v).getTime();
    return isNaN(t) ? null : new Date(t).toISOString();
};

/** Usage of one API response, with Codex's input_tokens split into uncached and cached reads. */
const toBucket = (u: any): Bucket => {
    const input = num(u?.input_tokens);
    const cached = Math.min(num(u?.cached_input_tokens), input);
    return { input: input - cached, cacheRead: cached, output: num(u?.output_tokens) };
};

const diffUsage = (now: any, before: any) => ({
    input_tokens: num(now?.input_tokens) - num(before?.input_tokens),
    cached_input_tokens: num(now?.cached_input_tokens) - num(before?.cached_input_tokens),
    output_tokens: num(now?.output_tokens) - num(before?.output_tokens),
});

/** Price each model's tokens on its own; a model with no price contributes $0 and marks the result 'unpriced'. */
const priceBuckets = (buckets: Map<string, Bucket>): { costUsd: number; costSource: CostSource } => {
    let costUsd = 0;
    let costSource: CostSource = 'pricing_table';
    for (const [model, b] of buckets) {
        if (b.input + b.cacheRead + b.output === 0) continue;
        const pricing = getPricingForModel(getProviderForModel(model), model);
        let source: CostSource = 'pricing_table';
        if (!pricing) {
            source = 'unpriced';
        } else {
            // No cached rate on the price row: cached reads are billed at the full input rate (never under-reports).
            const cachedRate = pricing.cached || pricing.input;
            if (b.cacheRead > 0 && !pricing.cached) source = 'estimated';
            costUsd += (b.input / 1_000_000) * pricing.input
                + (b.cacheRead / 1_000_000) * cachedRate
                + (b.output / 1_000_000) * pricing.output;
        }
        if (SOURCE_RANK[source] > SOURCE_RANK[costSource]) costSource = source;
    }
    return { costUsd, costSource };
};

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p;

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;

    if (!shouldParseFile(filePath, mtime)) return;

    const fileName = path.basename(filePath, '.jsonl');
    const sessionId = fileName;

    let started_at: string | null = null;
    let ended_at: string | null = null;
    let messageCount = 0;
    let estimatedTokensFromLength = 0;
    let hasExplicitTokens = false;
    let sawEnvelope = false;
    let cwd: string | null = null;
    let currentModel = '';
    let lastTotalKey: string | null = null;
    let lastTotal: any = null;
    const toolCalls: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};
    const buckets = new Map<string, Bucket>();

    const addUsage = (model: string, b: Bucket) => {
        const into = buckets.get(model) || { input: 0, cacheRead: 0, output: 0 };
        into.input += b.input;
        into.cacheRead += b.cacheRead;
        into.output += b.output;
        buckets.set(model, into);
        hasExplicitTokens = true;
    };

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            if (!event || typeof event !== 'object') continue;

            const ts = isoOrNull(event.timestamp);
            if (ts) {
                if (!started_at) started_at = ts;
                ended_at = ts;
            }

            const payload = event.payload;
            if (payload && typeof payload === 'object' && typeof event.type === 'string') {
                sawEnvelope = true;
                if (event.type === 'session_meta') {
                    if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
                } else if (event.type === 'turn_context') {
                    if (typeof payload.model === 'string' && payload.model) {
                        currentModel = payload.model;
                        modelCounts[currentModel] = (modelCounts[currentModel] || 0) + 1;
                    }
                    if (!cwd && typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
                } else if (event.type === 'event_msg') {
                    if (payload.type === 'token_count' && payload.info) {
                        const info = payload.info;
                        const totalKey = info.total_token_usage ? JSON.stringify(info.total_token_usage) : null;
                        // The same running total written twice is the same response, not a new one.
                        if (!(totalKey && totalKey === lastTotalKey)) {
                            const last = info.last_token_usage
                                || (info.total_token_usage ? diffUsage(info.total_token_usage, lastTotal) : null);
                            if (last) addUsage(currentModel, toBucket(last));
                            if (totalKey) { lastTotalKey = totalKey; lastTotal = info.total_token_usage; }
                        }
                    } else if (payload.type === 'item_completed') {
                        const kind = payload.item?.type;
                        if (kind === 'UserMessage' || kind === 'AgentMessage') messageCount++;
                    }
                } else if (event.type === 'response_item') {
                    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
                        const toolName = payload.name || 'unknown';
                        toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
                    }
                }
                // `token_usage_record` repeats each token_count: deliberately not read.
                continue;
            }

            // Hand-written legacy shape: fields at the top level of the event.
            if (event.type === 'message') messageCount++;

            if (event.model) {
                currentModel = event.model;
                modelCounts[event.model] = (modelCounts[event.model] || 0) + 1;
            }

            if (event.usage && (event.usage.input_tokens !== undefined || event.usage.output_tokens !== undefined)) {
                addUsage(currentModel, { input: num(event.usage.input_tokens), cacheRead: 0, output: num(event.usage.output_tokens) });
            } else if (event.content && typeof event.content === 'string') {
                estimatedTokensFromLength += estimateTokens(event.content);
            }

            if (event.type === 'tool_call') {
                const toolName = event.name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            }

        } catch (e) {
            // Ignore malformed json
        }
    }

    // A real Codex log with no completed request has no usage and no cost (a failed request is logged
    // only as an error on the turn). Do not invent a $0 session for it.
    if (sawEnvelope && !hasExplicitTokens) {
        markFileParsed(filePath, 'codex', mtime, 'success');
        return;
    }

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();

    let durationSeconds = 0;
    if (started_at && ended_at) {
        durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
    }

    // Usage seen before any model was named belongs to the session's main model.
    let primaryModel = sawEnvelope ? 'unknown' : 'codex-mini';
    let best = -1;
    const tokensOf = (b: Bucket) => b.input + b.cacheRead + b.output;
    for (const [model, b] of buckets) {
        if (model && tokensOf(b) > best) { best = tokensOf(b); primaryModel = model; }
    }
    if (best < 0) {
        let maxCount = 0;
        for (const [model, count] of Object.entries(modelCounts)) {
            if (count > maxCount) { maxCount = count; primaryModel = model; }
        }
    }
    const unnamed = buckets.get('');
    if (unnamed) {
        buckets.delete('');
        const into = buckets.get(primaryModel) || { input: 0, cacheRead: 0, output: 0 };
        into.input += unnamed.input; into.cacheRead += unnamed.cacheRead; into.output += unnamed.output;
        buckets.set(primaryModel, into);
    }

    let inputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;
    for (const b of buckets.values()) { inputTokens += b.input; cacheReadTokens += b.cacheRead; outputTokens += b.output; }

    let isEstimated = !hasExplicitTokens;
    if (isEstimated && messageCount > 0) {
        inputTokens = Math.floor(estimatedTokensFromLength / 2);
        outputTokens = Math.ceil(estimatedTokensFromLength / 2);
        buckets.clear();
        buckets.set(primaryModel, { input: inputTokens, cacheRead: 0, output: outputTokens });
    }

    const priced = priceBuckets(buckets);
    const costSource: CostSource = isEstimated && SOURCE_RANK[priced.costSource] < SOURCE_RANK.estimated ? 'estimated' : priced.costSource;
    isEstimated = isEstimated || costSource !== 'pricing_table';

    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';
    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;

    insertSession({
        provider: getProviderForModel(primaryModel),
        tool: 'OpenAI Codex CLI',
        session_id: sessionId,
        project_path: cwd || path.dirname(filePath),
        project_name: cwd ? baseName(cwd) : 'codex-session',
        model_primary: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: durationSeconds,
        message_count: messageCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_hit_rate: cacheHitRate,
        estimated_cost_usd: priced.costUsd,
        is_estimated: isEstimated ? 1 : 0,
        cost_source: costSource,
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: false,
        subagent_count: 0,
        file_path: filePath,
        file_modified_at: mtime,
        parent_cost_usd: priced.costUsd
    } as any);

    markFileParsed(filePath, 'codex', mtime, 'success');
};

const located = locator(() => (fs.existsSync(getCodexDir()) ? [getCodexDir()] : []));

export const adapter: ParserAdapter = {
    id: 'codex',
    displayName: 'OpenAI Codex CLI',
    verification: {
        level: 'verified',
        recording: 'codex',
        note: 'Verified for the log format: golden-output tests against scrubbed rollout files recorded from real Codex CLI 0.162.1 (codex exec) on Linux. The model endpoint was a mock, so its token counts are the mock\'s, and costs are not checked against a bill (the log holds no cost; LLM Observer prices the tokens). Older Codex versions, macOS, Windows and a real model or account were not recorded: logs in an older layout may not parse. A session whose requests all failed has no usage and gets no row.',
    },
    detect: located.detect,
    watchPaths: located.watchPaths,
    parse: opts => parse(opts?.onProgress),
};
