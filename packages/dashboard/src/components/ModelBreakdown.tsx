import { useEffect, useState, useRef } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { API_BASE_URL } from '../config';

interface ModelStat {
    model: string;
    cost: number;
    tokens: number;
    requests: number;
}

const COLORS = ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

export function ModelBreakdown() {
    const [data, setData] = useState<ModelStat[]>([]);
    const [loading, setLoading] = useState(true);
    const sseRef = useRef<EventSource | null>(null);

    const fetchModels = () => {
        fetch(`${API_BASE_URL}/api/stats/models`)
            .then(res => res.json())
            .then(resData => {
                setData(resData.data || []);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch models stat:', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchModels();

        // SSE trigger for refresh
        sseRef.current = new EventSource(`${API_BASE_URL}/api/events`);
        sseRef.current.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'new_request') {
                    setTimeout(fetchModels, 500);
                }
            } catch (e) { }
        };

        const intervalId = setInterval(fetchModels, 60000);

        return () => {
            sseRef.current?.close();
            clearInterval(intervalId);
        };
    }, []);

    if (loading) {
        return <div className="animate-pulse h-full bg-surfaceHighlight/20 rounded-2xl w-full"></div>;
    }

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="glass-panel p-4 border-white/10 shadow-2xl">
                    <p className="font-black text-white mb-2 tracking-tight">{data.model}</p>
                    <div className="text-[10px] text-textMuted uppercase font-bold flex flex-col gap-2">
                        <div className="flex justify-between gap-4">
                            <span>Cost</span>
                            <span className="text-white">${data.cost.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span>Tokens</span>
                            <span className="text-white">{data.tokens.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span>Requests</span>
                            <span className="text-white">{data.requests.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };

    if (data.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-textMuted p-8 text-center">
                <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/10 mb-4" />
                <p className="font-medium">No model data available yet.</p>
                <p className="text-xs opacity-50 mt-1">Send requests through the proxy to see breakdown.</p>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col">
            <div className="flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={70}
                            outerRadius={95}
                            paddingAngle={8}
                            dataKey="cost"
                            stroke="none"
                        >
                            {data.map((_, index) => (
                                <Cell
                                    key={`cell-${index}`}
                                    fill={COLORS[index % COLORS.length]}
                                    className="outline-none hover:opacity-80 transition-opacity cursor-pointer"
                                />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-6">
                {data.slice(0, 6).map((entry, index) => (
                    <div key={entry.model} className="flex items-center gap-2 group">
                        <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-[10px] text-textMuted font-bold uppercase truncate group-hover:text-textMain transition-colors" title={entry.model}>
                            {entry.model}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

