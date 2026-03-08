import { useState, useEffect } from 'react';
import { SpendCounter } from '../components/SpendCounter';
import { CostChart } from '../components/CostChart';
import { ModelBreakdown } from '../components/ModelBreakdown';
import { Sparkles, AlertCircle } from 'lucide-react';

export default function Overview() {
    const [unknownCount, setUnknownCount] = useState<number>(0);

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_BASE_URL}/api/stats/unknown-pricing`)
            .then(res => res.json())
            .then(data => setUnknownCount(data.count))
            .catch(console.error);
    }, []);
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

            {unknownCount > 0 && (
                <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4 mb-6 flex items-start text-orange-400">
                    <AlertCircle className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                    <div>
                        <h3 className="font-semibold text-orange-500">Unrecognized Models Detected</h3>
                        <p className="text-sm mt-1 text-orange-200">
                            {unknownCount} request(s) used an unrecognized model with unknown pricing. Costs are not being tracked accurately for these requests.
                            Please add custom pricing via the CLI: <code className="bg-orange-500/20 px-1.5 py-0.5 rounded text-xs ml-1">npx llm-observer pricing add</code>
                        </p>
                    </div>
                </div>
            )}

            <SpendCounter />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <CostChart />
                <ModelBreakdown />
            </div>
        </div>
    );
}
