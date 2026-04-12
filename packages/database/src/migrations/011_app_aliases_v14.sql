INSERT INTO app_aliases (process_name, display_name) VALUES ('copilot', 'GitHub Copilot') ON CONFLICT(process_name) DO UPDATE SET display_name = 'GitHub Copilot';
INSERT INTO app_aliases (process_name, display_name) VALUES ('windsurf', 'Windsurf') ON CONFLICT(process_name) DO UPDATE SET display_name = 'Windsurf';
INSERT INTO app_aliases (process_name, display_name) VALUES ('cline', 'Cline') ON CONFLICT(process_name) DO UPDATE SET display_name = 'Cline';
INSERT INTO app_aliases (process_name, display_name) VALUES ('roo-code', 'Roo Code') ON CONFLICT(process_name) DO UPDATE SET display_name = 'Roo Code';
INSERT INTO app_aliases (process_name, display_name) VALUES ('codex', 'OpenAI Codex CLI') ON CONFLICT(process_name) DO UPDATE SET display_name = 'OpenAI Codex CLI';
