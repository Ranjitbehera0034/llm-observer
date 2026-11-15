import { ExternalLink, KeyRound, MessageSquareText, CreditCard, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

type Provider = { name: string; chat?: string; api?: string; apiTracked: string; note?: string };

// Official destinations only. Purchase and account status stay with the provider.
const providers: Provider[] = [
    { name: 'ChatGPT / OpenAI', chat: 'https://chatgpt.com/', api: 'https://platform.openai.com/', apiTracked: 'Proxy and account usage sync' },
    { name: 'Claude / Anthropic', chat: 'https://claude.ai/', api: 'https://console.anthropic.com/', apiTracked: 'Proxy and account usage sync' },
    { name: 'Gemini / Google', chat: 'https://gemini.google.com/', api: 'https://aistudio.google.com/', apiTracked: 'Proxy and supported local logs', note: 'Gemini app plans and Gemini API billing are separate.' },
    { name: 'DeepSeek', chat: 'https://chat.deepseek.com/', api: 'https://platform.deepseek.com/', apiTracked: 'Proxy traffic' },
    { name: 'Kimi / Moonshot', chat: 'https://kimi.com/', api: 'https://platform.kimi.ai/', apiTracked: 'Proxy traffic' },
    { name: 'OpenRouter', api: 'https://openrouter.ai/', apiTracked: 'Proxy traffic', note: 'One API account can reach many supported provider models.' },
];

function Destination({ href, children }: { href: string; children: React.ReactNode }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surfaceHighlight text-white border border-border hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary text-sm font-semibold">
        {children}<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
    </a>;
}

export default function ModelAccess() {
    return <div className="max-w-6xl mx-auto space-y-7 py-10 px-6">
        <div>
            <p className="text-xs uppercase tracking-[.2em] text-primary font-bold mb-3">Model access</p>
            <h1 className="text-3xl font-bold text-white">Choose, connect and track your AI services</h1>
            <p className="text-textMuted mt-3 max-w-3xl">Choose a provider below. Their checkout handles payment; LLM Observer never asks for your card or claims to activate another company’s plan. After paying for API usage, connect your own key to track supported calls.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-border bg-surface p-5"><CreditCard className="w-5 h-5 text-primary mb-3" /><h2 className="font-semibold text-white">1. Choose access</h2><p className="text-sm text-textMuted mt-2">Chat subscription for the provider’s app, or API billing for apps and developer tools.</p></div>
            <div className="rounded-2xl border border-border bg-surface p-5"><KeyRound className="w-5 h-5 text-primary mb-3" /><h2 className="font-semibold text-white">2. Connect API key</h2><p className="text-sm text-textMuted mt-2">For API usage, save your provider key locally in Settings → Upstream Providers.</p></div>
            <div className="rounded-2xl border border-border bg-surface p-5"><ArrowRight className="w-5 h-5 text-primary mb-3" /><h2 className="font-semibold text-white">3. Track usage</h2><p className="text-sm text-textMuted mt-2">Route calls through Observer or use supported local logs and account sync. Unsupported traffic stays unknown.</p></div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-100">Chat plans do not grant API credits or model calls through LLM Observer. Provider payments and renewals are managed in your provider account. Observer Pro is a separate product.</div>
        <div className="grid md:grid-cols-2 gap-4">
            {providers.map(provider => <section key={provider.name} className="rounded-2xl border border-border bg-surface p-6 space-y-4">
                <div><h2 className="text-lg font-bold text-white">{provider.name}</h2><p className="text-sm text-textMuted mt-1">API tracking: {provider.apiTracked}</p></div>
                {provider.note && <p className="text-xs text-textMuted">{provider.note}</p>}
                <div className="flex flex-wrap gap-2">
                    {provider.chat && <Destination href={provider.chat}><MessageSquareText className="w-4 h-4" /> Open chat plans</Destination>}
                    {provider.api && <Destination href={provider.api}><KeyRound className="w-4 h-4" /> Set up API billing</Destination>}
                </div>
            </section>)}
        </div>
        <div className="flex flex-wrap gap-3 text-sm"><Link to="/settings" className="text-primary hover:underline">Connect your API key →</Link><Link to="/" className="text-primary hover:underline">Record an existing chat subscription →</Link></div>
    </div>;
}
