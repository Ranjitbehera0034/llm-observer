import { useState, useEffect } from 'react';
import { Bell, Search, User } from 'lucide-react';
import { NotificationsPanel } from './NotificationsPanel';

export function Header() {
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotifications, setShowNotifications] = useState(false);

    useEffect(() => {
        const fetchUnreadCount = async () => {
            try {
                const res = await fetch('/api/alerts/unread-count');
                if (res.ok) {
                    const data = await res.json();
                    setUnreadCount(data.count);
                }
            } catch (err) {
                // Silently fail
            }
        };

        fetchUnreadCount();
        const interval = setInterval(fetchUnreadCount, 30_000);
        return () => clearInterval(interval);
    }, []);

    return (
        <header className="h-16 border-b border-border bg-background sticky top-0 z-30 px-8 flex items-center justify-between">
            <div className="flex-1 max-w-xl relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted group-focus-within:text-primary transition-colors" />
                <input 
                    type="text" 
                    placeholder="Search logs, projects, or settings..." 
                    className="w-full bg-surfaceHighlight/30 border border-border rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-primary/50 focus:bg-surfaceHighlight/50 transition-all placeholder:text-textMuted/50"
                />
            </div>

            <div className="flex items-center gap-4">
                <div className="relative">
                    <button 
                        onClick={() => setShowNotifications(!showNotifications)}
                        className={`p-2 rounded-xl transition-all relative group ${
                            showNotifications ? 'bg-primary/10 text-primary' : 'text-textMuted hover:bg-surfaceHighlight hover:text-textMain'
                        }`}
                    >
                        <Bell className="w-5 h-5" />
                        {unreadCount > 0 && (
                            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 border-2 border-background rounded-full flex items-center justify-center">
                                <span className="text-[8px] font-black text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>
                            </span>
                        )}
                    </button>

                    {showNotifications && (
                        <NotificationsPanel onClose={() => setShowNotifications(false)} />
                    )}
                </div>

                <div className="w-px h-6 bg-border mx-2" />

                <button className="flex items-center gap-3 pl-2 pr-1 py-1 rounded-full hover:bg-surfaceHighlight transition-all group">
                    <div className="flex flex-col items-end">
                        <span className="text-xs font-bold text-textMain leading-tight">Admin User</span>
                        <span className="text-[10px] font-medium text-textMuted leading-tight uppercase tracking-widest text-success">Pro Plan</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-primary/20 group-hover:scale-105 transition-transform">
                        <User className="w-4 h-4" />
                    </div>
                </button>
            </div>
        </header>
    );
}
