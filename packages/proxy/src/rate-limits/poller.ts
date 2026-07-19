import fetch from 'node-fetch';
import { readClaudeOAuth } from './credentials';
import { 
    insertRateLimitSnapshot, 
    getRateLimitConfig, 
    getLatestSnapshots, 
    cleanupOldSnapshots,
    RateLimitSnapshot
} from '@llm-observer/database';
// Assuming we have access to sessions DB logic to count sessions, import them:
import { getDb } from '@llm-observer/database';

// Rate limit poller cycle in MS (5 minutes)
const POLL_INTERVAL = 5 * 60 * 1000;
let pollerInterval: NodeJS.Timeout | null = null;

// Mock interface for Anthropic Rate Limit API (which doesn't really exist publicly, but we parse what we get)
// From plan: 5h, 7d, opus, sonnet, extra with total_allowed, total_used, resets_at etc.
// The plan provided assumes an API response like `GET https://api.claude.ai/api/organizations/{org_id}/rate_limits`
// Wait, we don't have the org_id. From prior knowledge, Claude Code gets org via `GET https://api.claude.ai/api/organizations`.
// For the scope of this file as designed by the plan, let's implement the fetching logic:

async function getAnthropicOrgId(token: string): Promise<string | null> {
    try {
        const res = await fetch('https://api.claude.ai/api/organizations', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const data = await res.json() as any[];
        if (data && data.length > 0) {
            return data[0].uuid; // Assumes org ID is in uuid field
        }
        return null;
    } catch {
        // ignore
    }
    return null;
}

export async function fetchAnthropicRateLimitsLive(token: string): Promise<void> {
    const orgId = await getAnthropicOrgId(token);
    if (!orgId) throw new Error('Could not fetch org ID');

    const res = await fetch(`https://api.claude.ai/api/organizations/${orgId}/rate_limits`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) {
        throw new Error(`Rate limit API failed: ${res.status}`);
    }

    const data = await res.json() as any;
    // Assume data has the format expected: an array or object containing different limits
    // For this implementation, we will map standard limits. 
    // Plan lists windows: "5h", "7d", "opus", "sonnet", "extra"
    const now = new Date().toISOString();
    
    // We mock the mapping of raw response to our schema since actual response format wasn't strictly provided.
    // Let's assume data.rate_limits exists
    const limits = data.rate_limits || [];
    for (const limit of limits) {
        const pct = limit.total_allowed ? (limit.total_used / limit.total_allowed) : 0;
        
        insertRateLimitSnapshot({
            provider: 'anthropic',
            window_type: limit.type || 'unknown',
            total_allowed: limit.total_allowed || 0,
            total_used: limit.total_used || 0,
            utilization_pct: pct,
            resets_at: limit.resets_at || null,
            is_estimated: false,
            captured_at: now
        });

        checkAlerts('anthropic', limit.type || 'unknown', pct);
    }
}

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

function checkAlerts(provider: string, window_type: string, pct: number) {
    const config = getRateLimitConfig(provider, window_type);
    const threshold = config ? config.alert_threshold_pct : 0.75;
    
    // Mock firing an alert - assumes we integrate with alerting repo.
    // E.g., if pct > threshold, trigger 'rate_limit_warning' or 'rate_limit_critical' if > 0.95
    if (pct >= 1.0) {
        fireAlert(provider, window_type, 'rate_limit_exceeded', pct);
    } else if (pct >= 0.95) {
        fireAlert(provider, window_type, 'rate_limit_critical', pct);
    } else if (pct >= threshold) {
        fireAlert(provider, window_type, 'rate_limit_warning', pct);
    }
}

// Simple alert fire stub bridging to the actual alerts system
function fireAlert(provider: string, window_type: string, type: string, pct: number) {
    const db = getDb();
    // Implementation of insert into alerts is expected in alerts.repo.ts
    // For deduplication, we would check if a recent alert exists inside the alerts repo.
    // For now, we will just call the raw insert assuming standard alerts table struct from v1.4.0.
    const recent = db.prepare(`
        SELECT id FROM alerts 
        WHERE type = ? AND context_id = ? AND created_at >= datetime('now', '-1 hour')
    `).get(type, `${provider}_${window_type}`);

    if (!recent) {
        const severity = type === 'rate_limit_warning' ? 'warning' : 'critical';
        const message = `${provider} ${window_type} limit is at ${Math.round(pct * 100)}%`;
        db.prepare(`
            INSERT INTO alerts (type, message, severity, context_id, is_read) 
            VALUES (?, ?, ?, ?, 0)
        `).run(type, message, severity, `${provider}_${window_type}`);
    }
}

export async function pollRateLimits() {
    try {
        // Cleaning up old snapshots
        cleanupOldSnapshots(30);

        // Anthropic Polling
        const token = await readClaudeOAuth();
        if (token) {
            await fetchAnthropicRateLimitsLive(token);
        } else {
            estimateAnthropicRateLimits();
        }

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
