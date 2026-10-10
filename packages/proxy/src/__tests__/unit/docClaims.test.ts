/**
 * Wording guard. The admin-API sync has only been tested against synthetic fixtures
 * (docs/RELEASE_CHECKLIST.md), and the kill switch reads spend that is written in short
 * batches, so user-facing text must not state either as a proven fact.
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
    'packages/dashboard/src/components/TeamPanels.tsx',
    'docs/guide/team.md',
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
});
