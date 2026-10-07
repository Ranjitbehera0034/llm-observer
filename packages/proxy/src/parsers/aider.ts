import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { getParsedFile, upsertParsedFile, insertSession, getPricingForModel } from '@llm-observer/database';
import { getProviderForModel } from './utils';

/*
 * Aider has no default analytics log: it only writes one when started with
 * `--analytics-log FILE`. ~/.aider/analytics.jsonl is the path this tool looks at, so a
 * user has to point Aider there. Each line is `{event, properties, user_id, time}` where
 * `time` is Unix seconds and everything else lives under `properties`. Only the
 * `message_send` event carries usage (prompt_tokens, completion_tokens, cost).
 * Upstream: https://github.com/Aider-AI/aider/blob/main/aider/analytics.py
 * The fixtures for this parser are synthetic (see __tests__/fixtures/aider/README.md).
 */
const getAiderAnalyticsPath = () => {
    return path.join(os.homedir(), '.aider', 'analytics.jsonl');
};

export const detector = (): boolean => {
    return fs.existsSync(getAiderAnalyticsPath());
};

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);

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
            if (event?.event !== 'message_send') continue;

            const props = event.properties || {};
            const inputTokens = num(props.prompt_tokens);
            const outputTokens = num(props.completion_tokens);
            if (inputTokens + outputTokens === 0) continue;

            // Aider redacts the names of models litellm does not know to "REDACTED".
            const rawModel = typeof props.main_model === 'string' ? props.main_model : '';
            const model = rawModel && rawModel !== 'REDACTED' ? rawModel : 'unknown';

            let cost = num(props.cost);
            let isEstimated = false;
            let costSource = 'reported'; // the price Aider itself computed
            if (!cost) {
                const pricing = model !== 'unknown' ? getPricingForModel(getProviderForModel(model), model) : undefined;
                isEstimated = true;
                if (pricing) {
                    cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
                    costSource = 'pricing_table';
                } else {
                    costSource = 'unpriced';
                }
            }

            const when = new Date(num(event.time) ? event.time * 1000 : stat.birthtimeMs).toISOString();
            insertSession({
                provider: 'aider',
                tool: 'Aider',
                session_id: eventId(filePath, lineStart),
                project_name: 'aider',
                project_path: null as any,
                model_primary: model,
                started_at: when,
                ended_at: when,
                duration_seconds: 0,
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
