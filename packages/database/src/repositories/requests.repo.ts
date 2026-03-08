import { getDb } from '../db';
import { randomUUID } from 'crypto';

export interface RequestRecord {
  id: string;
  project_id: string;
  provider: string;
  model: string;
  endpoint?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost_usd: number;
  latency_ms?: number;
  status_code?: number;
  status?: string;
  is_streaming?: boolean;
  has_tools?: boolean;
  error_message?: string;
  request_body?: string;
  response_body?: string;
  pricing_unknown?: boolean;
  tags?: string;
  prompt_hash?: string;
  created_at?: string;
}

export const insertRequest = (req: Omit<RequestRecord, 'id'>): string => {
  const db = getDb();
  const id = randomUUID();
  const stmt = db.prepare(`
    INSERT INTO requests (
      id, project_id, provider, model, endpoint, prompt_tokens, 
      completion_tokens, total_tokens, cost_usd, latency_ms, status_code, 
      status, is_streaming, has_tools, error_message, request_body, 
      response_body, pricing_unknown, tags, prompt_hash
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id, req.project_id, req.provider, req.model, req.endpoint || null,
    req.prompt_tokens || null, req.completion_tokens || null, req.total_tokens || null,
    req.cost_usd, req.latency_ms || null, req.status_code || null,
    req.status || 'success', req.is_streaming ? 1 : 0, req.has_tools ? 1 : 0,
    req.error_message || null, req.request_body || null, req.response_body || null,
    req.pricing_unknown ? 1 : 0, req.tags || null, req.prompt_hash || null
  );

  return id;
};

export const bulkInsertRequests = (requests: Omit<RequestRecord, 'id'>[]) => {
  const db = getDb();

  const insertStmt = db.prepare(`
    INSERT INTO requests (
      id, project_id, provider, model, endpoint, prompt_tokens, 
      completion_tokens, total_tokens, cost_usd, latency_ms, status_code, 
      status, is_streaming, has_tools, error_message, request_body, 
      response_body, pricing_unknown, tags, prompt_hash, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const insertMany = db.transaction((reqs: Omit<RequestRecord, 'id'>[]) => {
    for (const req of reqs) {
      const id = randomUUID();
      insertStmt.run(
        id, req.project_id, req.provider, req.model, req.endpoint || null,
        req.prompt_tokens || null, req.completion_tokens || null, req.total_tokens || null,
        req.cost_usd, req.latency_ms || null, req.status_code || null,
        req.status || 'success', req.is_streaming ? 1 : 0, req.has_tools ? 1 : 0,
        req.error_message || null, req.request_body || null, req.response_body || null,
        req.pricing_unknown ? 1 : 0, req.tags || null, req.prompt_hash || null,
        req.created_at || new Date().toISOString()
      );
    }
  });

  insertMany(requests);
};

export const getRequests = (filters: any = {}) => {
  const db = getDb();
  let query = `
    SELECT id, project_id, provider, model, endpoint, prompt_tokens, 
           completion_tokens, total_tokens, cost_usd, latency_ms, status_code, 
           status, is_streaming, has_tools, error_message, pricing_unknown, 
           tags, created_at
    FROM requests
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filters.project_id) {
    query += ` AND project_id = ?`;
    params.push(filters.project_id);
  }
  if (filters.provider) {
    query += ` AND provider = ?`;
    params.push(filters.provider);
  }
  if (filters.model) {
    query += ` AND model = ?`;
    params.push(filters.model);
  }

  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;

  const limit = parseInt(filters.limit) || 50;
  let offset = parseInt(filters.offset) || 0;
  // If page is provided instead of offset
  if (filters.page && !filters.offset) {
    const page = parseInt(filters.page) || 1;
    offset = (page - 1) * limit;
  }

  params.push(limit, offset);

  return db.prepare(query).all(...params);
};
