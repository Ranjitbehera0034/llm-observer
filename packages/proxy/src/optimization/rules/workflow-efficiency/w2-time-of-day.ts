import { OptimizationRule, OptimizationResult, RuleContext } from '../../types';

export const w2TimeOfDay: OptimizationRule = {
    id: "workflow-late-night-fatigue",
    name: "Reduce late-night coding fatigue",
    category: "workflow-efficiency",
    minDataDays: 14,
    evaluate(context: RuleContext): OptimizationResult | null {
        const sessionsByHour: Record<number, { cost: number, count: number }> = {};
        context.sessions.forEach(s => {
            const hour = new Date(s.started_at).getHours();
            if (!sessionsByHour[hour]) sessionsByHour[hour] = { cost: 0, count: 0 };
            sessionsByHour[hour].cost += (s.estimated_cost_usd || 0);
            sessionsByHour[hour].count++;
        });

        // Late night (11 PM - 4 AM)
        const lateNightHours = [23, 0, 1, 2, 3, 4];

        // Daytime baseline: average per-session cost over the other hours
        const dayHours = Object.keys(sessionsByHour).map(Number).filter(h => !lateNightHours.includes(h));
        if (dayHours.length === 0) return null;
        const dayAvg = dayHours.reduce((acc, h) => acc + (sessionsByHour[h].cost / sessionsByHour[h].count), 0) / dayHours.length;

        let lateNightCostSum = 0;
        let lateNightCount = 0;
        lateNightHours.forEach(h => {
                if (sessionsByHour[h]) {
                    lateNightCostSum += sessionsByHour[h].cost;
                    lateNightCount += sessionsByHour[h].count;
                }
        });

        const lateNightAvg = lateNightCount > 0 ? lateNightCostSum / lateNightCount : 0;

        if (dayAvg > 0 && lateNightAvg > dayAvg * 1.5) {
            return {
                ruleId: this.id,
                title: "Late-night fatigue is increasing costs",
                description: `Your sessions between 11 PM and 4 AM cost ${Math.round((lateNightAvg / dayAvg - 1) * 100)}% more than your average daytime session.`,
                category: this.category,
                impact: "low",
                estimatedMonthlySavings: lateNightCostSum * 0.2,
                basis: "heuristic",
                action: "Tired coding is expensive coding. Save complex tasks for when you're alert to reduce retries.",
                dataPoints: {
                    lateNightAvg,
                    dayAvg
                }
            };
        }
        return null;
    }
};
