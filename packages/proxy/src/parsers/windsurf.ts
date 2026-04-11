import fs from 'fs';
import path from 'path';
import os from 'os';
import { insertSession } from '@llm-observer/database';
import { calculateCost, safeReadSQLite, findFilesRecursive, shouldParseFile, markFileParsed, getProviderForModel } from './utils';

const getWindsurfDirs = (): string[] => {
    const home = os.homedir();
    let basePaths: string[] = [];
    if (process.platform === 'win32') {
        basePaths = [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Windsurf', 'User')];
    } else if (process.platform === 'darwin') {
        basePaths = [path.join(home, 'Library', 'Application Support', 'Windsurf', 'User')];
    } else {
        basePaths = [path.join(home, '.config', 'Windsurf', 'User')];
    }

    const dirs: string[] = [];
    for (const base of basePaths) {
        const globalStorage = path.join(base, 'globalStorage');
        const workspaceStorage = path.join(base, 'workspaceStorage');
        if (fs.existsSync(globalStorage)) dirs.push(globalStorage);
        if (fs.existsSync(workspaceStorage)) dirs.push(workspaceStorage);
    }
    return dirs;
};

export const detector = (): boolean => {
    return getWindsurfDirs().length > 0;
};

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const dirs = getWindsurfDirs();
    if (dirs.length === 0) return;

    let dbPaths: string[] = [];
    for (const dir of dirs) {
        const files = findFilesRecursive(dir, /state\.vscdb$/);
        dbPaths = dbPaths.concat(files);
    }

    const total = dbPaths.length;
    let current = 0;

    for (const dbPath of dbPaths) {
        current++;
        if (onProgress) onProgress(current, total);
        
        try {
            await parseSessionFile(dbPath);
        } catch (err) {
            console.error(`[Windsurf Parser] Failed to parse ${dbPath}:`, err);
            markFileParsed(dbPath, 'windsurf', fs.statSync(dbPath).mtimeMs, 'error', String(err));
        }
    }
};

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    if (!shouldParseFile(filePath, mtime)) return;

    const db = await safeReadSQLite(filePath);
    if (!db) return; // SQLite lock persistence handled silently

    try {
        let rows: any[] = [];
        try {
            rows = db.prepare("SELECT value FROM ItemTable WHERE key LIKE '%conversations%' OR key LIKE '%sessions%'").all();
        } catch(e) {
            return;
        }

        for (const row of rows) {
            let data: any;
            try { data = JSON.parse(row.value); } catch(e) { continue; }

            const conversations = data.conversations || data.sessions || [];
            if (!Array.isArray(conversations)) continue;

            for (const conv of conversations) {
                const sessionId = conv.id || conv.sessionId;
                if (!sessionId) continue;

                let started_at: string | null = null;
                let ended_at: string | null = null;
                let inputTokens = 0;
                let outputTokens = 0;
                let cacheReadTokens = 0;
                let cacheCreateTokens = 0;
                let toolCalls: Record<string, number> = {};
                const modelCounts: Record<string, number> = {};

                const messages = conv.messages || conv.turns || [];
                if (!messages.length) continue;

                let hasMessages = false;
                for (const msg of messages) {
                    const ts = msg.timestamp || (msg.request?.timestamp) || null;
                    if (ts && !started_at) started_at = new Date(ts).toISOString();
                    if (ts) ended_at = new Date(ts).toISOString();

                    const role = msg.role || (msg.agent?.role);
                    if (role === 'assistant' || role === 'system') hasMessages = true;

                    const model = msg.model || (msg.response?.model);
                    if (model) modelCounts[model] = (modelCounts[model] || 0) + 1;

                    const usage = msg.usage || (msg.response?.usage);
                    if (usage) {
                        inputTokens += usage.input_tokens || 0;
                        outputTokens += usage.output_tokens || 0;
                        cacheReadTokens += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
                        cacheCreateTokens += usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
                    }

                    const tCalls = msg.tool_calls || (msg.response?.tool_calls);
                    if (tCalls && Array.isArray(tCalls)) {
                        for (const t of tCalls) {
                            const name = t.name || 'unknown';
                            toolCalls[name] = (toolCalls[name] || 0) + 1;
                        }
                    }
                }

                if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();

                let primaryModel = 'claude-3-5-sonnet-20241022';
                let maxCount = 0;
                for (const [model, count] of Object.entries(modelCounts)) {
                    if (count > maxCount) { maxCount = count; primaryModel = model; }
                }

                const { costUsd, isEstimated } = calculateCost(
                    primaryModel, 
                    inputTokens, 
                    outputTokens, 
                    cacheReadTokens, 
                    cacheCreateTokens
                );

                const provider = getProviderForModel(primaryModel);

                let durationSeconds = 0;
                if (started_at && ended_at) {
                    durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
                }
                if (durationSeconds < 0) durationSeconds = 0;

                const toolCallCount = Object.values(toolCalls).reduce((a, b) => a + b, 0);
                const sessionType = toolCallCount > 0 ? 'agentic' : 'interactive';

                insertSession({
                    provider: provider,
                    tool: 'Windsurf',
                    session_id: sessionId,
                    project_path: path.dirname(filePath),
                    project_name: 'windsurf-workspace',
                    model_primary: primaryModel,
                    started_at,
                    ended_at: ended_at || undefined,
                    duration_seconds: durationSeconds,
                    message_count: messages.length,
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    cache_read_tokens: cacheReadTokens,
                    cache_write_tokens: cacheCreateTokens,
                    estimated_cost_usd: costUsd,
                    is_estimated: isEstimated || (inputTokens === 0 && outputTokens === 0) ? 1 : 0,
                    session_type: sessionType,
                    tool_calls_json: JSON.stringify(toolCalls),
                    has_subagents: false,
                    subagent_count: 0,
                    file_path: filePath,
                    file_modified_at: mtime,
                    parent_cost_usd: costUsd
                } as any);
            }
        }
    } finally {
        db.close();
    }

    markFileParsed(filePath, 'windsurf', mtime, 'success');
};
