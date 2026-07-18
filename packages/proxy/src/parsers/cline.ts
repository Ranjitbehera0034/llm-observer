import fs from 'fs';
import path from 'path';
import os from 'os';
import { insertSession } from '@llm-observer/database';
import { calculateCost, findFilesRecursive, shouldParseFile, markFileParsed, getProviderForModel } from './utils';

const CLINE_EXTENSIONS = [
    'saoudrizwan.claude-dev',
    'rooveterinaryinc.roo-cline',
    'rooveterinaryinc.roo-code'
];

const getClineDirs = (): string[] => {
    const home = os.homedir();
    let basePaths: string[] = [];
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        basePaths = [path.join(appData, 'Code', 'User', 'globalStorage')];
    } else if (process.platform === 'darwin') {
        basePaths = [path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage')];
    } else {
        basePaths = [path.join(home, '.config', 'Code', 'User', 'globalStorage')];
    }

    const dirs: string[] = [];
    for (const base of basePaths) {
        for (const ext of CLINE_EXTENSIONS) {
            const dir = path.join(base, ext, 'tasks');
            if (fs.existsSync(dir)) dirs.push(dir);
        }
    }
    return dirs;
};

export const detector = (): boolean => {
    return getClineDirs().length > 0;
};

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const dirs = getClineDirs();
    if (dirs.length === 0) return;

    let historyFiles: string[] = [];
    for (const dir of dirs) {
        const files = findFilesRecursive(dir, /api_conversation_history\.json$/);
        historyFiles = historyFiles.concat(files);
    }

    const total = historyFiles.length;
    let current = 0;

    for (const filePath of historyFiles) {
        current++;
        if (onProgress) onProgress(current, total);
        
        try {
            await parseTaskFile(filePath);
        } catch (err) {
            console.error(`[Cline Parser] Failed to parse ${filePath}:`, err);
            markFileParsed(filePath, 'cline', fs.statSync(filePath).mtimeMs, 'error', String(err));
        }
    }
};

const parseTaskFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    if (!shouldParseFile(filePath, mtime)) return;

    // Deduplication key is the task directory name
    const taskDirName = path.basename(path.dirname(filePath));
    const sessionId = taskDirName.startsWith('task-') ? taskDirName : `task-${taskDirName}`;

    let toolDisplay = 'Cline';
    if (filePath.includes('roo-cline') || filePath.includes('roo-code')) {
        toolDisplay = 'Roo Code';
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    let messages: any[];
    try {
        messages = JSON.parse(rawData);
    } catch(e) {
        return; // Empty or invalid json
    }
    
    if (!Array.isArray(messages) || messages.length === 0) return;

    let started_at = new Date(stat.birthtimeMs).toISOString(); // Fallback
    const firstMsg = messages[0];
    if (firstMsg && firstMsg.timestamp) {
        started_at = new Date(firstMsg.timestamp).toISOString();
    }
    const lastMsg = messages[messages.length - 1];
    let ended_at = new Date(stat.mtimeMs).toISOString();
    if (lastMsg && lastMsg.timestamp) {
        ended_at = new Date(lastMsg.timestamp).toISOString();
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreateTokens = 0;
    let toolCalls: Record<string, number> = {};
    const modelCounts: Record<string, number> = {};
    let hasMessages = false;

    for (const msg of messages) {
        if (msg.role !== 'assistant') continue;
        hasMessages = true;

        if (msg.model) modelCounts[msg.model] = (modelCounts[msg.model] || 0) + 1;
        
        if (msg.usage) {
            inputTokens += msg.usage.input_tokens || 0;
            outputTokens += msg.usage.output_tokens || 0;
            cacheReadTokens += msg.usage.cache_read_input_tokens || 0;
            cacheCreateTokens += msg.usage.cache_creation_input_tokens || 0;
        }
        
        if (msg.tool_use && Array.isArray(msg.tool_use)) {
            for (const tUse of msg.tool_use) {
                const toolName = tUse.name || 'unknown';
                toolCalls[toolName] = (toolCalls[toolName] || 0) + 1;
            }
        }
    }

    if (!hasMessages) return; // Ignore sessions with zero assistant messages

    let primaryModel = 'claude-3-5-sonnet-20241022';
    let maxCount = 0;
    for (const [model, count] of Object.entries(modelCounts)) {
        if (count > maxCount) {
            maxCount = count;
            primaryModel = model;
        }
    }

    const { costUsd, isEstimated } = calculateCost(
        primaryModel, 
        inputTokens, 
        outputTokens,
        cacheReadTokens,
        cacheCreateTokens
    );

    let durationSeconds = 0;
    if (started_at && ended_at) {
        durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
    }
    if (durationSeconds < 0) durationSeconds = 0;

    const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
    const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

    insertSession({
        provider: getProviderForModel(primaryModel),
        tool: toolDisplay,
        session_id: sessionId,
        project_path: path.dirname(path.dirname(filePath)),
        project_name: 'cline-task', 
        model_primary: primaryModel,
        started_at,
        ended_at,
        duration_seconds: durationSeconds,
        message_count: messages.length,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheCreateTokens,
        estimated_cost_usd: costUsd,
        is_estimated: isEstimated ? 1 : 0,
        session_type: sessionType,
        tool_calls_json: JSON.stringify(toolCalls),
        has_subagents: false,
        subagent_count: 0,
        file_path: filePath,
        file_modified_at: mtime,
        parent_cost_usd: costUsd
    } as any);

    markFileParsed(filePath, 'cline', mtime, 'success');
};
