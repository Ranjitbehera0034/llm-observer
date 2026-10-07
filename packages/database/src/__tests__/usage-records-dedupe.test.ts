import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const dir = path.join(__dirname, '../migrations');
const sql = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8');
const MIGRATION = '014_usage_records_dedupe.sql';

function dbBeforeDedupe() {
    const db = new Database(':memory:');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
        if (f >= MIGRATION) break;
        db.exec(sql(f));
    }
    return db;
}

function insert(db: Database.Database, model: string, bucket: string, tokens: number, cost: number | null, apiKey: string | null = null) {
    db.prepare(`INSERT INTO usage_records (provider, model, bucket_start, bucket_width, input_tokens, cost_usd, api_key_id, workspace_id)
                VALUES ('anthropic', ?, ?, '1d', ?, ?, ?, NULL)`).run(model, bucket, tokens, cost, apiKey);
}

describe('014 usage_records dedupe migration', () => {
    it('reproduces the defect: NULL key columns let the old UNIQUE admit duplicates', () => {
        const db = dbBeforeDedupe();
        for (let i = 0; i < 5; i++) insert(db, 'm', '2026-07-01T00:00:00Z', 100, 4);
        const t = db.prepare('SELECT COUNT(*) c, SUM(cost_usd) s FROM usage_records').get() as any;
        expect(t.c).toBe(5);
        expect(t.s).toBe(20);
    });

    it('collapses duplicates to the newest row, keeps other rows, and is safe to run twice', () => {
        const db = dbBeforeDedupe();
        insert(db, 'm', '2026-07-01T00:00:00Z', 100, 1);
        insert(db, 'm', '2026-07-01T00:00:00Z', 200, 2);
        insert(db, 'm', '2026-07-01T00:00:00Z', 300, 4);          // newest: wins
        insert(db, 'm', '2026-07-02T00:00:00Z', 50, 0.5);          // different bucket: untouched
        insert(db, 'other', '2026-07-01T00:00:00Z', 70, 0.7);      // different model: untouched
        insert(db, 'm', '2026-07-01T00:00:00Z', 9, 9, 'key1');     // different api key: untouched

        db.exec(sql(MIGRATION));
        const afterFirst = db.prepare('SELECT * FROM usage_records ORDER BY id').all() as any[];
        expect(afterFirst).toHaveLength(4);
        const day1 = afterFirst.find(r => r.model === 'm' && r.bucket_start.startsWith('2026-07-01') && r.api_key_id === null);
        expect(day1.input_tokens).toBe(300);
        expect(day1.cost_usd).toBe(4);

        db.exec(sql(MIGRATION));
        expect(db.prepare('SELECT * FROM usage_records ORDER BY id').all()).toEqual(afterFirst);
    });

    it('carries an older duplicate\'s cost onto the survivor when the survivor has none', () => {
        const db = dbBeforeDedupe();
        insert(db, 'm', '2026-07-01T00:00:00Z', 100, 3);
        insert(db, 'm', '2026-07-01T00:00:00Z', 200, null);
        db.exec(sql(MIGRATION));
        const rows = db.prepare('SELECT * FROM usage_records').all() as any[];
        expect(rows).toHaveLength(1);
        expect(rows[0].input_tokens).toBe(200);
        expect(rows[0].cost_usd).toBe(3);
    });

    it('treats NULL and empty-string keys as the same key from then on', () => {
        const db = dbBeforeDedupe();
        insert(db, 'm', '2026-07-01T00:00:00Z', 1, 1, null);
        insert(db, 'm', '2026-07-01T00:00:00Z', 2, 2, '');
        db.exec(sql(MIGRATION));
        expect(db.prepare('SELECT COUNT(*) c FROM usage_records').get()).toEqual({ c: 1 });
        expect(() => insert(db, 'm', '2026-07-01T00:00:00Z', 3, 3, null)).toThrow(/UNIQUE/);
    });

    it('is a no-op on an empty table', () => {
        const db = dbBeforeDedupe();
        expect(() => db.exec(sql(MIGRATION))).not.toThrow();
    });
});
