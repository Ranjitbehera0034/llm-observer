/**
 * Dashboard API — Composed from sub-routers.
 * 
 * This file is a thin re-export for backward compatibility.
 * The actual route handlers live in ./routes/*.routes.ts
 */
import { createDashboardRouter, requestEventEmitter } from './routes';

export const dashboardApi = createDashboardRouter();
export { requestEventEmitter };
