import { getDb } from '@llm-observer/database';
import * as claudeParser from './claude';
import * as cursorParser from './cursor';
import * as aiderParser from './aider';
import * as codexParser from './codex';
import * as clineParser from './cline';
import * as windsurfParser from './windsurf';
import * as copilotParser from './copilot';
import * as opencodeParser from './opencode';
import { aggregateToolUsage } from './toolAggregator';

const STATE = {
    isRunning: false,
    intervalHandle: null as NodeJS.Timeout | null,
    providers: {
        'claude-code': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'cursor': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'aider': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'codex': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'cline': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'windsurf': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'copilot': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'opencode': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } }
    }
};

let lastAggregationDay = '';

export const initParsers = () => {
    if (STATE.intervalHandle) return;
    if (process.env.LLM_OBSERVER_DISABLE_PARSERS === '1') return;
    // 2. Perform initial parse without blocking
    triggerParseCycle().catch(err => {
        console.error('[Parser Manager] Initial parse error:', err);
    });

    // 3. Set interval for background incremental parsing (5 minutes)
    STATE.intervalHandle = setInterval(() => {
        triggerParseCycle().catch(err => {
            console.error('[Parser Manager] Background parse error:', err);
        });
    }, 5 * 60 * 1000);
};

export const triggerParseCycle = async () => {
    if (process.env.LLM_OBSERVER_DISABLE_PARSERS === '1') return;
    if (STATE.isRunning) {
        console.log('[Parser Manager] Parse already in progress, skipping.');
        return;
    }

    STATE.isRunning = true;
    try {
        const db = getDb();
        const changesBefore = (db.prepare('SELECT total_changes() AS count').get() as any).count;
        const parsersInfo = [
            { id: 'claude-code', mod: claudeParser },
            { id: 'cursor', mod: cursorParser },
            { id: 'aider', mod: aiderParser },
            { id: 'codex', mod: codexParser },
            { id: 'cline', mod: clineParser },
            { id: 'windsurf', mod: windsurfParser },
            { id: 'copilot', mod: copilotParser },
            { id: 'opencode', mod: opencodeParser }
        ];

        for (const info of parsersInfo) {
            const state: { status: string; progress: { current: number; total: number }; error?: string } = STATE.providers[info.id as keyof typeof STATE.providers];
            try {
                // A user may install a tool or create their first session after launch.
                if (!info.mod.detector()) {
                    state.status = 'not found';
                    delete state.error;
                    continue;
                }
                if (state.status === 'unsupported') continue;
                state.status = 'parsing';
                delete state.error;
                await info.mod.parse((c, t) => {
                    state.progress = { current: c, total: t };
                });
                state.status = 'success';
            } catch (e: any) {
                state.status = e?.code === 'UNSUPPORTED_FORMAT' ? 'unsupported' : 'error';
                state.error = e instanceof Error ? e.message : String(e);
                console.error(`[Parser Manager] Error parsing ${info.id}:`, e);
            }
        }

        // After all individual parsers finish, run cross-provider aggregation
        try {
            const changed = (db.prepare('SELECT total_changes() AS count').get() as any).count !== changesBefore;
            const today = new Date().toISOString().slice(0, 10);
            if (changed || lastAggregationDay !== today) {
                aggregateToolUsage();
                lastAggregationDay = today;
            }
        } catch (e) {
            console.error('[Parser Manager] Tool aggregation failed:', e);
        }

    } finally {
        STATE.isRunning = false;
    }
};

export const getProviderStatus = () => {
    return STATE.providers;
};
