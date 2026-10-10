-- Team tier (part 2): where a budget came from.
--   'local' = created by the user in this app (the default, so every existing row stays local)
--   'team'  = reconciled from the team policy by the sync manager; read-only in the app, and the only
--             rows the policy reconciliation may create, update or delete.
ALTER TABLE budgets ADD COLUMN source TEXT NOT NULL DEFAULT 'local' CHECK(source IN ('local', 'team'));
CREATE INDEX IF NOT EXISTS idx_budgets_source ON budgets(source);

-- Version of the team policy last applied here (0 = none). The sync manager keeps it up to date.
INSERT OR IGNORE INTO settings (key, value) VALUES ('team_policy_version', '0');
