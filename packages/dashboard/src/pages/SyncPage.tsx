import React, { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

interface SyncConfig {
    id: string;
    display_name: string;
    status: 'active' | 'inactive' | 'error' | 'rate_limited';
    last_poll_at: string | null;
    last_error: string | null;
    org_name: string | null;
    has_key: boolean;
    next_poll_in_seconds: number | null;
}

interface DailyPoint {
    date: string;
    cost_usd: number;
    num_requests: number;
}

interface ModelRow {
    model: string;
    num_requests: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    pct_of_total: number;
}

const SyncPage: React.FC = () => {
    const [config, setConfig] = useState<SyncConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [adminKey, setAdminKey] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);
    const [dailyData, setDailyData] = useState<DailyPoint[]>([]);
    const [modelData, setModelData] = useState<ModelRow[]>([]);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/sync/status');
            const data = await res.json();
            const anthropic = data.find((c: any) => c.id === 'anthropic');
            setConfig(anthropic || null);
        } catch (err) {
            console.error('Failed to fetch sync status', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchChartData = useCallback(async () => {
        try {
            const [dailyRes, modelRes] = await Promise.all([
                fetch('/api/sync/usage/daily?days=30'),
                fetch('/api/sync/usage/by-model?days=7'),
            ]);
            if (dailyRes.ok) setDailyData(await dailyRes.json());
            if (modelRes.ok) setModelData(await modelRes.json());
        } catch (err) {
            console.error('Failed to fetch usage data', err);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
        fetchChartData();
        // Auto-refresh every 60 seconds while the page is open
        const interval = setInterval(() => { fetchStatus(); fetchChartData(); }, 60_000);
        return () => clearInterval(interval);
    }, [fetchStatus, fetchChartData]);

    const handleSaveKey = async () => {
        if (!adminKey.trim()) {
            setTestError('Please enter an Admin API key.');
            return;
        }
        if (adminKey.startsWith('sk-ant-api')) {
            setTestError('This is a regular API key, not an Admin key. Admin keys start with sk-ant-admin.');
            return;
        }
        if (!adminKey.startsWith('sk-ant-admin')) {
            setTestError("This doesn't look like an Anthropic Admin key. Admin keys start with sk-ant-admin.");
            return;
        }

        setIsTesting(true);
        setTestError(null);

        try {
            const res = await fetch('/api/sync/providers/anthropic/key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminKey })
            });
            const data = await res.json();
            if (!res.ok) {
                setTestError(data.error || 'Failed to validate key');
            } else {
                await fetchStatus();
                await fetchChartData();
                setAdminKey('');
            }
        } catch (err: any) {
            setTestError(err.message);
        } finally {
            setIsTesting(false);
        }
    };

    const handleRemoveKey = async () => {
        if (!confirm('Are you sure you want to disconnect Anthropic? Historical data will be preserved.')) return;
        try {
            await fetch('/api/sync/providers/anthropic/key', { method: 'DELETE' });
            await fetchStatus();
        } catch (err) {
            console.error('Failed to remove key', err);
        }
    };

    if (loading) return <div className="p-8 text-slate-400">Loading sync status...</div>;

    // ── STATE 1: No Key Configured ──────────────────────────────────────────
    if (!config || !config.has_key || config.status === 'inactive') {
        return (
            <div className="p-8 max-w-4xl">
                <h1 className="text-2xl font-bold mb-2">Usage Sync</h1>
                <p className="text-slate-400 mb-8">
                    Track your global Anthropic spend even for requests made outside LLM Observer
                    (e.g., via Continue, Cursor, or Claude Code). Zero IDE changes — just paste one key.
                </p>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 bg-orange-500/10 rounded-lg flex items-center justify-center text-2xl">🔑</div>
                        <div>
                            <h2 className="text-xl font-semibold">Anthropic Integration</h2>
                            <p className="text-sm text-slate-500">Requires an Organization Admin Key (sk-ant-admin...)</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-2">Admin API Key</label>
                            <input
                                type="password"
                                placeholder="sk-ant-admin..."
                                value={adminKey}
                                onChange={(e) => { setAdminKey(e.target.value); setTestError(null); }}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                                className="w-full bg-black border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-orange-500 transition-colors"
                            />
                            {testError && <p className="text-red-400 text-sm mt-2">{testError}</p>}
                        </div>

                        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-4 text-sm text-blue-200">
                            <strong>How to get an Admin Key:</strong>
                            <ol className="list-decimal ml-4 mt-2 space-y-1">
                                <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline">console.anthropic.com</a></li>
                                <li>Navigate to <strong>Settings → Admin Keys</strong></li>
                                <li>Create a new key and paste it above</li>
                            </ol>
                        </div>

                        <button
                            onClick={handleSaveKey}
                            disabled={isTesting || !adminKey}
                            className="bg-white text-black font-semibold px-6 py-2 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTesting ? 'Validating...' : 'Connect Anthropic'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const totalSpend = modelData.reduce((acc, r) => acc + (r.cost_usd || 0), 0);
    const totalRequests = modelData.reduce((acc, r) => acc + (r.num_requests || 0), 0);
    const lastSyncStr = config.last_poll_at
        ? new Date(config.last_poll_at).toLocaleString()
        : 'Never';
    const nextSyncStr = config.next_poll_in_seconds != null && config.status === 'active'
        ? `Next sync in ${config.next_poll_in_seconds}s`
        : '';

    return (
        <div className="p-8 max-w-6xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-3">
                        Usage Sync
                        <StatusBadge
                            statusCode={config.status === 'error' ? 500 : 200}
                            status={config.status === 'error' ? 'Error' : config.status === 'rate_limited' ? 'Rate Limited' : 'Active'}
                        />
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Monitoring <strong>{config.org_name || 'Anthropic Org'}</strong>
                        {' · '}Last synced: {lastSyncStr}
                        {nextSyncStr && <span className="text-slate-500"> · {nextSyncStr}</span>}
                    </p>
                </div>
                <button
                    onClick={handleRemoveKey}
                    className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                    Disconnect Provider
                </button>
            </div>

            {/* STATE 3: Error Banner */}
            {config.status === 'error' && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex items-start gap-4">
                    <div className="text-red-500 text-lg leading-none">⚠</div>
                    <div>
                        <h3 className="text-red-200 font-semibold">Sync Error</h3>
                        <p className="text-sm text-red-300/80">{config.last_error || 'Unknown error occurred during polling.'}</p>
                    </div>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">7-Day Spend</h3>
                    <div className="text-4xl font-black text-green-400">${totalSpend.toFixed(2)}</div>
                    <p className="text-xs text-slate-500 mt-1">{totalRequests.toLocaleString()} requests</p>
                </div>

                {/* 30-Day Bar Chart */}
                <div className="md:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6">
                    <h3 className="text-sm font-medium text-slate-400 mb-4">30-Day Cost Trend</h3>
                    {dailyData.every(d => d.cost_usd === 0) ? (
                        <div className="flex items-center justify-center h-24 text-slate-600 text-sm">
                            No cost data yet — check back after the first sync cycle
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={120}>
                            <BarChart data={dailyData.map(d => ({
                                ...d,
                                displayDate: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            }))} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                <XAxis
                                    dataKey="displayDate"
                                    stroke="#94A3B8"
                                    fontSize={9}
                                    tickLine={false}
                                    axisLine={false}
                                    interval={4}
                                />
                                <YAxis
                                    stroke="#94A3B8"
                                    fontSize={9}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v) => `$${v}`}
                                />
                                <Tooltip
                                    formatter={(val: any) => [`$${Number(val).toFixed(4)}`, 'Cost']}
                                    labelStyle={{ color: '#94A3B8', fontSize: 11 }}
                                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                                />
                                <Bar dataKey="cost_usd" fill="#4F46E5" radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

            {/* Model Breakdown Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
                <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Model Breakdown</h3>
                    <span className="text-xs text-slate-500">Last 7 days</span>
                </div>

                {/* STATE 4: Zero Usage */}
                {modelData.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="text-4xl mb-4">✨</div>
                        <h3 className="text-lg font-medium text-white mb-1">$0.00 today</h3>
                        <p className="text-slate-500 text-sm max-w-sm mx-auto">
                            No Anthropic API usage detected in the last 7 days. Usage typically appears within 5 minutes of making an API call.
                        </p>
                    </div>
                ) : (
                    <div className="p-6">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="text-slate-500 uppercase text-[10px] font-bold tracking-widest border-b border-white/5">
                                    <th className="pb-3">Model</th>
                                    <th className="pb-3">Requests</th>
                                    <th className="pb-3 text-right">Input Tokens</th>
                                    <th className="pb-3 text-right">Output Tokens</th>
                                    <th className="pb-3 text-right">Cost</th>
                                    <th className="pb-3 text-right">% of Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {modelData.map((row) => (
                                    <tr key={row.model}>
                                        <td className="py-4 font-medium text-white font-mono text-xs">{row.model}</td>
                                        <td className="py-4 text-slate-400">{row.num_requests.toLocaleString()}</td>
                                        <td className="py-4 text-slate-400 text-right">{(row.input_tokens || 0).toLocaleString()}</td>
                                        <td className="py-4 text-slate-400 text-right">{(row.output_tokens || 0).toLocaleString()}</td>
                                        <td className="py-4 text-green-400 font-bold text-right">${(row.cost_usd || 0).toFixed(4)}</td>
                                        <td className="py-4 text-slate-500 text-right">{row.pct_of_total}%</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="border-t border-white/10">
                                <tr>
                                    <td className="pt-3 text-slate-400 font-medium text-xs">Total</td>
                                    <td className="pt-3 text-slate-400 text-xs">{totalRequests.toLocaleString()}</td>
                                    <td colSpan={2} />
                                    <td className="pt-3 text-green-400 font-bold text-right text-xs">${totalSpend.toFixed(4)}</td>
                                    <td className="pt-3 text-slate-500 text-right text-xs">100%</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>

            {/* Data Source Disclaimer */}
            <p className="text-xs text-slate-600 leading-relaxed">
                Showing all usage billed to your Anthropic API account. This includes Claude Code, Continue, Aider, Cursor (BYOK mode), and any app using your API key.
                Subscription tools like Cursor Pro and Claude.ai are not included — you can add those manually starting in v1.3.0.
            </p>
        </div>
    );
};

export default SyncPage;
