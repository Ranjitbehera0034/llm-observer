import { getSetting } from '@llm-observer/database';

/** Restrict newly proxied prompts to a loopback Ollama endpoint. */
export function localOnlyEnabled(): boolean {
    return process.env.LLM_OBSERVER_LOCAL_ONLY === '1' || getSetting('privacy_local_only') === 'true';
}

export function localOllamaTargetAllowed(providerName: string, target: string): boolean {
    if (providerName !== 'ollama') return false;
    try {
        const url = new URL(target);
        return url.protocol === 'http:' && !url.username && !url.password &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
            url.pathname === '/' && !url.search && !url.hash;
    } catch { return false; }
}
