import clsx from 'clsx';
import { DollarSign } from 'lucide-react';

interface BudgetMeterProps {
    spent: number;
    budget: number;
}

export function BudgetMeter({ spent, budget }: BudgetMeterProps) {
    const percentage = budget > 0 ? (spent / budget) * 100 : 0;
    const isDanger = percentage >= 90;
    const isWarning = percentage >= 75 && percentage < 90;

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

            <div className="h-2 w-full bg-surfaceHighlight rounded-full overflow-hidden">
                <div
                    className={clsx(
                        "h-full rounded-full transition-all duration-1000",
                        isDanger ? "bg-danger" : isWarning ? "bg-warning" : "bg-primary"
                    )}
                    style={{ width: `${Math.min(percentage, 100)}%` }}
                />
            </div>
        </div>
    );
}
