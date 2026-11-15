import { randomBytes, randomUUID } from 'crypto';
import { getSetting, updateSetting } from '@llm-observer/database';
declare const __LICENSE_SERVER_URL__: string;
const service = () => process.env.LICENSE_SERVER_URL || (typeof __LICENSE_SERVER_URL__ !== 'undefined' ? __LICENSE_SERVER_URL__ : '');
let pending: Promise<void> | null = null;
export function activityStatus() {
    return { enabled: getSetting('activity_reporting_enabled') === 'true', configured: !!service(), last_sent: getSetting('activity_reporting_last_sent') || null, error: getSetting('activity_reporting_error') || null };
}
async function send(method: 'POST' | 'DELETE') {
    const url = new URL(service());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Activity reporting service is not configured');
    let id = getSetting('activity_installation_id');
    let token = getSetting('activity_installation_token');
    if (!id || !token) {
        if (method === 'DELETE') return;
        id = randomUUID(); token = randomBytes(32).toString('hex');
        updateSetting('activity_installation_id', id); updateSetting('activity_installation_token', token);
    }
    const response = await fetch(new URL('/activity', url).href, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installation_id: id, token, ...(method === 'POST' ? { consent: true, version: '2.1.0-beta.1', license_key: getSetting('license_key') || undefined } : {}) }),
        signal: AbortSignal.timeout(8000), redirect: 'error'
    });
    if (!response.ok) throw new Error('Reporting service unavailable; retry later');
    const result = await response.json() as any;
    if (method === 'DELETE' ? result.removed !== true : result.accepted !== true) throw new Error('Reporting was not acknowledged');
    if (method === 'POST') updateSetting('activity_reporting_last_sent', new Date().toISOString());
    else {
        updateSetting('activity_installation_id', ''); updateSetting('activity_installation_token', ''); updateSetting('activity_reporting_last_sent', '');
    }
    updateSetting('activity_reporting_error', '');
}
export async function reportActivity(): Promise<void> {
    if (getSetting('activity_reporting_enabled') !== 'true') return;
    if (!pending) pending = send('POST').catch(() => { updateSetting('activity_reporting_error', 'Reporting unavailable. Local tracking is unaffected.'); }).finally(() => { pending = null; });
    await pending;
}
export async function setActivityReporting(enabled: boolean): Promise<void> {
    updateSetting('activity_reporting_enabled', String(enabled));
    if (enabled) await reportActivity();
    else {
        if (pending) await pending;
        if (!getSetting('activity_installation_id')) return;
        try { await send('DELETE'); }
        catch { updateSetting('activity_reporting_error', 'Reporting stopped. Remote deletion failed; retry Stop and forget when online.'); }
    }
}
export function startActivityReporting() {
    void reportActivity();
    const timer = setInterval(() => { void reportActivity(); }, 24 * 60 * 60 * 1000);
    timer.unref();
}
