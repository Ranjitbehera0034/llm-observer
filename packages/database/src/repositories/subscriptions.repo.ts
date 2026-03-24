import { getDb } from '../db';

export interface SubscriptionRecord {
    id?: number;
    service_name: string;
    provider?: string;
    monthly_cost_usd: number;
    billing_cycle: 'monthly' | 'yearly';
    is_active: number; // 0 or 1
    start_date: string;
    end_date?: string;
    notes?: string;
    created_at?: string;
    updated_at?: string;
}

export const createSubscription = (sub: Omit<SubscriptionRecord, 'id' | 'created_at' | 'updated_at'>): number => {
    const db = getDb();
    const stmt = db.prepare(`
        INSERT INTO subscriptions (
            service_name, provider, monthly_cost_usd, billing_cycle, is_active, start_date, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        sub.service_name,
        sub.provider || null,
        sub.monthly_cost_usd,
        sub.billing_cycle || 'monthly',
        sub.is_active ?? 1,
        sub.start_date || new Date().toISOString(),
        sub.notes || null
    );
    return result.lastInsertRowid as number;
};

export const getSubscriptions = (onlyActive: boolean = false): SubscriptionRecord[] => {
    const db = getDb();
    let query = 'SELECT * FROM subscriptions';
    if (onlyActive) {
        query += ' WHERE is_active = 1';
    }
    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all() as SubscriptionRecord[];
};

export const getSubscription = (id: number): SubscriptionRecord | undefined => {
    const db = getDb();
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as SubscriptionRecord | undefined;
};

export const updateSubscription = (id: number, updates: Partial<SubscriptionRecord>) => {
    const db = getDb();
    const sub = getSubscription(id);
    if (!sub) throw new Error('Subscription not found');

    const stmt = db.prepare(`
        UPDATE subscriptions SET
            service_name = COALESCE(?, service_name),
            provider = COALESCE(?, provider),
            monthly_cost_usd = COALESCE(?, monthly_cost_usd),
            billing_cycle = COALESCE(?, billing_cycle),
            is_active = COALESCE(?, is_active),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date),
            notes = COALESCE(?, notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);

    stmt.run(
        updates.service_name ?? null,
        updates.provider ?? null,
        updates.monthly_cost_usd ?? null,
        updates.billing_cycle ?? null,
        updates.is_active ?? null,
        updates.start_date ?? null,
        updates.end_date ?? null,
        updates.notes ?? null,
        id
    );
};

export const deleteSubscription = (id: number) => {
    const db = getDb();
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
};
