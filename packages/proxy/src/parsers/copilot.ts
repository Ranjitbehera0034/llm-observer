import fs from 'fs';
import path from 'path';
import os from 'os';
import { insertSession } from '@llm-observer/database';
import { calculateCost, estimateTokens, safeReadSQLite, findFilesRecursive, shouldParseFile, markFileParsed, getProviderForModel } from './utils';

const getCopilotDirs = (): string[] => {
    const home = os.homedir();
    let basePaths: string[] = [];
    if (process.platform === 'darwin') {
        basePaths = [path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage')];
    } else if (process.platform === 'linux') {
        basePaths = [path.join(home, '.config', 'Code', 'User', 'globalStorage')];
    } else if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        basePaths = [path.join(appData, 'Code', 'User', 'globalStorage')];
    }

    const dirs: string[] = [];
    for (const base of basePaths) {
        const ext1 = path.join(base, 'github.copilot');
        const ext2 = path.join(base, 'github.copilot-chat');
        if (fs.existsSync(ext1)) dirs.push(ext1);
        if (fs.existsSync(ext2)) dirs.push(ext2);
    }
    return dirs;
};

export const detector = (): boolean => {
    return getCopilotDirs().length > 0;
};

export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const dirs = getCopilotDirs();
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
            console.error(`[Copilot Parser] Failed to parse ${dbPath}:`, err);
            markFileParsed(dbPath, 'copilot', fs.statSync(dbPath).mtimeMs, 'error', String(err));
        }
    }
};

const parseSessionFile = async (filePath: string) => {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;
    
    if (!shouldParseFile(filePath, mtime)) return;

    const db = await safeReadSQLite(filePath);
    if (!db) return;

    try {
        let rows: any[] = [];
        try {
            rows = db.prepare("SELECT value FROM ItemTable WHERE key LIKE '%sessions%' OR key LIKE '%conversations%'").all();
        } catch(e) {
            return;
        }

        for (const row of rows) {
            let data: any;
            try { data = JSON.parse(row.value); } catch(e) { continue; }

            const sessions = data.sessions || data.conversations || [];
            if (!Array.isArray(sessions)) continue;

            for (const session of sessions) {
                const sessionId = session.sessionId || session.id;
                if (!sessionId) continue;

                let started_at: string | null = null;
                let ended_at: string | null = null;
                let estimatedTokens = 0;
                let messageCount = 0;
                
                const turns = session.turns || session.messages || [];
                if (!turns.length) continue;

                for (const turn of turns) {
                    const ts = turn.timestamp || turn.createdAt || null;
                    if (ts && !started_at) started_at = new Date(ts).toISOString();
                    if (ts) ended_at = new Date(ts).toISOString();

                    if (turn.request?.message) {
                        estimatedTokens += estimateTokens(turn.request.message);
                        messageCount++;
                    }
                    if (turn.response?.message) {
                        estimatedTokens += estimateTokens(turn.response.message);
                        messageCount++;
                    }
                }

                if (!started_at) started_at = new Date(stat.birthtimeMs).toISOString();

                // Divide equally into input and output for display purposes
                const finalInputTokens = Math.floor(estimatedTokens / 2);
                const finalOutputTokens = Math.ceil(estimatedTokens / 2);

                const primaryModel = session.turns?.[0]?.response?.model || 'gpt-4o'; // Copilot defaults
                const { costUsd } = calculateCost(primaryModel, finalInputTokens, finalOutputTokens);

                let durationSeconds = 0;
                if (started_at && ended_at) {
                    durationSeconds = Math.round((new Date(ended_at).getTime() - new Date(started_at).getTime()) / 1000);
                }
                if (durationSeconds < 0) durationSeconds = 0;

                insertSession({
                    provider: getProviderForModel(primaryModel),
                    tool: 'GitHub Copilot',
                    session_id: sessionId,
                    project_path: path.dirname(filePath),
                    project_name: 'vscode-workspace',
                    model_primary: primaryModel,
                    started_at,
                    ended_at: ended_at || undefined,
                    duration_seconds: durationSeconds,
                    message_count: messageCount,
                    input_tokens: finalInputTokens,
                    output_tokens: finalOutputTokens,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    estimated_cost_usd: costUsd,
                    is_estimated: 1, // ALways estimated
                    session_type: 'interactive',
                    tool_calls_json: JSON.stringify({}),
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

    markFileParsed(filePath, 'copilot', mtime, 'success');
};
