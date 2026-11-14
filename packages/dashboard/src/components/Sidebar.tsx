import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, CheckSquare, Activity, FolderOpen, Bell, Settings as SettingsIcon, Lightbulb, RefreshCw, MonitorSmartphone, Gift, Database, Bot, Wrench, Zap, Clock, GitCompare } from 'lucide-react';
import clsx from 'clsx';

const navItems = [
    { name: 'Control Room', path: '/', icon: LayoutDashboard },
    { name: 'Apps', path: '/apps', icon: MonitorSmartphone },
    { name: 'API Sync', path: '/sync', icon: RefreshCw },
    { name: 'Sessions', path: '/sessions', icon: Database },
    { name: 'Agents', path: '/agents', icon: Bot },
    { name: 'Task inbox', path: '/tasks', icon: CheckSquare },
    { name: 'Optimize', path: '/optimize', icon: Zap },
    { name: 'Compare', path: '/compare', icon: GitCompare },
    { name: 'Limits', path: '/limits', icon: Clock },
    { name: 'Tools', path: '/tools', icon: Wrench },
    { name: 'Requests', path: '/requests', icon: Activity },
    { name: 'Insights', path: '/insights', icon: Lightbulb },
    { name: 'Projects', path: '/projects', icon: FolderOpen },
    { name: 'AI Wrapped', path: '/wrapped', icon: Gift },
    { name: 'Alerts', path: '/alerts', icon: Bell },
    { name: 'Settings', path: '/settings', icon: SettingsIcon },
];

export function Sidebar() {
    const location = useLocation();

    return (
        <aside className="w-16 md:w-64 shrink-0 border-r border-border bg-surface flex flex-col min-h-screen sticky top-0">
            <div className="h-16 flex items-center px-2 md:px-6 border-b border-border mb-6">
                <span className="text-white font-bold text-lg tracking-tight truncate flex items-center gap-2">
                    <div className="w-6 h-6 bg-primary rounded shadow-[0_0_15px_rgba(79,70,229,0.5)]"></div>
                    <span className="hidden md:inline">LLM Observer</span>
                </span>
            </div>

            <nav className="flex-1 px-1 md:px-4 space-y-1">
                {navItems.map((item) => {
                    const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                    return (
                        <Link
                            key={item.name}
                            to={item.path}
                            aria-label={item.name}
                            title={item.name}
                            className={clsx(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                                isActive
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "text-textMuted hover:bg-surfaceHighlight hover:text-white"
                            )}
                        >
                            <item.icon className={clsx("w-5 h-5", isActive ? "text-primary" : "opacity-60 group-hover:opacity-100")} />
                            <span className="hidden md:inline">{item.name}</span>
                        </Link>
                    )
                })}
            </nav>

            <div className="hidden md:block p-4 border-t border-border">
                <div className="bg-surfaceHighlight/50 rounded-lg p-3 border border-border">
                    <p className="text-xs text-textMuted font-medium mb-1">Observation Server</p>
                    <div className="flex items-center gap-2 text-xs text-success">
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                        </span>
                        Local workspace
                    </div>
                </div>
            </div>
        </aside>
    );
}
