import fs from 'fs';
import path from 'path';
import { ADAPTERS } from '../registry';

const README_TABLE_START = '| Tool | Location | Format | Status |';
const README_TABLE_END = '**Verified** means';

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

const tableRows = (): { tool: string; location: string; format: string; status: string }[] => {
    const start = README.indexOf(README_TABLE_START);
    const end = README.indexOf(README_TABLE_END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return README.slice(start, end).split('\n')
        .filter(l => l.startsWith('|'))
        .slice(2) // header and separator
        .map(l => {
            const cells = l.split('|').slice(1, -1).map(c => c.trim());
            return { tool: cells[0], location: cells[1], format: cells[2], status: cells[3] };
        });
};

describe('README "Auto-Detected Session Files" table agrees with the parser registry', () => {
    it('has exactly one row per registered adapter, named by its displayName', () => {
        expect(tableRows().map(r => r.tool).sort()).toEqual(ADAPTERS.map(a => a.displayName).sort());
    });

    it('labels each row with the same verification level as its adapter', () => {
        const rows = tableRows();
        for (const a of ADAPTERS) {
            const row = rows.find(r => r.tool === a.displayName)!;
            const want = a.verification.level[0].toUpperCase() + a.verification.level.slice(1);
            expect([a.id, row.status.startsWith(`**${want}**`)]).toEqual([a.id, true]);
        }
    });

    it('cites the version of the recording behind every verified adapter, so the README cannot outlive a swapped recording', () => {
        const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'format-matrix.json'), 'utf8'));
        const rows = tableRows();
        for (const a of ADAPTERS.filter(x => x.verification.level === 'verified')) {
            const row = rows.find(r => r.tool === a.displayName)!;
            for (const { fixture } of matrix[a.verification.recording!] as { fixture: string }[]) {
                const version = fixture.match(/(\d+\.\d+\.\d+)/)![1];
                expect([a.id, row.status.includes(version)]).toEqual([a.id, true]);
            }
        }
    });

    it('does not call an adapter verified in the README when its recording is missing, or vice versa', () => {
        for (const a of ADAPTERS) {
            const row = tableRows().find(r => r.tool === a.displayName)!;
            expect([a.id, /\*\*Verified\*\*/.test(row.status)]).toEqual([a.id, a.verification.level === 'verified']);
        }
    });
});
