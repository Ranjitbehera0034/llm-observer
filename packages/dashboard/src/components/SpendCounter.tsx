import { useEffect, useState } from 'react';
import { DollarSign, Activity, Database, TrendingUp } from 'lucide-react';
import { API_BASE_URL } from '../config';

interface OverviewStats {
    todaySpendUsd: number;
    dailyBudgetUsd: number;
    totalRequestsToday: number;
    totalTokensToday: number;
}

export function SpendCounter() {
    const [stats, setStats] = useState<OverviewStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = () => {
            fetch(`${API_BASE_URL}/api/stats/overview`)
                .then(res => res.json())
                .then(data => {
                    setStats(data);
                    setLoading(false);
                })
                .catch(err => {
                    console.error('Failed to fetch stats:', err);
                    setLoading(false);
                });
        };

        fetchStats();
        const intervalId = setInterval(fetchStats, 10000); // Poll every 10s

        return () => clearInterval(intervalId);
    }, []);

    if (loading) {
        return <div className="animate-pulse h-32 bg-surfaceHighlight rounded-xl w-full"></div>;
    }

    if (!stats) return null;

    const pctUsed = stats.dailyBudgetUsd > 0 ? (stats.todaySpendUsd / stats.dailyBudgetUsd) * 100 : 0;
    const isDanger = pctUsed >= 90;
    const isWarning = pctUsed >= 75 && pctUsed < 90;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 animate-fade-in">
            <div className="card hover:border-primary/50 transition-colors">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-sm text-textMuted font-medium">Daily Spend</p>
                        <h3 className="text-3xl font-bold mt-1 text-white">${stats.todaySpendUsd.toFixed(3)}</h3>
                    </div>
                    <div className="p-3 bg-primary/10 rounded-lg">
                        <DollarSign className="w-6 h-6 text-primary" />
                    </div>
                </div>
                <div className="mt-4">
                    <div className="flex justify-between text-xs mb-2">
                        <span className="text-textMuted">Budget: ${stats.dailyBudgetUsd.toFixed(2)}</span>
                        <span className={isDanger ? 'text-danger' : isWarning ? 'text-warning' : 'text-success'}>
                            {pctUsed.toFixed(1)}%
                        </span>
                    </div>
                    <div className="w-full bg-surfaceHighlight rounded-full h-2">
                        <div
                            className={`h-2 rounded-full transition-all duration-1000 ${isDanger ? 'bg-danger' : isWarning ? 'bg-warning' : 'bg-primary'}`}
                            style={{ width: `${Math.min(pctUsed, 100)}%` }}
                        ></div>
                    </div>
                </div>
            </div>

            <div className="card hover:border-accent/50 transition-colors">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-sm text-textMuted font-medium">Today's Requests</p>
                        <h3 className="text-3xl font-bold mt-1 text-white">{stats.totalRequestsToday.toLocaleString()}</h3>
                    </div>
                    <div className="p-3 bg-accent/10 rounded-lg">
                        <Activity className="w-6 h-6 text-accent" />
                    </div>
                </div>
                <div className="mt-4 flex items-center text-sm text-success">
                    <TrendingUp className="w-4 h-4 mr-1" />
                    <span>Active tracing</span>
                </div>
            </div>

            <div className="card hover:border-success/50 transition-colors">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <p className="text-sm text-textMuted font-medium">Tokens Processed</p>
                        <h3 className="text-3xl font-bold mt-1 text-white">{stats.totalTokensToday.toLocaleString()}</h3>
                    </div>
                    <div className="p-3 bg-success/10 rounded-lg">
                        <Database className="w-6 h-6 text-success" />
                    </div>
                </div>
                <div className="mt-4 flex items-center text-sm text-textMuted">
                    <span>Total prompt + completion</span>
                </div>
            </div>

            {/* Placeholder for future metric */}
            <div className="card bg-gradient-to-br from-surface to-surfaceHighlight border-dashed">
                <div className="flex flex-col items-center justify-center h-full text-textMuted">
                    <p className="text-sm font-medium mb-1">More Metrics</p>
                    <p className="text-xs opacity-75">Coming in updates</p>
                </div>
            </div>
        </div >
    );
}
