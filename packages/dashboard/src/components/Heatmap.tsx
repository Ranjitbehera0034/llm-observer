import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';

export function Heatmap() {
    const [data, setData] = useState<any>(null);
    const [mode, setMode] = useState<'sessions' | 'cost'>('sessions');

    useEffect(() => {
        fetch(`${API_BASE_URL}/api/heatmap?days=30&mode=${mode}`)
            .then(r => r.json())
            .then(setData)
            .catch(console.error);
    }, [mode]);

    if (!data) return <div className="h-32 animate-pulse bg-slate-800 rounded-xl" />;

    return (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 group hover:border-indigo-500/30 transition-all col-span-1 md:col-span-2 xl:col-span-3">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-xl font-bold tracking-[0.05em] text-white">Your AI Activity Pattern</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-black mt-1">Last {data.period_days} Days</p>
                </div>
                <div className="flex bg-slate-800 rounded-lg p-1">
                    <button 
                        onClick={() => setMode('sessions')} 
                        className={`text-[10px] uppercase font-black px-3 py-1 rounded-md ${mode === 'sessions' ? 'bg-indigo-500 text-white' : 'text-slate-400'}`}>
                        Sessions
                    </button>
                    <button 
                        onClick={() => setMode('cost')} 
                        className={`text-[10px] uppercase font-black px-3 py-1 rounded-md ${mode === 'cost' ? 'bg-indigo-500 text-white' : 'text-slate-400'}`}>
                        Cost
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto pb-4">
                <div className="flex flex-col gap-1 min-w-[600px]">
                    <div className="flex pl-10 mb-2">
                        {Array.from({length: 24}).map((_, i) => (
                            <div key={i} className="flex-1 text-center text-[8px] font-bold text-slate-500">{i%2===0 ? `${i}h` : ''}</div>
                        ))}
                    </div>
                    {data.grid.map((dayRow: any) => (
                        <div key={dayRow.day} className="flex gap-1 items-center">
                            <div className="w-8 text-[9px] font-black text-slate-400 mr-2 text-right">
                                {dayRow.day_name.substring(0, 3)}
                            </div>
                            {dayRow.hours.map((h: any) => {
                                const intensity = data.max_value > 0 ? h.value / data.max_value : 0;
                                let bgClass = 'bg-slate-800';
                                if (intensity > 0) {
                                    if (intensity > 0.8) bgClass = 'bg-emerald-400';
                                    else if (intensity > 0.5) bgClass = 'bg-emerald-500';
                                    else if (intensity > 0.2) bgClass = 'bg-emerald-700';
                                    else bgClass = 'bg-emerald-900';
                                }

                                const ampm = h.hour >= 12 ? 'PM' : 'AM';
                                const displayHour = h.hour % 12 || 12;
                                const avg = h.sessions ? h.cost / h.sessions : 0;
                                const titleStr = `${dayRow.day_name} ${displayHour} ${ampm} — ${h.sessions} sessions — $${avg.toFixed(2)} average`;

                                return (
                                    <div 
                                        key={h.hour}
                                        title={titleStr}
                                        className={`flex-1 aspect-square rounded-sm ${bgClass} hover:ring-2 ring-indigo-400 transition-all cursor-crosshair`}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-4 flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase">
                {data.peak && <div>Peak: {data.peak.label} ({Math.round(data.peak.value)}{mode==='cost'?'$':''})</div>}
                {data.quietest && <div>Quietest: {data.quietest.label} ({Math.round(data.quietest.value)}{mode==='cost'?'$':''})</div>}
            </div>
        </div>
    );
}
