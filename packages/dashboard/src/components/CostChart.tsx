import { useEffect, useState, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from '../config';

interface ChartDataPoint {
    date: string;
    cost: number;
    requests: number;
    displayDate?: string;
}

export function CostChart() {
    const [data, setData] = useState<ChartDataPoint[]>([]);
    const [loading, setLoading] = useState(true);
    const sseRef = useRef<EventSource | null>(null);

    const fetchChart = () => {
        fetch(`${API_BASE_URL}/api/stats/chart`)
            .then(res => res.json())
            .then(resData => {
                if (resData.data) {
                    const formatted = resData.data.map((item: any) => ({
                        ...item,
                        displayDate: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    }));
                    setData(formatted);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch chart:', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchChart();

        // SSE trigger for refresh
        sseRef.current = new EventSource(`${API_BASE_URL}/api/events`);
        sseRef.current.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'new_request') {
                    // Small delay to ensure DB write is finalized if needed, 
                    // though internalLogger is async, stats/chart reads from DB.
                    setTimeout(fetchChart, 500);
                }
            } catch (e) { }
        };

        const intervalId = setInterval(fetchChart, 60000); // Less frequent poll since we have SSE

        return () => {
            sseRef.current?.close();
            clearInterval(intervalId);
        };
    }, []);

    if (loading) {
        return <div className="animate-pulse h-full bg-surfaceHighlight/20 rounded-2xl w-full"></div>;
    }

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="glass-panel p-4 outline-none border-primary/20 shadow-2xl">
                    <p className="text-[10px] uppercase tracking-widest text-textMuted font-bold mb-2">{label}</p>
                    <p className="text-xl font-black text-white mb-1">
                        ${payload[0].value.toFixed(4)}
                    </p>
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                        <span className="text-xs text-textMuted font-medium">
                            {payload[0].payload.requests} requests handled
                        </span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis
                    dataKey="displayDate"
                    stroke="#94A3B8"
                    fontSize={10}
                    fontWeight={600}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                />
                <YAxis
                    stroke="#94A3B8"
                    fontSize={10}
                    fontWeight={600}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#4F46E533', strokeWidth: 2 }} />
                <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="#4F46E5"
                    strokeWidth={4}
                    fillOpacity={1}
                    fill="url(#colorCost)"
                    animationDuration={1000}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}

