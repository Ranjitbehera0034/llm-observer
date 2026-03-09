export declare const getStatsByProvider: (projectId?: string, days?: number) => unknown[];
export declare const getCostOptimizationSuggestions: (projectId?: string) => {
    type: string;
    title: string;
    description: string;
    savings_usd: number;
    model_impacted: any;
    suggested_model: string;
}[];
export declare const getPromptCacheSuggestions: (projectId?: string) => {
    type: string;
    title: string;
    description: string;
    savings_usd: any;
    hash: any;
    occurrences: any;
}[];
//# sourceMappingURL=stats.repo.d.ts.map