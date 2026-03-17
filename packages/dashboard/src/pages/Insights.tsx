import { useState, useEffect } from 'react';
import { Lightbulb, Sparkles, TrendingDown, Clock, ShieldCheck, ArrowRight } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface Insight {
    type: string;
    title: string;
    description: string;
    savings_usd: number;
    model_impacted?: string;
    suggested_model?: string;
    occurrences?: number;
}

export default function Insights() {
    const [insights, setInsights] = useState<Insight[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/stats/optimizer`)
            .then(res => res.json())
            .then(res => {
                setInsights(res.data || []);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const totalPotentialSavings = insights.reduce((acc, curr) => acc + curr.savings_usd, 0);

    return (
        <div className="max-w-7xl mx-auto space-y-10 animate-fade-in py-10 px-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <Lightbulb className="w-6 h-6 text-blue-400" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">
                            Cost Optimizer
                        </h1>
                    </div>
                    <p className="text-textMuted text-lg font-medium pl-12">
                        Intelligent recommendations to scale your infrastructure efficiently.
                    </p>
                </div>

                <div className="bg-success/10 border border-success/20 rounded-2xl p-6 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-success/20 rounded-lg">
                            <TrendingDown className="w-5 h-5 text-success" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-textMuted font-bold">Monthly Savings Potential</p>
                            <p className="text-2xl font-black text-white">${(totalPotentialSavings * 30).toFixed(2)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                    <p className="text-textMuted font-medium italic">Analyzing your LLM traffic patterns...</p>
                </div>
            ) : insights.length === 0 ? (
                <div className="card text-center py-20 bg-surfaceHighlight/30 border-dashed border-white/10">
                    <ShieldCheck className="w-16 h-16 text-white/5 mx-auto mb-6" />
                    <h3 className="text-xl font-bold text-white mb-2">Maximum Efficiency Reached</h3>
                    <p className="text-textMuted max-w-sm mx-auto">
                        Our engine hasn't found any significant savings opportunities for your current traffic. Keep up the great work!
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {insights.map((insight, idx) => (
                        <div key={idx} className="card group hover:border-primary/30 transition-all duration-300">
                            <div className="flex items-start justify-between mb-6">
                                <div className={`p-3 rounded-2xl ${insight.type === 'model_downgrade' ? 'bg-purple-500/10' : 'bg-blue-500/10'}`}>
                                    {insight.type === 'model_downgrade' ? (
                                        <Sparkles className="w-6 h-6 text-purple-400" />
                                    ) : (
                                        <Clock className="w-6 h-6 text-blue-400" />
                                    )}
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] uppercase tracking-widest text-textMuted font-bold">Estimated Savings</p>
                                    <p className="text-xl font-black text-success">+${insight.savings_usd.toFixed(2)}</p>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold text-white mb-3 group-hover:text-primary transition-colors">
                                {insight.title}
                            </h3>
                            <p className="text-textMuted text-sm leading-relaxed mb-8">
                                {insight.description}
                            </p>

                            <div className="mt-auto pt-6 border-t border-white/5 flex items-center justify-between">
                                {insight.type === 'model_downgrade' ? (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] bg-white/5 px-2 py-1 rounded-md text-textMuted font-bold uppercase">{insight.model_impacted}</span>
                                        <ArrowRight className="w-3 h-3 text-white/20" />
                                        <span className="text-[10px] bg-primary/20 px-2 py-1 rounded-md text-primary font-bold uppercase">{insight.suggested_model}</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] bg-blue-500/10 px-2 py-1 rounded-md text-blue-400 font-bold uppercase">{insight.occurrences} Duplicates</span>
                                    </div>
                                )}
                                <button className="text-xs font-bold text-white group-hover:translate-x-1 transition-transform flex items-center gap-1">
                                    View Details <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Educational Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-20">
                <div className="p-8 rounded-3xl bg-blue-500/5 border border-blue-500/10">
                    <h4 className="font-bold text-blue-400 mb-2">Model Downgrades</h4>
                    <p className="text-xs text-white/40 leading-relaxed">
                        Routing small tasks (e.g. classification or simple extraction) from frontier models like GPT-4o to lighter alternatives like GPT-4o-mini can reduce costs by up to 90%.
                    </p>
                </div>
                <div className="p-8 rounded-3xl bg-purple-500/5 border border-purple-500/10">
                    <h4 className="font-bold text-purple-400 mb-2">Prompt Caching</h4>
                    <p className="text-xs text-white/40 leading-relaxed">
                        Duplicate prompts detected by our engine are prime candidates for caching. Caching redundant system prompts or context can save up to 50% on input tokens.
                    </p>
                </div>
                <div className="p-8 rounded-3xl bg-success/5 border border-success/10">
                    <h4 className="font-bold text-success mb-2">Anomaly Protection</h4>
                    <p className="text-xs text-white/40 leading-relaxed">
                        Our engine continuously monitors for spend spikes. Alerts are generated if velocity exceeds 5x your rolling average.
                    </p>
                </div>
            </div>
        </div>
    );
}
