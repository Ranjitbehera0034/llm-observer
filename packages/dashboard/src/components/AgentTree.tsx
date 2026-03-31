import { Bot, Clock, Zap, Search, PenTool, Layout, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../utils/format';

interface AgentTreeProps {
    parent: any;
    subagents: any[];
}

const getAgentTypeIcon = (type: string) => {
    switch (type) {
        case 'explore': return <Search className="w-4 h-4 text-blue-400" />;
        case 'plan': return <Layout className="w-4 h-4 text-purple-400" />;
        case 'execute': return <PenTool className="w-4 h-4 text-orange-400" />;
        case 'validate': return <CheckCircle className="w-4 h-4 text-green-400" />;
        default: return <Bot className="w-4 h-4 text-textMuted" />;
    }
};

export function AgentTree({ parent, subagents }: AgentTreeProps) {
    const totalCost = (parent.estimated_cost_usd || 0) + subagents.reduce((sum, a) => sum + (a.estimated_cost_usd || 0), 0);

    return (
        <div className="space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Bot className="w-4 h-4 text-primary" />
                Subagent Observability
            </h3>

            <div className="bg-surfaceHighlight/30 rounded-xl border border-border p-4">
                {/* Parent Node */}
                <div className="flex items-start gap-4 pb-4 border-b border-border/50">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                        <Bot className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-white">Parent Session</span>
                            <span className="text-sm font-mono text-white">{formatCurrency(parent.parent_cost_usd || parent.estimated_cost_usd)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-textMuted">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {parent.duration_seconds}s</span>
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {parent.input_tokens + parent.output_tokens} tokens</span>
                            <span className="text-primary/60">{Math.round(((parent.parent_cost_usd || parent.estimated_cost_usd) / totalCost) * 100)}% of total</span>
                        </div>
                    </div>
                </div>

                {/* Subagent Nodes */}
                <div className="mt-4 space-y-3 pl-4 border-l-2 border-border/50">
                    {subagents.map((agent) => {
                        const toolCallCount = Object.values(JSON.parse(agent.tool_calls_json || '{}')).reduce((a: any, b: any) => a + b, 0) as number;
                        return (
                            <div key={agent.agent_id} className="relative flex items-start gap-4 p-3 bg-surfaceHighlight/20 rounded-lg border border-border/30 hover:border-primary/30 transition-colors">
                                <div className="absolute -left-[18px] top-6 w-4 h-[2px] bg-border/50"></div>
                                <div className="w-8 h-8 rounded-lg bg-surfaceHighlight flex items-center justify-center shrink-0">
                                    {getAgentTypeIcon(agent.agent_type)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white capitalize">{agent.agent_type} Agent</span>
                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceHighlight text-textMuted font-mono">
                                                {agent.agent_id.substring(0, 8)}
                                            </span>
                                        </div>
                                        <span className="text-sm font-mono text-white">{formatCurrency(agent.estimated_cost_usd)}</span>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-textMuted">
                                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {agent.duration_seconds}s</span>
                                        <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {agent.input_tokens + agent.output_tokens} tokens</span>
                                        {toolCallCount > 0 && (
                                            <span className="text-blue-400/80">{toolCallCount} tool calls</span>
                                        )}
                                        <span className="text-textMuted/60">{Math.round((agent.estimated_cost_usd / totalCost) * 100)}%</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    
                    {subagents.length === 0 && (
                        <div className="py-2 text-xs text-textMuted italic">No subagents spawned during this session.</div>
                    )}
                </div>

                <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                    <span className="text-xs text-textMuted">Total Session Cost</span>
                    <span className="text-lg font-bold text-white font-mono">{formatCurrency(totalCost)}</span>
                </div>
            </div>
        </div>
    );
}
