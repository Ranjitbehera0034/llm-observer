import { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartDataPoint {
    date: string;
    cost: number;
    requests: number;
}

export function CostChart() {
    const [data, setData] = useState<ChartDataPoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('http://localhost:4001/api/stats/chart')
            .then(res => res.json())
            .then(resData => {
                // Format the date to be more readable
                const formatted = resData.data.map((item: any) => ({
                    ...item,
                    displayDate: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }));
                setData(formatted);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch chart:', err);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return <div className="animate-pulse h-80 bg-surfaceHighlight rounded-xl w-full"></div>;
    }

    // Create a sleek custom tooltip
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="glass-panel p-4 outline-none">
                    <p className="text-sm text-textMuted mb-2">{label}</p>
                    <p className="text-lg font-bold text-white mb-1">
                        <span className="text-primary mr-2">●</span>
                        ${payload[0].value.toFixed(4)}
                    </p>
                    <p className="text-xs text-textMuted">
                        {payload[0].payload.requests} requests
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="card col-span-1 lg:col-span-2 animate-slide-up" style={{ animationDelay: '100ms' }}>
            <h3 className="text-lg font-semibold text-white mb-6">Spend Over Time (7 Days)</h3>
            <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2C3C" vertical={false} />
                        <XAxis
                            dataKey="displayDate"
                            stroke="#94A3B8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            dy={10}
                        />
                        <YAxis
                            stroke="#94A3B8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `$${value}`}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Area
                            type="monotone"
                            dataKey="cost"
                            stroke="#4F46E5"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorCost)"
                            animationDuration={1500}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
