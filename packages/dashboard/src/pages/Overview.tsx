import { useState, useEffect } from 'react';
import { SpendCounter } from '../components/SpendCounter';
import { StatCards } from '../components/StatCards';
import { CostChart } from '../components/CostChart';
import { ModelBreakdown } from '../components/ModelBreakdown';
import { Sparkles, AlertCircle, LayoutDashboard } from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function Overview() {
    const [unknownCount, setUnknownCount] = useState<number>(0);

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/stats/unknown-pricing`)
            .then(res => res.json())
            .then(data => setUnknownCount(data.count))
            .catch(console.error);
    }, []);

    return (
        <div className="max-w-7xl mx-auto space-y-10 animate-fade-in py-10 px-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary/20 rounded-lg">
                            <LayoutDashboard className="w-6 h-6 text-primary" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">
                            Control Room
                        </h1>
                    </div>
                    <p className="text-textMuted text-lg font-medium pl-12">
                        Real-time intelligence for your LLM infrastructure.
                    </p>
                </div>

                <div className="flex items-center gap-4 bg-surfaceHighlight/50 border border-white/5 rounded-2xl p-4 backdrop-blur-sm self-end md:self-auto">
                    <div className="text-right">
                        <p className="text-[10px] uppercase tracking-widest text-textMuted font-bold">Active Project</p>
                        <p className="text-white font-black">Default Node</p>
                    </div>
                    <div className="w-3 h-3 rounded-full bg-success animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
                </div>
            </div>

            {/* Warning Banner */}
            {unknownCount > 0 && (
                <div className="bg-warning/5 border border-warning/20 rounded-2xl p-6 flex items-start gap-4 animate-slide-up group">
                    <div className="p-3 bg-warning/10 rounded-xl group-hover:scale-110 transition-transform">
                        <AlertCircle className="w-6 h-6 text-warning" />
                    </div>
                    <div>
                        <h3 className="font-bold text-warning text-lg">Unrecognized Models Detected</h3>
                        <p className="text-warning/70 mt-1 max-w-2xl">
                            {unknownCount} request(s) used models with unknown pricing. We've defaulted their cost to $0.00.
                            Add custom pricing via the CLI to maintain accurate billing.
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                            <code className="bg-warning/20 px-3 py-1.5 rounded-lg text-xs font-mono text-warning border border-warning/20">
                                npx llm-observer pricing add
                            </code>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Metrics */}
            <div className="space-y-8">
                <section>
                    <SpendCounter />
                </section>

                <section>
                    <StatCards />
                </section>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-8">
                    <div className="card h-[450px]">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-xl font-bold text-white tracking-tight">Cost Trajectory</h3>
                                <p className="text-xs text-textMuted mt-1 uppercase tracking-widest font-bold">Daily spend over last 7 days</p>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full">
                                <Sparkles className="w-3 h-3 text-primary" />
                                <span className="text-[10px] font-bold text-primary uppercase">Calculated in USD</span>
                            </div>
                        </div>
                        <div className="h-[320px]">
                            <CostChart />
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4">
                    <div className="card h-[450px]">
                        <div className="mb-8">
                            <h3 className="text-xl font-bold text-white tracking-tight">Model Mix</h3>
                            <p className="text-xs text-textMuted mt-1 uppercase tracking-widest font-bold">Budget distribution by LLM</p>
                        </div>
                        <div className="h-[320px]">
                            <ModelBreakdown />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
