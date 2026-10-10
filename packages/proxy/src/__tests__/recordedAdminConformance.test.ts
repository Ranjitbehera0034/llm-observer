/**
 * Conformance of REAL admin-API recordings with the pollers' response normalisers.
 *
 * Recordings are produced by `node scripts/validate-admin-sync.js --save` run by the owner with a live
 * admin key, and committed to fixtures/recorded/<provider>-<YYYY-MM-DD>/ (usage-N.json, cost-N.json,
 * meta.json, one file per page). Until the first one is committed there is nothing real to check; the
 * per-recording tests below are then reported as skipped, on purpose, rather than passing on nothing.
 * The helper that does the checking is exercised against synthetic directories so it is known to work.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    normalizeAnthropicUsage, normalizeAnthropicCost, normalizeOpenAIUsage, normalizeOpenAICost,
} from '../sync/response-shapes';

const FIXTURES = path.join(__dirname, 'fixtures');
const RECORDED = path.join(FIXTURES, 'recorded');
const DIR_RE = /^(anthropic|openai)-\d{4}-\d{2}-\d{2}$/;

/** Returns a list of problems with one recording directory (empty = conforms). */
function checkRecording(dir: string): string[] {
    const problems: string[] = [];
    const provider = path.basename(dir).split('-')[0] as 'anthropic' | 'openai';
    const files = fs.readdirSync(dir);
    const usageFiles = files.filter(f => /^usage-\d+\.json$/.test(f)).sort();
    const costFiles = files.filter(f => /^cost-\d+\.json$/.test(f)).sort();
    if (!usageFiles.length) problems.push('no usage-N.json');
    if (!costFiles.length) problems.push('no cost-N.json');

    if (!files.includes('meta.json')) {
        problems.push('no meta.json');
    } else {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        if (meta.provider !== provider) problems.push('meta.provider does not match the directory name');
        if (/NOT a vendor recording/i.test(String(meta.source))) problems.push('meta.source says this is not a vendor recording');
    }

    const usage = provider === 'anthropic' ? normalizeAnthropicUsage : normalizeOpenAIUsage;
    const cost = provider === 'anthropic' ? normalizeAnthropicCost : normalizeOpenAICost;
    for (const [list, fn] of [[usageFiles, usage], [costFiles, cost]] as const) {
        for (const f of list) {
            const text = fs.readFileSync(path.join(dir, f), 'utf8');
            try { (fn as (b: unknown) => unknown)(JSON.parse(text)); } catch (e: any) { problems.push(`${f}: ${e.message}`); }
        }
    }
    for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/\bsk-[A-Za-z0-9_\-]{6,}/.test(text)) problems.push(`${f}: contains a key-like string`);
        const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).find(m => !m.endsWith('@example.invalid'));
        if (email) problems.push(`${f}: contains an email address`);
    }
    return problems;
}

describe('checkRecording (the conformance helper)', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recorded-conformance-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const copy = (name: string, into: string, as: string) => fs.copyFileSync(path.join(FIXTURES, name), path.join(into, as));
    const makeDir = (provider: 'anthropic' | 'openai', source: string) => {
        const dir = path.join(tmp, `${provider}-2026-10-08`);
        fs.mkdirSync(dir);
        copy(`${provider}-${provider === 'anthropic' ? 'usage-report' : 'usage-completions'}.nested.json`, dir, 'usage-1.json');
        copy(`${provider}-${provider === 'anthropic' ? 'cost-report' : 'costs'}.nested.json`, dir, 'cost-1.json');
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ provider, source }));
        return dir;
    };

    it.each(['anthropic', 'openai'] as const)('accepts a well-formed %s recording', (p) => {
        expect(checkRecording(makeDir(p, 'vendor API, live admin key'))).toEqual([]);
    });

    it('rejects an unrecognised shape', () => {
        const dir = makeDir('anthropic', 'vendor API');
        fs.writeFileSync(path.join(dir, 'usage-1.json'), JSON.stringify({ data: { oops: true } }));
        expect(checkRecording(dir).join('\n')).toMatch(/usage-1\.json: Unrecognised Anthropic usage/);
    });

    it('rejects a recording that says it came from a fake server', () => {
        expect(checkRecording(makeDir('openai', 'NOT a vendor recording: base URL override')).join('\n')).toMatch(/not a vendor recording/);
    });

    it('rejects leftover emails and keys', () => {
        const dir = makeDir('anthropic', 'vendor API');
        fs.writeFileSync(path.join(dir, 'cost-1.json'), JSON.stringify({ data: [], note: 'bob@corp.example sk-ant-admin01-abcdefghij' }));
        const problems = checkRecording(dir).join('\n');
        expect(problems).toMatch(/email address/);
        expect(problems).toMatch(/key-like/);
    });
});

const recordings = fs.existsSync(RECORDED)
    ? fs.readdirSync(RECORDED).filter(d => DIR_RE.test(d) && fs.statSync(path.join(RECORDED, d)).isDirectory())
    : [];

describe('real admin-API recordings (fixtures/recorded)', () => {
    if (!recordings.length) {
        // Nothing real has been recorded yet. Skipped (visible in the test summary), not passed.
        it.skip('no recordings committed yet: run scripts/validate-admin-sync.js --save with live keys', () => { });
    }
    for (const dir of recordings) {
        it(`${dir} conforms to the normalisers and holds no identifying data`, () => {
            expect(checkRecording(path.join(RECORDED, dir))).toEqual([]);
        });
    }
});
