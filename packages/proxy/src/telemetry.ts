import crypto from 'crypto';
import { getSetting, updateSetting } from '@llm-observer/database';
import { version as APP_VERSION } from '../package.json';
import { getLicenseInfo, licenseServerUrl } from './licenseManager';

/**
 * Opt-in anonymous usage ping. OFF by default; turned on only by the user in
 * Settings → "Share anonymous usage stats" (setting `telemetry_opt_in`).
 *
 * When on, once a day it sends exactly:
 *   { install_id, version, os, tier }
 * install_id is a random UUID created on first opt-in and stored locally — it
 * isn't derived from the machine, account or any API key. Nothing about spend,
 * prompts, models, projects or files is sent. Turning it off stops the ping
 * and deletes the install_id, so a later opt-in starts as a new install.
 */
const PING_EVERY_MS = 24 * 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function isTelemetryEnabled(): boolean {
    return getSetting('telemetry_opt_in') === 'true';
}

export async function buildPing(): Promise<{ install_id: string; version: string; os: string; tier: 'free' | 'pro' }> {
    let installId = getSetting('telemetry_install_id');
    if (!installId) {
        installId = crypto.randomUUID();
        updateSetting('telemetry_install_id', installId);
    }
    const license = await getLicenseInfo();
    return { install_id: installId, version: APP_VERSION, os: process.platform, tier: license.isPro ? 'pro' : 'free' };
}

export async function sendPingIfDue(): Promise<boolean> {
    if (!isTelemetryEnabled()) return false;
    const last = Date.parse(getSetting('telemetry_last_ping_at') || '') || 0;
    if (Date.now() - last < PING_EVERY_MS) return false;
    try {
        const res = await fetch(`${licenseServerUrl()}/telemetry/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(await buildPing()),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return false;
        updateSetting('telemetry_last_ping_at', new Date().toISOString());
        return true;
    } catch {
        return false; // offline, blocked, etc. — try again next hour
    }
}

/** Applies an opt-in / opt-out choice from Settings. */
export function setTelemetryOptIn(enabled: boolean): void {
    updateSetting('telemetry_opt_in', String(enabled));
    if (!enabled) {
        updateSetting('telemetry_install_id', '');
        updateSetting('telemetry_last_ping_at', '');
    } else {
        sendPingIfDue().catch(() => {});
    }
}

export function startTelemetry(): void {
    if (timer) clearInterval(timer);
    sendPingIfDue().catch(() => {});
    timer = setInterval(() => sendPingIfDue().catch(() => {}), 60 * 60 * 1000);
    timer.unref?.();
}
