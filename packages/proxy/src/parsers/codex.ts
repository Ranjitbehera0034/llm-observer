import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { insertSession } from '@llm-observer/database';
import { calculateCost, findFilesRecursive, shouldParseFile, markFileParsed } from './utils';

const getCodexDir = () => path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
export const detector = (): boolean => fs.existsSync(getCodexDir());

type Usage = { input: number; output: number; cached: number; writes: number };
const zero = (): Usage => ({ input: 0, output: 0, cached: 0, writes: 0 });
const usageKeys = ['input', 'output', 'cached', 'writes'] as const;
function readUsage(value: any): Usage | null {
    if (!value || typeof value !== 'object' || value.input_tokens == null || value.output_tokens == null) return null;
    const usage = {
        input: value.input_tokens, output: value.output_tokens,
        cached: value.cached_input_tokens ?? value.input_tokens_details?.cached_tokens ?? 0,
        writes: value.cache_write_input_tokens ?? 0
    };
    if (!Object.values(usage).every(n => Number.isSafeInteger(n) && n >= 0) || usage.cached > usage.input) return null;
    return usage;
}

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const files = findFilesRecursive(getCodexDir(), /\.jsonl$/);
    let failures = 0;
    for (const [index, file] of files.entries()) {
        onProgress?.(index + 1, files.length);
        try {
            await parseSessionFile(file);
        } catch (error) {
            failures++;
            markFileParsed(file, 'codex', fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0, 'error', String(error));
        }
    }
    if (failures) throw new Error(`Codex import incomplete: ${failures} file(s) failed or contained unsupported usage. See import diagnostics.`);
};

export const parseSessionFile = async (filePath: string): Promise<void> => {
    const stat = fs.statSync(filePath);
    if (!shouldParseFile(filePath, stat.mtimeMs)) return;
    const totals = zero();
    let previous = zero();
    let sawCumulative = false;
    let sawLegacy = false;
    let recognized = false;
    let hasUsage = false;
    let issues = 0;
    let model = 'unknown';
    let cwd: string | undefined;
    let started: string | undefined;
    let ended: string | undefined;
    let messageCount = 0;
    const byModel = new Map<string, Usage>();
    const toolCalls: Record<string, number> = Object.create(null);
    const seenCalls = new Set<string>();

    const addUsage = (usage: Usage) => {
        hasUsage = true;
        const bucket = byModel.get(model) ?? zero();
        for (const key of usageKeys) {
            totals[key] += usage[key];
            bucket[key] += usage[key];
        }
        byModel.set(model, bucket);
    };
    const stream = fs.createReadStream(filePath);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (!line.trim()) continue;
            let event: any;
            try { event = JSON.parse(line); } catch { issues++; continue; }
            if (!event || typeof event !== 'object') { issues++; continue; }
            const timestamp = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
            if (Number.isFinite(timestamp)) {
                const iso = new Date(timestamp).toISOString();
                if (!started || iso < started) started = iso;
                if (!ended || iso > ended) ended = iso;
            }
            const payload = event.payload;
            if (event.type === 'session_meta' || event.type === 'turn_context') {
                recognized = true;
                if (typeof payload?.cwd === 'string') cwd ??= payload.cwd;
                if (typeof payload?.model === 'string' && payload.model) model = payload.model;
            }
            if (event.type === 'event_msg' && payload?.type === 'thread_settings_applied') {
                if (typeof payload.thread_settings?.model === 'string') model = payload.thread_settings.model;
                if (typeof payload.thread_settings?.cwd === 'string') cwd ??= payload.thread_settings.cwd;
            }
            if (typeof event.model === 'string' && event.model) model = event.model;
            const item = event.type === 'response_item' ? payload : event;
            if (item?.type === 'message') {
                recognized = true;
                messageCount++;
            }
            if (['tool_call', 'function_call', 'custom_tool_call'].includes(item?.type)) {
                recognized = true;
                const id = item.call_id ?? item.id;
                if (!id || !seenCalls.has(id)) {
                    const name = typeof item.name === 'string' ? item.name : 'unknown';
                    toolCalls[name] = (toolCalls[name] || 0) + 1;
                    if (id) seenCalls.add(id);
                }
            }
            if (event.type === 'event_msg' && payload?.type === 'token_count') {
                recognized = true;
                // Null info is a quota-only update, not a zero-usage observation.
                if (payload.info == null) continue;
                const cumulative = readUsage(payload.info.total_token_usage);
                if (!cumulative || sawLegacy) { issues++; continue; }
                const delta = zero();
                for (const key of usageKeys) delta[key] = cumulative[key] - previous[key];
                // A reset/out-of-order counter is ambiguous. Keep the known totals
                // and mark the whole valuation incomplete rather than invent spend.
                if (Object.values(delta).some(n => n < 0) || delta.cached > delta.input) { issues++; continue; }
                previous = cumulative;
                sawCumulative = true;
                hasUsage = true;
                if (Object.values(delta).some(n => n > 0)) addUsage(delta);
            } else if (event.usage != null) {
                recognized = true;
                const usage = readUsage(event.usage);
                if (!usage || sawCumulative) { issues++; continue; }
                sawLegacy = true;
                addUsage(usage);
            }
        }
    } finally {
        lines.close();
        stream.destroy();
    }
    if (!recognized) throw new Error('Unsupported Codex log format; no session imported.');
    let cost: number | null = hasUsage && issues === 0 ? 0 : null;
    for (const [usageModel, usage] of byModel) {
        const priced = calculateCost(usageModel, usage.input, usage.output, usage.cached, usage.writes);
        if (priced.costUsd === null) cost = null;
        else if (cost !== null) cost += priced.costUsd;
    }
    const primary = [...byModel.entries()].sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))[0]?.[0] ?? model;
    const toolCount = Object.values(toolCalls).reduce((sum, count) => sum + count, 0);
    insertSession({
        provider: 'openai',
        // Keep the existing identity to update imports rather than duplicating them.
        session_id: path.basename(filePath, '.jsonl'),
        project_path: cwd,
        project_name: cwd ? path.win32.basename(path.posix.basename(cwd)) : undefined,
        model_primary: primary,
        started_at: started ?? new Date(stat.birthtimeMs).toISOString(),
        ended_at: ended,
        duration_seconds: started && ended ? Math.max(0, Math.round((Date.parse(ended) - Date.parse(started)) / 1000)) : undefined,
        message_count: messageCount,
        input_tokens: totals.input,
        output_tokens: totals.output,
        cache_read_tokens: totals.cached,
        cache_write_tokens: totals.writes,
        estimated_cost_usd: cost,
        session_type: toolCount ? 'agentic' : 'interactive',
        tool_calls_json: JSON.stringify(toolCalls),
        raw_metadata_json: JSON.stringify({ parser: 'codex-v2', usage_observed: hasUsage, issue_count: issues, pricing_status: cost === null ? 'unpriced' : 'api-equivalent', models: [...byModel.keys()] }),
        file_path: filePath,
        file_modified_at: stat.mtimeMs
    });
    if (issues) throw new Error(`Codex session imported with partial data: ${issues} malformed or ambiguous usage record(s). Cost is unpriced.`);
    markFileParsed(filePath, 'codex', stat.mtimeMs, 'success');
};
