import { useState, useEffect } from 'react';
import { Bot, TrendingUp, DollarSign, Activity, ChevronRight, Search, Layout, PenTool, CheckCircle } from 'lucide-react';
import { formatCurrency } from '../utils/format';

export default function Agents() {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_BASE_URL}/api/agents/summary`)
            .then(res => res.json())
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(err => console.error('Error fetching agent summary:', err));
    }, []);

    if (loading) return <div className="p-8 text-textMuted animate-pulse">Loading agent observability...</div>;

    if (!stats || stats.total_agents === 0) {
        return (
            <div className="p-8 max-w-7xl mx-auto space-y-8">
                <header>
                    <h1 className="text-3xl font-bold text-white mb-2">Subagent Observability</h1>
                    <p className="text-textMuted">See exactly what Claude Code subagents are doing and what they cost.</p>
                </header>
                <div className="bg-surface border-2 border-dashed border-border rounded-[2rem] p-20 text-center">
                    <Bot className="w-16 h-16 text-slate-700 mx-auto mb-6" />
                    <h2 className="text-xl font-bold text-white mb-2">No agent sessions detected</h2>
                    <p className="text-textMuted max-w-md mx-auto">
                        Agent observability is currently optimized for <strong>Claude Code</strong> sessions. 
                        No subagent logs were found in your local project directories. 
                        Run a few tasks with Claude Code to see this dashboard come alive.
                    </p>
                </div>
            </div>
        );
    }

    const cards = [
        { name: 'Agents Spawned', value: stats.total_agents, icon: Bot, color: 'text-primary' },
        { name: 'Total Agent Cost', value: formatCurrency(stats.total_cost), icon: DollarSign, color: 'text-success' },
        { name: 'Avg Cost per Agent', value: formatCurrency(stats.avg_cost), icon: Activity, color: 'text-blue-400' },
        { name: 'Most Heavy Operation', value: stats.type_breakdown[0]?.type || 'N/A', icon: TrendingUp, color: 'text-purple-400' },
    ];

    const getAgentTypeIcon = (type: string) => {
        switch (type) {
            case 'explore': return <Search className="w-5 h-5 text-blue-400" />;
            case 'plan': return <Layout className="w-5 h-5 text-purple-400" />;
            case 'execute': return <PenTool className="w-5 h-5 text-orange-400" />;
            case 'validate': return <CheckCircle className="w-5 h-5 text-green-400" />;
            default: return <Bot className="w-5 h-5 text-textMuted" />;
        }
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Subagent Observability</h1>
                    <p className="text-textMuted">See exactly what Claude Code subagents are doing and what they cost.</p>
                </div>
            </header>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card) => (
                    <div key={card.name} className="bg-surface border border-border p-6 rounded-2xl shadow-sm hover:border-primary/30 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className={`p-2 rounded-xl bg-surfaceHighlight ${card.color}`}>
                                <card.icon className="w-5 h-5" />
                            </div>
                        </div>
                        <p className="text-sm text-textMuted font-medium mb-1">{card.name}</p>
                        <p className="text-2xl font-bold text-white tracking-tight">{card.value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Type Breakdown */}
                <div className="lg:col-span-2 bg-surface border border-border rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-6">Cost by Agent Type</h2>
                    <div className="space-y-6">
                        {stats.type_breakdown.map((type: any) => (
                            <div key={type.type} className="group">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-surfaceHighlight">
                                            {getAgentTypeIcon(type.type)}
                                        </div>
                                        <div>
                                            <span className="text-sm font-medium text-white capitalize">{type.type}</span>
                                            <p className="text-xs text-textMuted">{type.count} agents spawned</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-bold text-white">{formatCurrency(type.total_cost)}</span>
                                        <p className="text-[10px] text-textMuted">{Math.round((type.total_cost / stats.total_cost) * 100)}% of agent spend</p>
                                    </div>
                                </div>
                                <div className="h-2 w-full bg-surfaceHighlight rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-primary transition-all duration-500 group-hover:bg-primaryLight" 
                                        style={{ width: `${(type.total_cost / stats.total_cost) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Most Expensive Agents */}
                <div className="bg-surface border border-border rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-6">Expensive Agents</h2>
                    <div className="space-y-4">
                        {stats.top_agents.map((agent: any, i: number) => (
                            <div key={agent.agent_id} className="flex items-center justify-between p-3 rounded-xl bg-surfaceHighlight/30 hover:bg-surfaceHighlight transition-colors cursor-pointer group">
                                <div className="flex items-center gap-3">
                                    <div className="text-xs font-mono text-textMuted w-4">{i + 1}</div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white capitalize">{agent.agent_type}</span>
                                            <span className="text-[10px] text-primary/60 font-medium px-1.5 py-0.5 rounded bg-primary/10">v1.10.0</span>
                                        </div>
                                        <p className="text-xs text-textMuted truncate max-w-[120px]">{agent.project_name}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-white">{formatCurrency(agent.estimated_cost_usd)}</p>
                                    <ChevronRight className="w-4 h-4 text-textMuted group-hover:text-primary transition-colors inline" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
