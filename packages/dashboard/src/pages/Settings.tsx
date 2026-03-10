import { useEffect, useState } from 'react';
import { Key, Save, Plus, Trash2, Copy, ShieldCheck, Globe, AlertTriangle, Settings as SettingsIcon, CreditCard, CheckCircle2, Zap, History, Layers, KeyRound, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface ApiKeyData {
    id: string;
    name: string;
    key_hint: string;
    created_at: string;
    last_used_at: string | null;
}

export default function Settings() {
    const [activeTab, setActiveTab] = useState<'providers' | 'api_keys' | 'security' | 'license'>('providers');
    const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

    // Provider Tab State
    const [openAiKey, setOpenAiKey] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [googleKey, setGoogleKey] = useState('');
    const [mistralKey, setMistralKey] = useState('');
    const [groqKey, setGroqKey] = useState('');
    const [saved, setSaved] = useState(false);

    // API Keys Tab State
    const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    // License Tab State
    const [licenseInfo, setLicenseInfo] = useState<any>(null);
    const [activationKey, setActivationKey] = useState('');
    const [activating, setActivating] = useState(false);
    const [activationError, setActivationError] = useState<string | null>(null);
    const [activationSuccess, setActivationSuccess] = useState<string | null>(null);

    // Projects Info (for limits display)
    const [projectsCount, setProjectsCount] = useState(0);

    // Geolocation for Hybrid Payments
    const [country, setCountry] = useState<string | null>(null);
    const [detectingCountry, setDetectingCountry] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/settings`);
                const data = await res.json();
                if (data.data) {
                    setOpenAiKey(data.data.openai_api_key || '');
                    setAnthropicKey(data.data.anthropic_api_key || '');
                    setGoogleKey(data.data.google_api_key || '');
                    setMistralKey(data.data.mistral_api_key || '');
                    setGroqKey(data.data.groq_api_key || '');
                }
            } catch (err) {
                console.error('Failed to fetch settings:', err);
            }
        };
        fetchSettings();

        // Detect Country for Payments
        const detectCountry = async () => {
            try {
                const res = await fetch('https://ipapi.co/json/');
                const data = await res.json();
                setCountry(data.country_code);
            } catch (err) {
                console.error('Failed to detect country:', err);
                setCountry('US'); // Fallback to Global
            } finally {
                setDetectingCountry(false);
            }
        };
        detectCountry();
    }, []);

    useEffect(() => {
        if (activeTab === 'api_keys') {
            fetchApiKeys();
        }
        if (activeTab === 'license') {
            fetchLicenseStatus();
            fetchProjectsCount();
        }
    }, [activeTab]);

    const fetchLicenseStatus = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/license/status`);
            const data = await res.json();
            setLicenseInfo(data.data);
        } catch (err) {
            console.error(err);
        }
    };

    const fetchProjectsCount = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/projects`);
            const data = await res.json();
            setProjectsCount(data.data?.length || 0);
        } catch (err) {
            console.error(err);
        }
    };

    const handleActivate = async () => {
        if (!activationKey.trim()) return;
        setActivating(true);
        setActivationError(null);
        setActivationSuccess(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/license/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: activationKey })
            });
            const data = await res.json();
            if (res.ok) {
                setActivationSuccess(data.message);
                setActivationKey('');
                fetchLicenseStatus();
            } else {
                setActivationError(data.error || 'Activation failed');
            }
        } catch (err) {
            setActivationError('Connection error. Please try again.');
        } finally {
            setActivating(false);
        }
    };

    const fetchApiKeys = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/keys`);
            const data = await res.json();
            setApiKeys(data.data || []);
        } catch (err) {
            console.error(err);
        }
    };

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) return;
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newKeyName })
            });
            const data = await res.json();
            if (data.data) {
                setGeneratedKey(data.data.apiKey);
                setNewKeyName('');
                fetchApiKeys();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this API key?')) return;
        try {
            await fetch(`${API_BASE_URL}/api/auth/keys/${id}`, { method: 'DELETE' });
            fetchApiKeys();
        } catch (err) {
            console.error(err);
        }
    };

    const handleSave = async () => {
        try {
            await fetch(`${API_BASE_URL}/api/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    openai_api_key: openAiKey,
                    anthropic_api_key: anthropicKey,
                    google_api_key: googleKey,
                    mistral_api_key: mistralKey,
                    groq_api_key: groqKey,
                })
            });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            console.error('Failed to save settings:', err);
        }
    };

    return (
        <div className="max-w-5xl mx-auto p-8 animate-fade-in">
            <div className="flex items-center gap-3 mb-8">
                <SettingsIcon className="w-8 h-8 text-primary" />
                <div>
                    <h1 className="text-3xl font-bold text-white">Settings</h1>
                    <p className="text-textMuted mt-1">Configure your proxy upstreams and access keys.</p>
                </div>
            </div>

            <div className="flex gap-8">
                {/* Sidebar */}
                <div className="w-64 space-y-2">
                    <button
                        onClick={() => setActiveTab('providers')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${activeTab === 'providers' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-textMuted hover:text-white hover:bg-surfaceHighlight'}`}>
                        <Globe className="w-5 h-5" /> Upstream Providers
                    </button>
                    <button
                        onClick={() => setActiveTab('api_keys')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${activeTab === 'api_keys' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-textMuted hover:text-white hover:bg-surfaceHighlight'}`}>
                        <Key className="w-5 h-5" /> Observer Keys
                    </button>
                    <button
                        onClick={() => setActiveTab('security')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${activeTab === 'security' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-textMuted hover:text-white hover:bg-surfaceHighlight'}`}>
                        <ShieldCheck className="w-5 h-5" /> Security & Privacy
                    </button>
                    <button
                        onClick={() => setActiveTab('license')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${activeTab === 'license' ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-textMuted hover:text-white hover:bg-surfaceHighlight'}`}>
                        <CreditCard className="w-5 h-5" /> License & Billing
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 min-w-0">
                    {activeTab === 'providers' && (
                        <div className="space-y-6">
                            <div className="card">
                                <h2 className="text-xl font-bold text-white mb-6">Global Upstream Keys</h2>
                                <p className="text-sm text-textMuted mb-8">
                                    These keys are used by the proxy when a request doesn't provide its own `Authorization` header.
                                </p>

                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-sm font-medium text-textMuted mb-2">OpenAI API Key</label>
                                        <input
                                            type="password"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="sk-..."
                                            value={openAiKey}
                                            onChange={e => setOpenAiKey(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-textMuted mb-2">Anthropic API Key</label>
                                        <input
                                            type="password"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="sk-ant-..."
                                            value={anthropicKey}
                                            onChange={e => setAnthropicKey(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-textMuted mb-2">Google API Key</label>
                                        <input
                                            type="password"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="AIza..."
                                            value={googleKey}
                                            onChange={e => setGoogleKey(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-textMuted mb-2">Mistral API Key</label>
                                        <input
                                            type="password"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="..."
                                            value={mistralKey}
                                            onChange={e => setMistralKey(e.target.value)}
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-textMuted mb-2">Groq API Key</label>
                                        <input
                                            type="password"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            placeholder="gsk_..."
                                            value={groqKey}
                                            onChange={e => setGroqKey(e.target.value)}
                                        />
                                    </div>

                                    <div className="pt-6 mt-6 border-t border-border flex items-center justify-end gap-4">
                                        {saved && <span className="text-success text-sm font-medium animate-fade-in">Saved Successfully</span>}
                                        <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                                            <Save className="w-4 h-4" /> Save Configuration
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 bg-surfaceHighlight/30 rounded-xl border border-border border-dashed flex items-start gap-4">
                                <AlertTriangle className="w-6 h-6 text-warning shrink-0" />
                                <div>
                                    <h4 className="text-white font-semibold">Security Note</h4>
                                    <p className="text-sm text-textMuted mt-1">
                                        These keys are stored in the local database of your LLM Observer instance.
                                        Ensure your server environment is secure.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'api_keys' && (
                        <div className="space-y-6">
                            <div className="card">
                                <h2 className="text-xl font-bold text-white mb-2">Generate API Key</h2>
                                <p className="text-sm text-textMuted mb-6">Create a static token to authenticate your applications through the LLM Observer proxy.</p>

                                {generatedKey && (
                                    <div className="mb-6 p-4 bg-success/10 border border-success/30 rounded-lg">
                                        <p className="text-success font-medium mb-2 flex items-center gap-2"><Key className="w-4 h-4" /> Key Generated Successfully</p>
                                        <p className="text-sm text-textMuted mb-3">Please copy this key now. You will not be able to see it again.</p>
                                        <div className="flex bg-background border border-border rounded p-2 items-center justify-between">
                                            <code className="text-white font-mono break-all">{generatedKey}</code>
                                            <button onClick={() => navigator.clipboard.writeText(generatedKey)} className="text-textMuted hover:text-white p-2">
                                                <Copy className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-4 items-end">
                                    <div className="flex-1">
                                        <label className="block text-sm font-medium text-textMuted mb-2">Key Name</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Production Webapp"
                                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                            value={newKeyName}
                                            onChange={e => setNewKeyName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
                                        />
                                    </div>
                                    <button
                                        onClick={handleCreateKey}
                                        disabled={!newKeyName.trim()}
                                        className="h-[42px] flex items-center gap-2 px-5 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                        <Plus className="w-4 h-4" /> Generate
                                    </button>
                                </div>
                            </div>

                            <div className="card">
                                <h2 className="text-xl font-bold text-white mb-6">Active API Keys</h2>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead>
                                            <tr className="text-textMuted border-b border-border">
                                                <th className="pb-3 font-medium">Name</th>
                                                <th className="pb-3 font-medium">Hint</th>
                                                <th className="pb-3 font-medium text-right">Last Used</th>
                                                <th className="pb-3 font-medium text-right">Created</th>
                                                <th className="pb-3 font-medium text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border text-sm">
                                            {apiKeys.length === 0 ? (
                                                <tr><td colSpan={5} className="py-8 text-center text-textMuted">No API keys found.</td></tr>
                                            ) : (
                                                apiKeys.map(key => (
                                                    <tr key={key.id} className="hover:bg-surfaceHighlight/30 transition-colors">
                                                        <td className="py-4 text-white font-medium">{key.name}</td>
                                                        <td className="py-4 text-textMuted font-mono text-xs">{key.key_hint}</td>
                                                        <td className="py-4 text-right text-textMuted">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
                                                        <td className="py-4 text-right text-textMuted">{new Date(key.created_at).toLocaleDateString()}</td>
                                                        <td className="py-4 text-right">
                                                            <button onClick={() => handleDeleteKey(key.id)} className="text-danger/70 hover:text-danger p-2 rounded-lg hover:bg-danger/10 transition-colors">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <div className="card text-center py-20">
                            <ShieldCheck className="w-16 h-16 text-textMuted mx-auto mb-4 opacity-20" />
                            <h2 className="text-xl font-bold text-white mb-2">Security Settings</h2>
                            <p className="text-textMuted max-w-sm mx-auto">Enterprise security features including SSO, IP Whitelisting, and Data Masking are coming soon.</p>
                        </div>
                    )}

                    {activeTab === 'license' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Left Column: Plan Status */}
                            <div className="space-y-6">
                                <div className="card overflow-hidden relative">
                                    {!licenseInfo?.isPro && (
                                        <div className="absolute top-0 right-0 px-3 py-1 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider rounded-bl-xl border-l border-b border-primary/20">
                                            Free Tier
                                        </div>
                                    )}
                                    {licenseInfo?.isPro && (
                                        <div className="absolute top-0 right-0 px-3 py-1 bg-amber-500 text-slate-900 text-xs font-black uppercase tracking-wider rounded-bl-xl shadow-[0_0_15px_rgba(245,158,11,0.5)]">
                                            Pro Plan
                                        </div>
                                    )}

                                    <h3 className="text-lg font-bold mb-2 flex items-center gap-2 text-white">
                                        {licenseInfo?.isPro ? <Zap className="w-5 h-5 text-amber-500 fill-amber-500" /> : <ShieldCheck className="w-5 h-5 text-primary" />}
                                        {licenseInfo?.isPro ? 'Pro Subscription' : 'Hobbyist (Free)'}
                                    </h3>
                                    <p className="text-textMuted text-sm mb-6">
                                        {licenseInfo?.isPro
                                            ? 'Full local access to all observability features. Thank you for supporting privacy-first development!'
                                            : 'Everything you need to track local experiments.'}
                                    </p>

                                    <div className="space-y-4">
                                        <div>
                                            <div className="flex justify-between text-xs mb-1.5 px-0.5">
                                                <span className="text-textMuted font-medium">Project Capacity</span>
                                                <span className="text-white font-mono italic">
                                                    {projectsCount} / {licenseInfo?.limits.maxProjects === 100 ? '∞' : licenseInfo?.limits.maxProjects}
                                                </span>
                                            </div>
                                            <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
                                                <div
                                                    className={`h-full transition-all duration-700 ease-out ${licenseInfo?.isPro ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-primary to-blue-400'}`}
                                                    style={{ width: `${Math.min((projectsCount / (licenseInfo?.limits.maxProjects || 1)) * 100, 100)}%` }}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <div className="flex justify-between text-xs mb-1.5 px-0.5">
                                                <span className="text-textMuted font-medium">Log Retention</span>
                                                <span className="text-white font-mono italic tracking-tight">{licenseInfo?.limits.logRetentionDays || 7} Days</span>
                                            </div>
                                            <div className="h-2 bg-background rounded-full overflow-hidden border border-border">
                                                <div
                                                    className={`h-full transition-all duration-700 ease-out ${licenseInfo?.isPro ? 'bg-gradient-to-r from-amber-600 to-amber-400 w-full' : 'bg-gradient-to-r from-primary to-blue-400 w-[7.7%]'}`}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {!licenseInfo?.isPro && (
                                        <div className="mt-8 pt-6 border-t border-border">
                                            <div className="flex items-center justify-between mb-4">
                                                <h4 className="text-xs font-bold text-textMuted uppercase tracking-widest">Why Upgrade?</h4>
                                                {detectingCountry ? (
                                                    <span className="text-[10px] text-textMuted animate-pulse">Detecting local regional pricing...</span>
                                                ) : (
                                                    <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                                                        {country === 'IN' ? '🇮🇳 Local Pricing Available' : '🌍 Global Coverage'}
                                                    </span>
                                                )}
                                            </div>
                                            <ul className="space-y-3">
                                                {[
                                                    { text: 'Unlimited Local Projects', icon: Layers },
                                                    { text: 'Extended 90-Day Log Retention', icon: History },
                                                    { text: 'Full Cost Optimizer Insights', icon: Zap },
                                                    { text: 'Priority Feature Access', icon: ShieldCheck }
                                                ].map((feature, i) => (
                                                    <li key={i} className="flex items-center gap-3 text-sm text-textMuted">
                                                        <div className="p-1 bg-amber-500/10 rounded-lg">
                                                            <feature.icon className="w-3.5 h-3.5 text-amber-500" />
                                                        </div>
                                                        {feature.text}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Right Column: Activation */}
                            <div className="space-y-6">
                                <div className="card">
                                    <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                                        <CreditCard className="w-5 h-5 text-textMuted" />
                                        {licenseInfo?.isPro ? 'License Management' : 'Upgrade to Pro'}
                                    </h2>
                                    <p className="text-textMuted text-sm mb-4">
                                        {licenseInfo?.isPro
                                            ? 'Enter a new key to transfer or update your subscription.'
                                            : 'Unlock unlimited potential with our flat-rate pricing.'}
                                    </p>

                                    {!licenseInfo?.isPro && (
                                        <div className="flex bg-background/50 border border-border p-1 rounded-lg mb-6 w-fit">
                                            <button
                                                onClick={() => setBillingCycle('monthly')}
                                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${billingCycle === 'monthly' ? 'bg-primary text-white shadow-sm' : 'text-textMuted hover:text-white'}`}>
                                                Monthly
                                            </button>
                                            <button
                                                onClick={() => setBillingCycle('yearly')}
                                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${billingCycle === 'yearly' ? 'bg-amber-500 text-slate-900 shadow-sm' : 'text-textMuted hover:text-white'}`}>
                                                Yearly <span className="opacity-70 ml-1 font-medium">(Save 15%)</span>
                                            </button>
                                        </div>
                                    )}

                                    {activationError && (
                                        <div className="mb-6 p-4 bg-danger/10 border border-danger/30 rounded-lg flex items-center gap-3">
                                            <AlertTriangle className="w-5 h-5 text-danger" />
                                            <p className="text-danger text-sm font-medium">{activationError}</p>
                                        </div>
                                    )}

                                    {activationSuccess && (
                                        <div className="mb-6 p-4 bg-success/10 border border-success/30 rounded-lg flex items-center gap-3">
                                            <CheckCircle2 className="w-5 h-5 text-success" />
                                            <p className="text-success text-sm font-medium">{activationSuccess}</p>
                                        </div>
                                    )}

                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs font-bold text-textMuted uppercase tracking-widest mb-2 block">
                                                License Key
                                            </label>
                                            <div className="relative group">
                                                <input
                                                    type="password"
                                                    value={activationKey}
                                                    onChange={(e) => setActivationKey(e.target.value)}
                                                    placeholder="sk_live_..."
                                                    className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary group-hover:border-slate-500 transition-all font-mono text-sm"
                                                />
                                                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <KeyRound className="w-4 h-4 text-textMuted" />
                                                </div>
                                            </div>
                                        </div>

                                        <button
                                            onClick={handleActivate}
                                            disabled={activating || !activationKey}
                                            className={`w-full py-2.5 rounded-lg font-bold text-sm transition-all shadow-lg active:scale-[0.98] ${activating
                                                ? 'bg-surfaceHighlight text-textMuted cursor-not-allowed'
                                                : licenseInfo?.isPro
                                                    ? 'bg-surfaceHighlight hover:bg-surfaceHighlight/80 text-white border border-border'
                                                    : 'bg-primary hover:bg-primary/90 text-white'
                                                }`}
                                        >
                                            {activating ? 'Validating Key...' : licenseInfo?.isPro ? 'Update License' : 'Activate Pro Features'}
                                        </button>

                                        {!licenseInfo?.isPro && (
                                            <div className="pt-2">
                                                {country === 'IN' ? (
                                                    <a
                                                        href={billingCycle === 'monthly' ? "https://rzp.io/l/llm-observer-monthly" : "https://rzp.io/l/llm-observer-yearly"}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="block text-center text-sm text-white hover:text-primary transition-colors py-4 font-bold bg-primary/10 hover:bg-primary/20 rounded-xl border border-primary/30 mt-4 group"
                                                    >
                                                        Pay <span className="text-primary group-hover:scale-110 inline-block transition-transform">{billingCycle === 'monthly' ? '₹299' : '₹2,499'}</span> with UPI &rarr;
                                                        <span className="block text-[10px] text-textMuted font-medium mt-1 uppercase tracking-widest">Local India Region Pricing</span>
                                                    </a>
                                                ) : (
                                                    <a
                                                        href={billingCycle === 'monthly' ? "https://llmobserver.lemonsqueezy.com/checkout/buy/pro-monthly" : "https://llmobserver.lemonsqueezy.com/checkout/buy/pro-yearly"}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="block text-center text-sm text-white hover:text-primary transition-colors py-4 font-bold bg-primary/10 hover:bg-primary/20 rounded-xl border border-primary/30 mt-4 group"
                                                    >
                                                        Pay <span className="text-primary group-hover:scale-110 inline-block transition-transform">{billingCycle === 'monthly' ? '$9' : '$79'}</span> via Lemon Squeezy &rarr;
                                                        <span className="block text-[10px] text-textMuted font-medium mt-1 uppercase tracking-widest">Global Flat-Rate Pricing</span>
                                                    </a>
                                                )}

                                                <div className="mt-8 pt-6 border-t border-border">
                                                    <p className="text-[10px] text-textMuted font-medium uppercase tracking-widest mb-3">Already have a key?</p>
                                                    <div className="space-y-4">
                                                        <div>
                                                            <div className="relative group">
                                                                <input
                                                                    type="password"
                                                                    value={activationKey}
                                                                    onChange={(e) => setActivationKey(e.target.value)}
                                                                    placeholder="sk_live_..."
                                                                    className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-primary group-hover:border-slate-500 transition-all font-mono text-xs"
                                                                />
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={handleActivate}
                                                            disabled={activating || !activationKey}
                                                            className={`w-full py-2 rounded-lg font-bold text-xs transition-all active:scale-[0.98] ${activating
                                                                ? 'bg-surfaceHighlight text-textMuted cursor-not-allowed'
                                                                : 'bg-surfaceHighlight hover:bg-surfaceHighlight/80 text-white border border-border'
                                                                }`}
                                                        >
                                                            {activating ? 'Validating...' : 'Activate License'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {licenseInfo?.isPro && (
                                    <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-start gap-3">
                                        <div className="p-2 bg-amber-500/10 rounded-lg shrink-0">
                                            <AlertCircle className="w-4 h-4 text-amber-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-amber-200/80 leading-relaxed">
                                                <strong className="text-amber-400 font-bold block mb-1">Billing Note</strong>
                                                Subscriptions are managed externaly. To cancel or modify your payment method, please visit the portal linked in your activation email.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
