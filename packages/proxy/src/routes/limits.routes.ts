import { Router } from 'express';
import { 
    getLatestSnapshots, 
    getSnapshotHistory, 
    getAllRateLimitConfigs,
    upsertRateLimitConfig
} from '@llm-observer/database';

const router = Router();

router.get('/', (req, res) => {
    const providers = ['anthropic', 'cursor', 'openai', 'aider'];
    const response = providers.map(p => {
        const snapshots = getLatestSnapshots(p);
        if (snapshots.length === 0) return null;
        
        return {
            provider: p,
            source: snapshots.every(s => !s.is_estimated) ? 'oauth_api' : snapshots.every(s => s.is_estimated) ? 'session_count' : 'mixed',
            windows: snapshots.map(s => {
                const observedAt = Date.parse(s.captured_at);
                const ageMs = Date.now() - observedAt;
                const stale = !Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000 || ageMs < -60_000
                    || (s.resets_at !== null && Date.parse(s.resets_at) <= Date.now());
                let status = 'ok';
                if (s.utilization_pct !== null) {
                    if (s.utilization_pct >= 1.0) status = 'throttled';
                    else if (s.utilization_pct >= 0.95) status = 'critical';
                    else if (s.utilization_pct >= 0.75) status = 'warning';
                } else {
                    status = 'monitoring';
                }
                
                return {
                    type: s.window_type,
                    label: getWindowLabel(s.window_type),
                    total_allowed: s.total_allowed,
                    total_used: s.total_used,
                    utilization_pct: s.utilization_pct,
                    resets_at: s.resets_at,
                    status: stale ? 'stale' : status,
                    stale,
                    captured_at: s.captured_at,
                    source: s.is_estimated ? 'session_count' : 'oauth_api',
                    is_estimated: s.is_estimated
                };
            }),
            last_updated: snapshots.map(s => s.captured_at).sort().at(-1)
        };
    }).filter(Boolean);
    
    res.json({ providers: response });
});

router.get('/config', (req, res) => {
    const configs = getAllRateLimitConfigs();
    res.json({ configs });
});

router.put('/config', (req, res) => {
    const { provider, alert_threshold_pct, plan_type, window_type } = req.body;
    if (!provider || !window_type || alert_threshold_pct === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    upsertRateLimitConfig({
        provider,
        window_type,
        alert_threshold_pct, // e.g. 0.75
        plan_type: plan_type || null
    });
    
    res.json({ success: true });
});

router.get('/:provider', (req, res) => {
    const { provider } = req.params;
    const snapshots = getLatestSnapshots(provider);
    const history = getSnapshotHistory(provider, 24);
    
    if (snapshots.length === 0) {
        return res.json({ provider, windows: [], history: [] });
    }
    
    res.json({
        provider,
        windows: snapshots,
        history
    });
});

function getWindowLabel(type: string): string {
    const labels: Record<string, string> = {
        '5h': '5-Hour Rolling',
        '7d': '7-Day Rolling',
        'opus': 'Opus (7-Day)',
        'sonnet': 'Sonnet (7-Day)',
        'activity_5h': 'Sessions in Last 5 Hours',
        'activity_daily': "Today's Activity",
        'activity_weekly': 'This Week'
    };
    return labels[type] || type;
}

export default router;
