import { useEffect, useState, useRef } from 'react';
import { Clock, AlertCircle, Hash } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface OverviewStats {
    totalRequestsToday: number;
    avgLatencyMs: number;
    errorRate: number;
}

export function StatCards() {
    const [stats, setStats] = useState<OverviewStats | null>(null);
    const sseRef = useRef<EventSource | null>(null);

    useEffect(() => {
        const fetchStats = () => {
            fetch(`${API_BASE_URL}/api/stats/overview`)
                .then(res => res.json())
                .then(data => setStats(data))
                .catch(console.error);
        };

        fetchStats();

        sseRef.current = new EventSource(`${API_BASE_URL}/api/events`);
        sseRef.current.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'new_request') {
                    // Refresh stats on new request
                    fetchStats();
                }
            } catch (e) { }
        };

        const pollId = setInterval(fetchStats, 30000);

        return () => {
            sseRef.current?.close();
            clearInterval(pollId);
        };
    }, []);

    if (!stats) return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => <div key={i} className="h-32 animate-pulse bg-surface rounded-2xl" />)}
        </div>
    );

    const cards = [
        {
            label: 'Total Requests',
            value: stats.totalRequestsToday.toLocaleString(),
            icon: Hash,
            color: 'text-primary',
            bg: 'bg-primary/10',
            border: 'hover:border-primary/50'
        },
        {
            label: 'Avg Latency',
            value: `${stats.avgLatencyMs}ms`,
            icon: Clock,
            color: 'text-accent',
            bg: 'bg-accent/10',
            border: 'hover:border-accent/50'
        },
        {
            label: 'Error Rate',
            value: `${stats.errorRate.toFixed(1)}%`,
            icon: AlertCircle,
            color: stats.errorRate > 5 ? 'text-danger' : 'text-success',
            bg: stats.errorRate > 5 ? 'bg-danger/10' : 'bg-success/10',
            border: stats.errorRate > 5 ? 'hover:border-danger/50' : 'hover:border-success/50'
        }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {cards.map((card, i) => (
                <div key={i} className={`card ${card.border} transition-all duration-300 group`}>
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-sm text-textMuted font-medium tracking-wide uppercase transition-colors group-hover:text-textMain">
                                {card.label}
                            </p>
                            <h3 className="text-3xl font-black mt-2 text-white tabular-nums tracking-tight">
                                {card.value}
                            </h3>
                        </div>
                        <div className={`p-3 ${card.bg} rounded-xl transition-transform group-hover:scale-110`}>
                            <card.icon className={`w-6 h-6 ${card.color}`} />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
