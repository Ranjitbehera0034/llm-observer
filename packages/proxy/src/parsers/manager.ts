import * as claudeParser from './claude';
import * as cursorParser from './cursor';
import * as aiderParser from './aider';
import * as codexParser from './codex';
import * as clineParser from './cline';
import * as windsurfParser from './windsurf';
import * as copilotParser from './copilot';
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
        'copilot': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } }
    }
};

export const initParsers = () => {
    // 1. Detect available providers
    if (claudeParser.detector()) STATE.providers['claude-code'].status = 'found';
    if (cursorParser.detector()) STATE.providers['cursor'].status = 'found';
    if (aiderParser.detector()) STATE.providers['aider'].status = 'found';
    if (codexParser.detector()) STATE.providers['codex'].status = 'found';
    if (clineParser.detector()) STATE.providers['cline'].status = 'found';
    if (windsurfParser.detector()) STATE.providers['windsurf'].status = 'found';
    if (copilotParser.detector()) STATE.providers['copilot'].status = 'found';

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
    if (STATE.isRunning) {
        console.log('[Parser Manager] Parse already in progress, skipping.');
        return;
    }

    STATE.isRunning = true;
    try {
        const parsersInfo = [
            { id: 'claude-code', mod: claudeParser },
            { id: 'cursor', mod: cursorParser },
            { id: 'aider', mod: aiderParser },
            { id: 'codex', mod: codexParser },
            { id: 'cline', mod: clineParser },
            { id: 'windsurf', mod: windsurfParser },
            { id: 'copilot', mod: copilotParser }
        ];

        for (const info of parsersInfo) {
            const state = STATE.providers[info.id as keyof typeof STATE.providers];
            if (state.status !== 'not found') {
                state.status = 'parsing';
                try {
                    await info.mod.parse((c, t) => {
                        state.progress = { current: c, total: t };
                    });
                    state.status = 'success';
                } catch (e) {
                    console.error(`[Parser Manager] Error parsing ${info.id}:`, e);
                    state.status = 'error';
                }
            }
        }

        // After all individual parsers finish, run cross-provider aggregation
        try {
            aggregateToolUsage();
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
