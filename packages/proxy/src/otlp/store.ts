import { getDb } from '@llm-observer/database';
import type { UsageRecord } from './mapper';

/**
 * Writes OTLP usage to the database without ever double counting.
 *
 * - Every usage record lands in the otlp_usage ledger under a key that is the same each time the same
 *   data is delivered (see mapper.ts), so a redelivered export changes nothing.
 * - The session row is REBUILT from the ledger after each write, never incremented.
 * - When a session has per-request events, the events are the source of truth and the counter metrics
 *   (which report the same requests) are ignored for that session; otherwise the counters are used.
 * - A session that the log parser has stored (sessions.source = 'log') is never touched, and its ledger
 *   rows are dropped: the parser reads the complete file and is the better source. The parser's own
 *   upsert (insertSession) takes an 'otlp' row over by resetting source to 'log'.
 */

const PROVIDER = 'claude-code';
const TOOL_NAME = 'Claude Code';
// Telemetry carries no project path (and workspace paths are deliberately not read); the log parser
// replaces this with the real project when it later sees the session's file.
const PROJECT_LABEL = '(OpenTelemetry)';

export interface IngestResult {
    /** Records written to (or already in) the ledger. */
    accepted: number;
    /** Records dropped because the log parser already owns their session. */
    skippedLogSessions: number;
    sessionsUpdated: number;
}

export function ingestUsage(records: UsageRecord[]): IngestResult {
    const result: IngestResult = { accepted: 0, skippedLogSessions: 0, sessionsUpdated: 0 };
    if (records.length === 0) return result;
    const db = getDb();

    const sourceOf = db.prepare('SELECT source FROM sessions WHERE provider = ? AND session_id = ?');
    const dropLedger = db.prepare('DELETE FROM otlp_usage WHERE session_id = ?');
    const insertSum = db.prepare(`
        INSERT OR IGNORE INTO otlp_usage
          (session_id, kind, dedupe_key, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, started_at, occurred_at)
        VALUES (@sessionId, @kind, @key, @model, @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd, @startedAt, @occurredAt)`);
    // Cumulative counters: the series only grows, so keep the largest value seen (an older export that
    // arrives late can never lower the total).
    const upsertMax = db.prepare(`
        INSERT INTO otlp_usage
          (session_id, kind, dedupe_key, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, started_at, occurred_at)
        VALUES (@sessionId, @kind, @key, @model, @inputTokens, @outputTokens, @cacheReadTokens, @cacheWriteTokens, @costUsd, @startedAt, @occurredAt)
        ON CONFLICT(session_id, kind, dedupe_key) DO UPDATE SET
          input_tokens = MAX(input_tokens, excluded.input_tokens),
          output_tokens = MAX(output_tokens, excluded.output_tokens),
          cache_read_tokens = MAX(cache_read_tokens, excluded.cache_read_tokens),
          cache_write_tokens = MAX(cache_write_tokens, excluded.cache_write_tokens),
          cost_usd = CASE WHEN cost_usd IS NULL THEN excluded.cost_usd
                          WHEN excluded.cost_usd IS NULL THEN cost_usd
                          ELSE MAX(cost_usd, excluded.cost_usd) END,
          occurred_at = MAX(occurred_at, excluded.occurred_at)`);

    db.transaction(() => {
        const touched = new Set<string>();
        const owned = new Map<string, boolean>(); // session id -> may the receiver write it?

        for (const r of records) {
            let mine = owned.get(r.sessionId);
            if (mine === undefined) {
                const row = sourceOf.get(PROVIDER, r.sessionId) as { source: string } | undefined;
                mine = !row || row.source === 'otlp';
                owned.set(r.sessionId, mine);
                if (!mine) dropLedger.run(r.sessionId);
            }
            if (!mine) { result.skippedLogSessions++; continue; }

            (r.accumulate === 'max' ? upsertMax : insertSum).run(r);
            result.accepted++;
            touched.add(r.sessionId);
        }

        for (const id of touched) {
            if (rebuildSession(id)) result.sessionsUpdated++;
        }
    })();
    return result;
}

interface Aggregate {
    n: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number | null;
    nullCost: number;
    costRows: number;
    startedAt: string;
    endedAt: string;
}

/** Recompute one session row from its ledger rows. Returns false if the row belongs to the log parser. */
function rebuildSession(sessionId: string): boolean {
    const db = getDb();
    const hasEvents = (db.prepare(`SELECT 1 FROM otlp_usage WHERE session_id = ? AND kind = 'event' LIMIT 1`).get(sessionId)) !== undefined;
    const kind = hasEvents ? 'event' : 'metric';

    const a = db.prepare(`
        SELECT COUNT(*) AS n,
               COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
               COALESCE(SUM(cache_read_tokens), 0) AS cacheRead, COALESCE(SUM(cache_write_tokens), 0) AS cacheWrite,
               SUM(cost_usd) AS cost, COALESCE(SUM(cost_usd IS NULL), 0) AS nullCost, COALESCE(SUM(cost_usd IS NOT NULL), 0) AS costRows,
               MIN(started_at) AS startedAt, MAX(occurred_at) AS endedAt
        FROM otlp_usage WHERE session_id = ? AND kind = ?`).get(sessionId, kind) as Aggregate;
    if (a.n === 0) return false;

    const topModel = db.prepare(`
        SELECT model FROM otlp_usage WHERE session_id = ? AND kind = ? AND model IS NOT NULL
        GROUP BY model ORDER BY SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC, model LIMIT 1`).get(sessionId, kind) as { model: string } | undefined;

    const totalTokens = a.input + a.output + a.cacheRead + a.cacheWrite;
    // Events: every request must carry a cost. Counters: cost arrives as its own series.
    const unpriced = totalTokens > 0 && (hasEvents ? a.nullCost > 0 : a.costRows === 0);
    const cost = a.cost ?? 0;
    const durationSeconds = Math.max(0, Math.round((Date.parse(a.endedAt) - Date.parse(a.startedAt)) / 1000)) || 0;
    const hitRate = a.cacheRead + a.input > 0 ? a.cacheRead / (a.cacheRead + a.input) : 0;

    const info = db.prepare(`
        INSERT INTO sessions (
          provider, session_id, project_name, model_primary, started_at, ended_at, duration_seconds, message_count,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cache_hit_rate, estimated_cost_usd,
          tool_calls_json, parent_cost_usd, tool, is_estimated, cost_source, source
        ) VALUES (
          @provider, @sessionId, @project, @model, @startedAt, @endedAt, @duration, @messages,
          @input, @output, @cacheRead, @cacheWrite, @hitRate, @cost,
          '{}', @cost, @tool, @isEstimated, @costSource, 'otlp'
        )
        ON CONFLICT(provider, session_id) DO UPDATE SET
          model_primary = excluded.model_primary, started_at = excluded.started_at, ended_at = excluded.ended_at,
          duration_seconds = excluded.duration_seconds, message_count = excluded.message_count,
          input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
          cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
          cache_hit_rate = excluded.cache_hit_rate, estimated_cost_usd = excluded.estimated_cost_usd,
          parent_cost_usd = excluded.parent_cost_usd, is_estimated = excluded.is_estimated, cost_source = excluded.cost_source
        WHERE sessions.source = 'otlp'`).run({
        provider: PROVIDER, sessionId, project: PROJECT_LABEL, model: topModel?.model ?? null,
        startedAt: a.startedAt, endedAt: a.endedAt, duration: durationSeconds, messages: hasEvents ? a.n : 0,
        input: a.input, output: a.output, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite, hitRate, cost,
        tool: TOOL_NAME, isEstimated: unpriced ? 1 : 0, costSource: unpriced ? 'unpriced' : 'reported',
    });
    return info.changes > 0;
}
