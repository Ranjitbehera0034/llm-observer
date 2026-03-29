import * as claudeParser from './claude';
import * as cursorParser from './cursor';
import * as aiderParser from './aider';

const STATE = {
    isRunning: false,
    intervalHandle: null as NodeJS.Timeout | null,
    providers: {
        'claude-code': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'cursor': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } },
        'aider': { status: 'not found', sessionCount: 0, progress: { current: 0, total: 0 } }
    }
};

export const initParsers = () => {
    // 1. Detect available providers
    const hasClaude = claudeParser.detector();
    if (hasClaude) STATE.providers['claude-code'].status = 'found';
    
    const hasCursor = cursorParser.detector();
    if (hasCursor) STATE.providers['cursor'].status = 'found';
    
    const hasAider = aiderParser.detector();
    if (hasAider) STATE.providers['aider'].status = 'found';

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
        if (STATE.providers['claude-code'].status !== 'not found') {
            STATE.providers['claude-code'].status = 'parsing';
            await claudeParser.parse((c, t) => {
                STATE.providers['claude-code'].progress = { current: c, total: t };
            });
            STATE.providers['claude-code'].status = 'success';
        }

        if (STATE.providers['cursor'].status !== 'not found') {
            STATE.providers['cursor'].status = 'parsing';
            await cursorParser.parse((c, t) => {
                STATE.providers['cursor'].progress = { current: c, total: t };
            });
            STATE.providers['cursor'].status = 'success';
        }

        if (STATE.providers['aider'].status !== 'not found') {
            STATE.providers['aider'].status = 'parsing';
            await aiderParser.parse((c, t) => {
                STATE.providers['aider'].progress = { current: c, total: t };
            });
            STATE.providers['aider'].status = 'success';
        }
    } finally {
        STATE.isRunning = false;
    }
};

export const getProviderStatus = () => {
    return STATE.providers;
};
