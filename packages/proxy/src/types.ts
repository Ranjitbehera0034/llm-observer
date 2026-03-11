/**
 * Express Request type augmentation.
 * Eliminates the need for (req as any).projectId casts throughout the codebase.
 */
declare global {
    namespace Express {
        interface Request {
            /** Project ID resolved by budgetGuard middleware */
            projectId?: string;
            /** Cache key for budget lookups (API key or 'default') */
            cacheKey?: string;
            /** Custom target URL for the custom provider route */
            customTargetUrl?: string;
            /** Raw request body buffer, used by webhook signature verification */
            rawBody?: Buffer;
        }
    }
}

export {};
