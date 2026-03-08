import { formatDistanceToNow } from 'date-fns';

interface StatusBadgeProps {
    statusCode: number;
    status: string;
}

export function StatusBadge({ statusCode, status }: StatusBadgeProps) {
    if (statusCode >= 200 && statusCode < 300) {
        return (
            <span className="px-2 py-1 bg-success/10 text-success text-xs font-medium rounded border border-success/20">
                {statusCode} {status}
            </span>
        );
    }
    if (statusCode >= 400 && statusCode < 500) {
        return (
            <span className="px-2 py-1 bg-warning/10 text-warning text-xs font-medium rounded border border-warning/20">
                {statusCode} {status}
            </span>
        );
    }
    return (
        <span className="px-2 py-1 bg-danger/10 text-danger text-xs font-medium rounded border border-danger/20">
            {statusCode} {status}
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
