import React, { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '../components/StatusBadge';
import { API_BASE_URL } from '../config';
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
    total: number;
    anthropic?: number;
    openai?: number;
}

interface ModelRow {
    provider: string;
    model: string;
    num_requests: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    pct_of_total: number;
}

interface ProviderSetupProps {
    config: SyncConfig;
    onSave: (providerId: string, adminKey: string) => Promise<void>;
    onCancel?: () => void;
    isTesting: boolean;
    error: string | null;
}

const ProviderSetup: React.FC<ProviderSetupProps> = ({ config, onSave, onCancel, isTesting, error }) => {
    const [adminKey, setAdminKey] = useState('');
    const icon = config.id === 'anthropic' ? '🧡' : '🤖';
    const color = config.id === 'anthropic' ? 'orange' : 'emerald';

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 mb-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-4 mb-6">
                <div className={`w-12 h-12 bg-${color}-500/10 rounded-lg flex items-center justify-center text-2xl`}>{icon}</div>
                <div>
                    <h2 className="text-xl font-semibold">{config.display_name} Connection</h2>
                    <p className="text-sm text-slate-500">
                        Requires an Organization Admin Key ({config.id === 'anthropic' ? 'sk-ant-admin...' : 'sk-admin-...'})
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Admin API Key</label>
                    <input
                        type="password"
                        placeholder={config.id === 'anthropic' ? 'sk-ant-admin...' : 'sk-admin...'}
                        value={adminKey}
                        onChange={(e) => setAdminKey(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onSave(config.id, adminKey)}
                        className={`w-full bg-black border ${error ? 'border-red-500/50' : 'border-slate-800'} rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 transition-colors`}
                    />
                    {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                </div>

                <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-lg p-4 text-sm text-indigo-200">
                    <strong>How to get an Admin Key:</strong>
                    <ol className="list-decimal ml-4 mt-2 space-y-1">
                        {config.id === 'anthropic' ? (
                            <>
                                <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="underline">console.anthropic.com</a></li>
                                <li>Navigate to <strong>Settings → Admin Keys</strong></li>
                            </>
                        ) : (
                            <>
                                <li>Go to <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noreferrer" className="underline">platform.openai.com</a></li>
                                <li>Must be an <strong>Organization Owner</strong> to create Admin keys</li>
                            </>
                        )}
                        <li>Create a new key and paste it above</li>
                        <li className="text-[10px] mt-4 opacity-70 italic">
                            Note: If you are on an <strong>Individual</strong> Anthropic plan, you may not see "Admin Keys". In this case, use the <strong>Apps</strong> tab (Network Monitor) to track usage instead.
                        </li>
                    </ol>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => onSave(config.id, adminKey)}
                        disabled={isTesting || !adminKey}
                        className="bg-white text-black font-semibold px-6 py-2 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
                    >
                        {isTesting ? 'Validating...' : `Connect ${config.display_name}`}
                    </button>
                    {onCancel && (
                        <button onClick={onCancel} className="px-6 py-2 text-slate-400 hover:text-white transition-colors">Cancel</button>
                    )}
                </div>
            </div>
        </div>
    );
};

const SyncPage: React.FC = () => {
    const [configs, setConfigs] = useState<SyncConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'all' | 'anthropic' | 'openai'>('all');
    
    const [setupProvider, setSetupProvider] = useState<string | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [testError, setTestError] = useState<string | null>(null);

    const [dailyData, setDailyData] = useState<DailyPoint[]>([]);
    const [modelData, setModelData] = useState<{ total: number, providers: any, models: ModelRow[] }>({
        total: 0,
        providers: {},
        models: []
    });

    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/sync/status`);
            const data = await res.json();
            setConfigs(data);
        } catch (err) {
            console.error('Failed to fetch sync status', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchUsageData = useCallback(async () => {
        try {
            const providerQuery = activeTab === 'all' ? '' : `&provider=${activeTab}`;
            const [dailyRes, modelRes] = await Promise.all([
                fetch(`${API_BASE_URL}/api/sync/usage/daily?days=30${providerQuery}`),
                fetch(`${API_BASE_URL}/api/sync/usage/today?${providerQuery}`),
            ]);
            if (dailyRes.ok) setDailyData(await dailyRes.json());
            if (modelRes.ok) setModelData(await modelRes.json());
        } catch (err) {
            console.error('Failed to fetch usage data', err);
        }
    }, [activeTab]);

    useEffect(() => {
        fetchStatus();
        fetchUsageData();
        const interval = setInterval(() => { fetchStatus(); fetchUsageData(); }, 60_000);
        return () => clearInterval(interval);
    }, [fetchStatus, fetchUsageData]);

    const handleSaveKey = async (providerId: string, adminKey: string) => {
        setIsTesting(true);
        setTestError(null);

        try {
            const res = await fetch(`${API_BASE_URL}/api/sync/providers/${providerId}/key`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminKey })
            });
            const data = await res.json();
            if (!res.ok) {
                setTestError(data.error || 'Failed to validate key');
            } else {
                await fetchStatus();
                await fetchUsageData();
                setSetupProvider(null);
            }
        } catch (err: any) {
            setTestError(err.message);
        } finally {
            setIsTesting(false);
        }
    };

    const handleRemoveKey = async (providerId: string) => {
        const name = configs.find(c => c.id === providerId)?.display_name || providerId;
        if (!confirm(`Are you sure you want to disconnect ${name}? Historical data will be preserved.`)) return;
        try {
            await fetch(`${API_BASE_URL}/api/sync/providers/${providerId}/key`, { method: 'DELETE' });
            await fetchStatus();
            await fetchUsageData();
        } catch (err) {
            console.error('Failed to remove key', err);
        }
    };

    if (loading) return <div className="p-8 text-slate-400">Loading sync status...</div>;

    const providers = [
        configs.find(c => c.id === 'anthropic') || { id: 'anthropic', display_name: 'Anthropic', status: 'inactive', has_key: false } as SyncConfig,
        configs.find(c => c.id === 'openai') || { id: 'openai', display_name: 'OpenAI', status: 'inactive', has_key: false } as SyncConfig,
    ];

    const hasAnyActive = configs.some(c => c.has_key);
    const activeConfigs = configs.filter(c => c.has_key);

    return (
        <div className="p-8 max-w-6xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold">Usage Sync</h1>
                    <p className="text-slate-400 text-sm mt-1">
                        Track global API spend. Syncs completions usage and costs every 15 minutes.
                    </p>
                </div>
                {hasAnyActive && (
                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                        {(['all', ...activeConfigs.map(c => c.id)] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => setActiveTab(p as 'all' | 'anthropic' | 'openai')}
                                className={`px-4 py-1 rounded-md text-xs font-semibold transition-all ${activeTab === p ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                {p === 'all' ? 'All Providers' : p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Provider Section */}
            <div className="space-y-6 mb-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {providers.map(config => {
                    // Show setup form if this specific provider is being set up
                    if (setupProvider === config.id) {
                        return (
                            <ProviderSetup 
                                key={config.id}
                                config={config}
                                onSave={handleSaveKey}
                                onCancel={() => { setSetupProvider(null); setTestError(null); }}
                                isTesting={isTesting}
                                error={testError}
                            />
                        );
                    }

                    // Otherwise show status/connect button
                    if (!config.has_key) {
                        return (
                            <div key={config.id} className="bg-slate-900/50 border border-slate-800 border-dashed rounded-xl p-8 flex flex-col justify-between min-h-[200px] hover:border-slate-700 transition-colors">
                                <div className="flex items-center gap-4 mb-6">
                                    <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center text-2xl grayscale">
                                        {config.id === 'anthropic' ? '🧡' : '🤖'}
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold text-slate-400">{config.display_name}</h3>
                                        <p className="text-sm text-slate-600">Not Connected</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => setSetupProvider(config.id)} 
                                    className="w-full bg-slate-800 text-white font-semibold py-3 rounded-lg hover:bg-slate-700 transition-colors"
                                >
                                    Connect {config.display_name}
                                </button>
                            </div>
                        );
                    }
                    
                    const lastSyncStr = config.last_poll_at ? new Date(config.last_poll_at).toLocaleTimeString() : 'Never';
                    const color = config.id === 'anthropic' ? 'orange' : 'emerald';

                    return (
                        <div key={config.id} className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col justify-between min-h-[200px]">
                            <div className="flex items-center gap-4 mb-6">
                                <div className={`w-12 h-12 bg-${color}-500/10 rounded-lg flex items-center justify-center text-2xl`}>
                                    {config.id === 'anthropic' ? '🧡' : '🤖'}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-semibold">{config.display_name}</h3>
                                        <StatusBadge statusCode={config.status === 'error' ? 500 : 200} status={config.status} />
                                    </div>
                                    <p className="text-sm text-slate-500 mt-1">
                                        {config.org_name || 'Connected'} · Last sync: {lastSyncStr}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <button onClick={() => setSetupProvider(config.id)} className="flex-1 text-sm bg-slate-800/50 hover:bg-slate-800 py-2 rounded-lg transition-colors">Update Key</button>
                                <button onClick={() => handleRemoveKey(config.id)} className="px-4 py-2 text-sm text-slate-500 hover:text-red-400 transition-colors">Disconnect</button>
                            </div>
                        </div>
                    );
                })}
            </div>
            </div>

            {hasAnyActive && (
                <>
                    {/* Error Banner for any provider */}
                    {configs.filter(c => c.status === 'error').map(c => (
                        <div key={c.id} className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex items-start gap-4">
                            <div className="text-red-500 text-lg leading-none">⚠</div>
                            <div>
                                <h3 className="text-red-200 font-semibold">{c.display_name} Sync Error</h3>
                                <p className="text-sm text-red-300/80">{c.last_error || 'Unknown error occurred.'}</p>
                            </div>
                        </div>
                    ))}

                    {/* KPI Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Total Today</h3>
                            <div className="text-4xl font-black text-white">${modelData.total.toFixed(2)}</div>
                            <div className="flex gap-2 mt-2">
                                {Object.entries(modelData.providers).map(([p, cost]) => (
                                    <span key={p} className={`text-[10px] px-1.5 py-0.5 rounded ${p === 'anthropic' ? 'bg-orange-500/10 text-orange-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                                        {p.toUpperCase().at(0)}: ${Number(cost).toFixed(2)}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div className="md:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-6">
                            <h3 className="text-sm font-medium text-slate-400 mb-4">30-Day Cost Trend</h3>
                            <ResponsiveContainer width="100%" height={120}>
                                <BarChart data={dailyData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                    <XAxis 
                                        dataKey="date" 
                                        stroke="#475569" fontSize={9} tickLine={false} axisLine={false} 
                                        tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    />
                                    <YAxis stroke="#475569" fontSize={9} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                                    <Tooltip 
                                        contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                        cursor={{ fill: '#ffffff05' }}
                                    />
                                    <Bar dataKey="anthropic" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="openai" stackId="a" fill="#10b981" radius={[2, 2, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Model Breakdown */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
                        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                            <h3 className="text-lg font-semibold">Model Breakdown</h3>
                            <span className="text-xs text-slate-500">Last 7 days</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="text-slate-500 uppercase text-[10px] font-bold tracking-widest border-b border-white/5">
                                        <th className="p-4">Provider</th>
                                        <th className="p-4">Model</th>
                                        <th className="p-4 text-right">Requests</th>
                                        <th className="p-4 text-right">Input Tokens</th>
                                        <th className="p-4 text-right">Output Tokens</th>
                                        <th className="p-4 text-right">Cost</th>
                                        <th className="p-4 text-right">%</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {modelData.models.map((row, i) => (
                                        <tr key={`${row.provider}:${row.model}:${i}`} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="p-4">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.provider === 'anthropic' ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                                    {row.provider.toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="p-4 font-mono text-xs text-white">{row.model}</td>
                                            <td className="p-4 text-slate-400 text-right">{row.num_requests.toLocaleString()}</td>
                                            <td className="p-4 text-slate-400 text-right">{row.input_tokens.toLocaleString()}</td>
                                            <td className="p-4 text-slate-400 text-right">{row.output_tokens.toLocaleString()}</td>
                                            <td className="p-4 text-white font-bold text-right">${row.cost_usd.toFixed(4)}</td>
                                            <td className="p-4 text-slate-500 text-right">{row.pct_of_total}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default SyncPage;
