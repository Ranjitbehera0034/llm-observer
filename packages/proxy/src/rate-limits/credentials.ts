import os from 'os';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function readClaudeOAuthMacOS(): Promise<string | null> {
    try {
        const { stdout } = await execPromise('security find-generic-password -s "claude.ai" -w 2>/dev/null');
        if (stdout.trim()) return stdout.trim();
    } catch {
        // Fallback or ignore if security command fails
    }

    // Fallback: check credentials file
    try {
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (fs.existsSync(credPath)) {
            const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
            return creds.accessToken || creds.token || null;
        }
    } catch {
        return null; // Could not read or parse
    }
    return null;
}

export async function readClaudeOAuthLinux(): Promise<string | null> {
    try {
        // Try libsecret via secret-tool
        const { stdout } = await execPromise('secret-tool lookup service claude.ai 2>/dev/null');
        if (stdout.trim()) return stdout.trim();
    } catch {
        // Ignore secret-tool errors
    }

    try {
        // Fallback: credentials file
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (fs.existsSync(credPath)) {
            const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
            return creds.accessToken || creds.token || null;
        }
    } catch {
        return null;
    }
    return null;
}

export async function readClaudeOAuth(): Promise<string | null> {
    if (process.platform === 'darwin') {
        return readClaudeOAuthMacOS();
    } else if (process.platform === 'linux') {
        return readClaudeOAuthLinux();
    } else {
        // Windows fallback - try to read from credentials file only for now
        const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
        if (fs.existsSync(credPath)) {
            try {
                const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
                return creds.accessToken || creds.token || null;
            } catch {
                return null;
            }
        }
        return null;
    }
}
