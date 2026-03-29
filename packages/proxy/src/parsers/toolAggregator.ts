import { getDb, upsertToolUsage, upsertRedundantPattern, getPricingForModel } from '@llm-observer/database';

export const aggregateToolUsage = () => {
  const db = getDb();
  
  // 1. Get all sessions from the last 7 days to re-aggregate (ensures incremental updates are consistent)
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - 7);
  const dateStr = dateLimit.toISOString().split('T')[0];

  const sessions = db.prepare(`
    SELECT id, provider, started_at, estimated_cost_usd, tool_calls_json, input_tokens, output_tokens
    FROM sessions
    WHERE started_at >= ?
  `).all(dateStr) as any[];

  const dailyStats: Record<string, any> = {};

  for (const session of sessions) {
    const date = session.started_at.split('T')[0];
    const provider = session.provider;
    const toolCalls = JSON.parse(session.tool_calls_json || '{}');
    const totalCallsInSession = Object.values(toolCalls).reduce((a: number, b: any) => a + b, 0) as number;
    
    if (totalCallsInSession === 0) continue;

    for (const [tool, count] of Object.entries(toolCalls)) {
      const key = `${date}_${provider}_${tool}`;
      if (!dailyStats[key]) {
        dailyStats[key] = {
          date,
          provider,
          tool_name: tool,
          call_count: 0,
          total_tokens: 0,
          estimated_cost_usd: 0
        };
      }
      
      const c = count as number;
      dailyStats[key].call_count += c;
      
      // Heuristic cost attribution: 
      // Divide session cost proportionally by call count (v0.1 heuristic)
      // Future versions will use turn-by-turn usage data
      const share = totalCallsInSession > 0 ? c / totalCallsInSession : 0;
      dailyStats[key].estimated_cost_usd += session.estimated_cost_usd * share;
      dailyStats[key].total_tokens += (session.input_tokens + session.output_tokens) * share;
    }
  }

  // 2. Upsert aggregated stats
  for (const stats of Object.values(dailyStats)) {
    upsertToolUsage(stats);
  }

  // 3. Redundant Pattern Detection (Simplified)
  detectRedundantReads(sessions);
};

const detectRedundantReads = (sessions: any[]) => {
  // Logic to identify files read many times across sessions
  // This requires full metadata which we don't always store in sessions table
  // For v1.10.0, we'll implement a basic version that flags tools with very high counts
  const toolTotals: Record<string, { count: number, sessions: Set<number>, cost: number }> = {};
  
  for (const session of sessions) {
    const toolCalls = JSON.parse(session.tool_calls_json || '{}');
    for (const [tool, count] of Object.entries(toolCalls)) {
        if (!toolTotals[tool]) toolTotals[tool] = { count: 0, sessions: new Set(), cost: 0 };
        const c = count as number;
        toolTotals[tool].count += c;
        toolTotals[tool].sessions.add(session.id);
        
        const totalCalls = Object.values(toolCalls).reduce((a: number, b: any) => a + b, 0) as number;
        const share = totalCalls > 0 ? c / totalCalls : 0;
        toolTotals[tool].cost += session.estimated_cost_usd * share;
    }
  }

  const today = new Date().toISOString().split('T')[0];
  for (const [tool, stats] of Object.entries(toolTotals)) {
    if (stats.count > 50 && stats.sessions.size > 5) {
        // Flag as potentially redundant if more than 50 calls across 5+ sessions
        upsertRedundantPattern({
            date: today,
            type: 'high_frequency_tool',
            target: tool,
            call_count: stats.count,
            sessions_affected: stats.sessions.size,
            estimated_waste_usd: stats.cost * 0.2 // Assume 20% waste as heuristic
        });
    }
  }
};
