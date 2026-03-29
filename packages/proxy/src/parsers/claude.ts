import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { getParsedFile, upsertParsedFile, insertSession } from '@llm-observer/database';
import { getPricingForModel } from '@llm-observer/database';

const getClaudeDir = () => {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(home, '.claude', 'projects');
    }
    return path.join(home, '.claude', 'projects');
};

export const detector = (): boolean => {
    return fs.existsSync(getClaudeDir());
};

const findFilesRecursive = (dir: string, pattern: RegExp): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(findFilesRecursive(filePath, pattern));
        } else if (pattern.test(filePath)) {
            results.push(filePath);
        }
    }
    return results;
};

/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, tool counts). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const claudeDir = getClaudeDir();
    if (!fs.existsSync(claudeDir)) return;

    // Find all JSONL files
    const jsonlFiles = findFilesRecursive(claudeDir, /\.jsonl$/);
    const total = jsonlFiles.length;
    let current = 0;
    
    for (const filePath of jsonlFiles) {
        current++;
        if (onProgress) onProgress(current, total);
        
        try {
            await parseSessionFile(filePath);
        } catch (err) {
            console.error(`[Claude Parser] Failed to parse ${filePath}:`, err);
            upsertParsedFile({
                file_path: filePath,
                provider: 'claude-code',
                last_modified_at: fs.statSync(filePath).mtimeMs,
                last_parsed_at: new Date().toISOString(),
                status: 'error',
                error_message: String(err)
            });
        }
    }
};

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    const registryEntry = getParsedFile(filePath);
    if (registryEntry && registryEntry.last_modified_at >= mtime) {
        // Skip unchanged file
        return;
    }

    // Determine basic session details from path
    const isSubagent = filePath.includes('subagents');
    const fileName = path.basename(filePath, '.jsonl');
    const sessionId = fileName; // 'agent-123' or 'UUID'
    
    // The project hash is the parent dir (if main session) or parent of parent (if subagent)
    const dirSegments = filePath.split(path.sep);
    const projectHash = isSubagent ? dirSegments[dirSegments.length - 3] : dirSegments[dirSegments.length - 2];
    
    // Read the file line by line
    let started_at: string | null = null;
    let ended_at: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let messageCount = 0;
    let toolCalls: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};

    const rl = readline.createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            messageCount++;
            
            if (!started_at && event.timestamp) {
                started_at = new Date(event.timestamp).toISOString();
            }
            if (event.timestamp) {
                ended_at = new Date(event.timestamp).toISOString();
            }

            if (event.model) {
                modelCounts[event.model] = (modelCounts[event.model] || 0) + 1;
            }

            // Usage extraction
            if (event.usage) {
                inputTokens += event.usage.input_tokens || event.usage.prompt_tokens || 0;
                outputTokens += event.usage.output_tokens || event.usage.completion_tokens || 0;
                cacheReadTokens += event.usage.cache_read_tokens || event.usage.cache_creation_input_tokens || 0; // fallback matching logic
                cacheWriteTokens += event.usage.cache_creation_tokens || 0;
            }

            // Tool extraction
            if (event.type === 'tool_use' || (event.message && event.message.tool_calls)) {
                // If it's a direct tool_use event from Claude Code
                const toolName = event.name || event.tool_name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            } else if (event.content && Array.isArray(event.content)) {
                 for (const block of event.content) {
                     if (block.type === 'tool_use') {
                         const toolName = block.name || 'unknown';
                         toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
                     }
                 }
            }

        } catch (e) {
            // Skip malformed line
        }
    }

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();
    
    // Duration
    let durationSeconds = 0;
    if (started_at && ended_at) {
        durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
    }

    // Determine primary model
    let primaryModel = '';
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryModel = model;
        }
    }

    // Determine estimated cost
    let estimatedCost = 0;
    if (primaryModel) {
        // We use 'anthropic' as provider since it's claude-code
        const pricing = getPricingForModel('anthropic', primaryModel);
        if (pricing) {
            const inputCost = (inputTokens / 1_000_000) * pricing.input;
            const outputCost = (outputTokens / 1_000_000) * pricing.output;
            const cacheCost = pricing.cached ? (cacheReadTokens / 1_000_000) * pricing.cached : 0;
            estimatedCost = inputCost + outputCost + cacheCost;
        }
    }

    // Determine session type
    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    const cacheHitRate = cacheReadTokens + inputTokens > 0 ? cacheReadTokens / (cacheReadTokens + inputTokens) : 0;

    // Subagent counting
    let subagentCount = 0;
    let hasSubagents = false;
    if (!isSubagent) {
        const subagentsDir = path.join(path.dirname(filePath), 'subagents');
        if (fs.existsSync(subagentsDir)) {
            const list = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
            subagentCount = list.length;
            hasSubagents = subagentCount > 0;
        }
    }

    insertSession({
        provider: 'claude-code',
        session_id: sessionId,
        project_path: projectHash, 
        project_name: projectHash, // we use hash as name since actual path isn't exposed in standard jsonl filename unless inside the JSON
        model_primary: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: durationSeconds,
        message_count: messageCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_hit_rate: cacheHitRate,
        estimated_cost_usd: estimatedCost,
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: hasSubagents,
        subagent_count: subagentCount,
        file_path: filePath,
        file_modified_at: mtime
    });

    upsertParsedFile({
        file_path: filePath,
        provider: 'claude-code',
        last_modified_at: mtime,
        last_parsed_at: new Date().toISOString(),
        status: 'success'
    });
};
