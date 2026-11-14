import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

// Never return an entire keychain JSON document as an Authorization token.
export function parseClaudeCredential(raw: string): string | null {
    try {
        const data = JSON.parse(raw);
        const credential = data.claudeAiOauth ?? data;
        if (credential.expiresAt != null && (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= Date.now())) return null;
        if (credential.scopes != null && (!Array.isArray(credential.scopes) || !credential.scopes.includes('user:profile'))) return null;
        const token = credential.accessToken ?? credential.token;
        return typeof token === 'string' && token.trim() && !/\s/.test(token) ? token : null;
    } catch { return null; }
}

function readFileCredential(): string | null {
    try {
        const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
        const file = path.join(dir, '.credentials.json');
        if (fs.statSync(file).size > 1_000_000) return null;
        return parseClaudeCredential(fs.readFileSync(file, 'utf8'));
    } catch { return null; }
}

export async function readClaudeOAuthMacOS(): Promise<string | null> {
    const token = readFileCredential();
    if (token) return token;
    // Do not borrow a different default account for an explicit profile.
    if (process.env.CLAUDE_CONFIG_DIR) return null;
    try {
        const { stdout } = await run('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 1_000_000 });
        return parseClaudeCredential(stdout);
    } catch { return null; }
}

export async function readClaudeOAuthLinux(): Promise<string | null> {
    return readFileCredential();
}

export async function readClaudeOAuth(): Promise<string | null> {
    return process.platform === 'darwin' ? readClaudeOAuthMacOS() : readFileCredential();
}
