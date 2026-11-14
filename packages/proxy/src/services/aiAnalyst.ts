import Anthropic from '@anthropic-ai/sdk';
import { getDb, getSetting, updateSetting, encrypt, decrypt } from '@llm-observer/database';

const KEY_SETTING = 'ai_analyst_api_key';
const LAST_RESULT_SETTING = 'ai_analyst_last_result';

export const ANALYST_MODEL = 'claude-sonnet-5-5';
export const getAnalystModel = () => getSetting('ai_analyst_model') || ANALYST_MODEL;

/* PRIVACY RULE: only aggregated metadata (token totals, costs, tool call counts,
 * cache rates) is ever sent to the API. No prompts, responses, file paths, or
 * project names leave the machine. */

export interface AnalystRecommendation {
    title: string;
    detail: string;
    category: 'model-choice' | 'caching' | 'agent-efficiency' | 'budget' | 'other';
    estimated_monthly_savings_usd: number;
}

export interface AnalystResult {
    summary: string;
    recommendations: AnalystRecommendation[];
    model: string;
    generated_at: string;
}

const ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
        summary: { type: 'string', description: 'Two to four sentences describing the overall spend picture and the single biggest lever.' },
        recommendations: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    detail: { type: 'string', description: 'Concrete, actionable advice grounded in the numbers provided.' },
                    category: { type: 'string', enum: ['model-choice', 'caching', 'agent-efficiency', 'budget', 'other'] },
                    estimated_monthly_savings_usd: { type: 'number', description: 'Best-effort estimate; 0 when not quantifiable.' }
                },
                required: ['title', 'detail', 'category', 'estimated_monthly_savings_usd'],
                additionalProperties: false
            }
        }
    },
    required: ['summary', 'recommendations'],
    additionalProperties: false
} as const;

export const setAnalystKey = (apiKey: string): void => {
    updateSetting(KEY_SETTING, encrypt(apiKey));
};

export const clearAnalystKey = (): void => {
    updateSetting(KEY_SETTING, '');
};

export const hasAnalystKey = (): boolean => {
    const v = getSetting(KEY_SETTING);
    return !!v && v.length > 0;
};

const getAnalystKey = (): string | null => {
    const v = getSetting(KEY_SETTING);
    if (!v) return null;
    try { return decrypt(v); } catch { return null; }
};

export const getLastResult = (): AnalystResult | null => {
    const v = getSetting(LAST_RESULT_SETTING);
    if (!v) return null;
    try { return JSON.parse(v); } catch { return null; }
};

// Aggregated, anonymous spend snapshot — the only data that leaves the machine
export const buildSpendSnapshot = () => {
    const db = getDb();

    const byModel = db.prepare(`
        SELECT provider, model_primary AS model,
               COUNT(*) AS sessions,
               SUM(CASE WHEN session_type = 'agentic' THEN 1 ELSE 0 END) AS agentic_sessions,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read_tokens) AS cache_read_tokens,
               SUM(cache_write_tokens) AS cache_write_tokens,
               ROUND(SUM(estimated_cost_usd), 4) AS estimated_cost_usd,
               ROUND(AVG(cache_hit_rate), 4) AS avg_cache_hit_rate
        FROM sessions
        WHERE model_primary IS NOT NULL AND model_primary != ''
          AND julianday(started_at) >= julianday('now','-30 days')
        GROUP BY provider, model_primary
        ORDER BY estimated_cost_usd DESC LIMIT 50
    `).all();

    let topTools: any[] = [];
    let budgetCount = 0;
    try {
        topTools = db.prepare(`
            SELECT tool_name, SUM(call_count) AS calls
            FROM tool_usage_daily
            GROUP BY tool_name
            ORDER BY calls DESC
            LIMIT 15
        `).all();
    } catch { /* table absent on very old databases */ }
    try {
        budgetCount = (db.prepare(`SELECT COUNT(*) AS c FROM budgets`).get() as any)?.c ?? 0;
    } catch { /* table absent */ }

    return {
        window: 'last 30 days; at most 50 model groups; tool counts cover retained history',
        spend_by_model: byModel,
        top_tools_by_calls: topTools,
        budgets_configured: budgetCount
    };
};

const SYSTEM_PROMPT = `You are the cost analyst inside LLM Observer, a local, privacy-first tool that tracks what a developer spends on AI coding tools. You receive an aggregated spend snapshot: per-model token totals (input, output, cache read, cache write), estimated costs, agentic vs interactive session counts, and tool-call frequencies. You never see prompts or file contents.

Ground every recommendation in the numbers you were given — cite them. Focus on the levers that matter for coding-agent workloads: cache economics (cache reads/writes usually dominate agentic sessions), model selection per task type, redundant tool usage, and budget guardrails. If the data is too thin for a recommendation category, say so rather than inventing one. Keep each recommendation self-contained and actionable.`;

let pendingAnalysis: Promise<AnalystResult> | null = null;
export const runAnalysis = (client?: Anthropic): Promise<AnalystResult> => {
    if (!pendingAnalysis) pendingAnalysis = executeAnalysis(client).finally(() => { pendingAnalysis = null; });
    return pendingAnalysis;
};
const executeAnalysis = async (client?: Anthropic): Promise<AnalystResult> => {
    const apiKey = getAnalystKey();
    if (!client && !apiKey) {
        throw Object.assign(new Error('No API key configured for AI Analyst'), { code: 'NO_KEY' });
    }
    const anthropic = client ?? new Anthropic({ apiKey: apiKey!, timeout: 120000, maxRetries: 0 });

    const snapshot = buildSpendSnapshot();

    const response = await anthropic.messages.create({
        model: getAnalystModel(),
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA as any } },
        system: SYSTEM_PROMPT,
        messages: [{
            role: 'user',
            content: `Analyze this spend snapshot and produce recommendations:\n${JSON.stringify(snapshot, null, 1)}`
        }]
    } as any);

    if ((response as any).stop_reason === 'refusal') {
        throw new Error('The model declined to analyze this request.');
    }
    if ((response as any).stop_reason === 'max_tokens') {
        throw new Error('Analysis was truncated; please retry.');
    }

    const textBlock = (response as any).content.find((b: any) => b.type === 'text');
    if (!textBlock) throw new Error('No analysis returned by the model.');

    const parsed = JSON.parse(textBlock.text);
    if (typeof parsed.summary !== 'string' || parsed.summary.length > 10000 || !Array.isArray(parsed.recommendations) || parsed.recommendations.length > 30 || parsed.recommendations.some((r: any) =>
        typeof r.title !== 'string' || !r.title.trim() || r.title.length > 200 || typeof r.detail !== 'string' || r.detail.length > 10000 ||
        !['model-choice','caching','agent-efficiency','budget','other'].includes(r.category) ||
        !Number.isFinite(r.estimated_monthly_savings_usd) || r.estimated_monthly_savings_usd < 0)) throw new Error('Analysis returned an invalid recommendation format.');
    const result: AnalystResult = {
        summary: parsed.summary,
        recommendations: parsed.recommendations,
        model: (response as any).model,
        generated_at: new Date().toISOString()
    };

    updateSetting(LAST_RESULT_SETTING, JSON.stringify(result));
    return result;
};
