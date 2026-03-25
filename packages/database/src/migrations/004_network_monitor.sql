-- LLM Observer Migration - 004_network_monitor
-- Adds support for tracking which applications are making network connections to AI API endpoints

-- Table for storing raw detected connections
CREATE TABLE IF NOT EXISTS app_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    process_name TEXT NOT NULL,
    process_pid INTEGER,
    provider TEXT NOT NULL,
    destination_ip TEXT,
    destination_port INTEGER DEFAULT 443,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for per-provider and per-app time-range queries
CREATE INDEX IF NOT EXISTS idx_app_connections_timestamp_provider ON app_connections(timestamp DESC, provider);
CREATE INDEX IF NOT EXISTS idx_app_connections_name_timestamp ON app_connections(process_name, timestamp DESC);

-- Table for human-friendly application aliases
CREATE TABLE IF NOT EXISTS app_aliases (
    process_name TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    icon TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed defaults for common tools
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('cursor', 'Cursor');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('code', 'VS Code');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('code-insiders', 'VS Code Insiders');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('node', 'Node.js Script');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('python', 'Python Script');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('python3', 'Python Script');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('idea', 'IntelliJ IDEA');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('webstorm', 'WebStorm');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('pycharm', 'PyCharm');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('claude', 'Claude Code');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('aider', 'Aider');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('curl', 'cURL');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('language_', 'Language Server (IDE)');
INSERT OR IGNORE INTO app_aliases (process_name, display_name) VALUES ('antigravity', 'Antigravity (AI Agent)');
