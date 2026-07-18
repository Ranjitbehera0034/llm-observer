import { getDb } from '../db';

export interface DriftBaselineRow {
    provider: string;
    model: string;
    term_freq_json: string;
    sample_count: number;
    avg_similarity: number | null;
    variance_similarity: number | null;
}

export const getDriftBaseline = (provider: string, model: string): DriftBaselineRow | undefined => {
    const db = getDb();
    return db.prepare(
        'SELECT * FROM response_drift_baselines WHERE provider = ? AND model = ?'
    ).get(provider, model) as DriftBaselineRow | undefined;
};

export const saveDriftBaseline = (row: DriftBaselineRow): void => {
    const db = getDb();
    db.prepare(`
        INSERT INTO response_drift_baselines
            (provider, model, term_freq_json, sample_count, avg_similarity, variance_similarity, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(provider, model) DO UPDATE SET
            term_freq_json = excluded.term_freq_json,
            sample_count = excluded.sample_count,
            avg_similarity = excluded.avg_similarity,
            variance_similarity = excluded.variance_similarity,
            updated_at = datetime('now')
    `).run(row.provider, row.model, row.term_freq_json, row.sample_count, row.avg_similarity, row.variance_similarity);
};
