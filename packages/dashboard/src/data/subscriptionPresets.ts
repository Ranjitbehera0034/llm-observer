export interface SubscriptionPreset {
    service_name: string;
    monthly_cost_usd: number;
    provider?: string;
    notes: string;
}

export const SUBSCRIPTION_PRESETS: SubscriptionPreset[] = [
    { service_name: 'Cursor Pro', monthly_cost_usd: 20, provider: 'cursor', notes: 'IDE with AI features' },
    { service_name: 'Cursor Pro+', monthly_cost_usd: 60, provider: 'cursor', notes: 'Higher usage limits' },
    { service_name: 'Cursor Ultra', monthly_cost_usd: 200, provider: 'cursor', notes: 'Maximum usage' },
    { service_name: 'GitHub Copilot', monthly_cost_usd: 10, provider: 'github', notes: 'AI pair programming' },
    { service_name: 'GitHub Copilot Business', monthly_cost_usd: 19, provider: 'github', notes: 'Per seat' },
    { service_name: 'ChatGPT Plus', monthly_cost_usd: 20, provider: 'openai', notes: 'Web and mobile access' },
    { service_name: 'ChatGPT Pro', monthly_cost_usd: 200, provider: 'openai', notes: 'Unlimited access' },
    { service_name: 'Claude Pro', monthly_cost_usd: 20, provider: 'anthropic', notes: 'Web and mobile access' },
    { service_name: 'Claude Max', monthly_cost_usd: 100, provider: 'anthropic', notes: 'Higher limits' },
    { service_name: 'JetBrains AI', monthly_cost_usd: 10, provider: 'jetbrains', notes: 'IDE plugin' },
];
