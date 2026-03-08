import { SpendCounter } from '../components/SpendCounter';
import { CostChart } from '../components/CostChart';
import { ModelBreakdown } from '../components/ModelBreakdown';
import { Sparkles } from 'lucide-react';

export default function Overview() {
    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-fade-in p-8">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <Sparkles className="w-8 h-8 text-primary" />
                        Dashboard Overview
                    </h1>
                    <p className="text-textMuted mt-2">Monitor your LLM API spend, budget, and performance.</p>
                </div>
                <div>
                    {/* Future: Date picker or environment selector */}
                    <div className="px-4 py-2 bg-surfaceHighlight border border-border rounded-lg text-sm font-medium">
                        Project: <span className="text-white">Default</span>
                    </div>
                </div>
            </div>

            <SpendCounter />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <CostChart />
                <ModelBreakdown />
            </div>
        </div>
    );
}
