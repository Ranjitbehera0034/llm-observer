#!/usr/bin/env node
/**
 * Independent cost verification script.
 *
 * Re-derives token counts and cost for every parsed Claude Code session
 * directly from the raw ~/.claude/projects/**\/*.jsonl files — using its own
 * copy of the dedup rule and pricing formula, NOT by calling into the app's
 * own parser or cost-calculation code — and diffs the result against what
 * the app actually stored in its local database.
 *
 * This is the same methodology used to verify LLM Observer's own numbers
 * during development (see the evidence report). Anyone can run this against
 * their own data to audit the app rather than take its numbers on faith.
 *
 * Usage:
 *   node scripts/verify-costs.js [--claude-dir <path>] [--data-dir <path>] [--json]
 *
 * Exit code is 0 if every session matches exactly, 1 otherwise (useful for
 * scripting/CI, though this is primarily meant to be run interactively).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function parseArgs(argv) {
    const args = { claudeDir: null, dataDir: null, json: false };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--claude-dir') args.claudeDir = argv[++i];
        else if (argv[i] === '--data-dir') args.dataDir = argv[++i];
        else if (argv[i] === '--json') args.json = true;
        else if (argv[i] === '--help' || argv[i] === '-h') {
            console.log([
                'Usage: node scripts/verify-costs.js [--claude-dir <path>] [--data-dir <path>] [--json]',
                '',
                'Independently recomputes token counts and cost for every parsed Claude Code',
                'session from the raw ~/.claude/projects/**/*.jsonl files, and diffs the result',
                "against what's stored in LLM Observer's own database.",
                '',
                '  --claude-dir <path>  Override the Claude Code session directory (default: ~/.claude/projects)',
                '  --data-dir <path>    Override the LLM Observer data directory (default: $LLM_OBSERVER_DATA_DIR or ~/.llm-observer)',
                '  --json               Print machine-readable JSON instead of a summary table',
            ].join('\n'));
            process.exit(0);
        }
    }
    return args;
}

// --- Mirrors packages/database/src/db.ts's getDbPath() ---------------------
function getDbPath(override) {
    // --data-dir is documented (and behaves, matching LLM_OBSERVER_DATA_DIR
    // elsewhere in this app) as a DIRECTORY containing data.db — not the
    // database file itself.
    const envDir = process.env.LLM_OBSERVER_DATA_DIR;
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const dbDir = override || envDir || path.join(homeDir, '.llm-observer');
    return path.join(dbDir, 'data.db');
}

function getClaudeDir(override) {
    if (override) return override;
    return path.join(os.homedir(), '.claude', 'projects');
}

// --- Independent pricing source: this repo's pricing.json, not the app's live DB copy ---
function loadPricing() {
    const pricingPath = path.join(__dirname, '..', 'pricing.json');
    const raw = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
    const byModel = new Map();
    for (const entry of raw) {
        if (entry.provider === 'anthropic') byModel.set(entry.model, entry);
    }
    return byModel;
}

function resolvePricing(pricingMap, model) {
    if (pricingMap.has(model)) return pricingMap.get(model);
    const stripped = model.replace(/-\d{8}$/, '');
    return pricingMap.get(stripped);
}

// --- Independent token extraction + dedup (mirrors packages/proxy/src/parsers/claude.ts) ---
function findJsonlFiles(dir) {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
            if (entry === 'subagents') continue;
            results = results.concat(findJsonlFiles(full));
        } else if (entry.endsWith('.jsonl')) {
            results.push(full);
        }
    }
    return results;
}

function recomputeSession(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const seen = new Set();
    const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
    const models = {};
    const toolCalls = {};
    let messageCount = 0;

    for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }

        if (event.type === 'user' || event.type === 'assistant') messageCount++;

        const msg = event.message && typeof event.message === 'object' ? event.message : null;
        const model = msg?.model || event.model;
        if (model) models[model] = (models[model] || 0) + 1;

        const usage = msg?.usage || event.usage;
        if (usage) {
            const key = `${msg?.id ?? ''}:${event.requestId ?? ''}`;
            if (key === ':' || !seen.has(key)) {
                if (key !== ':') seen.add(key);
                totals.input += usage.input_tokens || usage.prompt_tokens || 0;
                totals.output += usage.output_tokens || usage.completion_tokens || 0;
                totals.cacheRead += usage.cache_read_input_tokens || usage.cache_read_tokens || 0;
                totals.cacheWrite += usage.cache_creation_input_tokens || usage.cache_creation_tokens || 0;
                totals.cacheWrite1h += usage.cache_creation?.ephemeral_1h_input_tokens || 0;
            }
        }

        const content = msg?.content || event.content;
        if (Array.isArray(content)) {
            for (const block of content) {
                if (block && block.type === 'tool_use') {
                    const name = block.name || 'unknown';
                    toolCalls[name] = (toolCalls[name] || 0) + 1;
                }
            }
        }
    }

    let primaryModel = '';
    let maxCount = 0;
    for (const [m, count] of Object.entries(models)) {
        if (count > maxCount) { maxCount = count; primaryModel = m; }
    }

    return { messageCount, totals, primaryModel, toolCalls, sessionId: path.basename(filePath, '.jsonl') };
}

function computeCost(pricingMap, model, totals) {
    if (!model) return { cost: 0, pricingFound: false };
    const pricing = resolvePricing(pricingMap, model);
    if (!pricing) return { cost: 0, pricingFound: false };
    const cacheWrite5m = Math.max(0, totals.cacheWrite - totals.cacheWrite1h);
    const cost =
        (totals.input / 1_000_000) * pricing.input +
        (totals.output / 1_000_000) * pricing.output +
        (pricing.cached ? (totals.cacheRead / 1_000_000) * pricing.cached : 0) +
        (cacheWrite5m / 1_000_000) * pricing.input * 1.25 +
        (totals.cacheWrite1h / 1_000_000) * pricing.input * 2;
    return { cost, pricingFound: true };
}

function main() {
    const args = parseArgs(process.argv);
    const dbPath = getDbPath(args.dataDir);
    const claudeDir = getClaudeDir(args.claudeDir);

    if (!fs.existsSync(dbPath)) {
        console.error(`No LLM Observer database found at ${dbPath}.`);
        console.error('Run the app at least once, or pass --data-dir to point at its data directory.');
        process.exit(2);
    }

    let Database;
    try {
        Database = require('better-sqlite3');
    } catch (e) {
        console.error('Could not load better-sqlite3. Run this script from within the llm-observer repo (npm install first).');
        process.exit(2);
    }

    let db;
    try {
        db = new Database(dbPath, { readonly: true });
    } catch (e) {
        // Some filesystems (notably certain sandboxed/network mounts) reject
        // SQLite's readonly+WAL access pattern even though a normal open
        // succeeds. This script only ever SELECTs, so falling back is safe.
        console.error(`(readonly open failed — ${e.message} — falling back to a normal connection; this script never writes)`);
        db = new Database(dbPath);
    }
    const pricingMap = loadPricing();
    const files = findJsonlFiles(claudeDir);

    if (files.length === 0) {
        console.error(`No Claude Code session files found under ${claudeDir}.`);
        process.exit(2);
    }

    const results = [];
    let mismatches = 0;

    for (const file of files) {
        const manual = recomputeSession(file);
        const appRow = db.prepare('SELECT * FROM sessions WHERE session_id = ? OR file_path = ?').get(manual.sessionId, file);

        if (!appRow) {
            results.push({ sessionId: manual.sessionId, status: 'not_in_app_db', file });
            continue;
        }

        const { cost: manualCost } = computeCost(pricingMap, manual.primaryModel, manual.totals);
        const fields = [
            ['input_tokens', manual.totals.input, appRow.input_tokens],
            ['output_tokens', manual.totals.output, appRow.output_tokens],
            ['cache_read_tokens', manual.totals.cacheRead, appRow.cache_read_tokens],
            ['cache_write_tokens', manual.totals.cacheWrite, appRow.cache_write_tokens],
        ];
        const costMatch = Math.abs(manualCost - appRow.estimated_cost_usd) < 0.0001;
        const fieldMismatches = fields.filter(([, a, b]) => a !== b);
        const ok = fieldMismatches.length === 0 && costMatch;
        if (!ok) mismatches++;

        results.push({
            sessionId: manual.sessionId,
            status: ok ? 'match' : 'mismatch',
            file,
            manual: { ...manual.totals, cost: manualCost, model: manual.primaryModel },
            app: {
                input_tokens: appRow.input_tokens, output_tokens: appRow.output_tokens,
                cache_read_tokens: appRow.cache_read_tokens, cache_write_tokens: appRow.cache_write_tokens,
                cost: appRow.estimated_cost_usd, model: appRow.model_primary
            },
            fieldMismatches: fieldMismatches.map(([k]) => k),
            costMatch
        });
    }

    db.close();

    if (args.json) {
        console.log(JSON.stringify({ results, mismatches, totalSessions: files.length }, null, 2));
    } else {
        console.log(`Checked ${files.length} session file(s) under ${claudeDir}\nAgainst database: ${dbPath}\n`);
        for (const r of results) {
            if (r.status === 'not_in_app_db') {
                console.log(`⚠  ${r.sessionId}  — not found in app database (not yet parsed, or file changed since last scan)`);
                continue;
            }
            const icon = r.status === 'match' ? '✓' : '✗';
            console.log(`${icon} ${r.sessionId}  (${r.manual.model || 'unknown model'})`);
            if (r.status === 'mismatch') {
                const FIELD_TO_MANUAL_KEY = {
                    input_tokens: 'input', output_tokens: 'output',
                    cache_read_tokens: 'cacheRead', cache_write_tokens: 'cacheWrite'
                };
                for (const field of r.fieldMismatches) {
                    console.log(`    ${field}: manual=${r.manual[FIELD_TO_MANUAL_KEY[field]]} app=${r.app[field]}`);
                }
                if (!r.costMatch) console.log(`    cost: manual=$${r.manual.cost.toFixed(4)} app=$${r.app.cost.toFixed(4)}`);
            }
        }
        console.log(`\n${results.length - mismatches - results.filter(r => r.status === 'not_in_app_db').length}/${files.length} sessions match exactly.`);
        if (mismatches > 0) {
            console.log(`${mismatches} session(s) diverged — see above.`);
        }
    }

    process.exit(mismatches > 0 ? 1 : 0);
}

main();
