import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config';
interface Status { enabled: boolean; configured: boolean; last_sent: string | null; error: string | null }
export function ActivityReporting() {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { apiFetch(`${API_BASE_URL}/api/activity`).then(async r => { if (!r.ok) throw new Error(); setStatus(await r.json()); }).catch(() => setError('Could not load reporting settings')); }, []);
    async function change(enabled: boolean) {
        setBusy(true); setError('');
        try {
            const r = await apiFetch(`${API_BASE_URL}/api/activity`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled}) });
            if (!r.ok) throw new Error(); setStatus(await r.json());
        } catch { setError('Could not save reporting settings'); }
        finally { setBusy(false); }
    }
    return <section className="bg-surface border border-border rounded-xl p-6 space-y-3">
        <h2 className="text-lg font-semibold">Optional product activity reporting</h2>
        <p className="text-textMuted">Off by default. Share a random installation ID, app version, and last-seen time with LLM Observer at startup and once daily while running. A license, if configured, links activity to your paid or trial account. No prompts, responses, API keys, project names, or session contents are sent. Reporting does not enable a trial.</p>
        <p>Reporting: {status?.enabled ? 'Enabled' : 'Off'} · Last acknowledged: {status?.last_sent ? new Date(status.last_sent).toLocaleString() : 'Never'}</p>
        {status && !status.configured && <p>Reporting service is not configured in this build.</p>}
        <div className="flex gap-3"><button disabled={busy || !status?.configured || status?.enabled} onClick={() => change(true)} className="border border-border px-3 py-2 rounded">Enable reporting</button>
        <button disabled={busy || !status?.configured} onClick={() => change(false)} className="border border-border px-3 py-2 rounded">Stop and forget activity</button></div>
        <p className="text-textMuted text-sm">Stop and forget removes the activity record when the service is reachable. Purchase records remain for billing. Anonymous free installations cannot be identified as people.</p>
        {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    </section>;
}
