import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { getParsedFile, upsertParsedFile, insertSession, getPricingForModel } from '@llm-observer/database';
import { getProviderForModel } from './utils';
import { ParserAdapter, locator } from './adapter';

/*
 * Aider has no default analytics log: it only writes one when started with
 * `--analytics-log FILE`. ~/.aider/analytics.jsonl is the path this tool looks at, so a
 * user has to point Aider there. The log is written even when the user has not opted in to
 * Aider's remote analytics (`--no-analytics` still logs locally).
 *
 * Format, as recorded from real Aider 0.86.2 (fixtures/aider/recorded/aider-0.86.2/README.md):
 * each line is `{event, properties, user_id, time}`; `time` is Unix seconds, `user_id` is a
 * per-install UUID (there is NO session or project id anywhere), and everything else lives
 * under `properties`. Only `message_send` carries usage (prompt_tokens, completion_tokens,
 * cost). It is logged after the reply, and the reply's request is announced by a
 * `message_send_starting` event, which this parser pairs with it to get a start time and duration.
 * A failed request logs `message_send_starting` and no `message_send`. Model names are written
 * as litellm ids ("openai/gpt-4o-mini"); a model litellm does not know is written as
 * "<provider>/REDACTED", or the string "None" when it has no provider prefix.
 * Upstream: https://github.com/Aider-AI/aider/blob/main/aider/analytics.py
 * Token counts in a log are whatever Aider reports: from the API's usage object when the reply
 * is not streamed, and Aider's own tokenizer estimate when it is streamed.
 */
const getAiderAnalyticsPath = () => {
    return path.join(os.homedir(), '.aider', 'analytics.jsonl');
};

export const detector = (): boolean => {
    return fs.existsSync(getAiderAnalyticsPath());
};

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

/**
 * Aider logs litellm model ids. Drop the routing prefix so the name matches the price table and the
 * other parsers ("openai/gpt-4o-mini" -> "gpt-4o-mini"), and treat names Aider itself redacted
 * ("openai/REDACTED", "REDACTED", "None", missing) as unknown.
 */
const normalizeModel = (raw: unknown): string => {
    if (typeof raw !== 'string') return 'unknown';
    const name = raw.trim().split('/').pop() || '';
    if (!name || name === 'REDACTED' || name === 'None') return 'unknown';
    return name;
};

/** Deterministic id: file path + byte offset of the line, so a re-read upserts instead of duplicating. */
const eventId = (filePath: string, offset: number): string =>
    `aider-${createHash('sha1').update(filePath).digest('hex').slice(0, 12)}-${offset}`;

/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, tool counts). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const filePath = getAiderAnalyticsPath();
    if (!fs.existsSync(filePath)) return;

    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;

    const registryEntry = getParsedFile(filePath);
    if (registryEntry && registryEntry.status === 'success' && registryEntry.last_modified_at >= mtime) {
        return; // Unchanged
    }

    try {
        if (onProgress) onProgress(0, 1);

        const buf = fs.readFileSync(filePath);
        let offset = 0;
        let pendingStart = 0; // `time` of the latest message_send_starting not yet answered by a message_send
        while (offset < buf.length) {
            const nl = buf.indexOf(0x0a, offset);
            const lineStart = offset;
            const lineEnd = nl === -1 ? buf.length : nl;
            offset = nl === -1 ? buf.length : nl + 1;

            const line = buf.toString('utf8', lineStart, lineEnd).trim();
            if (!line) continue;

            let event: any;
            try {
                event = JSON.parse(line);
            } catch {
                continue; // malformed or half-written last line; it keeps the same id once complete
            }
            if (event?.event === 'message_send_starting') {
                pendingStart = num(event.time);
                continue;
            }
            if (event?.event === 'launched' || event?.event === 'exit' || event?.event === 'message_send_exception') pendingStart = 0;
            if (event?.event !== 'message_send') continue;
            const startTime = pendingStart;
            pendingStart = 0;

            const props = event.properties || {};
            const inputTokens = num(props.prompt_tokens);
            const outputTokens = num(props.completion_tokens);
            if (inputTokens + outputTokens === 0) continue;

            const rawModel = typeof props.main_model === 'string' ? props.main_model : '';
            const model = normalizeModel(rawModel);

            let cost = num(props.cost);
            let isEstimated = false;
            let costSource = 'reported'; // the price Aider itself computed
            if (!cost) {
                const pricing = model !== 'unknown' ? getPricingForModel(getProviderForModel(rawModel), model) : undefined;
                isEstimated = true;
                if (pricing) {
                    cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
                    costSource = 'pricing_table';
                } else {
                    costSource = 'unpriced';
                }
            }

            const sentAt = num(event.time) ? event.time : Math.floor(stat.birthtimeMs / 1000);
            const startedAt = startTime && startTime <= sentAt ? startTime : sentAt;
            insertSession({
                provider: 'aider',
                tool: 'Aider',
                session_id: eventId(filePath, lineStart),
                project_name: 'aider',
                project_path: null as any,
                model_primary: model,
                started_at: new Date(startedAt * 1000).toISOString(),
                ended_at: new Date(sentAt * 1000).toISOString(),
                duration_seconds: sentAt - startedAt,
                message_count: 1,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                estimated_cost_usd: cost,
                is_estimated: isEstimated ? 1 : 0,
                cost_source: costSource,
                session_type: 'interactive',
                has_subagents: false,
                file_path: filePath,
                file_modified_at: mtime
            });
        }

        upsertParsedFile({
            file_path: filePath,
            provider: 'aider',
            last_modified_at: mtime,
            last_parsed_at: new Date().toISOString(),
            status: 'success'
        });

        if (onProgress) onProgress(1, 1);

    } catch (err) {
        console.error(`[Aider Parser] Failed to parse ${filePath}:`, err);
        upsertParsedFile({
            file_path: filePath,
            provider: 'aider',
            last_modified_at: mtime,
            last_parsed_at: new Date().toISOString(),
            status: 'error',
            error_message: String(err)
        });
    }
};

const located = locator(() => (fs.existsSync(getAiderAnalyticsPath()) ? [getAiderAnalyticsPath()] : []), paths => paths.map(p => path.dirname(p)));

export const adapter: ParserAdapter = {
    id: 'aider',
    displayName: 'Aider',
    verification: {
        level: 'verified',
        recording: 'aider',
        note: 'Verified for the log format: golden-output tests against a scrubbed analytics log recorded from real Aider 0.86.2 on Linux. The model endpoint was a mock, so its token counts are the mock\'s (or Aider\'s own estimate when streamed), and costs are not checked against a bill. Other Aider versions, macOS and Windows were not recorded. Aider only writes this file when started with --analytics-log, and the log has no session id, so each message is one row.',
    },
    detect: located.detect,
    watchPaths: located.watchPaths,
    parse: opts => parse(opts?.onProgress),
};
