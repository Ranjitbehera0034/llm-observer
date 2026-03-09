import { useEffect, useState, useCallback, useRef } from 'react';
import { RequestTable } from '../components/RequestTable';
import type { RequestRow } from '../components/RequestTable';
import { Activity, Filter, Search, RotateCcw } from 'lucide-react';
import { RequestDetail } from './RequestDetail';
import { API_BASE_URL } from '../config';

export default function Requests() {
    const [requests, setRequests] = useState<RequestRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Filters
    const [provider, setProvider] = useState('');
    const [status, setStatus] = useState('');
    const [modelSearch, setModelSearch] = useState('');

    const sseRef = useRef<EventSource | null>(null);

    const loadRequests = useCallback((targetPage: number) => {
        setLoading(true);
        const params = new URLSearchParams({
            page: targetPage.toString(),
            limit: '50',
            provider,
            status,
            model: modelSearch
        });

        fetch(`${API_BASE_URL}/api/requests?${params.toString()}`)
            .then(res => res.json())
            .then(resData => {
                setRequests(resData.data);
                setTotalPages(resData.meta?.totalPages || 1);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch requests:', err);
                setLoading(false);
            });
    }, [provider, status, modelSearch]);

    useEffect(() => {
        loadRequests(page);
    }, [page, loadRequests]);

    // SSE Real-time listener
    useEffect(() => {
        sseRef.current = new EventSource(`${API_BASE_URL}/api/events`);

        sseRef.current.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === 'new_request') {
                    const newReq = parsed.data;

                    // Client-side filtering check
                    if (provider && newReq.provider !== provider) return;
                    if (status) {
                        if (status === 'error' && newReq.status_code < 400) return;
                        if (status !== 'error' && newReq.status !== status) return;
                    }

                    // Prepend new request
                    setRequests((prev) => {
                        const newArray = [newReq, ...prev];
                        return newArray.slice(0, 50);
                    });
                }
            } catch (err) { }
        };

        return () => {
            sseRef.current?.close();
        };
    }, [provider, status]);

    const resetFilters = () => {
        setProvider('');
        setStatus('');
        setModelSearch('');
        setPage(1);
    };

    if (selectedRequest) {
        return <RequestDetail
            requestId={selectedRequest.id}
            onBack={() => setSelectedRequest(null)}
        />;
    }

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                <div>
                    <h1 className="text-4xl font-black text-white tracking-tight flex items-center gap-3">
                        <Activity className="w-8 h-8 text-primary" />
                        Live Traffic
                    </h1>
                    <p className="text-textMuted mt-1 font-medium pl-11">Granular inspection of every LLM interaction.</p>
                </div>

                <div className="flex items-center gap-2 text-xs text-primary font-bold bg-primary/10 px-4 py-2 rounded-2xl border border-primary/20 shadow-[0_0_15px_rgba(79,70,229,0.1)]">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                    </span>
                    SSE ACTIVE
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
                        placeholder="Search Model..."
                        className="bg-background/50 border border-white/5 rounded-xl pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors w-48"
                        value={modelSearch}
                        onChange={(e) => setModelSearch(e.target.value)}
                    />
                </div>

                <select
                    className="bg-background/50 border border-white/5 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                >
                    <option value="">All Providers</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Gemini</option>
                </select>

                <select
                    className="bg-background/50 border border-white/5 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors cursor-pointer"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                >
                    <option value="">All Statuses</option>
                    <option value="success">Success</option>
                    <option value="error">Errors Only</option>
                    <option value="blocked_budget">Budget Blocked</option>
                </select>

                {(provider || status || modelSearch) && (
                    <button
                        onClick={resetFilters}
                        className="flex items-center gap-2 text-xs font-bold text-textMuted hover:text-white transition-colors ml-auto"
                    >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset
                    </button>
                )}
            </div>

            {loading ? (
                <div className="animate-pulse h-[600px] w-full bg-surface/50 rounded-3xl border border-white/5" />
            ) : (
                <RequestTable
                    requests={requests}
                    onRowClick={(req) => setSelectedRequest(req)}
                />
            )}

            {/* Pagination Controls */}
            {!loading && (
                <div className="flex justify-between items-center mt-8">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                        className="px-6 py-2.5 bg-surfaceHighlight/50 hover:bg-white/[0.05] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                        Prev Page
                    </button>
                    <div className="px-4 py-2 bg-background/50 rounded-full border border-white/5 text-[10px] font-black text-textMuted uppercase tracking-widest">
                        Page <span className="text-primary">{page}</span> of {totalPages}
                    </div>
                    <button
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                        className="px-6 py-2.5 bg-surfaceHighlight/50 hover:bg-white/[0.05] text-white rounded-xl font-bold text-xs uppercase tracking-widest transition-all border border-white/5 disabled:opacity-20 disabled:cursor-not-allowed"
                    >
                        Next Page
                    </button>
                </div>
            )}
        </div>
    );
}
