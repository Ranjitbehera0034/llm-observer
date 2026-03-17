import { useState, useEffect } from 'react';
import { Bell, AlertTriangle, Plus, Trash2, CheckCircle, X } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface AlertRule {
    id: string;
    name: string;
    condition_type: string;
    threshold: number;
    time_window_minutes: number | null;
    webhook_url: string | null;
    is_active: boolean;
    created_at: string;
}

export default function Alerts() {
    const [rules, setRules] = useState<AlertRule[]>([]);
    const [isCreating, setIsCreating] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [conditionType, setConditionType] = useState('budget_threshold');
    const [threshold, setThreshold] = useState<number>(90);
    const [timeWindow, setTimeWindow] = useState<number>(60);
    const [webhookUrl, setWebhookUrl] = useState('');

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/alert-rules`);
            const data = await res.json();
            setRules(data.data || []);
        } catch (err) {
            console.error(err);
        }
    };

    const handleCreateRule = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await fetch(`${API_BASE_URL}/api/alert-rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    condition_type: conditionType,
                    threshold,
                    time_window_minutes: timeWindow,
                    webhook_url: webhookUrl
                })
            });
            setIsCreating(false);
            setName('');
            setWebhookUrl('');
            fetchRules();
        } catch (err) {
            console.error(err);
        }
    };

    const handleDeleteRule = async (id: string) => {
        if (!confirm('Are you sure you want to delete this alert rule?')) return;
        try {
            await fetch(`${API_BASE_URL}/api/alert-rules/${id}`, { method: 'DELETE' });
            fetchRules();
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <Bell className="w-8 h-8 text-primary" />
                        Alerts & Anomalies
                    </h1>
                    <p className="text-textMuted mt-2">Configure webhook notifications for budget overruns or error spikes.</p>
                </div>
                {!isCreating && (
                    <button
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                        <Plus className="w-4 h-4" /> Create Alert Rule
                    </button>
                )}
            </div>

            {isCreating && (
                <div className="card mb-8 animate-fade-in border border-primary/30">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-bold text-white">Create New Rule</h2>
                        <button onClick={() => setIsCreating(false)} className="text-textMuted hover:text-white p-2">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <form onSubmit={handleCreateRule} className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-2">Rule Name</label>
                                <input required type="text" placeholder="e.g. Budget 90% Warning" className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-2">Condition Type</label>
                                <select className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors" value={conditionType} onChange={e => setConditionType(e.target.value)}>
                                    <option value="budget_threshold">Daily Budget Threshold (%)</option>
                                    <option value="error_rate">Error Rate Anomaly (%)</option>
                                    <option value="latency_spike">Latency Spike (ms)</option>
                                </select>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-textMuted mb-2">Threshold limit</label>
                                    <input required type="number" className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors" value={threshold} onChange={e => setThreshold(Number(e.target.value))} />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-textMuted mb-2">Time Window (mins)</label>
                                    <input required type="number" className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors" value={timeWindow} onChange={e => setTimeWindow(Number(e.target.value))} disabled={conditionType === 'budget_threshold'} title="Budgets are daily, window applies to rates/spikes" />
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-textMuted mb-2">Webhook URL</label>
                                <input type="url" placeholder="https://hooks.slack.com/..." className="w-full bg-background border border-border rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary transition-colors" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} />
                                <p className="text-xs text-textMuted mt-2">Optional. We will POST a JSON payload to this endpoint when triggered.</p>
                            </div>
                            <div className="pt-6 mt-6 border-t border-border flex items-center justify-end">
                                <button type="submit" className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg font-medium transition-colors">
                                    Save Rule
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            )}

            {rules.length === 0 && !isCreating ? (
                <div className="bg-surfaceHighlight/30 border border-border border-dashed rounded-xl p-12 text-center">
                    <AlertTriangle className="w-16 h-16 text-warning/50 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-white mb-2">No active alerts configured</h3>
                    <p className="text-textMuted max-w-md mx-auto mb-6">
                        Set up alerts to get notified via Slack, Discord, or Webhook when your daily spend exceeds 90% of your budget, or if the 500-error rate spikes.
                    </p>
                    <div className="flex justify-center gap-4">
                        <button onClick={() => setIsCreating(true)} className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-lg font-medium transition-colors text-sm flex items-center gap-2">
                            <Plus className="w-4 h-4" /> Setup Generic Rule
                        </button>
                    </div>
                </div>
            ) : (
                rules.length > 0 && (
                    <div className="card text-left">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="text-textMuted border-b border-border">
                                        <th className="pb-3 font-medium">Name</th>
                                        <th className="pb-3 font-medium">Condition</th>
                                        <th className="pb-3 font-medium text-right">Threshold</th>
                                        <th className="pb-3 font-medium text-center">Status</th>
                                        <th className="pb-3 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-sm">
                                    {rules.map(rule => (
                                        <tr key={rule.id} className="hover:bg-surfaceHighlight/30 transition-colors">
                                            <td className="py-4 text-white font-medium">{rule.name}
                                                {rule.webhook_url && <div className="text-xs font-mono text-primary/70 mt-1 line-clamp-1">{rule.webhook_url}</div>}
                                            </td>
                                            <td className="py-4 text-textMuted capitalize">{rule.condition_type.replace('_', ' ')}</td>
                                            <td className="py-4 text-right text-textMuted">{rule.threshold} {rule.condition_type === 'latency_spike' ? 'ms' : '%'}</td>
                                            <td className="py-4 text-center">
                                                {rule.is_active ? <CheckCircle className="w-5 h-5 text-success mx-auto" /> : <X className="w-5 h-5 text-danger mx-auto" />}
                                            </td>
                                            <td className="py-4 text-right">
                                                <button onClick={() => handleDeleteRule(rule.id)} className="text-danger/70 hover:text-danger p-2 rounded-lg hover:bg-danger/10 transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}
