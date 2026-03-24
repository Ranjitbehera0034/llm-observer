import { useState, useEffect } from 'react';
import { Bell, CheckCircle, ExternalLink, RefreshCw, X } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Alert {
    id: string;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    created_at: string;
    acknowledged: boolean;
}

export function NotificationsPanel({ onClose }: { onClose: () => void }) {
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchAlerts = async () => {
        try {
            const res = await fetch('/api/alerts?all=false&limit=10');
            if (res.ok) {
                const data = await res.json();
                setAlerts(data.data || []);
            }
        } catch (err) {
            console.error('Failed to fetch alerts', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAlerts();
    }, []);

    const acknowledgeAll = async () => {
        try {
            const res = await fetch('/api/alerts/acknowledge-all', { method: 'POST' });
            if (res.ok) {
                setAlerts([]);
                onClose();
            }
        } catch (err) {
            console.error('Failed to acknowledge all', err);
        }
    };

    const acknowledgeOne = async (id: string) => {
        try {
            const res = await fetch(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
            if (res.ok) {
                setAlerts(alerts.filter(a => a.id !== id));
            }
        } catch (err) {
            console.error('Failed to acknowledge alert', err);
        }
    };

    return (
        <div className="absolute right-0 mt-2 w-96 bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl z-50 overflow-hidden animate-in slide-in-from-top-2 duration-200">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-sm text-white">Notifications</span>
                    {alerts.length > 0 && (
                        <span className="bg-indigo-500 text-[10px] font-black px-1.5 py-0.5 rounded-full text-white">
                            {alerts.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={acknowledgeAll}
                        className="text-[10px] font-black uppercase text-slate-500 hover:text-indigo-400 transition-colors"
                    >
                        Clear All
                    </button>
                    <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg text-slate-500 transition-all">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="p-8 flex items-center justify-center">
                        <RefreshCw className="w-6 h-6 text-slate-700 animate-spin" />
                    </div>
                ) : alerts.length === 0 ? (
                    <div className="p-10 text-center">
                        <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-6 h-6 text-slate-600" />
                        </div>
                        <p className="text-slate-500 text-sm font-medium">All caught up!</p>
                        <p className="text-[10px] text-slate-600 uppercase tracking-widest mt-1">No unread alerts</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-800/50">
                        {alerts.map(alert => (
                            <div key={alert.id} className="p-4 group hover:bg-slate-800/30 transition-all relative">
                                <div className="flex gap-3">
                                    <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${
                                        alert.severity === 'critical' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 
                                        alert.severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
                                    }`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-300 leading-relaxed font-medium">
                                            {alert.message}
                                        </p>
                                        <p className="text-[9px] text-slate-600 mt-2 font-bold uppercase">
                                            {new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {alert.type.replace(/_/g, ' ')}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => acknowledgeOne(alert.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-indigo-500/10 rounded-lg text-slate-500 hover:text-indigo-400 transition-all"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Link 
                to="/alerts" 
                onClick={onClose}
                className="block p-4 text-center border-t border-slate-800 bg-slate-900/50 hover:bg-slate-800 transition-all group"
            >
                <span className="text-[10px] font-black uppercase text-slate-500 group-hover:text-white transition-colors flex items-center justify-center gap-1.5">
                    View Alert History <ExternalLink className="w-3 h-3" />
                </span>
            </Link>
        </div>
    );
}
