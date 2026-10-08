/**
 * Where the admin-API pollers send their requests.
 *
 * Both pollers and scripts/validate-admin-sync.js build their URLs here, so the validator checks
 * exactly the requests the app makes.
 *
 * Base URL overrides (for tests against a local fake vendor server, or a corporate gateway):
 *   LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL   default https://api.anthropic.com
 *   LLM_OBSERVER_OPENAI_ADMIN_BASE_URL      default https://api.openai.com
 * The value is a scheme + host (+ optional path prefix), for example http://127.0.0.1:16050.
 * Because the admin key is sent to whatever host is configured, plain http is accepted only for a
 * loopback host; anything else must be https. Unset or blank means the real vendor host.
 */

export type AdminProvider = 'anthropic' | 'openai';

export const ANTHROPIC_BASE_URL_ENV = 'LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL';
export const OPENAI_BASE_URL_ENV = 'LLM_OBSERVER_OPENAI_ADMIN_BASE_URL';

const DEFAULTS: Record<AdminProvider, string> = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
};
const ENV_NAMES: Record<AdminProvider, string> = {
    anthropic: ANTHROPIC_BASE_URL_ENV,
    openai: OPENAI_BASE_URL_ENV,
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True when the base URL for this provider comes from the environment rather than the default. */
export function isBaseUrlOverridden(provider: AdminProvider): boolean {
    return (process.env[ENV_NAMES[provider]] || '').trim() !== '';
}

/** Base URL (no trailing slash) for a provider's admin API. Throws a clear error for an unusable override. */
export function adminBaseUrl(provider: AdminProvider): string {
    const envName = ENV_NAMES[provider];
    const raw = (process.env[envName] || '').trim();
    if (!raw) return DEFAULTS[provider];

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${envName} is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`${envName} must start with https:// (or http:// for a loopback host)`);
    }
    if (url.username || url.password) {
        throw new Error(`${envName} must not contain credentials`);
    }
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
        throw new Error(`${envName}: plain http is only allowed for localhost / 127.0.0.1; use https:// so the admin key is not sent in clear text`);
    }
    // Keep scheme, host and path prefix; drop query/fragment and trailing slashes.
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

const withPage = (url: string, page: string | null) => (page ? `${url}&page=${encodeURIComponent(page)}` : url);

export function anthropicUsageUrl(base: string, startingAt: string, page: string | null): string {
    return withPage(`${base}/v1/organizations/usage_report/messages?starting_at=${encodeURIComponent(startingAt)}&bucket_width=1d&group_by[]=model`, page);
}

export function anthropicCostUrl(base: string, startingAt: string, endingAt: string, page: string | null): string {
    return withPage(`${base}/v1/organizations/cost_report?starting_at=${encodeURIComponent(startingAt)}&ending_at=${encodeURIComponent(endingAt)}&group_by[]=description`, page);
}

export function openaiUsageUrl(base: string, startTimeSeconds: number, page: string | null): string {
    return withPage(`${base}/v1/organization/usage/completions?start_time=${startTimeSeconds}&bucket_width=1d&group_by[]=model`, page);
}

export function openaiCostUrl(base: string, startTimeSeconds: number, page: string | null): string {
    return withPage(`${base}/v1/organization/costs?start_time=${startTimeSeconds}&bucket_width=1d&group_by[]=line_item`, page);
}
