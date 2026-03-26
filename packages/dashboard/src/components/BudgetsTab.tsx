import { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, Shield, ShieldAlert, ShieldCheck, Globe, Cpu, AlertTriangle, RefreshCw } from 'lucide-react';
import { BudgetMeter } from './BudgetMeter';
import { API_BASE_URL } from '../config';

interface Budget {
    id: number;
    name: string;
    scope: 'global' | 'provider' | 'model';
    scope_value?: string;
    period: 'daily' | 'weekly' | 'monthly';
    limit_usd: number;
    current_spend?: number; // Added in v1.4.0
    warning_pct_1: number;
    warning_pct_2: number;
    kill_switch: boolean;
    safety_buffer_usd: number;
    estimate_multiplier: number;
    is_active: boolean;
}

export function BudgetsTab() {
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editing, setEditing] = useState<Budget | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<Budget | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Form State
    const [name, setName] = useState('');
    const [scope, setScope] = useState<'global' | 'provider' | 'model'>('global');
    const [scopeValue, setScopeValue] = useState('');
    const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
    const [limit, setLimit] = useState('');
    const [killSwitch, setKillSwitch] = useState(false);
    const [safetyBuffer, setSafetyBuffer] = useState('0.05');
    const [estimateMultiplier, setEstimateMultiplier] = useState('3.0');

    const fetchBudgets = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/budgets`);
            if (res.ok) {
                const data = await res.json();
                setBudgets(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchBudgets();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Safety Check: Avoid duplicate/overlapping budgets
        const isDuplicate = budgets.some((b: Budget) => 
            b.scope === scope && 
            b.scope_value === (scope === 'global' ? null : scopeValue) &&
            b.period === period &&
            b.id !== (editing?.id)
        );

        if (isDuplicate) {
            alert(`A ${period} budget for this ${scope}${scope !== 'global' ? ` (${scopeValue})` : ''} already exists. Please edit the existing one instead.`);
            return;
        }

        const payload = {
            name,
            scope,
            scope_value: scope === 'global' ? null : scopeValue,
            period,
            limit_usd: parseFloat(limit),
            kill_switch: killSwitch,
            safety_buffer_usd: parseFloat(safetyBuffer),
            estimate_multiplier: parseFloat(estimateMultiplier),
            warning_pct_1: 0.8,
            warning_pct_2: 0.9,
            is_active: true
        };

        try {
            const url = editing ? `${API_BASE_URL}/api/budgets/${editing.id}` : `${API_BASE_URL}/api/budgets`;
            const method = editing ? 'PUT' : 'POST';
            
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setShowAdd(false);
                setEditing(null);
                resetForm();
                fetchBudgets();
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        setDeleting(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/budgets/${confirmDelete.id}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json();
                alert(`Failed to delete budget: ${data.error || 'Unknown error'}`);
            } else {
                fetchBudgets();
                setConfirmDelete(null);
            }
        } catch (err: any) {
            console.error(err);
            alert(`Error deleting budget: ${err.message}`);
        } finally {
            setDeleting(false);
        }
    };

    const resetForm = () => {
        setName('');
        setScope('global');
        setScopeValue('');
        setPeriod('daily');
        setLimit('');
        setKillSwitch(false);
        setSafetyBuffer('0.05');
        setEstimateMultiplier('3.0');
    };

    const startEdit = (b: Budget) => {
        setEditing(b);
        setName(b.name);
        setScope(b.scope);
        setScopeValue(b.scope_value || '');
        setPeriod(b.period);
        setLimit(b.limit_usd.toString());
        setKillSwitch(b.kill_switch);
        setSafetyBuffer(b.safety_buffer_usd.toString());
        setEstimateMultiplier(b.estimate_multiplier.toString());
        setShowAdd(true);
    };

    if (loading) return (
        <div className="flex items-center justify-center p-20">
            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
    );

    const toggleKillSwitch = async (budget: Budget) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/budgets/${budget.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kill_switch: !budget.kill_switch })
            });
            if (res.ok) {
                setBudgets(budgets.map((b: Budget) => b.id === budget.id ? { ...b, kill_switch: !b.kill_switch } : b));
            }
        } catch (err) {
            console.error(err);
        }
    };

    const applyPreset = (preset: any) => {
        resetForm();
        setName(preset.name);
        setScope(preset.scope);
        setScopeValue(preset.scope_value || '');
        setPeriod(preset.period);
        setLimit(preset.limit_usd.toString());
        setKillSwitch(preset.kill_switch || false);
        setSafetyBuffer(preset.safety_buffer_usd?.toString() || '0.05');
        setEstimateMultiplier(preset.estimate_multiplier?.toString() || '3.0');
        setShowAdd(true);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-3xl font-black text-white tracking-tight">Budgets & Alerts</h2>
                    <p className="text-sm text-slate-500">Enforce precision spending across providers and models.</p>
                </div>
                {!showAdd && (
                    <div className="flex items-center gap-3">
                        <div className="hidden lg:flex items-center gap-2 mr-4">
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Quick Presets:</span>
                            {[
                                { name: '$5/day Global', scope: 'global', period: 'daily', limit_usd: 5, safety_buffer_usd: 0.1, estimate_multiplier: 2.5 },
                                { name: '$3/day OpenAI', scope: 'provider', scope_value: 'openai', period: 'daily', limit_usd: 3, safety_buffer_usd: 0.05, estimate_multiplier: 3.0 },
                            ].map((p, i) => (
                                <button 
                                    key={i}
                                    onClick={() => applyPreset(p)}
                                    className="text-[9px] font-bold bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-indigo-500/50 text-slate-400 hover:text-white px-2 py-1 rounded-md transition-all"
                                >
                                    {p.name}
                                </button>
                            ))}
                        </div>
                        <button 
                            onClick={() => { resetForm(); setShowAdd(true); }}
                            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2 rounded-xl transition-all active:scale-95 shadow-lg shadow-indigo-600/20"
                        >
                            <Plus className="w-4 h-4" />
                            Create Budget
                        </button>
                    </div>
                )}
            </div>

            {showAdd && (
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 animate-in slide-in-from-top-4 duration-300 shadow-2xl">
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                        <div className="space-y-4">
                             <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-2 px-1">Basic Settings</h4>
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Budget Name</label>
                                <input 
                                    type="text" 
                                    required
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="e.g. GPT-4o Safety Limit"
                                    className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all font-medium"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Scope</label>
                                    <select 
                                        value={scope}
                                        onChange={e => setScope(e.target.value as any)}
                                        className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all font-medium appearance-none"
                                    >
                                        <option value="global">Global</option>
                                        <option value="provider">Provider</option>
                                        <option value="model">Model</option>
                                    </select>
                                </div>
                                {scope !== 'global' && (
                                    <div>
                                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">
                                            {scope === 'provider' ? 'Provider Name' : 'Model Identifier'}
                                        </label>
                                        <input 
                                            type="text" 
                                            required
                                            value={scopeValue}
                                            onChange={e => setScopeValue(e.target.value)}
                                            placeholder={scope === 'provider' ? 'openai, anthropic...' : 'gpt-4o, claude-3-5...'}
                                            className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-xs font-black text-amber-400 uppercase tracking-widest mb-2 px-1">Limits & Thresholds</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Period</label>
                                    <select 
                                        value={period}
                                        onChange={e => setPeriod(e.target.value as any)}
                                        className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all font-medium appearance-none"
                                    >
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Limit ($)</label>
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        required
                                        value={limit}
                                        onChange={e => setLimit(e.target.value)}
                                        placeholder="50.00"
                                        className="w-full bg-black border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono font-bold"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-4 pt-4">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative">
                                        <input 
                                            type="checkbox" 
                                            className="sr-only peer"
                                            checked={killSwitch}
                                            onChange={e => setKillSwitch(e.target.checked)}
                                        />
                                        <div className="w-12 h-6 bg-slate-800 rounded-full peer peer-checked:bg-red-500/30 transition-all border border-slate-700" />
                                        <div className="absolute left-1 top-1 w-4 h-4 bg-slate-400 rounded-full peer-checked:left-7 peer-checked:bg-red-500 transition-all shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold text-white group-hover:text-red-400 transition-colors">Hard Block (Kill Switch)</span>
                                        <span className="text-[10px] text-slate-500 font-medium leading-tight">Block requests when limit is reached.</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Budget Guard v2 Advanced Settings */}
                        <div className="md:col-span-2 mt-4 p-6 bg-slate-800/30 rounded-[2rem] border border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-8">
                             <div>
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                                    Advanced Protection (v2)
                                </h5>
                                <div className="space-y-6">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Safety Buffer ($)</label>
                                            <span className="text-[9px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20">PREVENTS OVERSHOOT</span>
                                        </div>
                                        <input 
                                            type="number" 
                                            step="0.01"
                                            value={safetyBuffer}
                                            onChange={e => setSafetyBuffer(e.target.value)}
                                            className="w-full bg-black border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                                        />
                                        <p className="text-[9px] text-slate-500 mt-2 leading-relaxed">
                                            Blocks new requests when budget remaining is less than this amount. 
                                            Recommended: $0.05 for small budgets, $0.50 for large.
                                        </p>
                                    </div>
                                </div>
                             </div>

                             <div className="pt-8 md:pt-0">
                                <div className="space-y-6 mt-8 md:mt-0">
                                    <div className="pt-0.5">
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Estimation Multiplier</label>
                                            <span className="text-[9px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/20">LAYER 3 SAFETY</span>
                                        </div>
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={estimateMultiplier}
                                            onChange={e => setEstimateMultiplier(e.target.value)}
                                            className="w-full bg-black border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-indigo-500 transition-all font-mono text-sm"
                                        />
                                        <p className="text-[9px] text-slate-500 mt-2 leading-relaxed">
                                            Estimated output tokens = Input tokens x Multiplier.
                                            Increase if you use long Chain-of-Thought models (e.g. o1/o3). Default: 3.0
                                        </p>
                                    </div>
                                </div>
                             </div>
                        </div>

                        <div className="md:col-span-2 pt-6 border-t border-slate-800/50 flex items-center justify-end gap-3">
                            <button 
                                type="button" 
                                onClick={() => { setShowAdd(false); setEditing(null); }}
                                className="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:text-white transition-all text-sm"
                            >
                                Cancel
                            </button>
                            <button 
                                type="submit"
                                className="bg-white text-black font-black px-10 py-3 rounded-xl hover:bg-slate-200 transition-all active:scale-95 shadow-xl shadow-white/5 text-sm"
                            >
                                {editing ? 'Update Budget' : 'Create Budget'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 gap-4">
                {budgets.length === 0 && !showAdd ? (
                    <div className="bg-slate-900/50 border-2 border-dashed border-slate-800 rounded-[2rem] p-16 text-center group cursor-pointer hover:border-indigo-500/50 transition-all" onClick={() => setShowAdd(true)}>
                        <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                            <Shield className="w-8 h-8 text-slate-600 group-hover:text-indigo-400" />
                        </div>
                        <h4 className="text-white font-bold text-lg leading-tight">No guardrails active</h4>
                        <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">Set provider-specific limits to prevent unexpected bill shocks.</p>
                    </div>
                ) : (
                    budgets.map((budget: Budget) => (
                        <div key={budget.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-indigo-500/30 transition-all group relative overflow-hidden">
                            {budget.kill_switch && (
                                <div className="absolute top-0 right-0 p-3">
                                    <ShieldAlert className="w-4 h-4 text-red-500/40" />
                                </div>
                            )}
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-4 mb-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                                                budget.scope === 'global' ? 'bg-indigo-500/10 text-indigo-400' : 
                                                budget.scope === 'provider' ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                                            }`}>
                                                {budget.scope === 'global' ? <Globe className="w-6 h-6" /> : 
                                                budget.scope === 'provider' ? <ShieldCheck className="w-6 h-6" /> : <Cpu className="w-6 h-6" />}
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white text-lg flex items-center gap-2">
                                                    {budget.name}
                                                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                                        budget.kill_switch ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'
                                                    }`}>
                                                        {budget.kill_switch ? 'BLOCKING (v2)' : 'MONITOR ONLY'}
                                                    </span>
                                                </h4>
                                                <p className="text-xs text-slate-500 font-medium mt-0.5">
                                                    {budget.scope} {budget.scope_value && `• ${budget.scope_value}`} • {budget.period} reset
                                                </p>
                                            </div>
                                        </div>

                                        <div className="max-w-md">
                                            <BudgetMeter spent={budget.current_spend || 0} budget={budget.limit_usd} buffer={budget.safety_buffer_usd} />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-8 ml-auto">
                                        {/* New V2 Status Info */}
                                        <div className="hidden xl:flex flex-col items-center gap-1 border-x border-slate-800/50 px-6">
                                            <span className="text-[8px] font-black text-slate-600 uppercase tracking-widest leading-none">V2 Protection</span>
                                            <div className="flex gap-1.5 mt-1">
                                                 <div title="Safety Buffer" className="w-2.5 h-2.5 rounded-full bg-emerald-500/40 border border-emerald-500/60" />
                                                 <div title="Pre-estimation" className="w-2.5 h-2.5 rounded-full bg-indigo-500/40 border border-indigo-500/60" />
                                                 <div title="Threshold Warnings" className="w-2.5 h-2.5 rounded-full bg-amber-500/40 border border-amber-500/60" />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-3 pr-6 border-r border-slate-800/50">
                                            <div className="flex flex-col items-end mr-1">
                                                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Enforce</span>
                                                <span className={`text-[8px] font-bold ${budget.kill_switch ? 'text-red-400' : 'text-slate-500'}`}>PROTECTED</span>
                                            </div>
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input 
                                                    type="checkbox" 
                                                    className="sr-only peer"
                                                    checked={budget.kill_switch}
                                                    onChange={() => toggleKillSwitch(budget)}
                                                />
                                                <div className="w-9 h-5 bg-slate-800 rounded-full peer peer-checked:bg-red-500/20 border border-slate-700 transition-all" />
                                                <div className="absolute left-[3px] top-[3px] w-3.5 h-3.5 bg-slate-500 rounded-full peer-checked:translate-x-4 peer-checked:bg-red-500 transition-all" />
                                            </label>
                                        </div>

                                        <div className="text-right min-w-[100px]">
                                            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1">Threshold</p>
                                            <p className="text-2xl font-black text-white italic tracking-tight">${budget.limit_usd.toFixed(2)}</p>
                                        </div>
                                    <div className="flex items-center gap-2">
                                        <button 
                                            onClick={() => startEdit(budget)}
                                            className="p-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all shadow-sm"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => setConfirmDelete(budget)}
                                            className="p-2.5 bg-slate-800 hover:bg-red-500/20 rounded-xl text-slate-400 hover:text-red-400 transition-all shadow-sm"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="bg-indigo-500/5 border border-indigo-500/10 rounded-3xl p-6 flex gap-4">
                <AlertTriangle className="w-6 h-6 text-indigo-400 shrink-0" />
                <div>
                    <h5 className="text-sm font-bold text-white mb-1">Pre-estimation active</h5>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                        Proxy requests are pre-estimated using model pricing tables before execution. 
                        If a request is estimated to cross the kill-switch limit, it will be blocked with a 429 error and an alert will be logged.
                    </p>
                </div>
            </div>

            {/* Custom Delete Confirmation Modal (v1.4.0) */}
            {confirmDelete && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-xl bg-black/40 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-[2.5rem] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 border-red-500/20">
                        <div className="p-10 text-center">
                            <div className="w-20 h-20 bg-red-500/10 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                <Trash2 className="w-10 h-10 text-red-500" />
                            </div>
                            <h2 className="text-2xl font-black text-white tracking-tight mb-2">Destructive Action</h2>
                            <p className="text-slate-400 font-medium text-sm leading-relaxed mb-8">
                                You are about to permanently delete the <span className="text-white font-bold">"{confirmDelete.name}"</span> budget rule. This cannot be undone.
                            </p>
                            
                            <div className="grid grid-cols-2 gap-3">
                                <button 
                                    onClick={() => setConfirmDelete(null)}
                                    className="px-6 py-3 rounded-2xl font-bold text-slate-500 hover:text-white hover:bg-slate-800 transition-all"
                                >
                                    Go Back
                                </button>
                                <button 
                                    onClick={handleDelete}
                                    disabled={deleting}
                                    className="bg-red-600 hover:bg-red-500 text-white font-black px-6 py-3 rounded-2xl transition-all active:scale-95 shadow-xl shadow-red-600/20 flex items-center justify-center gap-2"
                                >
                                    {deleting ? (
                                        <RefreshCw className="w-4 h-4 animate-spin" />
                                    ) : (
                                        'Confirm Delete'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
