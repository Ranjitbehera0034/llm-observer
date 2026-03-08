export interface AlertRuleRecord {
    id: string;
    project_id: string;
    organization_id: string;
    name: string;
    condition_type: string;
    threshold: number;
    time_window_minutes: number | null;
    webhook_url: string | null;
    email_notification: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}
export declare const getAlertRules: (projectId?: string) => AlertRuleRecord[];
export declare const createAlertRule: (rule: Pick<AlertRuleRecord, "name" | "project_id" | "organization_id" | "condition_type" | "threshold" | "time_window_minutes" | "webhook_url" | "email_notification">) => string;
export declare const deleteAlertRule: (id: string) => void;
//# sourceMappingURL=alertRules.repo.d.ts.map