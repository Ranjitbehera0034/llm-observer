import { getDb, insertRateLimitSnapshot, cleanupOldSnapshots } from '@llm-observer/database';

// Rate limit poller cycle in MS (5 minutes)
const POLL_INTERVAL = 5 * 60 * 1000;
let pollerInterval: NodeJS.Timeout | null = null;

// Fallback estimation using session counts
export function estimateAnthropicRateLimits(): void {
    const db = getDb();
    const now = new Date().toISOString();
    
    // Count sessions in last 5 hours
    const count5hResp = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE provider = 'anthropic' AND started_at >= datetime('now', '-5 hours')`).get() as any;
    const count5h = count5hResp.count;

    // Output snapshot for 5h
    insertRateLimitSnapshot({
        provider: 'anthropic',
        window_type: '5h',
        total_allowed: null, // Unknown since estimated
        total_used: count5h,
        utilization_pct: null,
        resets_at: null,
        is_estimated: true,
        captured_at: now
    });
}

export function performActivityMonitoring(provider: string): void {
    const db = getDb();
    const now = new Date().toISOString();

    const dailyResp = db.prepare(`
        SELECT COUNT(*) as count, SUM(input_tokens + output_tokens) as tokens 
        FROM sessions 
        WHERE provider = ? AND started_at >= datetime('now', 'start of day')
    `).get(provider) as any;

    const weeklyResp = db.prepare(`
        SELECT COUNT(*) as count, SUM(input_tokens + output_tokens) as tokens 
        FROM sessions 
        WHERE provider = ? AND started_at >= datetime('now', '-7 days')
    `).get(provider) as any;

    insertRateLimitSnapshot({
        provider,
        window_type: 'activity_daily',
        total_allowed: null,
        total_used: dailyResp.count || 0,
        utilization_pct: null,
        resets_at: null,
        is_estimated: true,
        captured_at: now
    });

    insertRateLimitSnapshot({
        provider,
        window_type: 'activity_weekly',
        total_allowed: null,
        total_used: weeklyResp.count || 0,
        utilization_pct: null,
        resets_at: null,
        is_estimated: true,
        captured_at: now
    });
}

export async function pollRateLimits() {
    try {
        // Cleaning up old snapshots
        cleanupOldSnapshots(30);

        // Anthropic: estimated locally from parsed sessions. We deliberately do
        // not read Claude Code's OAuth token from the keychain or
        // ~/.claude/.credentials.json to query claude.ai -- that would send a
        // credential belonging to another app off the machine.
        estimateAnthropicRateLimits();

        // Activity monitoring for Cursor, OpenAI, Aider
        performActivityMonitoring('cursor');
        performActivityMonitoring('openai');
        performActivityMonitoring('aider');

    } catch (err) {
        console.error('Error during rate limit polling:', err);
    }
}

export function startRateLimitPoller() {
    if (pollerInterval) clearInterval(pollerInterval);
    pollRateLimits(); // Run immediately
    pollerInterval = setInterval(pollRateLimits, POLL_INTERVAL);
    console.log('Started Rate Limit Poller');
}

export function stopRateLimitPoller() {
    if (pollerInterval) clearInterval(pollerInterval);
    pollerInterval = null;
}
