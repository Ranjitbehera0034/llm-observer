import { useEffect, useState } from 'react';
import { RequestTable } from '../components/RequestTable';
import type { RequestRow } from '../components/RequestTable';
import { Activity } from 'lucide-react';
import { RequestDetail } from './RequestDetail';
import { API_BASE_URL } from '../config';

export default function Requests() {
    const [requests, setRequests] = useState<RequestRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    const loadRequests = (targetPage: number) => {
        setLoading(true);
        fetch(`${API_BASE_URL}/api/requests?page=${targetPage}&limit=50`)
            .then(res => res.json())
            .then(resData => {
                setRequests(resData.data);
                setTotalPages(resData.meta?.totalPages || 1);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch requests:', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        loadRequests(page);
    }, [page]);

    // SSE Real-time listener
    useEffect(() => {
        const eventSource = new EventSource(`${API_BASE_URL}/api/requests/stream`);

        eventSource.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.type === 'new_requests') {
                    // Prepend new requests to the list
                    setRequests((prev: RequestRow[]) => {
                        const newArray = [...parsed.data, ...prev];
                        // Optionally cap the array at 100 items to prevent memory bloat over time
                        return newArray.slice(0, 100);
                    });
                }
            } catch (err) {
                // Ignore parse errors on keep-alives
            }
        };

        eventSource.onerror = (err) => {
            console.error('SSE Error:', err);
        };

        return () => {
            eventSource.close();
        };
    }, []);

    if (loading) {
        return (
            <div className="p-8 max-w-7xl mx-auto">
                <div className="animate-pulse h-10 w-48 bg-surfaceHighlight rounded mb-8"></div>
                <div className="animate-pulse h-[600px] w-full bg-surfaceHighlight rounded-xl"></div>
            </div>
        );
    }

    if (selectedRequest) {
        return <RequestDetail
            requestId={selectedRequest.id}
            onBack={() => setSelectedRequest(null)}
        />;
    }

    return (
        <div className="max-w-7xl mx-auto p-8 animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-2">
                        <Activity className="w-8 h-8 text-primary" />
                        Request Logs
                    </h1>
                    <p className="text-textMuted mt-2">Live feed of all LLM completions passing through the proxy.</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-success font-medium bg-success/10 px-3 py-1.5 rounded-full border border-success/20">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                    </span>
                    Live Updates
                </div>
            </div>

            <RequestTable
                requests={requests}
                onRowClick={(req) => setSelectedRequest(req)}
            />

            {/* Pagination Controls */}
            <div className="flex justify-between items-center mt-6">
                <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                    className="px-4 py-2 bg-surfaceHighlight hover:bg-border text-white rounded-lg font-medium transition-colors border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Previous
                </button>
                <span className="text-textMuted text-sm">
                    Page {page} of {totalPages}
                </span>
                <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="px-4 py-2 bg-surfaceHighlight hover:bg-border text-white rounded-lg font-medium transition-colors border border-border disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Next
                </button>
            </div>
        </div>
    );
}
