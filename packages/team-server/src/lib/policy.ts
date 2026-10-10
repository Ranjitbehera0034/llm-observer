import { z } from 'zod';
import type { ITeamPolicy } from '../models/TeamPolicy';

export const MAX_BUDGETS = 50;
const MAX_LIMIT_USD = 10_000_000;

const BudgetSchema = z.object({
    scope: z.enum(['daily', 'weekly', 'monthly']),
    limitUsd: z.number().finite().positive().max(MAX_LIMIT_USD),
    provider: z.string().trim().toLowerCase().min(1).max(64).optional(),
    action: z.enum(['alert', 'block'])
}).strict();

export const PolicyBodySchema = z.object({
    budgets: z.array(BudgetSchema).max(MAX_BUDGETS)
}).strict();

/** What members and admins receive. Empty (version 0) until an admin saves one. */
export function policyDto(policy: Pick<ITeamPolicy, 'version' | 'budgets' | 'updated_at'> | null, extra: { updatedBy?: string } = {}) {
    return {
        beta: true,
        version: policy?.version ?? 0,
        budgets: (policy?.budgets ?? []).map((b) => ({
            scope: b.scope,
            limitUsd: b.limitUsd,
            ...(b.provider ? { provider: b.provider } : {}),
            action: b.action
        })),
        updatedAt: policy?.updated_at ? new Date(policy.updated_at).toISOString() : null,
        ...extra
    };
}
