import { useEffect, useState } from 'react';
import { ArrowLeft, Box, CheckCircle, Copy, Code, MessageSquare, Terminal } from 'lucide-react';
import { StatusBadge, formatTimeAgo } from '../components/StatusBadge';
import { API_BASE_URL } from '../config';

interface RequestDetailProps {
    requestId: string;
    onBack: () => void;
}

export function RequestDetail({ requestId, onBack }: RequestDetailProps) {
    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState<string | null>(null);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/requests/${requestId}`)
            .then(res => res.json())
            .then(resData => {
                setDetail(resData.data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch request detail:', err);
                setLoading(false);
            });
    }, [requestId]);

    const handleCopy = (text: string, type: string) => {
        navigator.clipboard.writeText(text);
        setCopied(type);
        setTimeout(() => setCopied(null), 2000);
    };

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="animate-pulse h-8 w-24 bg-surfaceHighlight rounded mb-8"></div>
                <div className="animate-pulse h-[500px] w-full bg-surfaceHighlight rounded-3xl"></div>
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="p-8 max-w-7xl mx-auto text-center mt-20">
                <div className="inline-flex p-6 rounded-full bg-danger/5 border border-danger/10 mb-4">
                    <Box className="w-12 h-12 text-danger opacity-20" />
                </div>
                <h2 className="text-xl font-bold text-white">Trace Not Found</h2>
                <p className="text-textMuted mt-2">The request ID might be invalid or has been purged from the logs.</p>
                <button onClick={onBack} className="mt-8 text-primary font-bold hover:underline">Return to Logs</button>
            </div>
        );
    }

    const tryParseJSON = (str: string) => {
        if (!str) return null;
        try {
            return JSON.parse(str);
        } catch (_) {
            return str;
        }
    };

    const reqBodyData = typeof detail.request_body === 'string' ? tryParseJSON(detail.request_body) : detail.request_body;
    const resBodyData = typeof detail.response_body === 'string' ? tryParseJSON(detail.response_body) : detail.response_body;

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in pb-20">
            <button
                onClick={onBack}
                className="group flex items-center gap-2 text-textMuted hover:text-white transition-all mb-10 text-xs font-black uppercase tracking-widest pl-1"
            >
                <div className="p-2 rounded-lg bg-surfaceHighlight group-hover:bg-border transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                </div>
                Back to Request Logs
            </button>

            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-12">
                <div className="flex items-center gap-5">
                    <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 shadow-2xl">
                        <Terminal className="w-8 h-8 text-primary" />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-black text-white tracking-tighter">Trace Details</h1>
                            <StatusBadge statusCode={detail.status_code} status={detail.status} />
                        </div>
                        <p className="text-sm font-bold text-textMuted mt-1 font-mono">{detail.id}</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-surfaceHighlight/50 p-2 rounded-2xl border border-white/5">
                    <div className="px-4 py-2 text-right border-r border-white/5">
                        <p className="text-[10px] font-black text-textMuted uppercase tracking-widest leading-none mb-1">Captured At</p>
                        <p className="text-xs font-bold text-white">{new Date(detail.created_at).toLocaleString()}</p>
                    </div>
                    <div className="px-4 py-2">
                        <p className="text-[10px] font-black text-textMuted uppercase tracking-widest leading-none mb-1">Time Ago</p>
                        <p className="text-xs font-bold text-white">{formatTimeAgo(detail.created_at)}</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                {[
                    { label: 'Provider & Model', value: detail.provider, sub: detail.model, color: 'text-primary' },
                    { label: 'Latency', value: `${detail.latency_ms}ms`, sub: detail.is_streaming ? 'Streaming' : 'REST (Blocking)', color: 'text-white' },
                    { label: 'Token Usage', value: detail.total_tokens.toLocaleString(), sub: `P: ${detail.prompt_tokens} / C: ${detail.completion_tokens}`, color: 'text-white' },
                    { label: 'Cost Est.', value: `$${detail.cost_usd.toFixed(6)}`, sub: 'USD (Computed)', color: 'text-danger' },
                ].map((stat, i) => (
                    <div key={i} className="glass-panel p-6 border-white/5 shadow-xl relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-1 h-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                        <p className="text-[10px] font-black text-textMuted uppercase tracking-widest mb-3">{stat.label}</p>
                        <p className={`text-2xl font-black tracking-tight ${stat.color}`}>{stat.value}</p>
                        <p className="text-xs font-bold text-textMuted mt-1">{stat.sub}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Request */}
                <div className="flex flex-col h-full">
                    <div className="flex justify-between items-center mb-4 px-2">
                        <div className="flex items-center gap-2">
                            <Code className="w-4 h-4 text-primary" />
                            <h3 className="font-black text-xs uppercase tracking-widest text-white">Request Context</h3>
                        </div>
                        <button
                            onClick={() => handleCopy(JSON.stringify(reqBodyData, null, 2), 'request')}
                            className="p-2 rounded-lg bg-surfaceHighlight hover:bg-white/10 transition-colors text-textMuted hover:text-white"
                        >
                            {copied === 'request' ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="glass-panel flex-1 min-h-[500px] border-white/5 shadow-2xl overflow-hidden flex flex-col">
                        <div className="bg-white/5 px-6 py-3 border-b border-white/5 flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-primary">{detail.endpoint}</span>
                            <span className="text-[10px] font-black uppercase text-textMuted tracking-tighter">JSON Payload</span>
                        </div>
                        <div className="p-6 overflow-auto bg-[#050505] flex-1 font-mono text-[13px] leading-relaxed">
                            <pre className="text-green-400">
                                {JSON.stringify(reqBodyData, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>

                {/* Response */}
                <div className="flex flex-col h-full">
                    <div className="flex justify-between items-center mb-4 px-2">
                        <div className="flex items-center gap-2">
                            <MessageSquare className="w-4 h-4 text-accent" />
                            <h3 className="font-black text-xs uppercase tracking-widest text-white">LLM Response</h3>
                        </div>
                        <button
                            onClick={() => handleCopy(JSON.stringify(resBodyData, null, 2), 'response')}
                            className="p-2 rounded-lg bg-surfaceHighlight hover:bg-white/10 transition-colors text-textMuted hover:text-white"
                        >
                            {copied === 'response' ? <CheckCircle className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="glass-panel flex-1 min-h-[500px] border-white/5 shadow-2xl overflow-hidden flex flex-col">
                        <div className="bg-white/5 px-6 py-3 border-b border-white/5 flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-accent">Completion</span>
                            <span className="text-[10px] font-black uppercase text-textMuted tracking-tighter">JSON Payload</span>
                        </div>
                        <div className="p-6 overflow-auto bg-[#050505] flex-1 font-mono text-[13px] leading-relaxed">
                            <pre className="text-blue-400">
                                {JSON.stringify(resBodyData, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

