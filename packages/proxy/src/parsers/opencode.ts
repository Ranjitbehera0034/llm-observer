import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { getParsedFile, upsertParsedFile, insertSession } from '@llm-observer/database';
import { getProviderForModel } from './utils';

const getOpencodeDbPath = () => {
    return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
};

interface OpencodeModelRef {
    id?: string;
    providerID?: string;
    variant?: string;
}

interface OpencodeSessionRow {
    id: string;
    directory: string | null;
    title: string | null;
    model: string | null;
    cost: number | null;
    tokens_input: number | null;
    tokens_output: number | null;
    tokens_reasoning: number | null;
    tokens_cache_read: number | null;
    tokens_cache_write: number | null;
    time_created: number | null;
    time_updated: number | null;
    parent_id: string | null;
    agent: string | null;
}

const parseModelRef = (raw: string | null): OpencodeModelRef => {
    if (!raw) return {};
    try {
        return JSON.parse(raw) as OpencodeModelRef;
    } catch {
        return { id: raw };
    }
};

const providerForOpencodeProviderID = (providerID: string | undefined, modelId: string | undefined): string => {
    const pid = (providerID || '').toLowerCase();
    const mid = (modelId || '').toLowerCase();

    if (pid.includes('anthropic') || mid.includes('claude')) return 'anthropic';
    if (pid.includes('openai') || mid.includes('gpt') || mid.includes('o1') || mid.includes('o3') || mid.includes('o4') || mid.includes('codex')) return 'openai';
    if (pid.includes('google') || mid.includes('gemini')) return 'google';
    if (pid.includes('mistral') || mid.includes('mixtral')) return 'mistral';
    if (pid.includes('groq') || mid.includes('llama')) return 'groq';
    if (pid.includes('xai') || mid.includes('grok')) return 'xai';
    if (pid.includes('deepseek')) return 'deepseek';
    if (pid.includes('moonshot') || mid.includes('kimi')) return 'moonshot';
    if (pid.includes('zhipu') || mid.includes('glm')) return 'zhipu';
    if (pid.includes('qwen') || pid.includes('alibaba') || mid.includes('qwen')) return 'qwen';

    // Fall back to the generic model-name heuristic from utils.
    return getProviderForModel(modelId || '');
};

const isoFromMs = (ms: number | null): string | null => {
    if (!ms || !Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
};

export const detector = (): boolean => {
    return fs.existsSync(getOpencodeDbPath());
};

/* PRIVACY RULE: This parser extracts ONLY metadata (token counts, duration, project path). It MUST NOT extract or store prompt text or raw conversational content to preserve developer privacy. */
export const parse = async (onProgress?: (current: number, total: number) => void): Promise<void> => {
    const dbPath = getOpencodeDbPath();
    if (!fs.existsSync(dbPath)) return;

    const stat = fs.statSync(dbPath);
    const mtime = stat.mtimeMs;

    const registryEntry = getParsedFile(dbPath);
    if (registryEntry && registryEntry.last_modified_at >= mtime) {
        return;
    }

    let db: Database.Database | null = null;
    try {
        if (onProgress) onProgress(0, 1);

        db = new Database(dbPath, { readonly: true, fileMustExist: true });

        // Verify the expected schema before we touch it — opencode's DB layout
        // is private and could change between releases.
        const tableRow = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session'")
            .get() as { name: string } | undefined;
        if (!tableRow) {
            console.warn(`[OpenCode Parser] No 'session' table in ${dbPath}; skipping.`);
            return;
        }

        const rows = db
            .prepare(
                `SELECT id, directory, title, model, cost,
                        tokens_input, tokens_output, tokens_reasoning,
                        tokens_cache_read, tokens_cache_write,
                        time_created, time_updated, parent_id, agent
                   FROM session
                  WHERE time_updated IS NOT NULL
                  ORDER BY time_created ASC`
            )
            .all() as OpencodeSessionRow[];

        if (rows.length === 0) {
            upsertParsedFile({
                file_path: dbPath,
                provider: 'opencode',
                last_modified_at: mtime,
                last_parsed_at: new Date().toISOString(),
                status: 'success',
            });
            if (onProgress) onProgress(1, 1);
            return;
        }

        // Count subagent children per parent session in a single pass.
        const childCount = new Map<string, number>();
        for (const row of rows) {
            if (row.parent_id) {
                childCount.set(row.parent_id, (childCount.get(row.parent_id) || 0) + 1);
            }
        }

        let processed = 0;
        for (const row of rows) {
            const ref = parseModelRef(row.model);
            const provider = providerForOpencodeProviderID(ref.providerID, ref.id);
            const modelDisplay = ref.id
                ? `${ref.id}${ref.variant ? ` (${ref.variant})` : ''}`
                : 'unknown';

            const inputTokens = row.tokens_input || 0;
            const outputTokens = (row.tokens_output || 0) + (row.tokens_reasoning || 0);
            const cacheRead = row.tokens_cache_read || 0;
            const cacheWrite = row.tokens_cache_write || 0;
            const cacheHitRate =
                cacheRead + inputTokens > 0 ? cacheRead / (cacheRead + inputTokens) : 0;
            const durationSeconds =
                row.time_updated && row.time_created
                    ? Math.max(0, Math.round((row.time_updated - row.time_created) / 1000))
                    : 0;

            const sessionType = row.agent === 'build' ? 'agentic' : 'interactive';
            const children = childCount.get(row.id) || 0;

            insertSession({
                provider,
                session_id: row.id,
                project_path: row.directory || undefined,
                project_name: row.directory ? path.basename(row.directory) : undefined,
                model_primary: modelDisplay,
                started_at: isoFromMs(row.time_created) || new Date(mtime).toISOString(),
                ended_at: isoFromMs(row.time_updated) || undefined,
                duration_seconds: durationSeconds,
                message_count: 0,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_read_tokens: cacheRead,
                cache_write_tokens: cacheWrite,
                cache_hit_rate: cacheHitRate,
                estimated_cost_usd: row.cost || 0,
                session_type: sessionType,
                tool_calls_json: '{}',
                has_subagents: children > 0,
                subagent_count: children,
                raw_metadata_json: JSON.stringify({
                    title: row.title,
                    agent: row.agent,
                    parent_id: row.parent_id,
                    model_json: row.model,
                }),
                parent_cost_usd: row.cost || 0,
                file_path: dbPath,
                file_modified_at: mtime,
            });

            processed++;
        }

        upsertParsedFile({
            file_path: dbPath,
            provider: 'opencode',
            last_modified_at: mtime,
            last_parsed_at: new Date().toISOString(),
            status: 'success',
        });

        console.log(`[OpenCode Parser] Synced ${processed} sessions from ${dbPath}`);
        if (onProgress) onProgress(1, 1);
    } catch (err: any) {
        if (err && err.code === 'SQLITE_BUSY') {
            console.warn('[OpenCode Parser] Database is locked (SQLITE_BUSY). Will retry next pass.');
            return;
        }
        console.error(`[OpenCode Parser] Failed to parse ${dbPath}:`, err);
        try {
            upsertParsedFile({
                file_path: dbPath,
                provider: 'opencode',
                last_modified_at: mtime,
                last_parsed_at: new Date().toISOString(),
                status: 'error',
                error_message: String(err),
            });
        } catch (e) {
            // ignore
        }
    } finally {
        if (db) db.close();
    }
};
