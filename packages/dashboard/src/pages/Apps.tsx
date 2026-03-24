import { useState, useEffect, useCallback } from 'react';
import { 
    MonitorSmartphone, 
    Play, 
    ChevronRight, 
    ArrowLeft, 
    Clock, 
    Zap 
} from 'lucide-react';
import { 
    BarChart, 
    Bar, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    Cell,
    AreaChart,
    Area
} from 'recharts';
import clsx from 'clsx';

interface AppSpend {
    process_name: string;
    display_name: string;
    estimated_cost_usd: number;
    connection_count: number;
    pct: number;
    is_subscription?: boolean;
}

interface AppsData {
    period: string;
    apps: AppSpend[];
    unattributed_usd: number;
    note: string;
}

interface NetworkStatus {
    running: boolean;
    platform: string;
    knownIps: number;
    lastLoggedCount: number;
    scanIntervalMs: number;
}

interface AppDetail {
    timeline: { date: string, cost_usd: number, connections: number }[];
    providers: Record<string, number>;
    connection_frequency: number;
    display_name: string;
}

export default function Apps() {
    const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
    const [data, setData] = useState<AppsData | null>(null);
    const [status, setStatus] = useState<NetworkStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedApp, setSelectedApp] = useState<string | null>(null);
    const [appDetail, setAppDetail] = useState<AppDetail | null>(null);
    const [renamingApp, setRenamingApp] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [showDiagnostics, setShowDiagnostics] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [appsRes, statusRes] = await Promise.all([
                fetch(`/api/apps?period=${period}`),
                fetch('/api/network/status')
            ]);
            if (appsRes.ok) setData(await appsRes.json());
            if (statusRes.ok) setStatus(await statusRes.json());
        } catch (err) {
            console.error('Failed to fetch apps data', err);
        } finally {
            setLoading(false);
        }
    }, [period]);

    const fetchAppDetail = useCallback(async (name: string) => {
        try {
            const res = await fetch(`/api/apps/${name}/detail?days=30`);
            if (res.ok) {
                setAppDetail(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch app detail', err);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [fetchData]);

    useEffect(() => {
        if (selectedApp) {
            fetchAppDetail(selectedApp);
        } else {
            setAppDetail(null);
        }
    }, [selectedApp, fetchAppDetail]);

    const toggleMonitor = async () => {
        const action = status?.running ? 'stop' : 'start';
        try {
            const res = await fetch(`/api/network/${action}`, { method: 'POST' });
            if (res.ok) {
                fetchData();
            }
        } catch (err) {
            console.error(`Failed to ${action} monitor`, err);
        }
    };

    const handleRename = async (processName: string) => {
        if (!newName.trim()) return;
        try {
            const res = await fetch(`/api/apps/${processName}/alias`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ display_name: newName })
            });
            if (res.ok) {
                setRenamingApp(null);
                setNewName('');
                fetchData();
                if (selectedApp === processName) {
                    fetchAppDetail(processName);
                }
            }
        } catch (err) {
            console.error('Failed to rename app', err);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-[80vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-700 py-10 px-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-4">
                    {selectedApp && (
                        <button 
                            onClick={() => setSelectedApp(null)}
                            className="p-2 bg-surfaceHighlight hover:bg-surfaceHighlight/80 rounded-xl transition-all"
                        >
                            <ArrowLeft className="w-5 h-5 text-white" />
                        </button>
                    )}
                    <div>
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/20 rounded-lg">
                                <MonitorSmartphone className="w-6 h-6 text-primary" />
                            </div>
                            <h1 className="text-4xl font-black text-white tracking-tight">
                                {selectedApp ? appDetail?.display_name : 'App Attribution'}
                            </h1>
                        </div>
                        <p className="text-textMuted text-lg font-medium mt-1">
                            {selectedApp ? 'Detailed usage patterns for this application.' : 'See which apps are driving your AI costs.'}
                        </p>
                    </div>
                </div>

                {!selectedApp && (
                    <div className="flex items-center gap-4">
                        <div className="bg-surface p-1 rounded-xl border border-border flex gap-1">
                            {(['today', 'week', 'month'] as const).map(p => (
                                <button
                                    key={p}
                                    onClick={() => setPeriod(p)}
                                    className={clsx(
                                        "px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                                        period === p ? "bg-white text-black shadow-lg" : "text-textMuted hover:text-white"
                                    )}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Monitor Status Banner (if off) */}
            {!status?.running && !selectedApp && (
                <div className="bg-primary/10 border border-primary/30 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-6 text-center md:text-left">
                        <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center">
                            <Zap className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white">Network Monitor is disabled</h3>
                            <p className="text-textMuted max-w-lg mt-1">
                                Enable the monitor to track which applications (Cursor, VS Code, etc.) are connecting to AI APIs.
                                <span className="text-primary font-bold ml-1">Privacy:</span> No traffic content is ever inspected.
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={toggleMonitor}
                        className="bg-primary text-white font-black px-10 py-4 rounded-2xl hover:bg-primary/90 transition-all active:scale-95 shadow-xl shadow-primary/20 flex items-center gap-2"
                    >
                        <Play className="w-5 h-5 fill-current" />
                        Enable Tracker
                    </button>
                </div>
            )}

            {status?.running && !data?.apps.length && !selectedApp && (
                <div className="bg-surface border-2 border-dashed border-border rounded-3xl p-16 text-center">
                    <div className="w-16 h-16 bg-surfaceHighlight rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Clock className="w-8 h-8 text-textMuted animate-pulse" />
                    </div>
                    <h3 className="text-2xl font-bold text-white italic">"Collecting data..."</h3>
                    <p className="text-textMuted max-w-md mx-auto mt-2">
                        The monitor is active and waiting for AI traffic. Try using Cursor, Claude Code, or any AI-powered IDE now.
                        Check back in an hour for your first detailed breakdown.
                    </p>
                </div>
            )}

            {selectedApp && appDetail ? (
                /* App Detail View */
                <div className="space-y-10 animate-in fade-in duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-surface border border-border rounded-3xl p-6 relative overflow-hidden group">
                                <h3 className="text-[9px] uppercase tracking-[0.2em] font-black text-textMuted mb-1">Estimated Cost (30d)</h3>
                                <div className="text-4xl font-black text-white">
                                    ${Object.values(appDetail.providers).reduce((a, b) => a + b, 0).toFixed(2)}
                                </div>
                        </div>
                        <div className="bg-surface border border-border rounded-3xl p-6">
                            <h3 className="text-[9px] uppercase tracking-[0.2em] font-black text-textMuted mb-1">Avg Connections / Day</h3>
                            <div className="text-4xl font-black text-white">{appDetail.connection_frequency.toFixed(1)}</div>
                        </div>
                        <div className="bg-surface border border-border rounded-3xl p-6">
                            <h3 className="text-[9px] uppercase tracking-[0.2em] font-black text-textMuted mb-1">Primary Provider</h3>
                            <div className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-2 mt-2">
                                <span className="w-2 h-2 rounded-full bg-primary" />
                                {Object.entries(appDetail.providers).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown'}
                            </div>
                        </div>
                    </div>

                    <div className="bg-surface border border-border rounded-3xl p-10">
                        <div className="flex items-center justify-between mb-10">
                            <div>
                                <h3 className="text-2xl font-bold text-white tracking-tight">Usage Trajectory</h3>
                                <p className="text-xs text-textMuted mt-1 uppercase tracking-widest font-black">Daily estimated cost and connection frequency</p>
                            </div>
                        </div>
                        <div className="h-[400px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={appDetail.timeline}>
                                    <defs>
                                        <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                    <XAxis 
                                        dataKey="date" 
                                        stroke="#475569" fontSize={10} tickLine={false} axisLine={false}
                                        tickFormatter={d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    />
                                    <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                                    <Tooltip 
                                        contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px' }}
                                        labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                                    />
                                    <Area type="monotone" dataKey="cost_usd" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorCost)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            ) : (
                data && data.apps.length > 0 && (
                    <div className="space-y-10">
                        <div className="bg-surface border border-border rounded-3xl p-10">
                            <h3 className="text-2xl font-bold text-white tracking-tight mb-10">Cost Breakdown by Application</h3>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.apps} layout="vertical" margin={{ left: 40, right: 40 }}>
                                        <XAxis type="number" hide />
                                        <YAxis dataKey="display_name" type="category" stroke="#94a3b8" fontSize={12} width={100} tickLine={false} axisLine={false} />
                                        <Tooltip 
                                            cursor={{ fill: '#ffffff05' }}
                                            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                                            formatter={(value: any) => [`$${value.toFixed(2)}`, 'Estimated Cost']}
                                        />
                                        <Bar dataKey="estimated_cost_usd" radius={[0, 4, 4, 0]} barSize={24}>
                                            {data.apps.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={index === 0 ? '#4f46e5' : '#312e81'} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {data.apps.map(app => (
                                <button
                                    key={app.process_name}
                                    onClick={() => setSelectedApp(app.process_name)}
                                    className="bg-surface border border-border rounded-3xl p-6 text-left group hover:border-primary/50 hover:bg-surfaceHighlight transition-all duration-300"
                                >
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                            <MonitorSmartphone className="w-6 h-6" />
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="bg-surfaceHighlight px-3 py-1 rounded-full text-[10px] font-black text-textMuted uppercase group-hover:text-white">
                                                {app.connection_count} conns
                                            </div>
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setRenamingApp(app.process_name);
                                                    setNewName(app.display_name);
                                                }}
                                                className="text-[8px] font-black text-primary uppercase hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                Rename
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {renamingApp === app.process_name ? (
                                        <div className="mb-4 space-y-2" onClick={e => e.stopPropagation()}>
                                            <input 
                                                autoFocus
                                                value={newName}
                                                onChange={e => setNewName(e.target.value)}
                                                className="w-full bg-background border border-primary rounded px-2 py-1 text-sm text-white"
                                                onKeyDown={e => e.key === 'Enter' && handleRename(app.process_name)}
                                            />
                                            <div className="flex gap-2">
                                                <button onClick={() => handleRename(app.process_name)} className="text-[10px] font-bold text-success uppercase">Save</button>
                                                <button onClick={() => setRenamingApp(null)} className="text-[10px] font-bold text-textMuted uppercase">Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <h4 className="text-xl font-bold text-white mb-1">{app.display_name}</h4>
                                            <p className="text-textMuted text-xs mb-4 font-mono">{app.process_name}</p>
                                        </>
                                    )}

                                    {app.is_subscription && (
                                        <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Zap className="w-3 h-3 text-primary" />
                                                <span className="text-[10px] font-black text-primary uppercase">Subscription Mode Detected</span>
                                            </div>
                                            <p className="text-[9px] text-textMuted leading-relaxed">
                                                This app connects to AI APIs but sync shows $0. It likely uses its own license or a Pro subscription.
                                            </p>
                                        </div>
                                    )}

                                    <div className="space-y-3 mt-4">
                                        <div className="flex justify-between items-end">
                                            <span className="text-[10px] font-black text-textMuted uppercase tracking-widest">Estimated Cost</span>
                                            <span className="text-xl font-black text-white">${app.estimated_cost_usd.toFixed(2)}</span>
                                        </div>
                                        <div className="h-1.5 bg-surfaceHighlight rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-primary transition-all duration-1000"
                                                style={{ width: `${app.pct}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between items-center text-[10px] font-bold text-textMuted">
                                            <span>{app.pct.toFixed(1)}% of total burn</span>
                                            <ChevronRight className="w-4 h-4 text-textMuted group-hover:text-primary group-hover:translate-x-1 transition-all" />
                                        </div>
                                    </div>
                                </button>
                            ))}

                            <div className="bg-surface/50 border border-dashed border-border rounded-3xl p-6 flex flex-col justify-center opacity-70">
                                <h4 className="text-lg font-bold text-textMuted mb-1 italic">Unattributed Sync Cost</h4>
                                <div className="text-3xl font-black text-white">${data.unattributed_usd.toFixed(2)}</div>
                                <p className="text-[10px] text-textMuted mt-2 leading-relaxed">
                                    Sync usage detected without corresponding network traffic during scan cycle.
                                </p>
                            </div>
                        </div>
                    </div>
                )
            )}

            <div className="pt-6 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-black uppercase tracking-widest text-textMuted">
                <div className="flex items-center gap-6">
                    <button 
                        onClick={() => setShowDiagnostics(!showDiagnostics)}
                        className="flex items-center gap-2 hover:text-white transition-colors"
                    >
                        <div className={clsx("w-2 h-2 rounded-full animate-pulse", status?.running ? "bg-success" : "bg-error")} />
                        Monitor {status?.running ? "Active" : "Stopped"} (Status Details)
                    </button>
                </div>
                <div className="italic opacity-60">
                    {data?.note}
                </div>
            </div>

            {showDiagnostics && status && (
                <div className="bg-surfaceHighlight/50 rounded-3xl p-10 grid grid-cols-2 md:grid-cols-4 gap-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div>
                        <h4 className="text-[9px] font-black text-textMuted uppercase mb-2">Platform</h4>
                        <div className="text-lg font-bold text-white capitalize">{status.platform}</div>
                    </div>
                    <div>
                        <h4 className="text-[9px] font-black text-textMuted uppercase mb-2">Known AI IPs</h4>
                        <div className="text-lg font-bold text-white">{status.knownIps}</div>
                    </div>
                    <div>
                        <h4 className="text-[9px] font-black text-textMuted uppercase mb-2">Scan Interval</h4>
                        <div className="text-lg font-bold text-white">{status.scanIntervalMs}ms</div>
                    </div>
                    <div>
                        <h4 className="text-[9px] font-black text-textMuted uppercase mb-2">Recent Logs</h4>
                        <div className="text-lg font-bold text-white">{status.lastLoggedCount} items</div>
                    </div>
                </div>
            )}
        </div>
    );
}
