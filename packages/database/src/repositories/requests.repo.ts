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
    tags?: string;
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
      response_body, tags
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

    stmt.run(
        id, req.project_id, req.provider, req.model, req.endpoint || null,
        req.prompt_tokens || null, req.completion_tokens || null, req.total_tokens || null,
        req.cost_usd, req.latency_ms || null, req.status_code || null,
        req.status || 'success', req.is_streaming ? 1 : 0, req.has_tools ? 1 : 0,
        req.error_message || null, req.request_body || null, req.response_body || null,
        req.tags || null
    );

    return id;
};

export const getRequests = (filters: any) => {
    const db = getDb();
    return db.prepare('SELECT * FROM requests ORDER BY created_at DESC LIMIT 50').all();
};
