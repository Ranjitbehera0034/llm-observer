import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiFetch';
import { API_BASE_URL } from '../config';

export function LocalOnlyMode() {
    const [enabled,setEnabled] = useState(false);
    const [locked,setLocked] = useState(false);
    const [busy,setBusy] = useState(false);
    const [error,setError] = useState('');
    useEffect(() => {
        let live=true;
        apiFetch(`${API_BASE_URL}/api/privacy/local-only`).then(async res => {
            if (!res.ok) throw new Error('Could not load privacy mode');
            const data=await res.json();
            if (live) {setEnabled(data.enabled===true);setLocked(data.locked===true);}
        }).catch(() => {if(live)setError('Could not load privacy mode.');});
        return () => {live=false;};
    },[]);
    async function toggle() {
        setBusy(true);setError('');
        try {
            const res=await apiFetch(`${API_BASE_URL}/api/privacy/local-only`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!enabled})});
            if (!res.ok) throw new Error('Could not update privacy mode');
            const data=await res.json();setEnabled(data.enabled===true);
        } catch {setError('Could not update privacy mode. Please retry.');}
        finally {setBusy(false);}
    }
    return <section className="card" aria-labelledby="local-only-title">
        <div className="flex items-start justify-between gap-5">
            <div><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /><h2 id="local-only-title" className="text-xl font-bold text-white">Local-only prompts</h2></div>
                <p className="text-sm text-textMuted mt-2">Block new cloud model requests through Observer. Only a loopback Ollama endpoint can receive prompts while this is on.</p>
            </div>
            <button type="button" role="switch" aria-checked={enabled} aria-label="Local-only prompts" onClick={toggle} disabled={busy || locked} className={`shrink-0 px-4 py-2 rounded-lg font-semibold text-sm ${enabled?'bg-primary text-white':'bg-surfaceHighlight border border-border text-white'}`}>{enabled?'On':'Off'}</button>
        </div>
        <p className="text-xs text-textMuted mt-4">This controls requests made through Observer, including newly connected model routes. Direct calls from other apps bypass it. It does not stop requests already in flight or optional account, license and pricing checks. Turn those off separately if you need a fully offline device. Prompt content is never sent to Observer’s customer reporting service.</p>
        {locked && <p className="text-xs text-amber-300 mt-2">Locked on by LLM_OBSERVER_LOCAL_ONLY=1.</p>}
        {error && <p role="alert" className="text-sm text-red-300 mt-3">{error}</p>}
    </section>;
}
