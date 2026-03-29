import { useState, useEffect } from 'react';
import { Wrench, PieChart, BarChart3, AlertTriangle, ArrowRight, FileText, Terminal, Layers, Search, PenTool } from 'lucide-react';
import { formatCurrency } from '../utils/format';

export default function Tools() {
    const [stats, setStats] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_BASE_URL}/api/tools/usage`)
            .then(res => res.json())
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(err => console.error('Error fetching tool usage:', err));
    }, []);

    if (loading) return <div className="p-8 text-textMuted animate-pulse">Analyzing tool usage...</div>;

    const getToolIcon = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes('read')) return <FileText className="w-4 h-4 text-blue-400" />;
        if (n.includes('write')) return <PenTool className="w-4 h-4 text-orange-400" />;
        if (n.includes('bash') || n.includes('shell')) return <Terminal className="w-4 h-4 text-green-400" />;
        if (n.includes('search')) return <Search className="w-4 h-4 text-purple-400" />;
        return <Wrench className="w-4 h-4 text-textMuted" />;
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <header>
                <h1 className="text-3xl font-bold text-white mb-2">Tool Usage Analytics</h1>
                <p className="text-textMuted">Understand which operations are consuming your budget.</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Cost by Operation */}
                <div className="bg-surface border border-border rounded-2xl p-6">
                    <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                        <PieChart className="w-5 h-5 text-primary" />
                        Cost by Operation Type
                    </h2>
                    <div className="space-y-6">
                        {stats.summary.map((tool: any) => (
                            <div key={tool.tool_name} className="group">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 rounded-lg bg-surfaceHighlight">
                                            {getToolIcon(tool.tool_name)}
                                        </div>
                                        <span className="text-sm font-medium text-white">{tool.tool_name}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-bold text-white">{formatCurrency(tool.total_cost)}</span>
                                        <p className="text-[10px] text-textMuted">{tool.total_calls} calls</p>
                                    </div>
                                </div>
                                <div className="h-2 w-full bg-surfaceHighlight rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-primary transition-all duration-500" 
                                        style={{ width: `${(tool.total_cost / stats.summary.reduce((a:any, b:any)=>a+b.total_cost, 0)) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Redundant Patterns */}
                <div className="space-y-6">
                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-warning" />
                        Efficiency Suggestions
                    </h2>
                    
                    {stats.redundant.length > 0 ? (
                        stats.redundant.map((pattern: any) => (
                            <div key={pattern.id} className="bg-surface border border-warning/20 rounded-2xl p-5 hover:border-warning/40 transition-all group">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-warning/10 text-warning text-[10px] font-bold uppercase tracking-wider">
                                        Optimization Target
                                    </div>
                                    <div className="text-right">
                                        <span className="text-sm font-mono text-warning font-bold">-{formatCurrency(pattern.estimated_waste_usd)}</span>
                                        <p className="text-[10px] text-textMuted">Est. monthly waste</p>
                                    </div>
                                </div>
                                <h3 className="text-sm font-semibold text-white mb-2">
                                    High Frequency {pattern.target === 'Read' ? 'File Access' : 'Tool Usage'}
                                </h3>
                                <p className="text-xs text-textMuted leading-relaxed mb-4">
                                    The <span className="text-primary">{pattern.target}</span> tool was called <b>{pattern.call_count}</b> times across <b>{pattern.sessions_affected}</b> sessions. 
                                    {pattern.target === 'Read' ? ' Consider adding the target files to a project-level context map to reduce repeated token costs.' : ' Consider batching these operations.'}
                                </p>
                                <button className="flex items-center gap-1 text-[10px] font-bold text-primary group-hover:gap-2 transition-all uppercase">
                                    View Affected Sessions <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="bg-surface border border-border border-dashed rounded-2xl p-12 text-center">
                            <Layers className="w-10 h-10 text-textMuted mx-auto mb-4 opacity-50" />
                            <p className="text-sm text-textMuted">No redundant patterns detected yet. Scanning session history...</p>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="bg-surface border border-border rounded-2xl p-6">
                 <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-success" />
                    Daily Operation Volume
                </h2>
                <div className="h-64 flex items-end gap-1 px-4">
                    {/* Mock daily trend visualization */}
                    {Array.from({length: 30}).map((_, i) => (
                        <div key={i} className="flex-1 bg-primary/20 rounded-t-sm hover:bg-primary transition-all cursor-help relative group h-[calc(20%+60%*var(--h))]--">
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-white text-black text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                                Day {i+1}: $0.42
                            </div>
                        </div>
                    ))}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                         <span className="text-xs text-textMuted">Trend visualization coming in v1.11.0</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
