import { formatDistanceToNow } from 'date-fns';

interface StatusBadgeProps {
    statusCode: number;
    status: string;
}

export function StatusBadge({ statusCode, status }: StatusBadgeProps) {
    if (status === 'blocked_budget' || statusCode === 429) {
        return (
            <span className="px-2 py-1 bg-danger/10 text-danger text-[10px] uppercase font-bold rounded-lg border border-danger/20 shadow-[0_0_8px_rgba(239,68,68,0.2)]">
                Budget Blocked
            </span>
        );
    }

    if (statusCode >= 200 && statusCode < 300) {
        return (
            <span className="px-2 py-1 bg-success/10 text-success text-[10px] uppercase font-bold rounded-lg border border-success/20">
                {status || 'Success'}
            </span>
        );
    }

    if (statusCode >= 400 && statusCode < 500) {
        return (
            <span className="px-2 py-1 bg-warning/10 text-warning text-[10px] uppercase font-bold rounded-lg border border-warning/20">
                {status || 'Client Error'}
            </span>
        );
    }

    return (
        <span className="px-2 py-1 bg-danger/10 text-danger text-[10px] uppercase font-bold rounded-lg border border-danger/20">
            {status || 'Server Error'}
        </span>
    );
}

export function formatTimeAgo(dateString: string) {
    try {
        const date = new Date(dateString);
        return formatDistanceToNow(date, { addSuffix: true });
    } catch {
        return dateString;
    }
}
