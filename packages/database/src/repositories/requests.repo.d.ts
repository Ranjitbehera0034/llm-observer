export interface RequestRecord {
    id: string;
    project_id: string;
    provider: string;
    model: string;
    endpoint?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost_usd: number;
    latency_ms?: number;
    status_code?: number;
    status?: string;
    is_streaming?: boolean;
    has_tools?: boolean;
    error_message?: string;
    request_body?: string;
    response_body?: string;
    pricing_unknown?: boolean;
    tags?: string;
    prompt_hash?: string;
    created_at?: string;
}
export declare const insertRequest: (req: Omit<RequestRecord, "id">) => string;
export declare const bulkInsertRequests: (requests: Omit<RequestRecord, "id">[]) => void;
export declare const getRequests: (filters?: any) => unknown[];
//# sourceMappingURL=requests.repo.d.ts.map