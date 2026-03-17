import { StatusBadge, formatTimeAgo } from './StatusBadge';
import { Database, Clock, Activity, Cpu, Sparkles, Zap, Ghost } from 'lucide-react';

export interface RequestRow {
    id: string;
    provider: string;
    model: string;
    endpoint: string;
    prompt_tokens: number;
    completion_tokens: number;
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

function ProviderBadge({ provider }: { provider: string }) {
    const p = provider.toLowerCase();

    if (p.includes('openai')) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-1 font-bold text-[10px] uppercase bg-green-500/10 text-green-500 rounded-lg border border-green-500/20">
                <Cpu className="w-3 h-3" />
                OpenAI
            </div>
        );
    }
    if (p.includes('anthropic') || p.includes('claude')) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-1 font-bold text-[10px] uppercase bg-orange-500/10 text-orange-500 rounded-lg border border-orange-500/20">
                <Ghost className="w-3 h-3" />
                Anthropic
            </div>
        );
    }
    if (p.includes('google') || p.includes('gemini')) {
        return (
            <div className="flex items-center gap-1.5 px-2 py-1 font-bold text-[10px] uppercase bg-blue-500/10 text-blue-500 rounded-lg border border-blue-500/20">
                <Sparkles className="w-3 h-3" />
                Gemini
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 px-2 py-1 font-bold text-[10px] uppercase bg-surfaceHighlight text-textMuted rounded-lg border border-border">
            {provider}
        </div>
    );
}

export function RequestTable({ requests, onRowClick }: RequestTableProps) {
    return (
        <div className="w-full overflow-hidden glass-panel">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-white/[0.02] border-b border-white/5">
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest pl-8">Timestamp</th>
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest">Model & Provider</th>
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest hidden lg:table-cell text-right">Tokens</th>
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest text-right">Cost</th>
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest text-right">Latency</th>
                            <th className="p-4 text-[10px] font-black text-textMuted uppercase tracking-widest text-center pr-8">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {requests.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-12 text-center text-textMuted">
                                    <div className="flex flex-col items-center gap-2 opacity-50">
                                        <Activity className="w-8 h-8" />
                                        <p className="font-bold text-sm">No live requests detected yet.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            requests.map((req) => (
                                <tr
                                    key={req.id}
                                    onClick={() => onRowClick(req)}
                                    className="hover:bg-white/[0.02] active:bg-white/[0.05] transition-all cursor-pointer group"
                                >
                                    <td className="p-4 whitespace-nowrap text-xs text-textMuted pl-8">
                                        <div className="flex items-center gap-2 group-hover:text-textMain transition-colors">
                                            <Clock className="w-3.5 h-3.5 opacity-50" />
                                            {formatTimeAgo(req.created_at)}
                                        </div>
                                    </td>
                                    <td className="p-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <ProviderBadge provider={req.provider} />
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-white tracking-tight leading-tight">
                                                    {req.model}
                                                </span>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[10px] text-textMuted font-medium truncate max-w-[120px]">
                                                        {req.endpoint}
                                                    </span>
                                                    {req.is_streaming === 1 && (
                                                        <Zap className="w-3 h-3 text-accent fill-accent/20" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4 whitespace-nowrap text-right hidden lg:table-cell">
                                        <div className="inline-flex flex-col items-end">
                                            <div className="flex items-center gap-1 text-sm font-bold text-textMain tabular-nums">
                                                {req.total_tokens.toLocaleString()}
                                                <Database className="w-3 h-3 text-textMuted" />
                                            </div>
                                            <span className="text-[9px] text-textMuted font-bold tracking-tighter">
                                                P: {req.prompt_tokens} / C: {req.completion_tokens}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4 whitespace-nowrap text-right">
                                        <span className="text-sm font-black text-white tabular-nums tracking-tight">
                                            ${req.cost_usd.toFixed(4)}
                                        </span>
                                    </td>
                                    <td className="p-4 whitespace-nowrap text-right">
                                        <div className="inline-flex flex-col items-end">
                                            <span className="text-sm font-bold text-textMuted tabular-nums">
                                                {req.latency_ms}ms
                                            </span>
                                            {req.latency_ms > 2000 && (
                                                <span className="text-[8px] text-warning font-black uppercase">Slow</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 whitespace-nowrap text-center pr-8">
                                        <StatusBadge statusCode={req.status_code} status={req.status} />
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

