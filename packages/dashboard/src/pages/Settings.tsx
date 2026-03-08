import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Key, Save, Server, Shield } from 'lucide-react';

export default function Settings() {
    const [openAiKey, setOpenAiKey] = useState('');
    const [anthropicKey, setAnthropicKey] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        // Load from local storage for demo purposes
        setOpenAiKey(localStorage.getItem('openAiKey') || 'sk-...');
        setAnthropicKey(localStorage.getItem('anthropicKey') || 'sk-ant-...');
    }, []);

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

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-left">

                <div className="lg:col-span-1 space-y-2">
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-primary/10 text-primary border border-primary/20 rounded-lg font-medium">
                        <Key className="w-5 h-5" /> Provider API Keys
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surfaceHighlight text-textMuted hover:text-white rounded-lg font-medium transition-colors">
                        <Server className="w-5 h-5" /> Proxy Config
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surfaceHighlight text-textMuted hover:text-white rounded-lg font-medium transition-colors">
                        <Shield className="w-5 h-5" /> Data Retention
                    </button>
                </div>

                <div className="lg:col-span-2">
                    <div className="card">
                        <h2 className="text-xl font-bold text-white mb-6 border-b border-border pb-4">Provider API Keys</h2>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-2">OpenAI API Key</label>
                                <div className="flex gap-3">
                                    <input
                                        type="password"
                                        placeholder="sk-..."
                                        className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                        value={openAiKey}
                                        onChange={e => setOpenAiKey(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-textMuted mt-2">Set via environment variable \`OPENAI_API_KEY\` (GUI mockup overrides local testing).</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-2">Anthropic API Key</label>
                                <div className="flex gap-3">
                                    <input
                                        type="password"
                                        placeholder="sk-ant-..."
                                        className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors"
                                        value={anthropicKey}
                                        onChange={e => setAnthropicKey(e.target.value)}
                                    />
                                </div>
                                <p className="text-xs text-textMuted mt-2">Set via environment variable \`ANTHROPIC_API_KEY\` (GUI mockup overrides local testing).</p>
                            </div>

                            <div className="pt-6 mt-6 border-t border-border flex items-center justify-end gap-4">
                                {saved && <span className="text-success text-sm animate-fade-in font-medium">Configuration Saved!</span>}
                                <button onClick={handleSave} className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                                    <Save className="w-4 h-4" /> Save Configuration
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
