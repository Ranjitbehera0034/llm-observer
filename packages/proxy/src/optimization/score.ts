import { OptimizationResult } from './types';

export function computeOptimizationScore(results: OptimizationResult[], totalMonthlySpend: number): number {
    if (totalMonthlySpend === 0) return 100;

    const totalIdentifiedSavings = results.reduce((acc, curr) => acc + curr.estimatedMonthlySavings, 0);
    
    // score = 100 - (total_identified_savings / total_monthly_spend × 100)
    let score = 100 - (totalIdentifiedSavings / totalMonthlySpend * 100);

    // Clamp score between 0 and 100
    return Math.max(0, Math.min(100, Math.round(score)));
}
