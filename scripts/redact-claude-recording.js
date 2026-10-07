#!/usr/bin/env node
/**
 * Builds a scrubbed fixture from a real Claude Code session log, for the parser
 * format matrix (see CONTRIBUTING.md, "Capturing a real recording").
 *
 * It keeps the record shapes: field names, nesting, record types, model ids,
 * usage objects and every number. It replaces everything that could be private:
 *   - every string not on a small allowlist of enum-like fields becomes "[redacted]"
 *     (prompts, thinking, tool inputs, tool output, paths, branch names, signatures)
 *   - uuids, msg_/req_/toolu_ ids and session/agent ids are replaced with fresh random ones
 *     (consistently, so parentUuid chains and dedupe keys still line up)
 *   - timestamps are shifted by one constant so the start lands on 2026-01-12T09:00:00Z
 *   - cwd and gitBranch become fixed placeholders
 *
 * Usage:
 *   node scripts/redact-claude-recording.js --session <~/.claude/projects/<proj>/<id>.jsonl> \
 *        [--subagent <agent-*.jsonl>] --out <dir> [--records 14] [--subagent-records 8]
 *
 * Writes <out>/<newSessionId>.jsonl and, with --subagent,
 * <out>/<newSessionId>/subagents/agent-<newAgentId>.jsonl (the layout the parser reads).
 * Always grep the output for your home path, username, email and repo name before committing it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.session || !args.out) {
    console.error('usage: redact-claude-recording.js --session <file> [--subagent <file>] --out <dir> [--records N] [--subagent-records N]');
    process.exit(2);
}

const KEEP_KEYS = new Set([
    'type', 'subtype', 'role', 'model', 'advisorModel', 'stop_reason', 'service_tier', 'speed', 'inference_geo',
    'effort', 'perTurnEffort', 'permissionMode', 'userType', 'entrypoint', 'version', 'promptSource',
    'turnOrigin', 'kind', 'platform', 'renderedRole', 'level',
]);
const KNOWN_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Task', 'Agent', 'TodoWrite', 'WebFetch', 'WebSearch', 'NotebookEdit']);
const KEEP_RECORD_TYPES = new Set(['user', 'assistant', 'attachment', 'system']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXED_ID = /^(msg_|req_|toolu_)[A-Za-z0-9]+$/;
const AGENT_ID = /^a[0-9a-f]{16}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const idMap = new Map();
const freshId = (v) => {
    if (idMap.has(v)) return idMap.get(v);
    let out;
    if (UUID.test(v)) out = crypto.randomUUID();
    else if (AGENT_ID.test(v)) out = 'a' + crypto.randomBytes(8).toString('hex');
    else {
        const prefix = v.slice(0, v.indexOf('_') + 1);
        let body = '';
        for (let i = prefix.length; i < v.length; i++) body += ALNUM[crypto.randomInt(ALNUM.length)];
        out = prefix + body;
    }
    idMap.set(v, out);
    return out;
};
const isId = (v) => UUID.test(v) || PREFIXED_ID.test(v) || AGENT_ID.test(v);

let shiftMs = null;
const TARGET_START = Date.parse('2026-01-12T09:00:00.000Z');
const shiftTime = (v, base) => {
    if (base !== null && shiftMs === null) shiftMs = TARGET_START - base;
    return new Date(Date.parse(v) + shiftMs).toISOString();
};

const scrub = (v, key) => {
    if (Array.isArray(v)) return v.map(x => scrub(x, key));
    if (v && typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) out[typeof k === 'string' && isId(k) ? freshId(k) : k] = scrub(x, k);
        return out;
    }
    if (typeof v !== 'string') return v;
    if (v === '') return v;
    if (isId(v)) return freshId(v);
    if (ISO.test(v)) return shiftTime(v, null);
    if (key === 'name') return KNOWN_TOOLS.has(v) ? v : 'tool';
    if (key === 'cwd') return '/redacted/project';
    if (key === 'gitBranch') return 'main';
    if (KEEP_KEYS.has(key)) return v;
    return '[redacted]';
};

// `limit` counts user/assistant records; at most two attachment/system records are kept as shape samples.
const read = (file, limit) => {
    const records = [];
    let conversation = 0;
    let extras = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (!KEEP_RECORD_TYPES.has(o.type)) continue;
        if (o.type === 'user' || o.type === 'assistant') {
            if (conversation >= limit) break;
            conversation++;
        } else if (extras++ >= 2) continue;
        records.push(o);
    }
    return records;
};

const write = (file, records) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
};

const main = read(args.session, Number(args.records || 14));
const firstTs = Math.min(...main.filter(r => r.timestamp).map(r => Date.parse(r.timestamp)));
shiftMs = TARGET_START - firstTs;
const sessionId = main[0].sessionId;
const outMain = main.map(r => scrub(r));
const newSessionId = idMap.get(sessionId);
write(path.join(args.out, `${newSessionId}.jsonl`), outMain);
console.log(`wrote ${outMain.length} records for session ${newSessionId}`);

if (args.subagent) {
    const sub = read(args.subagent, Number(args['subagent-records'] || 8));
    // Subagent files come from another time; place the first record a few seconds into the parent.
    const subStart = TARGET_START + 5000;
    shiftMs = subStart - Math.min(...sub.filter(r => r.timestamp).map(r => Date.parse(r.timestamp)));
    const agentId = sub[0].agentId;
    const outSub = sub.map(r => scrub(r)); // subagent records carry the parent's sessionId, which maps to the same fresh id
    const newAgentId = idMap.get(agentId);
    write(path.join(args.out, newSessionId, 'subagents', `agent-${newAgentId}.jsonl`), outSub);
    console.log(`wrote ${outSub.length} records for agent ${newAgentId}`);
}
