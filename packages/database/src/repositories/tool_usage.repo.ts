import { getDb } from '../db';

export interface ToolUsageRecord {
  id?: number;
  date: string;
  provider: string;
  tool_name: string;
  call_count: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

export const upsertToolUsage = (record: ToolUsageRecord) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tool_usage_daily (date, provider, tool_name, call_count, total_tokens, estimated_cost_usd)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, provider, tool_name) DO UPDATE SET
      call_count = excluded.call_count,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd
  `);

  stmt.run(
    record.date,
    record.provider,
    record.tool_name,
    record.call_count,
    record.total_tokens,
    record.estimated_cost_usd
  );
};

export const getToolUsage = (days: number = 30) => {
  const db = getDb();
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString().split('T')[0];

  const daily = db.prepare(`
    SELECT date, tool_name, SUM(call_count) as calls, SUM(estimated_cost_usd) as cost_usd
    FROM tool_usage_daily
    WHERE date >= ?
    GROUP BY date, tool_name
    ORDER BY date ASC
  `).all(dateStr) as any[];

  const summary = db.prepare(`
    SELECT tool_name, SUM(call_count) as total_calls, SUM(estimated_cost_usd) as total_cost
    FROM tool_usage_daily
    WHERE date >= ?
    GROUP BY tool_name
    ORDER BY total_cost DESC
  `).all(dateStr) as any[];

  // Redundant patterns
  const redundant = db.prepare(`
    SELECT * FROM redundant_patterns WHERE date >= ? ORDER BY estimated_waste_usd DESC LIMIT 5
  `).all(dateStr) as any[];

  return { daily, summary, redundant };
};

export const upsertRedundantPattern = (pattern: any) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO redundant_patterns (date, type, target, call_count, sessions_affected, estimated_waste_usd)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, type, target) DO UPDATE SET
      call_count = excluded.call_count,
      sessions_affected = excluded.sessions_affected,
      estimated_waste_usd = excluded.estimated_waste_usd
  `);

  stmt.run(
    pattern.date,
    pattern.type,
    pattern.target,
    pattern.call_count,
    pattern.sessions_affected,
    pattern.estimated_waste_usd
  );
};
