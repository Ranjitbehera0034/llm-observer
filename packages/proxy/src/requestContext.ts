import { Request, Response, NextFunction } from 'express';

declare global {
    namespace Express {
        interface Request {
            /** Provider resolved from the /v1/<provider> path prefix (set before the guards run) */
            provider?: string;
            /** Model resolved from body.model, x-model, or the Gemini URL (set before the guards run) */
            model?: string;
        }
    }
}

const PROVIDER_PREFIX = /^\/v1\/(openai|anthropic|google|mistral|groq|ollama|custom)(?:\/|$)/;
// Gemini puts the model in the URL: /models/gemini-1.5-pro:generateContent
const GEMINI_URL_MODEL = /\/models\/([^/:?]+)/;

/**
 * Resolves which provider/model a request is for, from the URL rather than
 * client-supplied headers, so provider- and model-scoped budgets match the
 * same way the route handlers dispatch. Must run after express.json() and
 * before the budget and rate-limit guards.
 */
export const resolveRequestContext = (req: Request, _res: Response, next: NextFunction) => {
    const match = PROVIDER_PREFIX.exec(req.path);
    if (match) {
        req.provider = match[1];

        let model: string | undefined = typeof req.body?.model === 'string' && req.body.model ? req.body.model : undefined;
        if (!model && match[1] === 'google') {
            const urlModel = GEMINI_URL_MODEL.exec(req.path);
            if (urlModel) {
                try { model = decodeURIComponent(urlModel[1]); } catch { model = urlModel[1]; }
            }
        }
        if (!model && typeof req.headers['x-model'] === 'string') model = req.headers['x-model'];
        if (model) req.model = model;
    }
    next();
};
