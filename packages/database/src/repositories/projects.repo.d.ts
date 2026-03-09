export interface ProjectRecord {
    id: string;
    name: string;
    api_key?: string;
    organization_id?: string;
    daily_budget?: number;
    weekly_budget?: number;
    monthly_budget?: number;
    alert_threshold?: number;
    kill_switch?: boolean;
    webhook_url?: string;
    saved_filters?: string;
    created_at?: string;
}
export declare const createProject: (project: Omit<ProjectRecord, "id">) => string;
export declare const getProject: (id: string) => ProjectRecord | undefined;
export declare const getProjectByApiKey: (apiKey: string) => ProjectRecord | undefined;
export declare const updateBudget: (id: string, budget: {
    daily?: number;
    weekly?: number;
    monthly?: number;
}) => void;
export declare const deleteProject: (id: string) => void;
export declare const getSavedFilters: (id: string) => any[];
export declare const updateSavedFilters: (id: string, filters: any[]) => void;
//# sourceMappingURL=projects.repo.d.ts.map