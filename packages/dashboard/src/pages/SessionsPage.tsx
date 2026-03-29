import { useEffect, useState, useCallback } from 'react';
import { Database, Filter, Search, RotateCcw, Clock, Zap, Cpu, TerminalSquare, Activity, Info } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface SessionRow {
    id: number;
    provider: string;
    session_id: string;
    project_name: string;
    model_primary: string;
    started_at: string;
    duration_seconds: number;
    message_count: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    estimated_cost_usd: number;
    session_type: string;
    has_subagents: boolean;
    subagent_count: number;
    tool_calls_json: string;
}

export default function Sessions() {
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [summary, setSummary] = useState<any>({});
    const [providers, setProviders] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [expandedRow, setExpandedRow] = useState<number | null>(null);
    const [page, setPage] = useState(1);

    // Filters
    const [providerFilter, setProviderFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [searchParam, setSearchParam] = useState('');

    const loadData = useCallback(() => {
        setLoading(true);
        const params = new URLSearchParams({
            page: page.toString(),
            limit: '50',
            provider: providerFilter,
            type: typeFilter,
            search: searchParam
        });

        Promise.all([
            fetch(`${API_BASE_URL}/api/sessions?${params.toString()}`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/sessions/summary`).then(r => r.json()),
            fetch(`${API_BASE_URL}/api/sessions/providers`).then(r => r.json())
        ]).then(([sessionsRes, summaryRes, providersRes]) => {
            setSessions(sessionsRes.data || []);
            setSummary(summaryRes || {});
            setProviders(providersRes || {});
            setLoading(false);
        }).catch(err => {
            console.error('Failed to load sessions:', err);
            setLoading(false);
        });
    }, [page, providerFilter, typeFilter, searchParam]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Polling for parsing progress
    useEffect(() => {
        let interval: any;
        const isParsing = Object.values(providers).some((p: any) => p?.status === 'parsing');
        if (isParsing) {
            interval = setInterval(() => {
                fetch(`${API_BASE_URL}/api/sessions/providers`).then(r => r.json()).then(data => {
                    setProviders(data);
                    if (!Object.values(data).some((p: any) => p?.status === 'parsing')) {
                        loadData();
                    }
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [providers, loadData]);

    const handleRefresh = async () => {
        try {
            await fetch(`${API_BASE_URL}/api/sessions/refresh`, { method: 'POST' });
            // wait a couple seconds for parse to complete
            setTimeout(loadData, 2000);
        } catch (e) {
            console.error(e);
        }
    };

    const resetFilters = () => {
        setProviderFilter('');
        setTypeFilter('');
        setSearchParam('');
        setPage(1);
    };

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div>
                    <h1 className="text-4xl font-black text-white tracking-tight flex items-center gap-3">
                        <Database className="w-8 h-8 text-indigo-400" />
                        Session Explorer
                    </h1>
                    <p className="text-textMuted mt-1 font-medium pl-11">End-to-end local tool conversations tracked automatically.</p>
                </div>

                <div className="flex gap-4 items-center">
                    <button onClick={handleRefresh} className="px-5 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded-xl text-sm font-bold tracking-wide transition-colors">
                        Force Manual Sync
                    </button>
                </div>
            </div>

            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-5 py-4 mb-8 flex items-start gap-4 text-sm text-indigo-200/80">
                <Info className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                    <strong className="text-indigo-300 font-bold">Note:</strong> Per-session costs are estimated dynamically from token counts. 
                    Daily totals on the Overview page use billing-verified data synced directly from the provider APIs when available.
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                    <p className="text-xs font-black text-textMuted uppercase tracking-widest mb-1">Total Parsed Sessions</p>
                    <p className="text-3xl font-black text-white">{summary.total_sessions || 0}</p>
                    <Activity className="absolute -right-2 -bottom-2 w-20 h-20 text-white/[0.02] group-hover:text-white/[0.04] transition-colors" />
                </div>
                <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                    <p className="text-xs font-black text-textMuted uppercase tracking-widest mb-1">Total Estimated Cost</p>
                    <p className="text-3xl font-black text-white">${(summary.total_cost || 0).toFixed(2)}</p>
                    <Zap className="absolute -right-2 -bottom-2 w-20 h-20 text-white/[0.02] group-hover:text-primary/[0.04] transition-colors" />
                </div>
                <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                    <p className="text-xs font-black text-textMuted uppercase tracking-widest mb-1">Agentic Sessions</p>
                    <p className="text-3xl font-black text-white">{summary.agentic_count || 0}</p>
                    <Cpu className="absolute -right-2 -bottom-2 w-20 h-20 text-white/[0.02] group-hover:text-amber-500/[0.05] transition-colors" />
                </div>
                <div className="glass-panel p-6 border-white/5 relative overflow-hidden group">
                    <p className="text-xs font-black text-textMuted uppercase tracking-widest mb-1">Interactive Sessions</p>
                    <p className="text-3xl font-black text-white">{summary.interactive_count || 0}</p>
                    <TerminalSquare className="absolute -right-2 -bottom-2 w-20 h-20 text-white/[0.02] group-hover:text-white/[0.04] transition-colors" />
                </div>
            </div>

            {/* Filters */}
            <div className="glass-panel p-4 mb-8 flex flex-wrap items-center gap-4 border-white/5 shadow-2xl">
                <div className="flex items-center gap-2 text-textMuted mr-2">
                    <Filter className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Filters</span>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-textMuted" />
                    <input
                        type="text"
                        placeholder="Search Project..."
                        className="bg-background/50 border border-white/5 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors w-48"
                        value={searchParam}
                        onChange={(e) => setSearchParam(e.target.value)}
                    />
                </div>

                <select
                    className="bg-background/50 border border-white/5 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors cursor-pointer"
                    value={providerFilter}
                    onChange={(e) => setProviderFilter(e.target.value)}
                >
                    <option value="">All Tools</option>
                    <option value="claude-code">Claude Code</option>
                    <option value="cursor">Cursor IDE</option>
                    <option value="aider">Aider</option>
                </select>

                <select
                    className="bg-background/50 border border-white/5 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-colors cursor-pointer"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                >
                    <option value="">All Types</option>
                    <option value="interactive">Interactive</option>
                    <option value="agentic">Agentic</option>
                </select>

                {(providerFilter || typeFilter || searchParam) && (
                    <button onClick={resetFilters} className="flex items-center gap-2 text-xs font-bold text-textMuted hover:text-white transition-colors ml-auto">
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset
                    </button>
                )}
            </div>

            {loading ? (
                <div className="animate-pulse h-[400px] w-full bg-surface/50 rounded-3xl border border-white/5" />
            ) : (
                <div className="glass-panel border-white/5 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 bg-surfaceHighlight/30">
                                <th className="py-4 px-6 text-xs font-black text-textMuted uppercase tracking-widest">Date</th>
                                <th className="py-4 px-6 text-xs font-black text-textMuted uppercase tracking-widest">Tool</th>
                                <th className="py-4 px-6 text-xs font-black text-textMuted uppercase tracking-widest">Project</th>
                                <th className="py-4 px-6 text-xs font-black text-textMuted uppercase tracking-widest text-right" title="Estimated from local token counting. See Overview for billing-verified totals.">Est. Cost</th>
                                <th className="py-4 px-6 text-xs font-black text-textMuted uppercase tracking-widest text-right">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-16 text-center text-textMuted">
                                        {Object.values(providers).some((p: any) => p?.status === 'parsing') ? (
                                            <div className="flex flex-col items-center gap-4 justify-center">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                                                <div>
                                                    <p className="text-white font-bold text-base mb-1">Parsing session history...</p>
                                                    {Object.entries(providers).map(([name, p]: [string, any]) => (
                                                        p?.status === 'parsing' && p?.progress?.total > 0 && (
                                                            <p key={name} className="text-xs text-textMuted font-mono bg-surfaceHighlight/50 px-3 py-1 rounded inline-block">
                                                                {p.progress.current} / {p.progress.total} files
                                                            </p>
                                                        )
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <span>No session history found. Run <code>claude</code> or <code>aider</code> to generate local files!</span>
                                        )}
                                    </td>
                                </tr>
                            ) : sessions.map(session => (
                                <tr 
                                    key={session.id} 
                                    onClick={() => setExpandedRow(expandedRow === session.id ? null : session.id)}
                                    className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors cursor-pointer group"
                                >
                                    <td className="py-4 px-6 text-sm text-textMuted">
                                        <div className="flex flex-col">
                                            <span className="text-white font-medium">{new Date(session.started_at).toLocaleDateString()}</span>
                                            <span className="text-xs">{new Date(session.started_at).toLocaleTimeString()}</span>
                                        </div>
                                    </td>
                                    <td className="py-4 px-6">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-white font-medium capitalize">{session.provider.replace('-', ' ')}</span>
                                            {session.session_type === 'agentic' && (
                                                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-wider">Agent</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="py-4 px-6">
                                        <span className="text-sm text-textMuted font-mono group-hover:text-indigo-400 transition-colors">{session.project_name}</span>
                                    </td>
                                    <td className="py-4 px-6 text-right font-mono text-sm font-medium text-emerald-400">
                                        ${session.estimated_cost_usd.toFixed(4)}
                                    </td>
                                    <td className="py-4 px-6 text-right">
                                        <span className="text-sm text-textMuted flex items-center justify-end gap-1">
                                            <Clock className="w-3.5 h-3.5 opacity-50" />
                                            {Math.floor((session.duration_seconds || 0) / 60)}m {(session.duration_seconds || 0) % 60}s
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            
            {/* Pagination Controls */}
            {!loading && <div className="flex justify-between items-center mt-8">
                <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="px-6 py-2.5 bg-surfaceHighlight/50 hover:bg-white/[0.05] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                    Prev Page
                </button>
                <div className="px-4 py-2 bg-background/50 rounded-full border border-white/5 text-[10px] font-black text-textMuted uppercase tracking-widest">
                    Page <span className="text-indigo-500">{page}</span>
                </div>
                <button
                    disabled={sessions.length < 50}
                    onClick={() => setPage(page + 1)}
                    className="px-6 py-2.5 bg-surfaceHighlight/50 hover:bg-white/[0.05] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                    Next Page
                </button>
            </div>}
        </div>
    );
}
