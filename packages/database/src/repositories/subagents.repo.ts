import { getDb } from '../db';

export interface SubagentRecord {
  id?: number;
  parent_session_id: number;
  agent_id: string; // UUID
  agent_type?: string; // explore, plan, execute, validate, general
  model?: string;
  started_at: string;
  ended_at?: string;
  duration_seconds?: number;
  message_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  estimated_cost_usd?: number;
  tool_calls_json?: string;
  file_path?: string;
  created_at?: string;
}

export const insertSubagent = (agent: SubagentRecord): number => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO subagents (
      parent_session_id, agent_id, agent_type, model,
      started_at, ended_at, duration_seconds, message_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      estimated_cost_usd, tool_calls_json, file_path
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(parent_session_id, agent_id) DO UPDATE SET
      agent_type = excluded.agent_type,
      model = excluded.model,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      message_count = excluded.message_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      tool_calls_json = excluded.tool_calls_json,
      file_path = excluded.file_path
  `);

  const info = stmt.run(
    agent.parent_session_id,
    agent.agent_id,
    agent.agent_type || 'general',
    agent.model || null,
    agent.started_at,
    agent.ended_at || null,
    agent.duration_seconds || 0,
    agent.message_count || 0,
    agent.input_tokens || 0,
    agent.output_tokens || 0,
    agent.cache_read_tokens || 0,
    agent.cache_write_tokens || 0,
    agent.estimated_cost_usd || 0,
    agent.tool_calls_json || '{}',
    agent.file_path || null
  );

  return info.lastInsertRowid as number;
};

export const getSubagentsBySession = (parentSessionId: number | string): SubagentRecord[] => {
  const db = getDb();
  return db.prepare('SELECT * FROM subagents WHERE parent_session_id = ? ORDER BY started_at ASC').all(parentSessionId) as SubagentRecord[];
};

export const getAgentSummary = (days: number = 30) => {
  const db = getDb();
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString();

  const total = db.prepare(`
    SELECT 
      COUNT(*) as total_agents,
      SUM(estimated_cost_usd) as total_cost,
      AVG(estimated_cost_usd) as avg_cost
    FROM subagents
    WHERE started_at >= ?
  `).get(dateStr) as any;

  const typeBreakdown = db.prepare(`
    SELECT agent_type as type, COUNT(*) as count, SUM(estimated_cost_usd) as total_cost
    FROM subagents
    WHERE started_at >= ?
    GROUP BY agent_type
    ORDER BY total_cost DESC
  `).all(dateStr) as any[];

  const topAgents = db.prepare(`
    SELECT s.agent_id, s.agent_type, s.estimated_cost_usd, p.project_name
    FROM subagents s
    JOIN sessions p ON s.parent_session_id = p.id
    WHERE s.started_at >= ?
    ORDER BY s.estimated_cost_usd DESC
    LIMIT 10
  `).all(dateStr) as any[];

  return {
    total_agents: total.total_agents || 0,
    total_cost: total.total_cost || 0,
    avg_cost: total.avg_cost || 0,
    type_breakdown: typeBreakdown.map(tb => ({
      ...tb,
      avg_cost: tb.count > 0 ? tb.total_cost / tb.count : 0
    })),
    top_agents: topAgents
  };
};
