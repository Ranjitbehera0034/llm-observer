import { getDb } from '../db';

export interface ParsedFileRecord {
  file_path: string;
  provider: string; // 'claude-code', 'cursor', 'aider'
  last_modified_at: number;
  last_parsed_at: string;
  status: string; // 'success', 'error', 'skipped'
  error_message?: string;
}

export const getParsedFile = (file_path: string): ParsedFileRecord | undefined => {
  const db = getDb();
  return db.prepare('SELECT * FROM parsed_files_registry WHERE file_path = ?').get(file_path) as ParsedFileRecord | undefined;
};

export const upsertParsedFile = (record: ParsedFileRecord) => {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO parsed_files_registry (
      file_path, provider, last_modified_at, last_parsed_at, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      provider = excluded.provider,
      last_modified_at = excluded.last_modified_at,
      last_parsed_at = excluded.last_parsed_at,
      status = excluded.status,
      error_message = excluded.error_message
  `);

  stmt.run(
    record.file_path,
    record.provider,
    record.last_modified_at,
    record.last_parsed_at,
    record.status,
    record.error_message || null
  );
};

export const getParsedFileCount = (provider?: string): number => {
    const db = getDb();
    if (provider) {
        const row = db.prepare('SELECT COUNT(*) as count FROM parsed_files_registry WHERE provider = ?').get(provider) as any;
        return row.count;
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM parsed_files_registry').get() as any;
    return row.count;
};
