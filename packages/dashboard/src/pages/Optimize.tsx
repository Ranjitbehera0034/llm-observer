import { useState, useEffect, useMemo } from 'react';
import { 
    Zap, 
    TrendingDown, 
    CheckCircle2, 
    RefreshCcw, 
    ArrowRight,
    ShieldCheck,
    Cpu,
    Layers,
    Clock,
    Ghost,
    Filter,
    BarChart2
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { API_BASE_URL } from '../config';

interface OptimizationResult {
    ruleId: string;
    title: string;
    description: string;
    category: string;
    impact: 'high' | 'medium' | 'low';
    estimatedMonthlySavings: number;
    action: string;
    configSnippet?: string;
    dataPoints: Record<string, any>;
}

interface OptimizationRun {
    score: number;
    totalSavingsUsd: number;
    results: OptimizationResult[];
    computedAt: string;
    daysAnalyzed: number;
}

const CATEGORY_ICONS: Record<string, any> = {
    'model-selection': Cpu,
    'context-efficiency': Layers,
    'provider-optimization': ShieldCheck,
    'workflow-efficiency': Clock,
    'agent-optimization': Zap
};

const CATEGORY_LABEL: Record<string, string> = {
    'model-selection': 'Model Selection',
    'context-efficiency': 'Context Efficiency',
    'provider-optimization': 'Provider Optimization',
    'workflow-efficiency': 'Workflow Efficiency',
    'agent-optimization': 'Agent Optimization',
};

const CATEGORY_COLOR: Record<string, string> = {
    'model-selection': '#818cf8',
    'context-efficiency': '#34d399',
    'provider-optimization': '#f472b6',
    'workflow-efficiency': '#fbbf24',
    'agent-optimization': '#60a5fa',
};

const IMPACT_COLORS = {
    high: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
    medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
    low: 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20'
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL);
const ALL_IMPACTS: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];

export default function Optimize() {
    const [data, setData] = useState<OptimizationRun | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [filterCategory, setFilterCategory] = useState<string>('all');
    const [filterImpact, setFilterImpact] = useState<string>('all');

    const fetchData = async (refresh = false) => {
        if (refresh) setRefreshing(true);
        else setLoading(true);
        
        try {
            const url = `${API_BASE_URL}/api/optimize?days=30${refresh ? '&refresh=true' : ''}`;
            const res = await fetch(url);
            if (res.ok) {
                setData(await res.json());
            }
        } catch (err) {
            console.error('Failed to fetch optimization data', err);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Filter recommendations
    const filteredResults = useMemo(() => {
        if (!data) return [];
        return data.results.filter(r => {
            if (filterCategory !== 'all' && r.category !== filterCategory) return false;
            if (filterImpact !== 'all' && r.impact !== filterImpact) return false;
            return true;
        });
    }, [data, filterCategory, filterImpact]);

    // Per-category savings for the breakdown chart
    const categoryBreakdown = useMemo(() => {
        if (!data) return [];
        return ALL_CATEGORIES.map(cat => ({
            name: CATEGORY_LABEL[cat].replace(' ', '\n'),
            shortName: CATEGORY_LABEL[cat].split(' ')[0],
            savings: data.results
                .filter(r => r.category === cat)
                .reduce((acc, r) => acc + r.estimatedMonthlySavings, 0),
            color: CATEGORY_COLOR[cat],
        })).filter(c => c.savings > 0);
    }, [data]);

    if (loading) return (
        <div className="flex items-center justify-center h-[80vh]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto space-y-12 py-10 px-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-500/20 rounded-xl">
                            <Zap className="w-6 h-6 text-emerald-400" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">Optimization Engine <span className="text-emerald-400 ml-2">v2</span></h1>
                    </div>
                    <p className="text-slate-400 text-lg font-medium mt-2">Actionable insights to slash your AI spending by up to 40%.</p>
                </div>

                <button 
                    onClick={() => fetchData(true)}
                    disabled={refreshing}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-6 py-3 rounded-2xl transition-all active:scale-95 disabled:opacity-50"
                >
                    <RefreshCcw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Analyzing...' : 'Scan Now'}
                </button>
            </div>

            {/* Score & Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <ShieldCheck className="w-20 h-20 text-indigo-400" />
                    </div>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2 text-center">Efficiency Score</h3>
                    <div className="flex flex-col items-center justify-center">
                        <div className="relative w-32 h-32 flex items-center justify-center">
                            <svg className="w-full h-full -rotate-90">
                                <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-800" />
                                <circle 
                                    cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" 
                                    strokeDasharray={364.4}
                                    strokeDashoffset={364.4 - (364.4 * (data?.score || 0)) / 100}
                                    className={`transition-all duration-1000 ease-out ${data?.score && data.score > 80 ? 'text-emerald-500' : data?.score && data.score > 50 ? 'text-amber-500' : 'text-rose-500'}`}
                                />
                            </svg>
                            <span className="absolute text-4xl font-black text-white">{data?.score}%</span>
                        </div>
                        <p className="text-[11px] font-bold text-slate-400 uppercase mt-4 tracking-widest">
                            {data?.score && data.score > 80 ? 'Highly Efficient' : data?.score && data.score > 50 ? 'Needs Optimization' : 'Inefficient Ops'}
                        </p>
                    </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 relative overflow-hidden group md:col-span-2 flex flex-col justify-center">
                    <div className="absolute top-0 right-0 p-8 opacity-10">
                        <TrendingDown className="w-24 h-24 text-emerald-400" />
                    </div>
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-black text-slate-500 mb-2">Total Monthly Potential Savings</h3>
                    <div className="text-7xl font-black text-emerald-400 mb-2 tracking-tighter">
                        ${data?.totalSavingsUsd.toFixed(2)}<span className="text-2xl text-slate-600 ml-2">/ mo</span>
                    </div>
                    <p className="text-slate-400 font-medium text-lg max-w-xl">
                        We've identified <b>{data?.results.length}</b> actionable ways to reduce your spend across <b>{categoryBreakdown.length}</b> categories.
                    </p>
                </div>
            </div>

            {/* Category Savings Breakdown Chart */}
            {categoryBreakdown.length > 0 && (
                <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <BarChart2 className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Savings by Category</h3>
                    </div>
                    <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={categoryBreakdown} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
                                <XAxis dataKey="shortName" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                                <Tooltip
                                    contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', padding: '10px' }}
                                    labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                                    formatter={(v: any) => [`$${Number(v).toFixed(2)}/mo`, 'Est. Savings']}
                                    cursor={{ fill: '#ffffff05' }}
                                />
                                <Bar dataKey="savings" radius={[6, 6, 0, 0]} barSize={40}>
                                    {categoryBreakdown.map((entry, idx) => (
                                        <Cell key={idx} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
                    <Filter className="w-4 h-4" />
                    Filter
                </div>

                {/* Category filter */}
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setFilterCategory('all')}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filterCategory === 'all' ? 'bg-white text-black border-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                    >All Categories</button>
                    {ALL_CATEGORIES.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setFilterCategory(cat === filterCategory ? 'all' : cat)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filterCategory === cat ? 'bg-white text-black border-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            {CATEGORY_LABEL[cat].split(' ')[0]}
                        </button>
                    ))}
                </div>

                <div className="w-px h-6 bg-slate-700" />

                {/* Impact filter */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setFilterImpact('all')}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filterImpact === 'all' ? 'bg-white text-black border-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                    >All Impact</button>
                    {ALL_IMPACTS.map(imp => (
                        <button
                            key={imp}
                            onClick={() => setFilterImpact(imp === filterImpact ? 'all' : imp)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${filterImpact === imp ? 'bg-white text-black border-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
                        >
                            {imp === 'high' ? '🔴 High' : imp === 'medium' ? '🟡 Medium' : '🟢 Low'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Recommendations List */}
            <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-xl font-bold text-white tracking-tight uppercase tracking-widest text-xs">Actionable Recommendations</h3>
                    <div className="flex items-center gap-4">
                         <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{filteredResults.length} of {data?.results.length} Rules Triggered</span>
                    </div>
                </div>

                {filteredResults.length === 0 ? (
                    <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[2.5rem] p-20 text-center">
                        <Ghost className="w-16 h-16 text-slate-700 mx-auto mb-6" />
                        <h4 className="text-2xl font-bold text-white">
                            {data?.results.length === 0 ? 'No optimizations found!' : 'No results match your filters'}
                        </h4>
                        <p className="text-slate-500 mt-2">
                            {data?.results.length === 0
                                ? 'Your setup is already highly efficient. Check back as we add more rules.'
                                : 'Try clearing the category or impact filters.'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-6">
                        {filteredResults.map((result, idx) => {
                            const Icon = CATEGORY_ICONS[result.category] || Zap;
                            return (
                                <div key={idx} className="bg-slate-900 border border-slate-800 rounded-[2rem] p-8 group hover:border-indigo-500/30 transition-all flex flex-col md:flex-row gap-8 items-start">
                                    <div className={`p-5 rounded-2xl ${IMPACT_COLORS[result.impact]} border shrink-0`}>
                                        <Icon className="w-8 h-8" />
                                    </div>
                                    
                                    <div className="flex-1 space-y-3">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h4 className="text-2xl font-black text-white tracking-tight">{result.title}</h4>
                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${IMPACT_COLORS[result.impact]} border`}>
                                                {result.impact} Impact
                                            </span>
                                            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-800 border border-slate-700">
                                                {CATEGORY_LABEL[result.category] || result.category}
                                            </span>
                                        </div>
                                        <p className="text-slate-400 font-medium text-lg leading-relaxed">{result.description}</p>
                                        
                                        <div className="pt-4 flex flex-col md:flex-row gap-4 items-start md:items-center">
                                            <div className="bg-emerald-500/10 border border-emerald-500/20 px-5 py-3 rounded-2xl flex items-center gap-3">
                                                <TrendingDown className="w-5 h-5 text-emerald-400" />
                                                <span className="text-lg font-black text-emerald-400">${result.estimatedMonthlySavings.toFixed(2)} <small className="opacity-60 text-xs uppercase ml-1">Est. Savings</small></span>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-1">Recommended Action</p>
                                                <p className="text-white font-bold flex items-center gap-2">
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                                    {result.action}
                                                </p>
                                            </div>
                                        </div>

                                        {result.configSnippet && (
                                            <div className="mt-4 p-4 bg-black rounded-2xl border border-slate-800 font-mono text-[11px] text-slate-300 relative group/snippet">
                                                <div className="absolute top-3 right-4 text-[9px] font-black text-slate-600 uppercase tracking-widest">Configuration Suggestion</div>
                                                {result.configSnippet}
                                            </div>
                                        )}
                                    </div>

                                    <div className="shrink-0 w-full md:w-auto self-stretch">
                                        <button className="h-full px-8 py-4 bg-white text-black font-black uppercase tracking-widest text-[11px] rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2 w-full active:scale-95 group/btn">
                                            Apply
                                            <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            {/* Disclaimer */}
            <div className="text-center pb-10">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em]">Analysis computed at {new Date(data?.computedAt || '').toLocaleString()} based on last {data?.daysAnalyzed} days of activity.</p>
            </div>
        </div>
    );
}
