import { 
    insertRateLimitSnapshot, 
    cleanupOldSnapshots
} from '@llm-observer/database';
// Assuming we have access to sessions DB logic to count sessions, import them:
import { getDb } from '@llm-observer/database';

// Rate limit poller cycle in MS (5 minutes)
const POLL_INTERVAL = 5 * 60 * 1000;
let pollerInterval: NodeJS.Timeout | null = null;
let polling = false;

// Fallback estimation using session counts
export function estimateAnthropicRateLimits(): void {
    const db = getDb();
    const now = new Date().toISOString();
    
    // Count sessions in last 5 hours
    const count5hResp = db.prepare(`SELECT COUNT(*) as count FROM sessions WHERE provider = 'anthropic' AND julianday(started_at) >= julianday('now', '-5 hours')`).get() as any;
    const count5h = count5hResp.count;

    // Output snapshot for 5h
    insertRateLimitSnapshot({
        provider: 'anthropic',
        window_type: 'activity_5h',
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
        WHERE provider = ? AND julianday(started_at) >= julianday('now', 'start of day')
    `).get(provider) as any;

    const weeklyResp = db.prepare(`
        SELECT COUNT(*) as count, SUM(input_tokens + output_tokens) as tokens 
        FROM sessions 
        WHERE provider = ? AND julianday(started_at) >= julianday('now', '-7 days')
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
    if (polling) return;
    polling = true;
    try {
        try { cleanupOldSnapshots(30); }
        catch (error) { console.error('Rate-limit cleanup failed:', error); }

        // Do not borrow Claude Code's OAuth credential to call a private API.
        // Local session activity is a separate estimate, not provider quota.
        try { estimateAnthropicRateLimits(); }
        catch (error) { console.error('Anthropic activity refresh failed:', error); }
        for (const provider of ['cursor', 'openai', 'aider']) {
            try { performActivityMonitoring(provider); }
            catch (error) { console.error(`${provider} activity refresh failed:`, error); }
        }
    } finally {
        polling = false;
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
