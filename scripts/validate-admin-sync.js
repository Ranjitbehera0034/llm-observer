#!/usr/bin/env node
/**
 * Live-key validator for the Anthropic / OpenAI admin-API billing sync.
 *
 *   npm run build:ci
 *   ANTHROPIC_ADMIN_KEY=... OPENAI_ADMIN_KEY=... node scripts/validate-admin-sync.js [--days 3] [--save]
 *
 * Why this exists: the pollers in packages/proxy/src/sync/ have only ever been tested against
 * SYNTHETIC fixtures written from the vendors' documentation. Nobody has seen a real admin-key response
 * go through them. This script runs the REAL poller code (syncUsage / syncCost, the response
 * normalisers, node-fetch) against your real account, read-only, into a throw-away SQLite database,
 * and tells you in a Markdown report whether what was stored reconciles with what the vendor sent.
 *
 * It does, for each provider whose key is in the environment:
 *   1. Requests the SAME endpoints the app polls (URLs come from packages/proxy/src/sync/admin-endpoints.ts)
 *      for the last N UTC days including today (default 3). GET requests only.
 *   2. With --save: writes the raw JSON responses, redacted (org/workspace/key/user/project ids, emails,
 *      key names and page cursors replaced with stable fake values; every number and the shape kept) to
 *      packages/proxy/src/__tests__/fixtures/recorded/<provider>-<YYYY-MM-DD>/ for you to commit.
 *   3. Runs the real sync twice into a temp database (the second time over the same window) and compares,
 *      per UTC day, tokens and USD summed from the raw responses (by separate code) with what was stored;
 *      checks the second poll added no rows, that no response was rejected as an unrecognised shape (and
 *      prints the exact top-level keys seen), that today's bucket has cost, and that every page was followed.
 *   4. Prints a PASS/FAIL report with the lines to paste into docs/RELEASE_CHECKLIST.md.
 *
 * Exit status: 0 = PASS, 1 = FAIL (or a WARN with --strict), 2 = bad usage / cannot start.
 *
 * Keys: read from ANTHROPIC_ADMIN_KEY / OPENAI_ADMIN_KEY in the environment ONLY. They are never accepted on
 * the command line, never printed, never written to a file (the temp database never receives them) and are
 * scrubbed from every error message this script prints.
 *
 * Testing without a key: the vendor base URLs can be redirected to a local fake server with
 * LLM_OBSERVER_ANTHROPIC_ADMIN_BASE_URL / LLM_OBSERVER_OPENAI_ADMIN_BASE_URL (see
 * tests/integration/admin-sync-validator.test.ts). Responses obtained that way are never written into the
 * repo's recorded/ directory (use --out-dir) and are labelled "NOT a vendor recording".
 *
 * Needs Node 18+ and a built proxy (packages/proxy/dist/syncValidate.js). No other dependencies.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'packages', 'proxy', 'dist', 'syncValidate.js');
const DEFAULT_RECORDED = path.join(ROOT, 'packages', 'proxy', 'src', '__tests__', 'fixtures', 'recorded');
const DEFAULT_DAYS = 3;
const MAX_DAYS = 31;
const USD_TOLERANCE = 1e-6;

const KEY_ENV = { anthropic: 'ANTHROPIC_ADMIN_KEY', openai: 'OPENAI_ADMIN_KEY' };
const DISPLAY = { anthropic: 'Anthropic', openai: 'OpenAI' };

const USAGE = `Usage: node scripts/validate-admin-sync.js [options]

Validates the Anthropic / OpenAI admin-API billing sync against a LIVE account (read-only).
Run "npm run build:ci" first.

Keys (environment only; never on the command line, never printed or written):
  ANTHROPIC_ADMIN_KEY   an Anthropic Admin API key
  OPENAI_ADMIN_KEY      an OpenAI Admin key
Either or both. Providers without a key are skipped.

Options:
  --days N        UTC days to fetch, including today (1-${MAX_DAYS}, default ${DEFAULT_DAYS}). Use 14 or more to make
                  the vendors paginate (Anthropic documents 7 daily buckets per page by default).
  --save          write the redacted raw responses to
                  packages/proxy/src/__tests__/fixtures/recorded/<provider>-<YYYY-MM-DD>/
  --out-dir DIR   write recordings under DIR instead (required with --save when a base URL override is set)
  --keep-db       keep the temporary SQLite database and print its path (for inspection)
  --strict        treat WARN as FAIL
  -h, --help      this text

Exit status: 0 PASS, 1 FAIL, 2 bad usage / cannot start.`;

// =============================================================================================
// Scrubbing (anything this script prints about errors goes through here)
// =============================================================================================

/** Returns a function that removes the given secrets and anything shaped like a key or bearer token. */
function makeScrubber(secrets) {
    const list = (secrets || []).filter((s) => typeof s === 'string' && s.length >= 4);
    return function scrub(text) {
        let t = String(text);
        for (const s of list) t = t.split(s).join('[redacted]');
        t = t.replace(/\bsk-[A-Za-z0-9_\-*.]{3,}/g, '[redacted]'); // sk-..., sk-ant-..., masked forms like sk-adm****wxyz
        t = t.replace(/(Bearer\s+)[^\s"',]+/gi, '$1[redacted]');
        t = t.replace(/(x-api-key["']?\s*[:=]\s*["']?)[^\s"',]+/gi, '$1[redacted]');
        return t;
    };
}

// =============================================================================================
// Redaction of recorded responses
// =============================================================================================

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEYLIKE_RE = /\bsk-[A-Za-z0-9_\-*.]{3,}/g;
const FT_RE = /ft:([^:,\s]+):([^:,\s]*):([^:,\s]*):([^:,\s]+)/g;
const FAKE_EMAIL_DOMAIN = '@example.invalid';

// String values under these keys are data the sync reads (model names, descriptions, units, timestamps,
// enum labels); they are kept (after scrubbing emails / keys / fine-tune ids out of them).
const KEEP_KEYS = new Set([
    'model', 'line_item', 'description', 'object', 'type', 'token_type', 'cost_type', 'currency',
    'service_tier', 'context_window', 'inference_geo', 'speed', 'bucket_width',
    'starting_at', 'ending_at', 'start_time', 'end_time',
]);
const PAGE_KEYS = new Set(['next_page', 'page', 'cursor', 'after', 'before', 'first_id', 'last_id']);
const IDENTIFYING_KEY_RE = /(^|_)(ids?|key|keys|token|secret|name|title|owner|org|organization|project|workspace|user|account)($|_)/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * A redactor keeps one mapping real value -> fake value for its whole life, so the same org/key/user id
 * gets the same fake everywhere (across results, pages and files). Unknown string fields are redacted by
 * default (privacy first); numbers, booleans, null, keys (the shape), model names, descriptions, units
 * and timestamps are kept.
 */
function createRedactor() {
    const maps = new Map(); // category -> Map(original -> n)
    const originals = new Set();
    const stats = {};

    function fake(category, original) {
        let m = maps.get(category);
        if (!m) { m = new Map(); maps.set(category, m); }
        let n = m.get(original);
        if (n === undefined) { n = m.size + 1; m.set(original, n); }
        originals.add(original);
        stats[category] = (stats[category] || 0) + 1;
        return n;
    }
    const fakeEmail = (e) => `user-${fake('email', e)}${FAKE_EMAIL_DOMAIN}`;

    function scrubText(s) {
        return s
            .replace(EMAIL_RE, (m) => fakeEmail(m))
            .replace(KEYLIKE_RE, (m) => `fake-key-${fake('key', m)}`)
            .replace(FT_RE, (m, base, org, suffix, id) =>
                `ft:${base}:org-fake-${fake('ft_org', org)}:name-fake-${fake('ft_name', suffix)}:id-fake-${fake('ft_id', id)}`);
    }

    function redactString(key, s) {
        if (/email/i.test(key)) return fakeEmail(s);
        if (PAGE_KEYS.has(key)) return `${key}_fake_${fake(key, s)}`;
        if (KEEP_KEYS.has(key)) return scrubText(s);
        if (IDENTIFYING_KEY_RE.test(key)) return `${key}_fake_${fake(key, s)}`;
        if (s === '' || DATE_RE.test(s) || NUMERIC_RE.test(s)) return scrubText(s);
        return `${key}_fake_${fake(key, s)}`;
    }

    function walk(value, key) {
        if (typeof value === 'string') return redactString(key, value);
        if (Array.isArray(value)) return value.map((v) => walk(v, key));
        if (value && typeof value === 'object') {
            const out = {};
            for (const k of Object.keys(value)) out[k] = walk(value[k], k);
            return out;
        }
        return value; // numbers, booleans, null: every number is kept
    }

    return {
        redact: (body) => walk(body, ''),
        stats: () => ({ ...stats }),
        /** Throws if `text` (serialised redacted output) still holds anything that should be gone. */
        verify(text, secrets) {
            const fail = (what) => { throw new Error(`redaction self-check failed: output still contains ${what}`); };
            for (const s of secrets || []) if (s && text.includes(s)) fail('an admin key');
            for (const o of originals) {
                if (!o) continue;
                const present = o.length >= 12 ? text.includes(o) : text.includes(JSON.stringify(o));
                if (present) fail('an original identifying value');
            }
            for (const m of text.match(EMAIL_RE) || []) if (!m.endsWith(FAKE_EMAIL_DOMAIN)) fail('an email address');
            if (/\bsk-[A-Za-z0-9_\-]{6,}/.test(text)) fail('a key-like string');
        },
    };
}

// =============================================================================================
// Independent reading of the raw responses (deliberately NOT the poller's normalisers)
// =============================================================================================

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(v) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
const dayOf = (iso) => String(iso).slice(0, 10);
const epochDay = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** Documented numeric usage fields the sync stores. Everything else numeric is listed as "not stored". */
const MAPPED_USAGE_FIELDS = {
    anthropic: new Set(['uncached_input_tokens', 'input_tokens', 'output_tokens', 'cache_read_input_tokens',
        'cache_creation.ephemeral_1h_input_tokens', 'cache_creation.ephemeral_5m_input_tokens', 'num_requests']),
    openai: new Set(['input_tokens', 'output_tokens', 'input_cached_tokens', 'num_model_requests']),
};

function numericLeaves(value, prefix, out) {
    if (typeof value === 'number') out.push([prefix, value]);
    else if (isObj(value)) for (const k of Object.keys(value)) numericLeaves(value[k], prefix ? `${prefix}.${k}` : k, out);
}

/** Per UTC day: token sums, models seen, plus numeric fields the sync does not store. */
function rawUsage(provider, pages) {
    const days = new Map();
    const notStored = new Map();
    let results = 0;
    const get = (d) => {
        let v = days.get(d);
        if (!v) { v = { i: 0, o: 0, cr: 0, cw: 0, models: new Set() }; days.set(d, v); }
        return v;
    };
    for (const body of pages) {
        if (!isObj(body) || !Array.isArray(body.data)) continue;
        for (const item of body.data) {
            if (!isObj(item)) continue;
            let when; let recs;
            if (provider === 'anthropic') {
                if (Array.isArray(item.results)) { when = item.starting_at; recs = item.results; } else { when = item.bucket_start; recs = [item]; }
            } else {
                when = typeof item.start_time === 'number' ? new Date(item.start_time * 1000).toISOString() : item.start_time;
                recs = Array.isArray(item.results) ? item.results : [item];
            }
            if (typeof when !== 'string') continue;
            const d = get(dayOf(when));
            for (const rec of recs) {
                if (!isObj(rec)) continue;
                results++;
                if (provider === 'anthropic') {
                    const cc = isObj(rec.cache_creation) ? rec.cache_creation : {};
                    d.i += num(rec.uncached_input_tokens !== undefined ? rec.uncached_input_tokens : rec.input_tokens);
                    d.o += num(rec.output_tokens);
                    d.cr += num(rec.cache_read_input_tokens);
                    d.cw += num(cc.ephemeral_1h_input_tokens) + num(cc.ephemeral_5m_input_tokens);
                } else {
                    d.i += num(rec.input_tokens);
                    d.o += num(rec.output_tokens);
                    d.cr += num(rec.input_cached_tokens);
                }
                d.models.add(typeof rec.model === 'string' && rec.model ? rec.model : 'unknown');
                const leaves = [];
                numericLeaves(rec, '', leaves);
                for (const [p, v] of leaves) {
                    if (!MAPPED_USAGE_FIELDS[provider].has(p) && v !== 0) notStored.set(p, (notStored.get(p) || 0) + v);
                }
            }
        }
    }
    return { days, results, notStored };
}

/** Per UTC day: all cost, cost attributable to a model, and cost per model (USD). */
function rawCost(provider, pages) {
    const days = new Map();
    const get = (d) => {
        let v = days.get(d);
        if (!v) { v = { all: 0, attributable: 0, models: new Map() }; days.set(d, v); }
        return v;
    };
    const add = (day, model, usd) => {
        const d = get(day);
        d.all += usd;
        if (model) { d.attributable += usd; d.models.set(model, (d.models.get(model) || 0) + usd); }
    };
    for (const body of pages) {
        if (!isObj(body) || !Array.isArray(body.data)) continue;
        for (const item of body.data) {
            if (!isObj(item)) continue;
            if (provider === 'anthropic') {
                const modelOf = (r) => {
                    if (r.model) return r.model;
                    const m = typeof r.description === 'string' ? r.description.match(/claude-[\w.-]+/i) : null;
                    return m ? m[0].toLowerCase() : null;
                };
                if (Array.isArray(item.results) && typeof item.starting_at === 'string') {
                    for (const r of item.results) if (isObj(r)) add(dayOf(item.starting_at), modelOf(r), num(r.amount) / 100); // cents -> USD
                } else if (typeof item.start_time === 'string') {
                    add(dayOf(item.start_time), modelOf(item), num(item.cost)); // legacy flat shape is USD
                }
            } else {
                const lineModel = (r) => (typeof r.line_item === 'string' && r.line_item ? r.line_item.split(',')[0].trim() : null);
                const valueOf = (r) => (isObj(r.amount) ? num(r.amount.value) : 0); // dollars
                if (typeof item.start_time !== 'number') continue;
                if (Array.isArray(item.results)) {
                    for (const r of item.results) if (isObj(r)) add(epochDay(item.start_time), lineModel(r), valueOf(r));
                } else {
                    add(epochDay(item.start_time), lineModel(item), valueOf(item));
                }
            }
        }
    }
    return { days, hasData: days.size > 0 };
}

// =============================================================================================
// Exchanges (what the real poller requested and received)
// =============================================================================================

function reportKind(exchange) {
    let p = '';
    try { p = new URL(exchange.url).pathname; } catch { p = exchange.url; }
    if (/\/usage_report\/messages$|\/usage\/completions$/.test(p)) return 'usage';
    if (/\/cost_report$|\/organization\/costs$/.test(p)) return 'cost';
    return 'other';
}

function parseJson(text) {
    try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false, value: undefined }; }
}

function topLevelKeys(parsed) {
    if (!parsed.ok) return '(not JSON)';
    const v = parsed.value;
    if (isObj(v)) return Object.keys(v).join(', ') || '(empty object)';
    if (Array.isArray(v)) return '(array)';
    return `(${v === null ? 'null' : typeof v})`;
}

const is2xx = (e) => e.status !== null && e.status >= 200 && e.status < 300;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// =============================================================================================
// Reading the temp database
// =============================================================================================

function readStored(db, provider, today) {
    const byDay = new Map();
    const dayRows = db.prepare(
        `SELECT date(bucket_start) AS day, COUNT(*) AS n, SUM(input_tokens) AS i, SUM(output_tokens) AS o,
                SUM(cache_read_tokens) AS cr, SUM(cache_write_tokens) AS cw, SUM(COALESCE(cost_usd, 0)) AS usd
         FROM usage_records WHERE provider = ? GROUP BY date(bucket_start)`).all(provider);
    for (const r of dayRows) byDay.set(r.day, { n: r.n, i: r.i || 0, o: r.o || 0, cr: r.cr || 0, cw: r.cw || 0, usd: r.usd || 0, models: new Set() });
    const rows = db.prepare(
        `SELECT date(bucket_start) AS day, model, input_tokens + output_tokens + cache_read_tokens + cache_write_tokens AS tokens, cost_usd
         FROM usage_records WHERE provider = ?`).all(provider);
    const nullCost = [];
    for (const r of rows) {
        byDay.get(r.day).models.add(r.model);
        if (r.cost_usd === null && r.tokens > 0 && r.day !== today) nullCost.push({ day: r.day, model: r.model });
    }
    return { count: rows.length, byDay, nullCost };
}

// =============================================================================================
// Evaluating one provider
// =============================================================================================

function fmtTokens(d) { return `${d.i}/${d.o}/${d.cr}/${d.cw}`; }
function fmtUsd(v) { return v.toFixed(6); }
function truncate(s, n) { return s.length > n ? `${s.slice(0, n)}...` : s; }

function explainHttp(provider, kind, e, scrub) {
    const label = `${kind} report`;
    if (e.status === null) return `${label}: network error: ${scrub(e.error || 'request failed')}`;
    const body = scrub(truncate(e.bodyText.replace(/\s+/g, ' ').trim(), 160));
    let hint = '';
    if (e.status === 401) hint = ' The admin key was rejected (key was rejected: wrong key type, revoked, or pasted incorrectly; it must be an ADMIN key).';
    else if (e.status === 403) hint = ' Access denied: this key or role cannot read usage/cost data (admin keys need an organisation Owner/Admin).';
    else if (e.status === 404 && provider === 'openai' && kind === 'cost') hint = ' The poller then falls back to ESTIMATED costs from token counts, which are not the vendor\'s numbers.';
    else if (kind === 'cost') hint = ' The poller ignores a failed cost report and carries on, so no costs were stored.';
    return `${label}: HTTP ${e.status}${body ? ` ${body}` : ''}.${hint}`;
}

function evaluateProvider(ctx) {
    const { provider, exchanges1, error1, error2, stored1, stored2, today, scrub, days } = ctx;
    const checks = [];
    const push = (name, status, detail) => checks.push({ name, status, detail });
    const byKind = (list, kind) => list.filter((e) => reportKind(e) === kind);
    const usageEx = byKind(exchanges1, 'usage');
    const costEx = byKind(exchanges1, 'cost');
    const SyncShapeError = ctx.mod.SyncShapeError;

    // -- requests ---------------------------------------------------------------------------
    const failed = exchanges1.filter((e) => !is2xx(e));
    if (!exchanges1.length) {
        push('Requests succeeded', 'FAIL', error1 ? scrub(`no request was made: ${error1.message}`) : 'no request was made');
    } else if (failed.length) {
        const first = failed[0];
        push('Requests succeeded', 'FAIL', `${plural(exchanges1.length, 'request')}, ${failed.length} failed. ${explainHttp(provider, reportKind(first), first, scrub)}`);
    } else {
        push('Requests succeeded', 'PASS', `${plural(exchanges1.length, 'request')}, all HTTP ${[...new Set(exchanges1.map((e) => e.status))].join('/')}`);
    }

    // -- shape ------------------------------------------------------------------------------
    const parsed = (list) => list.filter(is2xx).map((e) => ({ e, p: parseJson(e.bodyText) }));
    const usageParsed = parsed(usageEx);
    const costParsed = parsed(costEx);
    const keyLines = [];
    usageParsed.forEach((x, i) => keyLines.push(`usage page ${i + 1}: ${topLevelKeys(x.p)}`));
    costParsed.forEach((x, i) => keyLines.push(`cost page ${i + 1}: ${topLevelKeys(x.p)}`));
    const notJson = [...usageParsed.map((x) => ['usage', x]), ...costParsed.map((x) => ['cost', x])].find(([, x]) => !x.p.ok);
    if (error1 && SyncShapeError && error1 instanceof SyncShapeError) {
        const list = error1.report === 'usage' ? usageParsed : costParsed;
        push('Response shape recognised', 'FAIL', `${scrub(error1.message)}; top-level keys seen (${error1.report} page ${list.length}): ${list.length ? topLevelKeys(list[list.length - 1].p) : '(none)'}. The poller stores nothing and shows a sync error.`);
    } else if (notJson) {
        const [kind, x] = notJson;
        const idx = (kind === 'usage' ? usageParsed : costParsed).indexOf(x) + 1;
        push('Response shape recognised', 'FAIL', `${kind} page ${idx} is not JSON (HTTP ${x.e.status}); top-level keys seen (${kind} page ${idx}): (not JSON)`);
    } else if (!usageParsed.length && !costParsed.length) {
        push('Response shape recognised', 'SKIP', 'no successful response to check');
    } else {
        push('Response shape recognised', 'PASS', keyLines.join('; '));
    }

    // -- pagination -------------------------------------------------------------------------
    const pagingProblems = [];
    const pageCounts = {};
    for (const [kind, list] of [['usage', usageEx], ['cost', costEx]]) {
        const ok = list.filter(is2xx);
        pageCounts[kind] = ok.length;
        const seen = new Set();
        ok.forEach((e, i) => {
            const body = parseJson(e.bodyText);
            if (!body.ok || !isObj(body.value)) return;
            const more = body.value.has_more === true;
            const next = body.value.next_page;
            const last = i === ok.length - 1 && ok.length === list.length;
            if (more && (typeof next !== 'string' || !next)) {
                pagingProblems.push(`${kind} page ${i + 1} says has_more but gives no next_page (the poller stops here and never fetches the rest)`);
            } else if (more && last) {
                pagingProblems.push(`${kind} page ${i + 1} says has_more but no further page was requested`);
            } else if (more) {
                if (seen.has(next)) pagingProblems.push(`${kind} returned the same next_page twice`);
                seen.add(next);
                const nextUrl = list[i + 1] && list[i + 1].url;
                if (!nextUrl || !nextUrl.includes(`page=${encodeURIComponent(next)}`)) {
                    pagingProblems.push(`${kind} page ${i + 2} was not requested with page=<next_page>`);
                }
            }
        });
    }
    if (!exchanges1.length || failed.length && !pageCounts.usage && !pageCounts.cost) {
        push('Pagination followed', 'SKIP', 'no successful response');
    } else if (pagingProblems.length) {
        push('Pagination followed', 'FAIL', pagingProblems.join('; '));
    } else {
        const exercised = pageCounts.usage > 1 || pageCounts.cost > 1;
        push('Pagination followed', 'PASS', `usage: ${plural(pageCounts.usage || 0, 'page')}; cost: ${plural(pageCounts.cost || 0, 'page')}${exercised ? ' (every has_more page was followed)' : `; pagination was not exercised by ${days} day(s), use --days 14 or more to make the vendor paginate`}`);
    }

    // -- rows -------------------------------------------------------------------------------
    const usagePages = usageParsed.filter((x) => x.p.ok).map((x) => x.p.value);
    const costPages = costParsed.filter((x) => x.p.ok).map((x) => x.p.value);
    const ru = rawUsage(provider, usagePages);
    const rc = rawCost(provider, costPages);

    if (stored1.count === 0) {
        const emptyOk = !error1 && !failed.length && ru.results === 0;
        push('Rows stored', 'FAIL', `0 usage_records rows${emptyOk ? `: the vendor returned no usage in the last ${days} day(s), so nothing was validated (use --days, or make a request first)` : ''}`);
    } else {
        push('Rows stored', 'PASS', `${plural(stored1.count, 'usage_records row')} after poll 1 (${plural(ru.results, 'usage result')} in the raw responses)`);
    }

    // -- per-day tokens and USD ---------------------------------------------------------------
    const dayKeys = [...new Set([...ru.days.keys(), ...rc.days.keys(), ...stored1.byDay.keys()])].sort();
    const dayTable = [];
    const tokenProblems = [];
    const usdFail = [];
    const usdWarn = [];
    for (const d of dayKeys) {
        const raw = ru.days.get(d) || { i: 0, o: 0, cr: 0, cw: 0, models: new Set() };
        const st = stored1.byDay.get(d) || { n: 0, i: 0, o: 0, cr: 0, cw: 0, usd: 0, models: new Set() };
        const cost = rc.days.get(d) || { all: 0, attributable: 0, models: new Map() };
        const tokensOk = raw.i === st.i && raw.o === st.o && raw.cr === st.cr && raw.cw === st.cw;
        const usdOk = Math.abs(cost.attributable - st.usd) <= USD_TOLERANCE;
        const unattributed = cost.all - cost.attributable;
        let status = 'PASS';
        if (!tokensOk) { status = 'FAIL'; tokenProblems.push(`${d}: raw ${fmtTokens(raw)} vs stored ${fmtTokens(st)}`); }
        if (!usdOk) {
            status = 'FAIL';
            const orphans = [...cost.models.keys()].filter((m) => !st.models.has(m));
            usdFail.push(`${d}: stored ${fmtUsd(st.usd)} vs raw ${fmtUsd(cost.attributable)}${orphans.length ? `; cost lines naming no stored usage model: ${orphans.join(', ')}` : ''}`);
        } else if (Math.abs(unattributed) > USD_TOLERANCE) {
            if (status === 'PASS') status = 'WARN';
            usdWarn.push(`${d}: ${unattributed.toFixed(2)} USD in cost lines with no model (web search, code execution, ...) is not attributed to any row`);
        }
        if (raw.i + raw.o + raw.cr + raw.cw + cost.all + st.n + st.usd === 0) continue;
        dayTable.push({ day: d, raw: fmtTokens(raw), stored: fmtTokens(st), rawUsd: fmtUsd(cost.all), storedUsd: fmtUsd(st.usd), status });
    }
    if (!dayKeys.length || !stored1.count) {
        push('Tokens per day match the raw responses', 'SKIP', 'nothing stored to compare');
        push('USD per day match the raw responses', 'SKIP', 'nothing stored to compare');
    } else {
        push('Tokens per day match the raw responses', tokenProblems.length ? 'FAIL' : 'PASS',
            tokenProblems.length ? tokenProblems.join('; ') : `${plural(dayTable.length, 'day')} compared (input/output/cache-read/cache-write)`);
        if (usdFail.length) push('USD per day match the raw responses', 'FAIL', usdFail.join('; '));
        else if (usdWarn.length) push('USD per day match the raw responses', 'WARN', usdWarn.join('; '));
        else if (!rc.hasData) push('USD per day match the raw responses', 'WARN', 'the cost report returned no data to compare');
        else push('USD per day match the raw responses', 'PASS', `${plural(dayTable.length, 'day')} compared (${provider === 'anthropic' ? 'Anthropic amounts are cents and were divided by 100' : 'OpenAI amounts are dollars'})`);
    }

    // -- cost stamped on rows ------------------------------------------------------------------
    if (!stored1.count) {
        push('Cost stamped on every usage row', 'SKIP', 'no rows');
    } else if (stored1.nullCost.length) {
        const unmatched = new Set();
        for (const [d, c] of rc.days) {
            const st = stored1.byDay.get(d);
            for (const m of c.models.keys()) if (!st || !st.models.has(m)) unmatched.add(m);
        }
        const sample = stored1.nullCost.slice(0, 5).map((r) => `${r.day} ${r.model}`).join(', ');
        push('Cost stamped on every usage row', 'FAIL',
            `${stored1.nullCost.length} of ${plural(stored1.count, 'row')} have no cost (${sample}${stored1.nullCost.length > 5 ? ', ...' : ''})${unmatched.size ? `; cost lines naming no stored usage model: ${[...unmatched].join(', ')}` : ''}`);
    } else {
        push('Cost stamped on every usage row', 'PASS', 'every row with tokens outside today has a cost');
    }

    // -- today ----------------------------------------------------------------------------------
    const todayStored = stored1.byDay.get(today);
    const todayCost = rc.days.get(today);
    if (!stored1.count) {
        push("Today's bucket has cost", 'SKIP', 'no rows');
    } else if (!todayStored) {
        push("Today's bucket has cost", 'WARN', `no usage for today (${today}, UTC) in the window, so today's cost could not be checked; make a request with this organisation and run again`);
    } else if (todayStored.usd > 0 && todayCost && todayCost.attributable > 0) {
        push("Today's bucket has cost", 'PASS', `today (${today}): ${fmtUsd(todayStored.usd)} USD stored from ${fmtUsd(todayCost.attributable)} USD in the cost report`);
    } else {
        push("Today's bucket has cost", 'WARN', `today (${today}) has usage but no cost yet; the vendor may report today's cost late, check again later`);
    }

    // -- idempotency ---------------------------------------------------------------------------
    if (error1) {
        push('Second poll adds no rows', 'SKIP', 'the first poll failed');
    } else if (error2) {
        push('Second poll adds no rows', 'FAIL', scrub(`the second poll failed: ${error2.message}`));
    } else {
        const added = stored2.count - stored1.count;
        push('Second poll adds no rows', added === 0 ? 'PASS' : 'FAIL',
            `second poll added ${plural(added, 'row')} (${stored1.count} -> ${stored2.count}); the second poll re-requests the same window, stricter than the app, which resumes from its checkpoint`);
    }

    // -- numeric fields not stored (information) ------------------------------------------------
    if (ru.notStored.size) {
        push('Usage fields not stored', 'INFO', [...ru.notStored.entries()].map(([k, v]) => `${k} (sum ${v})`).join(', '));
    }

    return { checks, dayTable, pageCounts, rows: stored1.count, days: dayTable.length };
}

function providerStatus(checks, strict) {
    if (checks.some((c) => c.status === 'FAIL')) return 'FAIL';
    if (strict && checks.some((c) => c.status === 'WARN')) return 'FAIL';
    return 'PASS';
}

// =============================================================================================
// Recording
// =============================================================================================

/** Writes redacted responses; returns { dir, files, error }. Never throws. */
function saveRecordings(opts) {
    const { provider, exchanges, outDir, today, secrets, scrub, meta } = opts;
    const dir = path.join(outDir, `${provider}-${today}`);
    try {
        const redactor = createRedactor();
        const files = [];
        const counters = { usage: 0, cost: 0 };
        const staged = [];
        for (const e of exchanges) {
            const kind = reportKind(e);
            if (kind === 'other' || !is2xx(e)) continue;
            const parsed = parseJson(e.bodyText);
            if (!parsed.ok) continue; // cannot be redacted structurally; not saved
            counters[kind]++;
            const text = JSON.stringify(redactor.redact(parsed.value), null, 2) + '\n';
            redactor.verify(text, secrets);
            staged.push([`${kind}-${counters[kind]}.json`, text]);
        }
        const metaText = JSON.stringify({ ...meta, redaction: redactor.stats() }, null, 2) + '\n';
        redactor.verify(metaText, secrets);
        staged.push(['meta.json', metaText]);

        fs.mkdirSync(dir, { recursive: true });
        for (const old of fs.readdirSync(dir)) if (/^(usage|cost)-\d+\.json$|^meta\.json$/.test(old)) fs.rmSync(path.join(dir, old));
        for (const [name, text] of staged) { fs.writeFileSync(path.join(dir, name), text, { mode: 0o644 }); files.push(name); }
        return { dir, files, error: null };
    } catch (err) {
        return { dir, files: [], error: scrub(err && err.message ? err.message : String(err)) };
    }
}

// =============================================================================================
// Report
// =============================================================================================

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function renderProvider(r) {
    const lines = [];
    lines.push(`## ${DISPLAY[r.provider]}: ${r.status}`, '');
    lines.push('| Check | Result | Detail |', '|---|---|---|');
    for (const c of r.checks) lines.push(`| ${c.name} | ${c.status} | ${esc(c.detail)} |`);
    if (r.dayTable.length) {
        lines.push('', `### Per-day totals, poll 1 (tokens are input/output/cache-read/cache-write${r.provider === 'openai' ? '; OpenAI input already includes the cached tokens' : ''})`, '');
        lines.push('| Day (UTC) | Raw tokens | Stored tokens | Raw USD | Stored USD | Match |', '|---|---|---|---|---|---|');
        for (const d of r.dayTable) lines.push(`| ${d.day} | ${d.raw} | ${d.stored} | ${d.rawUsd} | ${d.storedUsd} | ${d.status} |`);
    }
    if (r.pollerLog.length) {
        lines.push('', '### What the real poller code logged', '', '```');
        for (const l of r.pollerLog.slice(0, 20)) lines.push(l);
        lines.push('```');
    }
    lines.push('');
    return lines.join('\n');
}

function repoRelative(p) {
    const rel = path.relative(ROOT, p);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : p;
}

function renderReport(ctx) {
    const { results, today, startDay, days, version, baseNotes, opts, notRun, tempDbPath, anyOverride } = ctx;
    const overall = results.some((r) => r.status === 'FAIL') ? 'FAIL' : 'PASS';
    const out = [];
    out.push(`# Admin-API sync validation: ${overall}`, '');
    if (anyOverride) {
        out.push('> NOT A LIVE-VENDOR RUN. A base URL override is set, so these responses did not come from Anthropic or OpenAI. This result proves nothing about the real APIs and must not be recorded in docs/RELEASE_CHECKLIST.md.', '');
    }
    out.push(`- Run: ${new Date().toISOString()} (UTC). Window: ${days} UTC day${days === 1 ? '' : 's'}, ${startDay} to ${today} (--days ${days}).`);
    out.push(`- Tool: scripts/validate-admin-sync.js, llm-observer proxy ${version}, Node ${process.version}.`);
    out.push(`- Base URLs: ${baseNotes.join('; ')}.`);
    out.push('- Keys: read from the environment only; never printed or written. Requests are read-only GETs.');
    if (opts.strict) out.push('- --strict: WARN counts as FAIL.');
    if (tempDbPath) out.push(`- Temporary database kept at ${tempDbPath} (--keep-db).`);
    out.push('');
    for (const r of results) out.push(renderProvider(r));
    for (const p of notRun) out.push(`## ${DISPLAY[p]}: not run`, '', `${KEY_ENV[p]} is not set.`, '');

    // Lines for docs/RELEASE_CHECKLIST.md
    const cell = (p) => {
        const r = results.find((x) => x.provider === p);
        if (!r) return 'not run';
        if (r.status === 'PASS') {
            const warns = r.checks.filter((c) => c.status === 'WARN').map((c) => c.name);
            return `PASS (${plural(r.days, 'day')}, ${plural(r.rows, 'row')}, tokens and attributable USD match the raw responses${warns.length ? `; WARN: ${warns.join(', ')}` : ''})`;
        }
        const bad = r.checks.filter((c) => c.status === 'FAIL' || (opts.strict && c.status === 'WARN')).map((c) => c.name);
        return `FAIL (${bad.join(', ')})`;
    };
    const notes = [`validate-admin-sync.js ${version}`];
    const savedDirs = results.filter((r) => r.recording && r.recording.files.length && !r.recording.error).map((r) => repoRelative(r.recording.dir));
    if (savedDirs.length) notes.push(`recordings: ${savedDirs.join(', ')}`);
    out.push('## Lines to paste into docs/RELEASE_CHECKLIST.md', '');
    if (anyOverride) {
        out.push('Nothing to paste: this was not a live-vendor run (base URL override).', '');
    } else {
        out.push('Replace `<your name>`, then add this row to the table in "Admin-API billing sync: live-key validation":', '');
        out.push('```', `| ${today} | <your name> | ${cell('anthropic')} | ${cell('openai')} | ${notes.join('; ')} |`, '```', '');
    }
    const openai = results.find((r) => r.provider === 'openai');
    if (openai) {
        const stamped = openai.checks.find((c) => c.name === 'Cost stamped on every usage row');
        out.push('Step 5 answers to record in Notes:', '');
        out.push(`- OpenAI cost \`line_item\` names match the usage \`model\` names: ${stamped && stamped.status === 'PASS' ? 'yes' : stamped && stamped.status === 'FAIL' ? 'NO (see the check above)' : 'not determined'}.`);
        out.push('');
    }
    const saved = results.filter((r) => r.recording && r.recording.files.length && !r.recording.error);
    if (anyOverride) {
        // Nothing to commit: these are not vendor recordings.
    } else if (saved.length) {
        out.push('Commit the recordings (check `git diff --cached` first):', '', '```');
        out.push(`git add ${saved.map((r) => repoRelative(r.recording.dir)).join(' ')}`);
        out.push('```', '');
    } else if (!opts.save) {
        out.push('No recordings were saved. Re-run with `--save` to write the redacted responses to the recorded/ fixtures directory.', '');
    }
    out.push('### Still manual', '');
    out.push('- Compare the per-day USD above (Raw USD column) with the Anthropic Console cost page and the OpenAI costs dashboard for the same UTC days. This script proves the app stored what the API said; only that comparison shows the API matches your invoice.');
    out.push(`- Overall: ${overall}.`, '');
    return out.join('\n');
}

// =============================================================================================
// Command line
// =============================================================================================

class UsageError extends Error {}

function parseArgs(argv) {
    const opts = { days: DEFAULT_DAYS, save: false, outDir: null, keepDb: false, strict: false, help: false };
    const keyNote = 'Admin keys are read from the environment only (ANTHROPIC_ADMIN_KEY / OPENAI_ADMIN_KEY), never from the command line.';
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const flag = a.startsWith('-') ? a.split('=')[0] : null;
        switch (flag) {
            case '-h': case '--help': opts.help = true; break;
            case '--save': opts.save = true; break;
            case '--keep-db': opts.keepDb = true; break;
            case '--strict': opts.strict = true; break;
            case '--days': {
                const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
                if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > MAX_DAYS) {
                    throw new UsageError(`--days must be a whole number from 1 to ${MAX_DAYS}`);
                }
                opts.days = Number(v);
                break;
            }
            case '--out-dir': {
                const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
                if (!v) throw new UsageError('--out-dir needs a directory');
                opts.outDir = path.resolve(v);
                break;
            }
            default:
                if (flag) throw new UsageError(`unknown option ${flag}. ${keyNote}`);
                throw new UsageError(`unexpected argument. ${keyNote}`);
        }
    }
    return opts;
}

function readKeys(env) {
    const keys = {};
    for (const p of Object.keys(KEY_ENV)) {
        const raw = env[KEY_ENV[p]];
        if (raw === undefined || raw === '') continue;
        const k = raw.trim();
        if (!k) continue;
        if (/[\s\x00-\x1f]/.test(k)) throw new UsageError(`${KEY_ENV[p]} contains whitespace or control characters`);
        keys[p] = k;
    }
    return keys;
}

function utcMidnight(offsetDays, now) {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime() + offsetDays * 86400000;
}

async function main(argv, env) {
    let opts;
    try { opts = parseArgs(argv); } catch (e) {
        process.stderr.write(`Error: ${e.message}\n\n${USAGE}\n`);
        return 2;
    }
    if (opts.help) { process.stdout.write(`${USAGE}\n`); return 0; }

    let keys;
    try { keys = readKeys(env); } catch (e) { process.stderr.write(`Error: ${e.message}\n`); return 2; }
    const providers = Object.keys(keys);
    if (!providers.length) {
        process.stderr.write(`Error: no admin key found in the environment. Set ANTHROPIC_ADMIN_KEY and/or OPENAI_ADMIN_KEY (environment only), then run again.\n\n${USAGE}\n`);
        return 2;
    }
    const secrets = Object.values(keys);
    const scrub = makeScrubber(secrets);

    let mod;
    try {
        if (!fs.existsSync(DIST)) throw new Error(`${repoRelative(DIST)} not found. Run "npm run build:ci" first.`);
        // Keep anything the app code touches away from the real home directory.
        const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-admin-sync-'));
        process.env.HOME = sandbox;
        process.env.USERPROFILE = sandbox;
        process.env.LLM_OBSERVER_DATA_DIR = sandbox;
        process.env.LLM_OBSERVER_SKIP_MIGRATION_BACKUP = '1';
        main.sandbox = sandbox;
        mod = require(DIST);
    } catch (e) {
        process.stderr.write(`Error: ${scrub(e.message)}\n`);
        return 2;
    }
    const cleanup = () => {
        try { mod && mod.closeDb(); } catch { /* ignore */ }
        if (main.sandbox && !opts.keepDb) { try { fs.rmSync(main.sandbox, { recursive: true, force: true }); } catch { /* ignore */ } }
    };

    // Base URLs (also refuses plain http to a non-loopback host before any request is made).
    const baseNotes = [];
    let anyOverride = false;
    for (const p of providers) {
        try {
            const base = mod.adminBaseUrl(p);
            const overridden = mod.isBaseUrlOverridden(p);
            anyOverride = anyOverride || overridden;
            baseNotes.push(`${DISPLAY[p]} ${overridden ? 'OVERRIDDEN to a non-vendor URL' : `${base} (default)`}`);
        } catch (e) {
            process.stderr.write(`Error: ${scrub(e.message)}\n`);
            cleanup();
            return 2;
        }
    }
    for (const p of Object.keys(KEY_ENV)) if (!keys[p]) baseNotes.push(`${DISPLAY[p]} not run`);

    if (opts.save && !opts.outDir && anyOverride) {
        process.stderr.write('Error: a base URL override is set, so the responses are not from a vendor. Refusing to write them into the recorded/ fixtures directory (it must only hold real recordings). Pass --out-dir DIR to save elsewhere.\n');
        cleanup();
        return 2;
    }
    const outDir = opts.outDir || DEFAULT_RECORDED;

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const startMs = utcMidnight(-(opts.days - 1), now);
    const startDay = new Date(startMs).toISOString().slice(0, 10);
    const version = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'proxy', 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();

    // Anything the app code prints (migrations, pollers) goes into the report, scrubbed, not onto the terminal.
    const captured = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const capture = (...args) => {
        const line = scrub(args.map((a) => (typeof a === 'string' ? a : (a && a.message) || String(a))).join(' '));
        if (/DeprecationWarning|--trace-deprecation|^Migration applied:/.test(line)) return;
        captured.push(line);
    };

    // Temp database; the real pollers write here.
    let db;
    let tempDbPath = null;
    console.log = console.warn = console.error = capture;
    try {
        mod.initDb(path.join(main.sandbox, 'data.db'));
        db = mod.getDb();
        if (opts.keepDb) tempDbPath = path.join(main.sandbox, 'data.db');
    } catch (e) {
        console.log = original.log; console.warn = original.warn; console.error = original.error;
        process.stderr.write(`Error: could not open the temporary database: ${scrub(e.message)}\n`);
        cleanup();
        return 2;
    } finally {
        console.log = original.log; console.warn = original.warn; console.error = original.error;
    }

    const results = [];
    try {
        for (const provider of providers) {
            captured.length = 0;
            console.log = console.warn = console.error = capture;
            const exchanges1 = [];
            let error1 = null;
            let error2 = null;
            let stored2 = null;
            try { await mod.runProviderSync(provider, keys[provider], { startMs }, mod.createRecordingFetch((e) => exchanges1.push(e))); } catch (e) { error1 = e; }
            const stored1 = readStored(db, provider, today);
            if (!error1) {
                try { await mod.runProviderSync(provider, keys[provider], { startMs }, mod.createRecordingFetch(() => { /* poll 2 requests are not kept */ })); } catch (e) { error2 = e; }
                stored2 = readStored(db, provider, today);
            }
            console.log = original.log; console.warn = original.warn; console.error = original.error;

            const ev = evaluateProvider({ provider, exchanges1, error1, error2, stored1, stored2, today, scrub, days: opts.days, mod });

            let recording = null;
            if (opts.save) {
                const overridden = mod.isBaseUrlOverridden(provider);
                recording = saveRecordings({
                    provider, exchanges: exchanges1, outDir, today, secrets, scrub,
                    meta: {
                        provider,
                        recorded_on: today,
                        recorded_by: 'scripts/validate-admin-sync.js',
                        tool_version: version,
                        node: process.version,
                        window_days: opts.days,
                        window_start: startDay,
                        source: overridden
                            ? 'NOT a vendor recording: responses came from a base URL override (a local fake server or gateway)'
                            : 'vendor API, live admin key, read-only GET requests; identifying values redacted, every number and the shape unmodified',
                        pages: ev.pageCounts,
                        http_statuses: exchanges1.map((e) => e.status),
                        result: providerStatus(ev.checks, opts.strict),
                    },
                });
                if (recording.error) ev.checks.push({ name: 'Recordings saved', status: 'FAIL', detail: `${recording.error}; nothing was written for the file that failed` });
                else ev.checks.push({ name: 'Recordings saved', status: 'PASS', detail: `${plural(recording.files.length, 'file')} in ${repoRelative(recording.dir)} (redacted)` });
            }
            results.push({ provider, ...ev, status: providerStatus(ev.checks, opts.strict), recording, pollerLog: captured.slice() });
        }
    } finally {
        console.log = original.log; console.warn = original.warn; console.error = original.error;
    }

    const notRun = Object.keys(KEY_ENV).filter((p) => !keys[p]);
    const report = scrub(renderReport({ results, today, startDay, days: opts.days, version, baseNotes, opts, notRun, tempDbPath, anyOverride }));
    cleanup();
    process.stdout.write(`${report}\n`);
    return results.some((r) => r.status === 'FAIL') ? 1 : 0;
}

module.exports = { createRedactor, makeScrubber, rawUsage, rawCost, parseArgs, renderReport };

if (require.main === module) {
    main(process.argv.slice(2), process.env).then(
        (code) => { process.exitCode = code; },
        (err) => {
            // Last resort. Never print a stack (it can embed request details); scrub what we do print.
            const keys = [process.env.ANTHROPIC_ADMIN_KEY, process.env.OPENAI_ADMIN_KEY].filter(Boolean).map((k) => k.trim());
            process.stderr.write(`Error: ${makeScrubber(keys)(err && err.message ? err.message : String(err))}\n`);
            process.exitCode = 2;
        },
    );
}
