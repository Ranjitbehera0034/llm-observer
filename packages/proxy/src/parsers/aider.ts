import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { getParsedFile, upsertParsedFile, insertSession } from '@llm-observer/database';
import { randomUUID } from 'crypto';
import { getPricingForModel } from '@llm-observer/database';

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
    if (registryEntry && registryEntry.last_modified_at >= mtime) {
        return; // Unchanged
    }

    try {
        if (onProgress) onProgress(0, 1);
        
        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        // Aider analytics has explicit token counts and model info
        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                const sessionId = event.id || event.request_id || randomUUID();
                
                const inputTokens = event.input_tokens || event.prompt_tokens || 0;
                const outputTokens = event.output_tokens || event.completion_tokens || 0;
                const model = event.model || 'unknown';

                let estimatedCost = event.cost || 0;

                // Fallback cost calc if aider doesn't provide it
                if (!estimatedCost && model !== 'unknown') {
                    // map common models to provider to fetch pricing
                    let provider = 'openai';
                    if (model.includes('claude')) provider = 'anthropic';
                    if (model.includes('gemini')) provider = 'google';
                    if (model.includes('mistral')) provider = 'mistral';
                    
                    const pricing = getPricingForModel(provider, model);
                    if (pricing) {
                        estimatedCost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
                    }
                }

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
