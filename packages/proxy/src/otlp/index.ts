import { Router, type NextFunction, type Request, type Response } from 'express';
import { getSetting } from '@llm-observer/database';
import { createOtlpManager, OTLP_SETTING, type OtlpManager } from './manager';

export { OTLP_SETTING, DEFAULT_OTLP_PORT, OTLP_HOST, resolveOtlpPort, createOtlpManager } from './manager';
export type { OtlpManager, OtlpStatus } from './manager';

let manager: OtlpManager | null = null;

/** The process-wide receiver. Created on first use; the port is read from LLM_OBSERVER_OTLP_PORT when it starts. */
export function getOtlpManager(): OtlpManager {
    if (!manager) manager = createOtlpManager();
    return manager;
}

/** Boot hook: start the receiver if (and only if) the user turned it on. Never throws. */
export async function initOtlpReceiver(): Promise<void> {
    try {
        await getOtlpManager().reconcile();
    } catch (err) {
        console.error('[OTLP] Could not start the receiver:', (err as Error).message);
    }
}

/** Shutdown hook (also used by tests): stop listening and forget the manager. */
export async function shutdownOtlp(): Promise<void> {
    const m = manager;
    manager = null;
    if (m) await m.stop();
}

/** The env vars to paste into the shell that runs Claude Code. Exactly what the UI and docs/guide/otlp.md show. */
export function buildEnvSnippet(endpoint: string): string {
    return [
        'export CLAUDE_CODE_ENABLE_TELEMETRY=1',
        'export OTEL_METRICS_EXPORTER=otlp',
        'export OTEL_LOGS_EXPORTER=otlp',
        'export OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
        `export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
    ].join('\n');
}

/**
 * Express middleware for PUT /api/settings: when the request carries the OTLP setting, the listener is
 * started or stopped BEFORE the response is sent, so a client that reads /api/otlp/status right after
 * the PUT sees the new state. Mount after the JSON body parser and before the settings router.
 */
export function otlpSettingsHook(req: Request, res: Response, next: NextFunction): void {
    const body = req.body;
    if (req.method !== 'PUT' || !body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, OTLP_SETTING)) {
        return next();
    }
    const end = res.end.bind(res) as (...args: any[]) => Response;
    (res as any).end = (...args: any[]) => {
        if (res.statusCode >= 300) return end(...args);
        getOtlpManager().reconcile().finally(() => end(...args));
        return res;
    };
    next();
}

export const otlpRoutes = Router();

// GET /api/otlp/status
otlpRoutes.get('/status', (_req, res) => {
    try {
        const status = getOtlpManager().status();
        res.json({
            data: {
                ...status,
                enabled: getSetting(OTLP_SETTING) === 'true',
                envSnippet: buildEnvSnippet(status.endpoint),
            },
        });
    } catch {
        res.status(500).json({ error: 'Failed to read OTLP receiver status' });
    }
});
