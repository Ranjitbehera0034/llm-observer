import { useState, useEffect, useCallback } from 'react';
import { 
    Gift, 
    TrendingUp, 
    PieChart, 
    BarChart3, 
    AlertCircle, 
    Zap, 
    CheckCircle2, 
    Info,
    Calendar,
    Share2,
    Eye,
    EyeOff,
    Bot,
    Cpu
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { API_BASE_URL } from '../config';

interface WrappedReport {
    period: string;
    type: 'monthly' | 'yearly';
    stats: {
        total_spend: number;
        total_requests: number;
        total_tokens: number;
        days_active: number;
    };
    breakdowns: {
        by_source: { API: number; Subscriptions: number };
        by_provider: Record<string, number>;
        by_model: Array<{ model: string; spend: number; requests: number }>;
    };
    trends: {
        daily: Array<{ date: string; spend: number }>;
        peak_day: { date: string; spend: number };
        trough_day: { date: string; spend: number };
        day_of_week: Record<string, number>;
    };
    app_breakdown: Array<{ name: string; spend: number; connections: number }>;
    insights: Array<{
        type: 'model_optimization' | 'cache_efficiency' | 'subscription_value' | 'budget_compliance';
        title: string;
        description: string;
        savings_usd?: number;
    }>;
    top_session?: {
        project_name: string;
        provider: string;
        cost_usd: number;
    };
    agent_stats: {
        total_agents: number;
        total_agent_cost: number;
        avg_agents_per_day: number;
        most_active_type: string;
    };
}

interface WrappedPreferences {
    show_total_spend: boolean;
    show_per_app: boolean;
    show_subscriptions: boolean;
    show_insights: boolean;
}

export default function Wrapped() {
    const [report, setReport] = useState<WrappedReport | null>(null);
    const [availablePeriods, setAvailablePeriods] = useState<{ months: string[]; years: string[] } | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<string>('');
    const [periodType, setPeriodType] = useState<'monthly' | 'yearly'>('monthly');
    const [prefs, setPrefs] = useState<WrappedPreferences>({
        show_total_spend: true,
        show_per_app: true,
        show_subscriptions: true,
        show_insights: true
    });
    const [loading, setLoading] = useState(true);
    const [generatingCard, setGeneratingCard] = useState(false);

    const fetchInitialData = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/wrapped/available-periods`);
            if (res.ok) {
                const data = await res.json();
                setAvailablePeriods(data);
                if (data.months.length > 0) {
                    setSelectedPeriod(data.months[0]);
                }
            }

            const prefRes = await fetch(`${API_BASE_URL}/api/wrapped/preferences`);
            if (prefRes.ok) {
                setPrefs(await prefRes.json());
            }
        } catch (err) {
            console.error('Failed to fetch initial wrapped data', err);
        }
    }, []);

    const fetchReport = useCallback(async (period: string, type: 'monthly' | 'yearly') => {
        if (!period) return;
        setLoading(true);
        try {
            const url = type === 'monthly' 
                ? `${API_BASE_URL}/api/wrapped/monthly?month=${period}`
                : `${API_BASE_URL}/api/wrapped/yearly?year=${period}`;
            const res = await fetch(url);
            if (res.ok) {
                setReport(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch report', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        if (selectedPeriod) {
            fetchReport(selectedPeriod, periodType);
        }
    }, [selectedPeriod, periodType, fetchReport]);

    const handleTogglePref = async (key: keyof WrappedPreferences) => {
        const newPrefs = { ...prefs, [key]: !prefs[key] };
        setPrefs(newPrefs);
        try {
            await fetch(`${API_BASE_URL}/api/wrapped/preferences`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newPrefs)
            });
        } catch (err) {
            console.error('Failed to update preferences', err);
        }
    };

    const downloadCard = async () => {
        if (!selectedPeriod) return;
        setGeneratingCard(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/wrapped/card?period=${selectedPeriod}&type=${periodType}&format=svg`);
            if (res.ok) {
                const svgBlob = await res.blob();
                const url = URL.createObjectURL(svgBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `AI_Wrapped_${selectedPeriod}.svg`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error('Failed to download card', err);
        } finally {
            setGeneratingCard(false);
        }
    };

    if (loading && !report) return (
        <div className="flex items-center justify-center h-[80vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
    );

    const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#3b82f6'];

    return (
        <div className="max-w-7xl mx-auto space-y-10 py-10 px-6 animate-in fade-in slide-in-from-bottom-2 duration-700">
            {/* Header & Period Selector */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Gift className="w-6 h-6 text-indigo-400" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">AI Wrapped</h1>
                    </div>
                    <p className="text-slate-400 text-lg font-medium mt-1">Your year in AI, visualized.</p>
                </div>

                <div className="flex flex-col md:items-end gap-3">
                    <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
                        <button 
                            onClick={() => { setPeriodType('monthly'); setSelectedPeriod(availablePeriods?.months[0] || ''); }}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${periodType === 'monthly' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Monthly
                        </button>
                        <button 
                            onClick={() => { setPeriodType('yearly'); setSelectedPeriod(availablePeriods?.years[0] || ''); }}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${periodType === 'yearly' ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Yearly
                        </button>
                    </div>
                    
                    <select 
                        value={selectedPeriod}
                        onChange={(e) => setSelectedPeriod(e.target.value)}
                        className="bg-slate-900 border border-slate-800 text-white rounded-xl px-4 py-2 text-sm font-bold focus:outline-none focus:border-indigo-500"
                    >
                        {periodType === 'monthly' 
                            ? availablePeriods?.months.map(m => <option key={m} value={m}>{m}</option>)
                            : availablePeriods?.years.map(y => <option key={y} value={y}>{y}</option>)
                        }
                    </select>
                </div>
            </div>

            {report ? (
                <>
                    {/* Stats Overview */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {[
                            { label: 'Total Spend', value: `$${report.stats.total_spend.toFixed(2)}`, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                            { label: 'Total Requests', value: report.stats.total_requests.toLocaleString(), icon: Zap, color: 'text-indigo-400', bg: 'bg-indigo-400/10' },
                            { label: 'Tokens Processed', value: `${(report.stats.total_tokens / 1000000).toFixed(1)}M`, icon: Info, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                            { label: 'Days Active', value: `${report.stats.days_active}`, icon: Calendar, color: 'text-amber-400', bg: 'bg-amber-400/10' }
                        ].map((stat, i) => (
                            <div key={i} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 group hover:border-slate-700 transition-all">
                                <div className={`w-10 h-10 ${stat.bg} ${stat.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                                    <stat.icon className="w-5 h-5" />
                                </div>
                                <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-1">{stat.label}</h3>
                                <div className="text-3xl font-black text-white">{stat.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Main Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Daily Spend Chart */}
                        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <BarChart3 className="w-5 h-5 text-indigo-400" />
                                Spending Pattern
                            </h3>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={report.trends.daily}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                        <XAxis 
                                            dataKey="date" 
                                            stroke="#475569" fontSize={10} tickLine={false} axisLine={false} 
                                            tickFormatter={d => d.split('-')[2]} // Show only day
                                        />
                                        <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                                        <Tooltip 
                                            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '16px' }}
                                            cursor={{ fill: '#ffffff05' }}
                                        />
                                        <Bar dataKey="spend" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Top Models Breakdown */}
                        <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                <PieChart className="w-5 h-5 text-purple-400" />
                                Top Models
                            </h3>
                            <div className="space-y-4">
                                {report.breakdowns.by_model.slice(0, 5).map((m, i) => (
                                    <div key={m.model} className="space-y-1.5">
                                        <div className="flex justify-between items-end text-xs">
                                            <span className="text-slate-400 font-bold truncate max-w-[150px]">{m.model}</span>
                                            <span className="text-white font-black">${m.spend.toFixed(2)}</span>
                                        </div>
                                        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full rounded-full transition-all duration-1000"
                                                style={{ 
                                                    width: `${(m.spend / report.breakdowns.by_model[0].spend) * 100}%`,
                                                    backgroundColor: COLORS[i % COLORS.length]
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Insights & Comparison */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        {/* Highlights & Insights */}
                        <div className="space-y-6">
                            <h3 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                                Efficiency Insights
                                <Zap className="w-6 h-6 text-amber-400 fill-amber-400" />
                            </h3>
                            <div className="grid gap-4">
                                {report.insights.map((insight, i) => (
                                    <div key={i} className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex gap-5 hover:border-indigo-500/30 transition-all group">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                                            {insight.type === 'model_optimization' ? <TrendingUp className="w-6 h-6 text-indigo-400" /> : <Zap className="w-6 h-6 text-amber-400" />}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors">{insight.title}</h4>
                                            <p className="text-slate-400 text-sm mt-1 leading-relaxed">{insight.description}</p>
                                            {insight.savings_usd && (
                                                <div className="mt-4 flex items-center gap-2 text-emerald-400 text-sm font-black uppercase tracking-widest">
                                                    <CheckCircle2 className="w-4 h-4" />
                                                    Est. Savings: ${insight.savings_usd.toFixed(2)} / period
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {report.top_session && (
                                    <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex gap-5 hover:border-indigo-500/30 transition-all group">
                                        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center shrink-0">
                                            <Zap className="w-6 h-6 text-indigo-400" />
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-lg group-hover:text-indigo-400 transition-colors">Most Expensive Session</h4>
                                            <p className="text-slate-400 text-sm mt-1 leading-relaxed">
                                                In this period, your most token-heavy AI tool session was working on <strong className="text-slate-300">{report.top_session.project_name}</strong> using {report.top_session.provider}.
                                            </p>
                                            <div className="mt-4 flex items-center gap-2 text-rose-400 text-sm font-black uppercase tracking-widest">
                                                <TrendingUp className="w-4 h-4" />
                                                Est. Cost: ${report.top_session.cost_usd.toFixed(2)}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {report.insights.length === 0 && !report.top_session && (
                                    <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-3xl p-10 text-center">
                                        <p className="text-slate-500 text-sm font-medium">No efficiency suggestions for this period. Great job!</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Agentic Growth Section (v1.10.0) */}
                        {report.agent_stats.total_agents > 0 && (
                            <div className="lg:col-span-2 space-y-6">
                                <h3 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                                    Agentic Growth
                                    <Bot className="w-7 h-7 text-indigo-400" />
                                </h3>
                                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 relative overflow-hidden">
                                     <div className="absolute top-0 right-0 p-8 opacity-5">
                                        <Cpu className="w-32 h-32 text-indigo-500" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12 relative z-10">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-4">Autonomous Capability</p>
                                            <div className="text-6xl font-black text-white mb-2">{report.agent_stats.total_agents}</div>
                                            <p className="text-slate-400 font-medium">Subagents spawned in this period. Your workflow is becoming increasingly agentic.</p>
                                            
                                            <div className="mt-8 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-bold text-slate-500 uppercase">Avg Daily Agents</span>
                                                    <span className="text-sm font-black text-white">{report.agent_stats.avg_agents_per_day.toFixed(1)}</span>
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-bold text-slate-500 uppercase">Dominant agent mode</span>
                                                    <span className="text-sm font-black text-indigo-400 uppercase tracking-wider">{report.agent_stats.most_active_type}</span>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="bg-black/40 border border-slate-800 rounded-3xl p-8 flex flex-col justify-center">
                                            <p className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2">Agent Contribution</p>
                                            <div className="text-4xl font-black text-emerald-400 mb-4 shadow-emerald-500/20 shadow-xl">
                                                ${report.agent_stats.total_agent_cost.toFixed(2)}
                                            </div>
                                            <p className="text-xs text-slate-400 leading-relaxed">
                                                Subagents accounted for <strong className="text-white">{Math.round((report.agent_stats.total_agent_cost / report.stats.total_spend) * 100)}%</strong> of your total AI spend this period. 
                                                High agency comes with high token density.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Per-App & Source Breakdown */}
                        <div className="space-y-6">
                            <h3 className="text-2xl font-black text-white tracking-tight">App Breakdown</h3>
                            <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8">
                                <div className="space-y-6">
                                    {report.app_breakdown.slice(0, 5).map((app, i) => (
                                        <div key={app.name} className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-xs font-black text-slate-400">
                                                    {i + 1}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-white">{app.name}</div>
                                                    <div className="text-[10px] text-slate-500 font-bold uppercase">{app.connections.toLocaleString()} requests</div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-black text-white">${app.spend.toFixed(2)}</div>
                                                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                                                    {((app.spend / report.stats.total_spend) * 100).toFixed(1)}%
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {report.app_breakdown.length === 0 && (
                                        <div className="text-center py-10">
                                            <AlertCircle className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                                            <p className="text-slate-500 text-sm">Enable Network Monitor in settings to see per-app attribution.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Shareable Card Section */}
                    <div className="pt-10 border-t border-slate-800">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                            <div>
                                <h3 className="text-3xl font-black text-white tracking-tight mb-4">Share your Wrapped</h3>
                                <p className="text-slate-400 text-lg leading-relaxed mb-8">
                                    Generate a beautiful summary of your AI usage to share with your team or online. 
                                    Don't worry, we've filtered out all sensitive project names and workspace IDs.
                                </p>
                                
                                <div className="space-y-4 max-w-sm">
                                    {[
                                        { key: 'show_total_spend', label: 'Show Total Spend' },
                                        { key: 'show_per_app', label: 'Show App Breakdown' },
                                        { key: 'show_subscriptions', label: 'Include Subscriptions' },
                                        { key: 'show_insights', label: 'Include Top Insight' }
                                    ].map(item => (
                                        <button 
                                            key={item.key}
                                            onClick={() => handleTogglePref(item.key as keyof WrappedPreferences)}
                                            className="w-full flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-indigo-500/50 transition-all"
                                        >
                                            <span className="text-sm font-bold text-white uppercase tracking-wider">{item.label}</span>
                                            {prefs[item.key as keyof WrappedPreferences] ? <Eye className="w-5 h-5 text-indigo-400" /> : <EyeOff className="w-5 h-5 text-slate-600" />}
                                        </button>
                                    ))}
                                </div>

                                <button 
                                    onClick={downloadCard}
                                    disabled={generatingCard}
                                    className="mt-10 flex items-center gap-3 bg-white text-black font-black px-10 py-5 rounded-3xl hover:bg-slate-200 transition-all active:scale-95 shadow-2xl shadow-white/5 disabled:opacity-50"
                                >
                                    <Share2 className="w-6 h-6" />
                                    {generatingCard ? 'GENERATING...' : 'DOWNLOAD CARD (.SVG)'}
                                </button>
                            </div>

                            <div className="bg-slate-950 p-4 rounded-[3rem] border border-slate-800 shadow-2xl relative overflow-hidden group">
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 pointer-events-none" />
                                <div className="aspect-[1200/630] w-full rounded-2xl overflow-hidden border border-slate-800">
                                    {/* Real SVG Preview from API */}
                                    <img 
                                        src={`${API_BASE_URL}/api/wrapped/card?period=${selectedPeriod}&type=${periodType}&t=${Date.now()}`} // t param to force reload on pref change
                                        alt="AI Wrapped Card Preview"
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="absolute top-8 right-8 bg-indigo-500 text-white text-[10px] font-black px-3 py-1.5 rounded-full shadow-xl">
                                    PREVIEW
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="bg-slate-900 border-2 border-dashed border-slate-800 rounded-[3rem] p-20 text-center">
                    <Calendar className="w-20 h-20 text-slate-800 mx-auto mb-6" />
                    <h3 className="text-2xl font-black text-white">No data for this period</h3>
                    <p className="text-slate-500 mt-2 max-w-md mx-auto">
                        We couldn't find any usage records or API sync data for {selectedPeriod}. 
                        Reports are available once you've made at least one request through the proxy or synced a provider account.
                    </p>
                </div>
            )}
        </div>
    );
}
