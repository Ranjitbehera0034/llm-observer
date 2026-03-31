CREATE TABLE IF NOT EXISTS wrapped_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Singleton record
    show_total_spend BOOLEAN DEFAULT 1,
    show_per_app BOOLEAN DEFAULT 1,
    show_subscriptions BOOLEAN DEFAULT 1,
    show_insights BOOLEAN DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO wrapped_preferences (id) VALUES (1);
