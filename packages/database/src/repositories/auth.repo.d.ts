export interface ApiKeyRecord {
    id: string;
    key_hash: string;
    key_hint: string;
    name: string;
    project_id: string | null;
    organization_id: string | null;
    created_at: string;
    expires_at: string | null;
    last_used_at: string | null;
}
export declare const hashApiKey: (apiKey: string) => string;
export declare const createApiKey: (name: string, projectId: string | null, organizationId: string | null, expiresAt?: string | null) => {
    id: string;
    apiKey: string;
};
export declare const validateApiKey: (apiKey: string) => ApiKeyRecord | null;
export declare const seedDefaultApiKey: () => void;
//# sourceMappingURL=auth.repo.d.ts.map