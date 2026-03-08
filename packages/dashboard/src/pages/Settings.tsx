import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Save, Server, Shield, Plus, Trash2, Copy } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface ApiKey {
    id: string;
    name: string;
    key_hint: string;
    created_at: string;
    last_used_at: string | null;
}

export default function Settings() {
    const [activeTab, setActiveTab] = useState('provider');

    // Provider Tab State
    const [openAiKey, setOpenAiKey] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [saved, setSaved] = useState(false);

    // API Keys Tab State
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [newKeyName, setNewKeyName] = useState('');
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);

    useEffect(() => {
        setOpenAiKey(localStorage.getItem('openAiKey') || 'sk-...');
        setAnthropicKey(localStorage.getItem('anthropicKey') || 'sk-ant-...');
    }, []);

    useEffect(() => {
        if (activeTab === 'api_keys') {
            fetchApiKeys();
        }
    }, [activeTab]);

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

    const handleSave = () => {
        localStorage.setItem('openAiKey', openAiKey);
        localStorage.setItem('anthropicKey', anthropicKey);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
    };

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                    <SettingsIcon className="w-8 h-8 text-primary" />
                    Global Settings
                </h1>
                <p className="text-textMuted mt-2">Manage API keys, proxy configurations, and data retention policies.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 text-left">
                <div className="lg:col-span-1 space-y-2">
                    <button
                        onClick={() => setActiveTab('provider')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'provider' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-surface hover:bg-surfaceHighlight text-textMuted hover:text-white'}`}>
                        <Server className="w-5 h-5" /> Provider Upstreams
                    </button>
                    <button
                        onClick={() => setActiveTab('api_keys')}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${activeTab === 'api_keys' ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-surface hover:bg-surfaceHighlight text-textMuted hover:text-white'}`}>
                        <Key className="w-5 h-5" /> Observer API Keys
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surfaceHighlight text-textMuted hover:text-white rounded-lg font-medium transition-colors">
                        <Shield className="w-5 h-5" /> Data Retention
                    </button>
                </div>

                <div className="lg:col-span-3">
                    {activeTab === 'provider' && (
                        <div className="card">
                            <h2 className="text-xl font-bold text-white mb-6 border-b border-border pb-4">Provider Equivalencies</h2>
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-textMuted mb-2">OpenAI API Key</label>
                                    <input
                                        type="password"
                                        className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                        value={openAiKey}
                                        onChange={e => setOpenAiKey(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-textMuted mb-2">Anthropic API Key</label>
                                    <input
                                        type="password"
                                        className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                        value={anthropicKey}
                                        onChange={e => setAnthropicKey(e.target.value)}
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
                </div>
            </div>
        </div>
    );
}
