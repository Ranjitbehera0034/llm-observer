import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { forgetAdminToken, readAdminToken, saveAdminToken } from '../utils/teamToken';
import {
    BetaBadge, ConnectionCard, ContributionCard, JoinCard, PolicyCard, PrivacyCard, RollupCard, UpgradeCard,
    type Rollup, type TeamStatus,
} from '../components/TeamPanels';

export default function Team() {
    const [status, setStatus] = useState<TeamStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);

    const [token, setToken] = useState<string | null>(() => readAdminToken());
    const [rollup, setRollup] = useState<Rollup | null>(null);
    const [rollupError, setRollupError] = useState<string | null>(null);
    const [rollupLoading, setRollupLoading] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/team/status`);
            if (!res.ok) throw new Error(`The app answered ${res.status}`);
            setStatus(await res.json());
            setLoadError(null);
        } catch (err) {
            setLoadError((err as Error).message);
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const loadRollup = useCallback(async (t: string) => {
        setRollupLoading(true);
        setRollupError(null);
        try {
            // The token only goes to this app's own route, which forwards it to the configured team server.
            const res = await fetch(`${API_BASE_URL}/api/team/rollup`, { headers: { Authorization: `Bearer ${t}` } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setRollup(null);
                setRollupError(body.error || `Request failed (${res.status})`);
                if (res.status === 401 || res.status === 400) { forgetAdminToken(); setToken(null); }
                return;
            }
            setRollup(body as Rollup);
        } catch {
            setRollupError('Could not reach the local app.');
        } finally {
            setRollupLoading(false);
        }
    }, []);

    useEffect(() => {
        if (token && status?.teamLicensed && status.configured) loadRollup(token);
    }, [token, status?.teamLicensed, status?.configured, loadRollup]);

    const syncNow = async () => {
        setSyncing(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/team/sync-now`, { method: 'POST' });
            if (res.ok) setStatus(await res.json()); else await loadStatus();
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="p-8 max-w-5xl space-y-6">
            <div className="flex items-center gap-3">
                <h2 className="text-3xl font-black text-white tracking-tight">Team</h2>
                <BetaBadge />
            </div>
            <p className="text-sm text-slate-500">Share daily usage totals with your team and follow its budget policy. Beta: not yet run against a production deployment.</p>

            {!status && !loadError && <div className="flex justify-center p-12"><RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" /></div>}
            {loadError && <p role="alert" className="text-sm text-amber-400">Could not load the team status: {loadError}</p>}

            {status && !status.teamLicensed && <UpgradeCard plan={status.licensePlan} configured={status.configured} />}
            {status && status.teamLicensed && !status.configured && <JoinCard />}
            {status && status.teamLicensed && status.configured && (
                <>
                    <ConnectionCard status={status} onSync={syncNow} syncing={syncing} />
                    {status.policy && <PolicyCard policy={status.policy} />}
                    {status.contribution && <ContributionCard contribution={status.contribution} />}
                    <RollupCard
                        hasToken={!!token}
                        loading={rollupLoading}
                        error={rollupError}
                        rollup={rollup}
                        onSubmitToken={(t) => { saveAdminToken(t); setToken(t); }}
                        onForget={() => { forgetAdminToken(); setToken(null); setRollup(null); setRollupError(null); }}
                        onRefresh={() => token && loadRollup(token)}
                    />
                </>
            )}

            <PrivacyCard />
        </div>
    );
}
