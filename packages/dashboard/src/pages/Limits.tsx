import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import { Clock, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip, XAxis } from 'recharts';

function useCountdown(resetsAt: string | null) {
    const [timeLeft, setTimeLeft] = useState('');

    useEffect(() => {
        if (!resetsAt) {
            setTimeLeft('');
            return;
        }

        const target = new Date(resetsAt).getTime();
        
        const updateTimer = () => {
            const now = new Date().getTime();
            const diff = target - now;
            if (diff <= 0) {
                setTimeLeft('Resetting...');
                return;
            }
            
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            
            setTimeLeft(`resets in ${h}h ${m}m ${s}s`);
        };

        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [resetsAt]);

    return timeLeft;
}

export default function Limits() {
    const [limits, setLimits] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLimits = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/limits`);
                if (res.ok) {
                    const data = await res.json();
                    
                    // Fetch history for each provider
                    const providersWithHistory = await Promise.all(
                        (data.providers || []).map(async (p: any) => {
                            try {
                                const histRes = await fetch(`${API_BASE_URL}/api/limits/${p.provider}`);
                                if (histRes.ok) {
                                    const histData = await histRes.json();
                                    return { ...p, history: histData.history || [] };
                                }
                            } catch { /* ignore */ }
                            return { ...p, history: [] };
                        })
                    );
                    setLimits(providersWithHistory);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchLimits();
        const interval = setInterval(fetchLimits, 60000); // 1 minute
        return () => clearInterval(interval);
    }, []);

    const StatusIcon = ({ status }: { status: string }) => {
        if (status === 'throttled' || status === 'critical') return <ShieldAlert className="w-5 h-5 text-red-500" />;
        if (status === 'warning') return <ShieldAlert className="w-5 h-5 text-amber-500" />;
        if (status === 'monitoring') return <Clock className="w-5 h-5 text-indigo-400" />;
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    };

    if (loading) return (
            <div className="flex items-center justify-center h-[80vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
            </div>
    );

    return (
        <div className="max-w-7xl mx-auto space-y-10 animate-in fade-in py-10 px-6">
            <div className="flex flex-col md:flex-row justify-between items-start gap-6">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Clock className="w-6 h-6 text-indigo-400" />
                        </div>
                        <h1 className="text-4xl font-black text-white tracking-tight">Rate Limits</h1>
                    </div>
                    <p className="text-slate-400 text-lg font-medium mt-1">Real-time utilization and countdown timers.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {limits.map(p => (
                    <div key={p.provider} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 group hover:border-indigo-500/30 transition-all">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                {p.provider}
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${p.source === 'oauth_api' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                                    {p.source === 'oauth_api' ? 'Live via OAuth' : 'Activity monitoring'}
                                </span>
                            </h2>
                        </div>
                        <div className="space-y-6">
                            {p.windows.map((w: any) => (
                                <div key={w.type}>
                                    <div className="flex justify-between items-end mb-2">
                                        <div className="flex items-center gap-2">
                                            <StatusIcon status={w.status} />
                                            <span className="text-sm font-bold text-slate-300">{w.label}</span>
                                        </div>
                                        {w.utilization_pct !== null && (
                                            <div className="text-xs text-slate-400 font-mono">
                                                <Timer resetsAt={w.resets_at} />
                                            </div>
                                        )}
                                    </div>
                                    
                                    {w.utilization_pct !== null ? (
                                        <div className="h-4 bg-slate-800 rounded-full overflow-hidden relative">
                                            <div 
                                                className={`h-full transition-all duration-1000 ${w.status === 'throttled' ? 'bg-red-500' : w.status === 'critical' ? 'bg-red-400' : w.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(w.utilization_pct * 100, 100)}%` }}
                                            />
                                            <div className="absolute inset-0 flex items-center justify-center text-[9px] font-black mix-blend-difference text-white">
                                                {Math.round(w.utilization_pct * 100)}% ({w.total_used} / {w.total_allowed})
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-slate-400 p-3 bg-slate-800/50 rounded-xl">
                                            {w.total_used} requests 
                                            {w.details?.sessions ? ` · ${w.details.sessions} sessions` : ''} 
                                            {w.details?.tokens ? ` · ${w.details.tokens} tokens` : ''}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                        
                        {p.history && p.history.length > 0 && (
                            <div className="mt-8 pt-6 border-t border-slate-800">
                                <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest mb-4">24-Hour Trend</h3>
                                <div className="h-24 w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={p.history}>
                                            <XAxis dataKey="captured_at" hide />
                                            <YAxis hide domain={[0, 1]} />
                                            <Tooltip 
                                                contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px', fontSize: '10px' }}
                                                labelFormatter={(time) => new Date(time as string).toLocaleTimeString()}
                                                formatter={(val: any) => [`${Math.round(val * 100)}%`, 'Utilization']}
                                            />
                                            <Line type="monotone" dataKey="utilization_pct" stroke="#6366f1" strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function Timer({ resetsAt }: { resetsAt: string | null }) {
    const timeLeft = useCountdown(resetsAt);
    return <span>{timeLeft}</span>;
}
