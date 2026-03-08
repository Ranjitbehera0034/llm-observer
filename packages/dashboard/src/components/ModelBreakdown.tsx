import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

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

    useEffect(() => {
        fetch('http://localhost:4001/api/stats/models')
            .then(res => res.json())
            .then(resData => {
                setData(resData.data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch models stat:', err);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return <div className="animate-pulse h-80 bg-surfaceHighlight rounded-xl w-full"></div>;
    }

    // Custom tool tip
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="glass-panel p-4">
                    <p className="font-bold text-white mb-2">{data.model}</p>
                    <div className="text-sm text-textMuted flex flex-col gap-1">
                        <span>Cost: <span className="text-white font-medium">\${data.cost.toFixed(4)}</span></span>
                        <span>Tokens: <span className="text-white font-medium">{data.tokens.toLocaleString()}</span></span>
                        <span>Requests: <span className="text-white font-medium">{data.requests.toLocaleString()}</span></span>
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="card col-span-1 animate-slide-up" style={{ animationDelay: '200ms' }}>
            <h3 className="text-lg font-semibold text-white mb-6">Cost by Model</h3>
            {data.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-textMuted">
                    No model data available yet.
                </div>
            ) : (
                <div className="h-64 h-[250px] w-full flex flex-col items-center">
                    <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                            <Pie
                                data={data}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="cost"
                                stroke="none"
                            >
                                {data.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip content={<CustomTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap justify-center gap-3 mt-4">
                        {data.slice(0, 4).map((entry, index) => (
                            <div key={entry.model} className="flex items-center text-xs">
                                <span
                                    className="w-3 h-3 rounded-full mr-2"
                                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                />
                                <span className="text-textMuted max-w-[100px] truncate" title={entry.model}>{entry.model}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
