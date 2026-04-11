import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { insertSession } from '@llm-observer/database';
import { calculateCost, estimateTokens, findFilesRecursive, shouldParseFile, markFileParsed, getProviderForModel } from './utils';

const getCodexDir = () => {
    const home = os.homedir();
    if (process.platform === 'win32') {
        return path.join(process.env.USERPROFILE || home, '.codex', 'sessions');
    }
    return path.join(home, '.codex', 'sessions');
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

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    if (!shouldParseFile(filePath, mtime)) return;

    const fileName = path.basename(filePath, '.jsonl');
    const sessionId = fileName;

    let started_at: string | null = null;
    let ended_at: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let messageCount = 0;
    let estimatedTokensFromLength = 0;
    let hasExplicitTokens = false;
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
            
            if (event.type === 'message') messageCount++;
            
            if (!started_at && event.timestamp) started_at = new Date(event.timestamp).toISOString();
            if (event.timestamp) ended_at = new Date(event.timestamp).toISOString();

            if (event.model) modelCounts[event.model] = (modelCounts[event.model] || 0) + 1;

            if (event.usage && (event.usage.input_tokens !== undefined || event.usage.output_tokens !== undefined)) {
                hasExplicitTokens = true;
                inputTokens += event.usage.input_tokens || 0;
                outputTokens += event.usage.output_tokens || 0;
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

    if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();

    let durationSeconds = 0;
    if (started_at && ended_at) {
        durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
    }

    let primaryModel = 'codex-mini';
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryModel = model;
        }
    }

    let finalInputTokens = inputTokens;
    let finalOutputTokens = outputTokens;
    let isEstimated = !hasExplicitTokens;
    
    if (isEstimated && messageCount > 0) {
        finalInputTokens = Math.floor(estimatedTokensFromLength / 2);
        finalOutputTokens = Math.ceil(estimatedTokensFromLength / 2);
    }

    const { costUsd, isEstimated: costIsEstimated } = calculateCost(
        primaryModel, 
        finalInputTokens, 
        finalOutputTokens
    );

    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    insertSession({
        provider: getProviderForModel(primaryModel),
        tool: 'OpenAI Codex CLI',
        session_id: sessionId,
        project_path: path.dirname(filePath), 
        project_name: 'codex-session', 
        model_primary: primaryModel,
        started_at,
        ended_at: ended_at || undefined,
        duration_seconds: durationSeconds,
        message_count: messageCount,
        input_tokens: finalInputTokens,
        output_tokens: finalOutputTokens,
        estimated_cost_usd: costUsd,
        is_estimated: isEstimated || costIsEstimated ? 1 : 0,
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: false,
        subagent_count: 0,
        file_path: filePath,
        file_modified_at: mtime,
        parent_cost_usd: costUsd
    } as any);

    markFileParsed(filePath, 'codex', mtime, 'success');
};
