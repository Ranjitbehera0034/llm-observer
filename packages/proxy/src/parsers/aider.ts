import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { getParsedFile, upsertParsedFile, insertSession } from '@llm-observer/database';
import { createHash } from 'crypto';
import { calculateCost } from './utils';

const getAiderAnalyticsPath = () => {
    return path.join(os.homedir(), '.aider', 'analytics.jsonl');
};

export const detector = (): boolean => {
    return fs.existsSync(getAiderAnalyticsPath());
};

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
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        // Stable fallback identities prevent replaying old events as new sessions
        // whenever this append-only analytics file grows.
        let lineNumber = 0;
        // Aider analytics has explicit token counts and model info
        for await (const line of rl) {
            lineNumber++;
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                const sessionId = event.id || event.request_id || `aider-${createHash('sha256')
                    .update(JSON.stringify([filePath, lineNumber, line])).digest('hex')}`;
                
                const inputTokens = event.input_tokens || event.prompt_tokens || 0;
                const outputTokens = event.output_tokens || event.completion_tokens || 0;
                const model = event.model || 'unknown';

                // A source-reported zero is valid; missing or invalid cost is not.
                const reported = typeof event.cost === 'number' && Number.isFinite(event.cost) && event.cost >= 0;
                const hasTokens = (event.input_tokens ?? event.prompt_tokens) != null
                    && (event.output_tokens ?? event.completion_tokens) != null;
                const estimatedCost = reported ? event.cost : hasTokens
                    ? calculateCost(model, inputTokens, outputTokens).costUsd : null;

                insertSession({
                    provider: 'aider',
                    session_id: sessionId,
                    project_name: event.project_dir ? path.basename(event.project_dir) : 'unknown',
                    project_path: event.project_dir || null,
                    model_primary: model,
                    started_at: new Date(event.timestamp || stat.birthtimeMs).toISOString(),
                    ended_at: new Date(event.timestamp || stat.birthtimeMs).toISOString(),
                    duration_seconds: event.duration || 0,
                    message_count: 1, // Aider tracks requests/events individually usually
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    estimated_cost_usd: estimatedCost,
                    session_type: event.type === 'chat' ? 'interactive' : 'agentic',
                    has_subagents: false,
                    file_path: filePath,
                    file_modified_at: mtime
                });
            } catch (e) {
                // Ignore malformed lines
            }
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
