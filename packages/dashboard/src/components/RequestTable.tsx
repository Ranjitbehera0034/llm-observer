import { StatusBadge, formatTimeAgo } from './StatusBadge';
import { Database, Clock, Activity } from 'lucide-react';

export interface RequestRow {
    id: string;
    provider: string;
    model: string;
    endpoint: string;
    total_tokens: number;
    cost_usd: number;
    latency_ms: number;
    status_code: number;
    status: string;
    is_streaming: number;
    created_at: string;
}

interface RequestTableProps {
    requests: RequestRow[];
    onRowClick: (req: RequestRow) => void;
}

export function RequestTable({ requests, onRowClick }: RequestTableProps) {
    return (
        <div className="w-full overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="border-b border-border bg-surfaceHighlight/50">
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider">Time</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider">Model</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider hidden md:table-cell">Endpoint</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider text-right">Tokens</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider text-right">Cost</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider text-right">Latency</th>
                        <th className="p-4 text-xs font-semibold text-textMuted uppercase tracking-wider text-center">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {requests.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="p-8 text-center text-textMuted">
                                No requests found. Start making LLM calls through the proxy!
                            </td>
                        </tr>
                    ) : (
                        requests.map((req) => (
                            <tr
                                key={req.id}
                                onClick={() => onRowClick(req)}
                                className="hover:bg-surfaceHighlight transition-colors cursor-pointer group"
                            >
                                <td className="p-4 whitespace-nowrap text-sm text-textMuted flex items-center gap-2">
                                    <Clock className="w-4 h-4 opacity-50" />
                                    {formatTimeAgo(req.created_at)}
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm">
                                    <div className="font-medium text-white">{req.model}</div>
                                    <div className="text-xs text-textMuted">{req.provider}</div>
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm text-textMuted hidden md:table-cell">
                                    <div className="flex items-center gap-1.5">
                                        <Activity className="w-3.5 h-3.5" />
                                        {req.endpoint}
                                    </div>
                                    {req.is_streaming === 1 && (
                                        <span className="inline-block mt-1 px-1.5 py-0.5 bg-accent/10 border border-accent/20 rounded text-[10px] text-accent uppercase tracking-wide">
                                            Stream
                                        </span>
                                    )}
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm text-right">
                                    <div className="flex items-center justify-end gap-1.5 text-textMain">
                                        <Database className="w-3.5 h-3.5 text-textMuted" />
                                        {req.total_tokens.toLocaleString()}
                                    </div>
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm text-right font-medium text-white">
                                    ${req.cost_usd.toFixed(4)}
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm text-right text-textMuted">
                                    {req.latency_ms}ms
                                </td>
                                <td className="p-4 whitespace-nowrap text-sm text-center">
                                    <StatusBadge statusCode={req.status_code} status={req.status} />
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
