import { useEffect, useState } from 'react';
import { ArrowLeft, Box, CheckCircle } from 'lucide-react';
import { StatusBadge, formatTimeAgo } from '../components/StatusBadge';

interface RequestDetailProps {
    requestId: string;
    onBack: () => void;
}

export function RequestDetail({ requestId, onBack }: RequestDetailProps) {
    const [detail, setDetail] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`http://localhost:4001/api/requests/${requestId}`)
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

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="animate-pulse h-8 w-24 bg-surfaceHighlight rounded mb-8"></div>
                <div className="animate-pulse h-[400px] w-full bg-surfaceHighlight rounded-xl"></div>
            </div>
        );
    }

    if (!detail) {
        return (
            <div className="p-8 max-w-7xl mx-auto text-center text-textMuted mt-20">
                Request not found.
            </div>
        );
    }

    const tryParseJSON = (str: string) => {
        if (!str) return null;
        try {
            return JSON.parse(str);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
            return null;
        }
    };

    const reqBodyData = tryParseJSON(detail.request_body) || detail.request_body;
    const resBodyData = tryParseJSON(detail.response_body) || detail.response_body;

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-textMuted hover:text-white transition-colors mb-6 text-sm font-medium"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Requests
            </button>

            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Box className="w-6 h-6 text-primary" />
                        {detail.id}
                    </h1>
                    <div className="flex items-center gap-4 mt-3 text-sm text-textMuted">
                        <span>{new Date(detail.created_at).toLocaleString()}</span>
                        <span>({formatTimeAgo(detail.created_at)})</span>
                    </div>
                </div>
                <StatusBadge statusCode={detail.status_code} status={detail.status} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                <div className="card p-5">
                    <p className="text-sm text-textMuted mb-1">Provider & Model</p>
                    <p className="font-medium text-white">{detail.provider}</p>
                    <p className="text-sm text-primary">{detail.model}</p>
                </div>
                <div className="card p-5">
                    <p className="text-sm text-textMuted mb-1">Tokens Used</p>
                    <p className="font-medium text-white">{detail.total_tokens.toLocaleString()}</p>
                    <p className="text-sm text-textMuted text-xs mt-1">
                        P: {detail.prompt_tokens} / C: {detail.completion_tokens}
                    </p>
                </div>
                <div className="card p-5">
                    <p className="text-sm text-textMuted mb-1">Total Cost</p>
                    <p className="font-medium text-danger">\${detail.cost_usd.toFixed(6)}</p>
                </div>
                <div className="card p-5">
                    <p className="text-sm text-textMuted mb-1">Metrics</p>
                    <p className="font-medium text-white">{detail.latency_ms}ms</p>
                    {detail.is_streaming === 1 && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-primary mt-1 border border-primary/20 bg-primary/10 px-1.5 py-0.5 rounded">
                            <CheckCircle className="w-3 h-3" /> Streamed
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="card p-0 overflow-hidden flex flex-col">
                    <div className="bg-surfaceHighlight/50 border-b border-border p-4">
                        <h3 className="font-semibold text-white">Request Payload</h3>
                        <p className="text-xs text-textMuted">{detail.endpoint}</p>
                    </div>
                    <div className="p-4 bg-[#0D1117] overflow-y-auto max-h-[600px]">
                        <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap">
                            {typeof reqBodyData === 'object'
                                ? JSON.stringify(reqBodyData, null, 2)
                                : reqBodyData}
                        </pre>
                    </div>
                </div>

                <div className="card p-0 overflow-hidden flex flex-col">
                    <div className="bg-surfaceHighlight/50 border-b border-border p-4">
                        <h3 className="font-semibold text-white">Response Payload</h3>
                    </div>
                    <div className="p-4 bg-[#0D1117] overflow-y-auto max-h-[600px]">
                        <pre className="text-sm text-blue-400 font-mono whitespace-pre-wrap">
                            {typeof resBodyData === 'object'
                                ? JSON.stringify(resBodyData, null, 2)
                                : resBodyData}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
}
