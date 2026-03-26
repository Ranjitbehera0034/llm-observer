import clsx from 'clsx';
import { DollarSign } from 'lucide-react';

interface BudgetMeterProps {
    spent: number;
    budget: number;
    buffer?: number;
}

export function BudgetMeter({ spent, budget, buffer = 0 }: BudgetMeterProps) {
    const percentage = budget > 0 ? (spent / budget) * 100 : 0;
    const bufferPercentage = budget > 0 ? (buffer / budget) * 100 : 0;
    const isDanger = percentage >= 100;
    const isBufferZone = percentage >= (100 - bufferPercentage) && percentage < 100;
    const isWarning = percentage >= 75 && percentage < (100 - bufferPercentage);

    return (
        <div className="w-full">
            <div className="flex justify-between items-end mb-2">
                <div className="flex items-center gap-1.5 text-white font-semibold text-lg">
                    <DollarSign className="w-5 h-5 text-textMuted" />
                    <span>{spent.toFixed(3)}</span>
                    <span className="text-sm font-normal text-textMuted ml-1">/ {budget.toFixed(2)}</span>
                </div>
                <div className={clsx("text-xs font-medium", isDanger ? "text-danger" : isWarning ? "text-warning" : "text-success")}>
                    {percentage.toFixed(1)}%
                </div>
            </div>

            <div className="h-2 w-full bg-surfaceHighlight rounded-full overflow-hidden relative">
                {/* Buffer Zone */}
                {bufferPercentage > 0 && (
                    <div 
                        className="absolute right-0 top-0 h-full bg-red-500/20 border-l border-red-500/30"
                        style={{ width: `${bufferPercentage}%` }}
                    />
                )}
                <div
                    className={clsx(
                        "h-full rounded-full transition-all duration-1000",
                        isDanger ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" : 
                        isBufferZone ? "bg-amber-500" :
                        isWarning ? "bg-amber-400" : "bg-primary"
                    )}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                />
            </div>
        </div>
    );
}
