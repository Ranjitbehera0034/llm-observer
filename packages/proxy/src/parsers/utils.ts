import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { getPricingForModel, getParsedFile, upsertParsedFile } from '@llm-observer/database';

export const estimateTokens = (content: string): number => {
    return Math.ceil(content.length / 4);
};

export const calculateCost = (
    model: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    cacheCreateTokens?: number
): { costUsd: number; isEstimated: boolean } => {
    let provider = 'unknown';
    const lowerModel = model.toLowerCase();
    
    if (lowerModel.includes('claude')) provider = 'anthropic';
    else if (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3') || lowerModel.includes('codex') || lowerModel.includes('o4')) provider = 'openai';

    const pricing = getPricingForModel(provider, model);
    if (!pricing) {
        const fallbackCost = ((inputTokens + outputTokens) / 1_000_000) * 1.0; // 1$/1M placeholder
        return { costUsd: isNaN(fallbackCost) ? 0 : fallbackCost, isEstimated: true };
    }

    let cost = 0;
    cost += (inputTokens / 1_000_000) * pricing.input;
    cost += (outputTokens / 1_000_000) * pricing.output;

    if (cacheReadTokens && pricing.cached) {
        cost -= (cacheReadTokens / 1_000_000) * (pricing.input - pricing.cached);
    }

    return { costUsd: Math.max(0, cost), isEstimated: false };
};

export const safeReadSQLite = async (sourcePath: string): Promise<Database.Database | null> => {
    let retries = 0;
    while (retries < 3) {
        try {
            const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
            db.pragma('busy_timeout = 5000');
            db.prepare('SELECT 1').get();
            return db;
        } catch (err: any) {
            if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
                retries++;
                if (retries >= 3) {
                    console.warn(`[Parser Utilities] Database locked after 3 retries: ${sourcePath}. Falling back to copy-and-read.`);
                    const tempPath = path.join(os.tmpdir(), `llm-observer-${Date.now()}-${Math.random().toString(36).substring(7)}.db`);
                    try {
                        fs.copyFileSync(sourcePath, tempPath);
                        const tempDb = new Database(tempPath, { readonly: true });
                        const originalClose = tempDb.close.bind(tempDb);
                        tempDb.close = function() {
                            const res = originalClose();
                            try { fs.unlinkSync(tempPath); } catch (e) {}
                            return res;
                        };
                        return tempDb;
                    } catch (copyErr) {
                        console.error(`[Parser Utilities] Copy fallback failed for ${sourcePath}:`, copyErr);
                        try { fs.unlinkSync(tempPath); } catch (e) {}
                        return null;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            } else {
                return null;
            }
        }
    }
    return null;
};

export const findFilesRecursive = (dir: string, pattern: RegExp): string[] => {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    
    try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const filePath = path.join(dir, file);
            let stat;
            try { stat = fs.statSync(filePath); } catch (e) { continue; }
            if (stat && stat.isDirectory()) {
                results = results.concat(findFilesRecursive(filePath, pattern));
            } else if (pattern.test(filePath)) {
                results.push(filePath);
            }
        }
    } catch (e) {
    }
    return results;
};

export const shouldParseFile = (filePath: string, currentMtime: number): boolean => {
    try {
        const record = getParsedFile(filePath);
        if (record && record.status === 'success' && Math.floor(record.last_modified_at) === Math.floor(currentMtime)) {
            return false;
        }
        return true;
    } catch (e) {
        console.error(`[utils] Error checking registry for ${filePath}`, e);
        return true;
    }
};

export const markFileParsed = (filePath: string, providerId: string, currentMtime: number, status: 'success' | 'error' | 'skipped', errMsg?: string) => {
    try {
        upsertParsedFile({
            file_path: filePath,
            provider: providerId,
            last_modified_at: currentMtime,
            last_parsed_at: new Date().toISOString(),
            status,
            error_message: errMsg
        });
    } catch (e) {
        console.error(`[utils] Error updating registry for ${filePath}`, e);
    }
};

export const getProviderForModel = (model: string): string => {
    const lmodel = model.toLowerCase();
    if (lmodel.includes('claude') || lmodel.includes('anthropic')) return 'anthropic';
    if (lmodel.includes('gpt') || lmodel.includes('openai') || lmodel.includes('text-embedding') || lmodel.includes('o1') || lmodel.includes('o3') || lmodel.includes('codex') || lmodel.includes('o4')) return 'openai';
    if (lmodel.includes('gemini') || lmodel.includes('google')) return 'google';
    if (lmodel.includes('mistral') || lmodel.includes('mixtral')) return 'mistral';
    if (lmodel.includes('llama') || lmodel.includes('groq')) return 'groq';
    return 'unknown';
};
