import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface SessionRecord {
  id?: number;
  provider: string; // 'claude-code', 'cursor', 'aider'
  session_id: string;
  project_path?: string;
  project_name?: string;
  model_primary?: string;
  started_at: string; // ISO 8601
  ended_at?: string; // ISO 8601
  duration_seconds?: number;
  message_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cache_hit_rate?: number;
  estimated_cost_usd?: number;
  session_type?: string; // 'interactive', 'agentic', 'mixed'
  tool_calls_json?: string; 
  has_subagents?: boolean;
  subagent_count?: number;
  raw_metadata_json?: string;
  total_subagent_cost_usd?: number;
  parent_cost_usd?: number;
  deepest_agent_depth?: number;
  file_path?: string;
  file_modified_at?: number;
  created_at?: string;
}

export const insertSession = (session: SessionRecord): number => {
  const db = getDb();
  
  const stmt = db.prepare(`
    INSERT INTO sessions (
      provider, session_id, project_path, project_name, model_primary,
      started_at, ended_at, duration_seconds, message_count,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      cache_hit_rate, estimated_cost_usd, session_type, tool_calls_json,
      has_subagents, subagent_count, raw_metadata_json, file_path, file_modified_at,
      total_subagent_cost_usd, parent_cost_usd, deepest_agent_depth
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(provider, session_id) DO UPDATE SET
      project_path = excluded.project_path,
      project_name = excluded.project_name,
      model_primary = excluded.model_primary,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      duration_seconds = excluded.duration_seconds,
      message_count = excluded.message_count,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      cache_read_tokens = excluded.cache_read_tokens,
      cache_write_tokens = excluded.cache_write_tokens,
      cache_hit_rate = excluded.cache_hit_rate,
      estimated_cost_usd = excluded.estimated_cost_usd,
      session_type = excluded.session_type,
      tool_calls_json = excluded.tool_calls_json,
      has_subagents = excluded.has_subagents,
      subagent_count = excluded.subagent_count,
      raw_metadata_json = excluded.raw_metadata_json,
      file_path = excluded.file_path,
      file_modified_at = excluded.file_modified_at,
      total_subagent_cost_usd = excluded.total_subagent_cost_usd,
      parent_cost_usd = excluded.parent_cost_usd,
      deepest_agent_depth = excluded.deepest_agent_depth
  `);

  const info = stmt.run(
    session.provider,
    session.session_id,
    session.project_path || null,
    session.project_name || null,
    session.model_primary || null,
    session.started_at,
    session.ended_at || null,
    session.duration_seconds || null,
    session.message_count || 0,
    session.input_tokens || 0,
    session.output_tokens || 0,
    session.cache_read_tokens || 0,
    session.cache_write_tokens || 0,
    session.cache_hit_rate || 0,
    session.estimated_cost_usd || 0,
    session.session_type || null,
    session.tool_calls_json || '{}',
    session.has_subagents ? 1 : 0,
    session.subagent_count || 0,
    session.raw_metadata_json || null,
    session.file_path || null,
    session.file_modified_at || null,
    session.total_subagent_cost_usd || 0,
    session.parent_cost_usd || session.estimated_cost_usd || 0,
    session.deepest_agent_depth || 0
  );

  return info.lastInsertRowid as number;
};

export const getSessions = (filters: any = {}) => {
  const db = getDb();
  let query = `SELECT * FROM sessions WHERE 1=1`;
  const params: any[] = [];

  if (filters.provider) {
    query += ` AND provider = ?`;
    params.push(filters.provider);
  }
  if (filters.project) {
    query += ` AND project_name = ?`;
    params.push(filters.project);
  }
  if (filters.model) {
    query += ` AND model_primary = ?`;
    params.push(filters.model);
  }
  if (filters.type) {
    query += ` AND session_type = ?`;
    params.push(filters.type);
  }
  if (filters.from) {
    query += ` AND started_at >= ?`;
    params.push(filters.from);
  }
  if (filters.to) {
    query += ` AND started_at <= ?`;
    params.push(filters.to);
  }
  if (filters.search) {
     query += ` AND (project_name LIKE ? OR raw_metadata_json LIKE ? OR tool_calls_json LIKE ?)`;
     const searchParam = `%${filters.search}%`;
     params.push(searchParam, searchParam, searchParam);
  }

  // Sorting
  const allowedSortFields = ['started_at', 'estimated_cost_usd', 'duration_seconds', 'input_tokens', 'message_count'];
  let sortField = filters.sort || 'started_at';
  if (!allowedSortFields.includes(sortField)) sortField = 'started_at';
  
  let order = (filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  query += ` ORDER BY ${sortField} ${order}`;

  // Pagination
  const limit = parseInt(filters.limit) || 50;
  const page = parseInt(filters.page) || 1;
  const offset = parseInt(filters.offset) || (page - 1) * limit;

  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(query).all(...params);
};

export const getSessionById = (id: string | number) => {
  const db = getDb();
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
};

export const getSessionSummary = (filters: any = {}) => {
  const db = getDb();
  let query = `
    SELECT 
      COUNT(*) as total_sessions,
      SUM(estimated_cost_usd) as total_cost,
      SUM(input_tokens + output_tokens) as total_tokens,
      AVG(duration_seconds) as avg_duration,
      SUM(CASE WHEN session_type = 'agentic' THEN 1 ELSE 0 END) as agentic_sessions,
      SUM(CASE WHEN session_type = 'interactive' THEN 1 ELSE 0 END) as interactive_sessions
    FROM sessions WHERE 1=1
  `;
  const params: any[] = [];
  
  if (filters.from) {
    query += ` AND started_at >= ?`;
    params.push(filters.from);
  }
  if (filters.to) {
    query += ` AND started_at <= ?`;
    params.push(filters.to);
  }

  let baseStats = db.prepare(query).get(...params) as any;

  // Most common model and project
  const topModelObj = db.prepare(`
      SELECT model_primary as model, COUNT(*) as count 
      FROM sessions WHERE model_primary IS NOT NULL 
      GROUP BY model_primary ORDER BY count DESC LIMIT 1
  `).get() as any;

  const topProjectObj = db.prepare(`
      SELECT project_name as project, COUNT(*) as count 
      FROM sessions WHERE project_name IS NOT NULL 
      GROUP BY project_name ORDER BY count DESC LIMIT 1
  `).get() as any;

  return {
    total_sessions: baseStats.total_sessions || 0,
    total_cost: baseStats.total_cost || 0,
    total_tokens: baseStats.total_tokens || 0,
    avg_duration_seconds: baseStats.avg_duration || 0,
    agentic_count: baseStats.agentic_sessions || 0,
    interactive_count: baseStats.interactive_sessions || 0,
    top_model: topModelObj ? topModelObj.model : null,
    top_project: topProjectObj ? topProjectObj.project : null,
  };
};

export const getSessionsByProject = () => {
  const db = getDb();
  return db.prepare(`
    SELECT project_name, COUNT(*) as session_count, SUM(estimated_cost_usd) as total_cost
    FROM sessions
    WHERE project_name IS NOT NULL
    GROUP BY project_name
    ORDER BY total_cost DESC
  `).all();
};

export const getSessionsByModel = () => {
  const db = getDb();
  return db.prepare(`
    SELECT model_primary, COUNT(*) as session_count, SUM(estimated_cost_usd) as total_cost
    FROM sessions
    WHERE model_primary IS NOT NULL
    GROUP BY model_primary
    ORDER BY total_cost DESC
  `).all();
};

export const getMostExpensiveSessions = (limit: number = 10) => {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM sessions
    ORDER BY estimated_cost_usd DESC
    LIMIT ?
  `).all(limit);
};

export const updateSessionTotals = (id: number, subagentCost: number, subagentCount: number) => {
  const db = getDb();
  db.prepare(`
    UPDATE sessions 
    SET total_subagent_cost_usd = ?, 
        subagent_count = ?, 
        has_subagents = ?,
        estimated_cost_usd = parent_cost_usd + ?
    WHERE id = ?
  `).run(subagentCost, subagentCount, subagentCount > 0 ? 1 : 0, subagentCost, id);
};
