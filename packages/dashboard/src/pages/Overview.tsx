import { useState, useEffect, useCallback } from 'react';
import { 
    LayoutDashboard, 
    CreditCard, 
    TrendingUp, 
    Plus, 
    Trash2, 
    Info, 
    ChevronRight,
    Search
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { SUBSCRIPTION_PRESETS } from '../data/subscriptionPresets';

interface SubscriptionRecord {
    id: number;
    service_name: string;
    provider?: string;
    monthly_cost_usd: number;
    billing_cycle: 'monthly' | 'yearly';
    is_active: number;
    start_date: string;
    end_date?: string;
    notes?: string;
}

interface OverviewData {
    period: 'today' | 'week' | 'month';
    total_usd: number;
    tracked_api: {
        total_usd: number;
        providers: Record<string, { total_usd: number; source: 'sync' | 'proxy' }>;
    };
    subscriptions: {
        total_monthly_commitment_usd: number;
        period_cost_usd: number;
        active_count: number;
        active: SubscriptionRecord[];
    };
}

interface TimelinePoint {
    date: string;
    tracked_api_usd: number;
    subscriptions_daily_usd: number;
    total_usd: number;
}

export default function Overview() {
    const [todayData, setTodayData] = useState<OverviewData | null>(null);
    const [weekData, setWeekData] = useState<OverviewData | null>(null);
    const [monthData, setMonthData] = useState<OverviewData | null>(null);
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddSub, setShowAddSub] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'today' | 'week' | 'month'>('today');

    const fetchData = useCallback(async () => {
        try {
            const [todayRes, weekRes, monthRes, timelineRes] = await Promise.all([
                fetch('/api/overview?period=today'),
                fetch('/api/overview?period=week'),
                fetch('/api/overview?period=month'),
                fetch('/api/overview/timeline?days=30')
            ]);
            
            if (todayRes.ok) setTodayData(await todayRes.json());
            if (weekRes.ok) setWeekData(await weekRes.json());
            if (monthRes.ok) setMonthData(await monthRes.json());
            if (timelineRes.ok) setTimeline(await timelineRes.json());
        } catch (err) {
            console.error('Failed to fetch overview data', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60_000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleAddSub = async (preset: Partial<SubscriptionRecord>) => {
        try {
            const res = await fetch('/api/subscriptions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preset)
            });
            if (res.ok) {
                setShowAddSub(false);
                fetchData();
            }
        } catch (err) {
            console.error('Failed to add subscription', err);
        }
    };

    const handleDeleteSub = async (id: number) => {
        if (!confirm('Remove this subscription?')) return;
        try {
            await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
            fetchData();
        } catch (err) {
            console.error('Failed to delete subscription', err);
        }
    };

    if (loading) return (
        <div className="flex items-center justify-center h-[80vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
    );

    const data = activeTab === 'today' ? todayData : (activeTab === 'week' ? weekData : monthData);

    const filteredPresets = SUBSCRIPTION_PRESETS.filter(p => 
        p.service_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-700 py-10 px-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <LayoutDashboard className="w-6 h-6 text-indigo-400" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">Control Room</h1>
                    </div>
                    <p className="text-slate-400 text-lg font-medium mt-1">Unified view of your AI spending.</p>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex gap-1">
                        {(['today', 'week', 'month'] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                    activeTab === tab 
                                    ? 'bg-white text-black shadow-lg' 
                                    : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    <button 
                        onClick={() => setShowAddSub(true)}
                        className="flex items-center gap-2 bg-white text-black font-bold px-6 py-2.5 rounded-xl hover:bg-slate-200 transition-all active:scale-95 shadow-xl shadow-white/5"
                    >
                        <Plus className="w-4 h-4" />
                        Add Subscription
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                        <TrendingUp className="w-12 h-12 text-emerald-400" />
                    </div>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2">
                        {activeTab === 'today' ? "Today's Burn" : (activeTab === 'week' ? "This Week" : "This Month")}
                    </h3>
                    <div className="text-5xl font-black text-white">${data?.total_usd.toFixed(2) || '0.00'}</div>
                    <div className="flex flex-wrap gap-2 mt-4">
                        <span className="text-[10px] px-2 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold">
                            API: ${data?.tracked_api?.total_usd?.toFixed(2) || '0.00'}
                        </span>
                        <span className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                            SUBS: ${data?.subscriptions?.period_cost_usd?.toFixed(2) || '0.00'}
                        </span>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CreditCard className="w-12 h-12 text-indigo-400" />
                    </div>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2">Monthly Commitment</h3>
                    <div className="text-5xl font-black text-white">${data?.subscriptions?.total_monthly_commitment_usd?.toFixed(0) || '0'}</div>
                    <p className="text-xs text-slate-500 mt-4 font-bold uppercase tracking-wider">Across {data?.subscriptions?.active_count || 0} active services</p>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col justify-center">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500">Data Sources</h3>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-emerald-500 uppercase">Live</span>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {Object.entries(data?.tracked_api?.providers || {}).map(([id, p]: [string, any]) => (
                            <div key={id} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${p.source === 'sync' ? 'bg-indigo-400' : 'bg-slate-500'}`} />
                                    <div className="flex flex-col">
                                        <p className="text-xs font-bold text-white uppercase leading-tight">{id}</p>
                                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-tighter">
                                            {p.source === 'sync' ? '● Verified Sync' : '◌ Proxy Logs'}
                                        </p>
                                    </div>
                                </div>
                                <p className="text-xs font-mono text-slate-400">${p.total_usd?.toFixed(2) || '0.00'}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Chart Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-10">
                <div className="flex items-center justify-between mb-10">
                    <div>
                        <h3 className="text-2xl font-bold text-white tracking-tight">Spending Trajectory</h3>
                        <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-black">Daily tracked API costs vs. Subscription overhead</p>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-indigo-500" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Tracked API</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-slate-700" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Subscriptions</span>
                        </div>
                    </div>
                </div>
                <div className="h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={timeline} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis 
                                dataKey="date" 
                                stroke="#475569" fontSize={10} tickLine={false} axisLine={false} 
                                tickFormatter={d => {
                                    const date = new Date(d);
                                    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                }}
                            />
                            <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                            <Tooltip 
                                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px', padding: '12px' }}
                                labelStyle={{ color: '#94a3b8', fontWeight: 'bold', marginBottom: '8px' }}
                                cursor={{ fill: '#ffffff05' }}
                            />
                            <Bar dataKey="tracked_api_usd" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} barSize={32} />
                            <Bar dataKey="subscriptions_daily_usd" stackId="a" fill="#334155" radius={[4, 4, 0, 0]} barSize={32} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Subscriptions Grid */}
            <div>
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-bold text-white tracking-tight">Active Subscriptions</h3>
                </div>
                {data?.subscriptions.active.length === 0 ? (
                    <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-3xl p-12 text-center group cursor-pointer hover:border-indigo-500/50 transition-all" onClick={() => setShowAddSub(true)}>
                        <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                            <Plus className="w-8 h-8 text-slate-500 group-hover:text-indigo-400" />
                        </div>
                        <h4 className="text-white font-bold text-lg">No active subscriptions</h4>
                        <p className="text-slate-500 text-sm mt-1">Track fixed costs like Cursor Pro or ChatGPT Plus here.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {data?.subscriptions.active.map(sub => (
                            <div key={sub.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 group hover:border-indigo-500/30 transition-all">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="w-10 h-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-lg font-bold text-indigo-400">
                                        {sub.service_name.charAt(0)}
                                    </div>
                                    <button onClick={() => handleDeleteSub(sub.id)} className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                                <h4 className="font-bold text-white text-lg">{sub.service_name}</h4>
                                <div className="flex items-baseline gap-1 mt-1">
                                    <span className="text-2xl font-black text-white">${sub.monthly_cost_usd}</span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">/ month</span>
                                </div>
                                {sub.notes && <p className="text-xs text-slate-600 mt-3 line-clamp-1">{sub.notes}</p>}
                            </div>
                        ))}
                        <button 
                            onClick={() => setShowAddSub(true)}
                            className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center hover:border-indigo-500/50 group transition-all"
                        >
                            <Plus className="w-6 h-6 text-slate-600 group-hover:text-indigo-400 mb-2" />
                            <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-400 uppercase tracking-widest">Add New</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Add Subscription Modal */}
            {showAddSub && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md bg-black/60">
                    <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-10">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h2 className="text-3xl font-black text-white tracking-tight">Add Subscription</h2>
                                    <p className="text-slate-400 font-medium">Select a service to start tracking its cost.</p>
                                </div>
                                <button onClick={() => setShowAddSub(false)} className="bg-slate-800 p-2 rounded-xl text-slate-400 hover:text-white transition-all">
                                    <Info className="w-6 h-6 rotate-45" />
                                </button>
                            </div>

                            <div className="relative mb-8">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                <input 
                                    type="text" 
                                    placeholder="Search services (Cursor, Copilot, OpenAI...)"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    autoFocus
                                    className="w-full bg-black border border-slate-800 rounded-2xl py-4 pl-12 pr-6 text-white text-lg focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {filteredPresets.map(preset => {
                                    const isDuplicate = todayData?.subscriptions.active.some(s => s.service_name === preset.service_name);

                                    return (
                                        <button 
                                            key={preset.service_name} 
                                            onClick={() => {
                                                if (isDuplicate) {
                                                    alert(`You already have an active ${preset.service_name} subscription.`);
                                                    return;
                                                }
                                                handleAddSub(preset);
                                            }}
                                            className={`bg-black/40 border p-6 rounded-2xl text-left transition-all flex items-center justify-between group ${
                                                isDuplicate ? 'opacity-50 border-slate-800 grayscale cursor-not-allowed' : 'border-slate-800 hover:border-indigo-500/50 hover:bg-black'
                                            }`}
                                        >
                                            <div>
                                                <h4 className="font-bold text-white mb-1">{preset.service_name}</h4>
                                                <span className="text-lg font-black text-indigo-400">${preset.monthly_cost_usd} <span className="text-[10px] text-slate-600 uppercase">/ mo</span></span>
                                                {isDuplicate && <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Already Tracking</p>}
                                            </div>
                                            {!isDuplicate && <ChevronRight className="w-5 h-5 text-slate-800 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
