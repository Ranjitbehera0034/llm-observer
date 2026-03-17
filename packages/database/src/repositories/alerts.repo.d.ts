export interface AlertRecord {
    id: string;
    project_id: string;
    type: string;
    severity: string;
    message: string;
    data?: string;
    notified_via?: string;
    acknowledged: boolean;
    created_at: string;
}
export declare const getAlerts: (projectId?: string) => AlertRecord[];
export declare const createAlert: (alert: Omit<AlertRecord, "id" | "acknowledged" | "created_at">) => string;
export declare const acknowledgeAlert: (id: string) => void;
//# sourceMappingURL=alerts.repo.d.ts.map