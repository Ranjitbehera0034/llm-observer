import { useEffect, useState, useRef } from 'react';
import { DollarSign, TrendingUp, AlertTriangle } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface OverviewStats {
    todaySpendUsd: number;
    dailyBudgetUsd: number;
    totalRequestsToday: number;
    avgLatencyMs: number;
    errorRate: number;
}

export function SpendCounter() {
    const [stats, setStats] = useState<OverviewStats | null>(null);
    const [displaySpend, setDisplaySpend] = useState(0);
    const [isPulsing, setIsPulsing] = useState(false);
    const sseRef = useRef<EventSource | null>(null);

    useEffect(() => {
        // 1. Initial Fetch
        fetch(`${API_BASE_URL}/api/stats/overview`)
            .then(res => res.json())
            .then(data => {
                setStats(data);
                setDisplaySpend(data.todaySpendUsd);
            })
            .catch(console.error);

        // 2. SSE Listener
        sseRef.current = new EventSource(`${API_BASE_URL}/api/events`);

        sseRef.current.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'new_request') {
                    const newRequest = payload.data;
                    setIsPulsing(true);
                    setStats(prev => {
                        if (!prev) return null;
                        const newSpend = prev.todaySpendUsd + (newRequest.cost_usd || 0);
                        const newTotalRequests = prev.totalRequestsToday + 1;

                        // Error rate update
                        const newErrorCount = (prev.errorRate * prev.totalRequestsToday / 100) + (newRequest.status_code >= 400 ? 1 : 0);

                        return {
                            ...prev,
                            todaySpendUsd: newSpend,
                            totalRequestsToday: newTotalRequests,
                            errorRate: (newErrorCount / newTotalRequests) * 100,
                            // Latency is harder to calc exactly without more state, but we can approximate or wait for next poll
                        };
                    });

                    setTimeout(() => setIsPulsing(false), 1000);
                }
            } catch (e) {
                console.error('SSE Error:', e);
            }
        };

        // 3. Periodic Poll (for sync)
        const pollId = setInterval(() => {
            fetch(`${API_BASE_URL}/api/stats/overview`)
                .then(res => res.json())
                .then(data => setStats(data))
                .catch(console.error);
        }, 30000);

        return () => {
            sseRef.current?.close();
            clearInterval(pollId);
        };
    }, []);

    // Smooth counter animation
    useEffect(() => {
        if (!stats) return;
        const start = displaySpend;
        const end = stats.todaySpendUsd;
        if (start === end) return;

        const duration = 1000;
        const startTime = performance.now();

        const animate = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const current = start + (end - start) * progress;
            setDisplaySpend(current);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }, [stats?.todaySpendUsd]);

    if (!stats) return <div className="h-64 animate-pulse bg-surface rounded-3xl" />;

    const budget = stats.dailyBudgetUsd || 10; // Fallback to 10 for visual
    const pct = (stats.todaySpendUsd / budget) * 100;

    let colorClass = 'text-success';
    let progressColor = 'bg-success';
    let glowColor = 'shadow-success/20';

    if (pct >= 100) {
        colorClass = 'text-danger';
        progressColor = 'bg-danger';
        glowColor = 'shadow-danger/20';
    } else if (pct >= 80) {
        colorClass = 'text-warning';
        progressColor = 'bg-warning';
        glowColor = 'shadow-warning/20';
    }

    return (
        <div className={`relative overflow-hidden glass-panel p-8 transition-all duration-500 ${isPulsing ? 'scale-[1.01] border-primary/50' : ''}`}>
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] -z-10" />
            <div className={`absolute bottom-0 left-0 w-64 h-64 ${progressColor}/5 blur-[100px] -z-10`} />

            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="flex-1 w-full">
                    <div className="flex items-center gap-2 text-textMuted mb-2">
                        <DollarSign className="w-4 h-4" />
                        <span className="text-sm font-medium uppercase tracking-wider">Today's Total Spend</span>
                        {pct >= 100 && <span className="flex items-center gap-1 text-danger animate-pulse text-xs font-bold ml-2">
                            <AlertTriangle className="w-3 h-3" /> BUDGET EXCEEDED
                        </span>}
                    </div>

                    <div className="flex items-baseline gap-2">
                        <span className={`text-6xl font-black tracking-tighter transition-colors duration-500 ${colorClass}`}>
                            ${displaySpend.toFixed(4)}
                        </span>
                        <span className="text-textMuted text-xl font-medium">/ ${budget.toFixed(2)}</span>
                    </div>

                    <div className="mt-8 relative h-4 bg-background/50 rounded-full border border-white/5 overflow-hidden">
                        <div
                            className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out ${progressColor} ${glowColor} shadow-lg`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                        {/* 80% marker */}
                        <div className="absolute left-[80%] top-0 w-px h-full bg-white/10 z-10" />
                    </div>

                    <div className="flex justify-between mt-3 text-xs font-bold uppercase tracking-widest text-textMuted">
                        <span>Usage: {pct.toFixed(1)}%</span>
                        <div className="flex items-center gap-1 text-primary">
                            <TrendingUp className="w-3 h-3" />
                            <span>Real-time tracking optimized</span>
                        </div>
                    </div>
                </div>

                <div className="hidden lg:flex items-center justify-center w-48 h-48 relative">
                    {/* SVG Progress Circle */}
                    <svg className="w-full h-full transform -rotate-90">
                        <circle
                            cx="96"
                            cy="96"
                            r="88"
                            stroke="currentColor"
                            strokeWidth="8"
                            fill="transparent"
                            className="text-white/5"
                        />
                        <circle
                            cx="96"
                            cy="96"
                            r="88"
                            stroke="currentColor"
                            strokeWidth="8"
                            strokeDasharray={2 * Math.PI * 88}
                            strokeDashoffset={2 * Math.PI * 88 * (1 - Math.min(pct, 100) / 100)}
                            strokeLinecap="round"
                            fill="transparent"
                            className={`transition-all duration-1000 ease-out ${colorClass}`}
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-4xl font-black ${colorClass}`}>{Math.round(pct)}%</span>
                        <span className="text-[10px] text-textMuted font-bold uppercase">Budget</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
