/**
 * Wording guard. The admin-API sync has only been tested against synthetic fixtures
 * (docs/RELEASE_CHECKLIST.md), and the kill switch is best effort, so user-facing text must not
 * state either as a proven fact.
 *
 * What the kill switch really does (K1): a request is refused before it is sent when recorded +
 * queued + in-flight estimated spend would exceed a budget. Overshoot is bounded by the difference
 * between a request's estimated and actual cost, and only proxy traffic of one process is seen.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const FILES = [
    'README.md',
    'CONTRIBUTING.md',
    'docs/index.md',
    'packages/cli/README.md',
    'packages/dashboard/src/pages/Sessions.tsx',
    'packages/dashboard/src/pages/Settings.tsx',
    'packages/dashboard/src/components/BudgetsTab.tsx',
    'landing-page/src/App.tsx',
];

const BANNED: [RegExp, string][] = [
    [/matches your invoice/i, 'sync is not validated against a live account'],
    [/exact cost matching invoice/i, 'sync is not validated against a live account'],
    [/billing-accurate/i, 'sync is not validated against a live account'],
    [/billing-verified/i, 'sync is not validated against a live account'],
    [/hard[- ]block/i, 'the kill switch is best effort (spend is written in batches)'],
    [/verified against real recordings/i, 'the Claude recording is one scrubbed excerpt'],
    [/~?\s?95%\s+accurate|within ~?5% of actual/i, 'session cost accuracy has not been measured'],
    [/surprise bill/i, 'the kill switch cannot promise to prevent a bill'],
    [/bill shocks?/i, 'the kill switch cannot promise to prevent a bill'],
    // K1 made these statements false: queued rows and in-flight estimates now count
    [/(?:slip|sail)s? past|before the block applies|spend is written (?:to the database )?in (?:short )?batches, so/i, 'stale: queued and in-flight spend are counted now; describe the real bound instead'],
    [/recorded spend lags the proxy/i, 'stale: queued and in-flight spend are counted now'],
];

// Files that describe the kill switch must state the real guarantee and its bound.
const KILL_SWITCH_FILES = [
    'README.md',
    'docs/index.md',
    'packages/cli/README.md',
    'packages/dashboard/src/components/BudgetsTab.tsx',
];

describe('user-facing claims', () => {
    it.each(FILES)('%s makes no overclaim about sync accuracy, the kill switch or verification', (file) => {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const hits = BANNED.filter(([re]) => re.test(text)).map(([re, why]) => `${re}: ${why}`);
        expect(hits).toEqual([]);
    });

    it('the README states the sync is not yet validated and the kill switch is best effort', () => {
        const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
        expect(readme).toMatch(/not yet validated against a live account/);
        expect(readme).toMatch(/best effort/i);
    });

    it.each(KILL_SWITCH_FILES)('%s states the kill switch guarantee, its bound and its limits', (file) => {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
        // blocked BEFORE sending, on recorded + queued + in-flight estimated spend
        expect(text).toMatch(/before it is sent|before they are sent/i);
        expect(text).toMatch(/recorded,? (?:and )?queued,? (?:and )?in-flight/i);
        // the bound
        expect(text).toMatch(/difference between a request's estimated and actual cost|gap between a request's estimated and actual cost/i);
        // the caveats
        expect(text).toMatch(/best effort/i);
        expect(text).toMatch(/cannot promise to prevent a bill/i);
        expect(text).toMatch(/proxy/i);
    });

    it('the longer docs also say the figure covers one process and not traffic that bypasses the proxy', () => {
        for (const file of ['README.md', 'packages/cli/README.md', 'packages/dashboard/src/components/BudgetsTab.tsx']) {
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
            expect(text).toMatch(/(?:one|single|this) (?:`llm-observer` )?(?:process|proxy process)|of a single process|of one `llm-observer` process/i);
            expect(text).toMatch(/bypass/i);
        }
    });
});
