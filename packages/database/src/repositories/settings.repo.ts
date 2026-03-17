import { getDb } from '../db';

export const getSetting = (key: string): string | null => {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row ? row.value : null;
};

export const getAllSettings = (): Record<string, string> => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
    return rows.reduce((acc, row) => {
        acc[row.key] = row.value;
        return acc;
    }, {});
};

export const updateSetting = (key: string, value: string) => {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
};

export const updateSettings = (settings: Record<string, string>) => {
    const db = getDb();
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const transaction = db.transaction((data) => {
        for (const [key, value] of Object.entries(data)) {
            stmt.run(key, String(value));
        }
    });
    transaction(settings);
};
