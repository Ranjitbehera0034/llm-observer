import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { readClaudeOAuth } from './credentials';
import { 
    insertRateLimitSnapshot, 
    getRateLimitConfig, 
    cleanupOldSnapshots
} from '@llm-observer/database';
// Assuming we have access to sessions DB logic to count sessions, import them:
import { getDb } from '@llm-observer/database';

// Rate limit poller cycle in MS (5 minutes)
const POLL_INTERVAL = 5 * 60 * 1000;
let pollerInterval: NodeJS.Timeout | null = null;
let polling = false;

// This is a private provider endpoint; accept only validated, observed fields.
// Reference: CodexBar docs/claude.md, OAuth usage mapping (2026-11-14).
let quotaCredential = '';
let quotaRetryAfter = 0;

export async function fetchAnthropicRateLimitsLive(token: string): Promise<void> {
    const credential = createHash('sha256').update(token).digest('hex');
    if (credential !== quotaCredential) {
        quotaCredential = credential;
        quotaRetryAfter = 0;
    }
    if (Date.now() < quotaRetryAfter) throw new Error('Anthropic quota refresh is cooling down after rate limiting.');
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
        timeout: 15_000, size: 1_000_000, redirect: 'error'
    });
    if (res.status === 429) {
        const retry = res.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - Date.now() : 0;
        quotaRetryAfter = Date.now() + Math.max(30 * 60 * 1000, Number.isFinite(delay) ? delay : 0);
    }
    if (!res.ok) throw new Error(`Anthropic quota refresh failed: HTTP ${res.status}`);
    const data = await res.json() as any;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Anthropic quota response.');
    const mapping: Record<string, string> = { five_hour: '5h', seven_day: '7d', seven_day_sonnet: 'sonnet', seven_day_opus: 'opus' };
    let observed = 0;
    const now = new Date().toISOString();
    for (const [field, window] of Object.entries(mapping)) {
        const value = field === 'seven_day' ? data.seven_day ?? data.seven_day_oauth_apps : data[field];
        if (value == null) continue;
        if (typeof value.utilization !== 'number' || !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 100) continue;
        if (value.resets_at != null && (typeof value.resets_at !== 'string' || !Number.isFinite(Date.parse(value.resets_at)))) continue;
        const pct = value.utilization / 100;
        insertRateLimitSnapshot({
            provider: 'anthropic', window_type: window,
            total_allowed: null, total_used: null, utilization_pct: pct,
            resets_at: value.resets_at ?? null, is_estimated: false, captured_at: now
        });
        observed++;
        try { checkAlerts('anthropic', window, pct); }
        catch (error) { console.error('Quota alert failed:', error); }
    }
    if (!observed) throw new Error('No supported quota measurements available; previous observations retained.');
}

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
    if (polling) return;
    polling = true;
    try {
        try { cleanupOldSnapshots(30); }
        catch (error) { console.error('Rate-limit cleanup failed:', error); }

        try {
            const token = await readClaudeOAuth();
            if (token) await fetchAnthropicRateLimitsLive(token);
            else estimateAnthropicRateLimits();
        } catch (error) {
            // Preserve the last known quota; activity is a separate observation.
            console.error('Anthropic quota refresh failed:', error);
            try { estimateAnthropicRateLimits(); }
            catch (fallbackError) { console.error('Anthropic activity refresh failed:', fallbackError); }
        }
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
