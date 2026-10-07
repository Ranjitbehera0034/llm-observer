#!/usr/bin/env node
/**
 * Packed-artifact smoke test.
 *
 * Builds the CLI, `npm pack`s it, installs the tarball into an empty temp
 * directory (the way a user's `npm install -g llm-observer` would), boots
 * `llm-observer start` on free ports against a throwaway HOME and data dir,
 * polls /health, exercises the AI Analyst against a local mock Anthropic API, then shuts it down with SIGINT, SIGTERM and `llm-observer stop`.
 *
 * It exists because the v2.0.0/2.0.1 tarballs crashed on first run with
 * MODULE_NOT_FOUND for a dependency that was bundled as external but never
 * declared -- something no test of the monorepo working tree can see.
 *
 * Usage:
 *   node scripts/smoke-pack.js                    build, pack, install, boot
 *   node scripts/smoke-pack.js --skip-build       reuse existing dist/ output
 *   node scripts/smoke-pack.js --tarball <file>   smoke an already-packed .tgz
 *   node scripts/smoke-pack.js --keep             keep the temp dirs for debugging
 *
 * Environment:
 *   SMOKE_PORT_MIN / SMOKE_PORT_MAX   pick the two ports from this range
 *                                     (default: any free port the OS hands out)
 *
 * Never touches real data: HOME, USERPROFILE and LLM_OBSERVER_DATA_DIR all
 * point into a fresh temp directory, and no API keys are passed through.
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { builtinModules } = require('module');

const ROOT = path.resolve(__dirname, '..');
const CLI_DIR = path.join(ROOT, 'packages', 'cli');
const IS_WIN = process.platform === 'win32';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

// Externals that are only loaded on demand and are deliberately not declared as
// CLI dependencies.
// encoding: node-fetch v2 does `try { require("encoding") } catch {}`.
// (The AI Analyst calls the Anthropic API with fetch and has no SDK, so
// @anthropic-ai/sdk reappearing in the bundle fails the undeclared-externals check.)
const LAZY_OPTIONAL_EXTERNALS = new Set(['encoding']);

const log = (msg) => console.log(`[smoke-pack] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, cmdArgs, opts = {}) {
    const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', shell: IS_WIN, ...opts });
    if (res.status !== 0) {
        const out = `${res.stdout || ''}${res.stderr || ''}`;
        throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (exit ${res.status})\n${out}`);
    }
    return res.stdout;
}

function freePort() {
    const min = parseInt(process.env.SMOKE_PORT_MIN || '', 10);
    const max = parseInt(process.env.SMOKE_PORT_MAX || '', 10);
    const tryPort = (port) => new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(null));
        srv.listen(port, '127.0.0.1', () => {
            const { port: bound } = srv.address();
            srv.close(() => resolve(bound));
        });
    });
    return (async () => {
        if (min && max && max >= min) {
            for (let i = 0; i < 200; i++) {
                const candidate = min + Math.floor(Math.random() * (max - min + 1));
                const got = await tryPort(candidate);
                if (got) return got;
            }
            throw new Error(`no free port in ${min}-${max}`);
        }
        return tryPort(0);
    })();
}

function httpGet(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode);
        });
        req.on('error', () => resolve(0));
        req.on('timeout', () => { req.destroy(); resolve(0); });
    });
}

/** Minimal JSON request helper; resolves { status, body } (status 0 on connection failure). */
function httpJson(method, url, payload) {
    return new Promise((resolve) => {
        const data = payload === undefined ? null : JSON.stringify(payload);
        const req = http.request(url, {
            method,
            timeout: 20000,
            headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
        }, (res) => {
            let text = '';
            res.on('data', (d) => { text += d; });
            res.on('end', () => {
                let body = null;
                try { body = JSON.parse(text); } catch { /* not JSON */ }
                resolve({ status: res.statusCode, body });
            });
        });
        req.on('error', () => resolve({ status: 0, body: null }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null }); });
        if (data) req.write(data);
        req.end();
    });
}

function isAlive(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(fn, ms, stepMs = 250) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const v = await fn();
        if (v) return v;
        await sleep(stepMs);
    }
    return null;
}

/** Every bare require() in the bundles must be declared by the packed package.json. */
function findUndeclaredExternals(pkgDir, manifest) {
    const declared = new Set([
        ...Object.keys(manifest.dependencies || {}),
        ...Object.keys(manifest.optionalDependencies || {}),
        ...Object.keys(manifest.peerDependencies || {}),
    ]);
    const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
    // esbuild emits double-quoted specifiers; single-quoted ones in the bundle
    // are prose inside error messages (e.g. iconv-lite's "require('iconv-lite')").
    const requireRe = /\b(?:(?:__)?require|import)\(\s*"([^"]+)"\s*\)/g;
    const missing = new Map();
    for (const file of ['index.js', 'server.js']) {
        const full = path.join(pkgDir, 'dist', file);
        if (!fs.existsSync(full)) throw new Error(`packed package is missing dist/${file}`);
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(requireRe)) {
            const spec = m[1];
            if (spec.startsWith('.') || spec.startsWith('/') || builtins.has(spec)) continue;
            const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
            if (declared.has(name) || LAZY_OPTIONAL_EXTERNALS.has(name)) continue;
            if (!missing.has(name)) missing.set(name, new Set());
            missing.get(name).add(`dist/${file}`);
        }
    }
    return missing;
}

async function main() {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-smoke-'));
    const installDir = path.join(tmpRoot, 'install');
    const homeDir = path.join(tmpRoot, 'home');
    const dataDir = path.join(tmpRoot, 'data');
    const packDir = path.join(tmpRoot, 'pack');
    for (const d of [installDir, homeDir, dataDir, packDir]) fs.mkdirSync(d, { recursive: true });

    const failures = [];
    const children = [];
    const servers = [];
    const fail = (msg) => { failures.push(msg); console.error(`[smoke-pack] FAIL: ${msg}`); };

    try {
        // 1. Build + pack
        let tarball = option('--tarball');
        if (tarball) {
            tarball = path.resolve(tarball);
            if (!fs.existsSync(tarball)) throw new Error(`tarball not found: ${tarball}`);
            log(`using tarball ${tarball}`);
        } else {
            if (!flag('--skip-build')) {
                log('building (npm run build:ci)...');
                run('npm', ['run', 'build:ci'], { cwd: ROOT, stdio: 'inherit' });
            }
            log('packing packages/cli...');
            const out = run('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: CLI_DIR });
            const packed = JSON.parse(out);
            tarball = path.join(packDir, packed[0].filename);
        }

        // 2. Install into an empty directory, the way a user would
        fs.writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({ name: 'smoke-consumer', version: '0.0.0', private: true }));
        log(`installing ${path.basename(tarball)} into an empty directory...`);
        run('npm', ['install', tarball, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: installDir });

        const pkgDir = path.join(installDir, 'node_modules', 'llm-observer');
        const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        const binRel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin['llm-observer'];
        const binPath = path.join(pkgDir, binRel);

        // 3. Static check: bundled externals vs declared dependencies
        const missing = findUndeclaredExternals(pkgDir, manifest);
        for (const [name, files] of missing) {
            fail(`MODULE_NOT_FOUND risk: ${[...files].join(', ')} require('${name}') but packages/cli/package.json does not declare it`);
        }

        // 4. Boot: llm-observer start on free ports, throwaway HOME and data dir
        const proxyPort = await freePort();
        let dashboardPort = await freePort();
        while (dashboardPort === proxyPort) dashboardPort = await freePort();

        // Local stand-in for api.anthropic.com so the AI Analyst can be exercised
        // end to end without a real key or network access.
        const upstreamRequests = [];
        const upstream = http.createServer((req, res) => {
            let body = '';
            req.on('data', (d) => { body += d; });
            req.on('end', () => {
                upstreamRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({
                    model: 'claude-opus-4-8',
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: JSON.stringify({ summary: 'Smoke summary.', recommendations: [] }) }],
                }));
            });
        });
        await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
        servers.push(upstream);
        const upstreamPort = upstream.address().port;

        const env = { ...process.env };
        for (const k of Object.keys(env)) {
            if (/API_KEY|ADMIN_KEY|^ANTHROPIC_|^OPENAI_/i.test(k)) delete env[k];
        }
        Object.assign(env, {
            HOME: homeDir,
            USERPROFILE: homeDir,
            LLM_OBSERVER_DATA_DIR: dataDir,
            LLM_OBSERVER_PROXY_PORT: String(proxyPort),
            LLM_OBSERVER_PORT: String(dashboardPort),
            LLM_OBSERVER_HOST: '127.0.0.1',
            LLM_OBSERVER_ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
            NO_UPDATE_NOTIFIER: '1',
            CI: '1',
        });

        const startCli = (label) => {
            const child = spawn(process.execPath, [binPath, 'start'], { cwd: installDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
            const state = { child, output: '', exited: false, code: null, signal: null };
            const collect = (d) => { state.output += d.toString(); };
            child.stdout.on('data', collect);
            child.stderr.on('data', collect);
            child.on('exit', (code, signal) => { state.exited = true; state.code = code; state.signal = signal; });
            children.push(state);
            log(`started ${label} (cli pid ${child.pid}, proxy :${proxyPort}, dashboard :${dashboardPort})`);
            return state;
        };
        const pidFile = path.join(homeDir, '.llm-observer', 'observer.pid');
        const readServerPid = () => {
            try { return parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10) || 0; } catch { return 0; }
        };

        async function bootAndCheck(label) {
            const cli = startCli(label);
            const healthy = await waitFor(async () => {
                if (cli.exited) return 'exited';
                return (await httpGet(`http://127.0.0.1:${proxyPort}/health`)) === 200 ? 'ok' : null;
            }, 60000);
            if (healthy !== 'ok') {
                fail(`${label}: /health never returned 200 (${healthy === 'exited' ? `process exited early, code ${cli.code}` : 'timed out'})\n--- output ---\n${cli.output}\n--------------`);
                return null;
            }
            log(`${label}: GET /health -> 200`);
            const dash = await httpGet(`http://127.0.0.1:${dashboardPort}/`);
            if (dash !== 200) fail(`${label}: dashboard GET / returned ${dash || 'no response'}`);
            else log(`${label}: dashboard GET / -> 200`);
            const serverPid = readServerPid();
            if (!serverPid) fail(`${label}: start did not write ${pidFile}`);
            return { cli, serverPid };
        }

        // 5a. Shut down with SIGINT: the CLI must exit cleanly and take the server with it
        const first = await bootAndCheck('start #1');
        if (first) {
            first.cli.child.kill('SIGINT');
            const exited = await waitFor(() => first.cli.exited, 15000);
            if (!exited) fail('start #1: CLI did not exit within 15s of SIGINT');
            else if (!IS_WIN && first.cli.code !== 0) fail(`start #1: CLI exited with code ${first.cli.code} (signal ${first.cli.signal}) after SIGINT`);
            if (first.serverPid) {
                const gone = await waitFor(() => !isAlive(first.serverPid), 15000);
                if (!gone) fail(`start #1: server process ${first.serverPid} still alive after SIGINT`);
            }
            if (exited) log('start #1: clean shutdown on SIGINT');
        }

        // 5b. SIGTERM (docker stop, systemd, kill) must not orphan the server either
        const termRun = await bootAndCheck('start #2 (SIGTERM)');
        if (termRun) {
            // 5b-i. AI Analyst works in the packed artifact: no SDK, plain fetch to the (mock) API
            const keyRes = await httpJson('POST', `http://127.0.0.1:${dashboardPort}/api/optimize/ai/key`, { apiKey: 'sk-ant-api-smoke' });
            const analyzeRes = keyRes.status === 200
                ? await httpJson('POST', `http://127.0.0.1:${dashboardPort}/api/optimize/ai/analyze`, {})
                : null;
            const sent = upstreamRequests[0];
            if (keyRes.status !== 200) fail(`AI Analyst: saving a key returned ${keyRes.status}`);
            else if (!analyzeRes || analyzeRes.status !== 200 || analyzeRes.body?.result?.summary !== 'Smoke summary.') {
                fail(`AI Analyst: analyze returned ${analyzeRes && analyzeRes.status} ${JSON.stringify(analyzeRes && analyzeRes.body)}`);
            } else if (!sent || sent.url !== '/v1/messages' || sent.headers['x-api-key'] !== 'sk-ant-api-smoke' || !sent.headers['anthropic-version']) {
                fail(`AI Analyst: unexpected upstream request ${JSON.stringify(sent && { url: sent.url, headers: sent.headers })}`);
            } else {
                log('AI Analyst: analysis served through the packed CLI (mock upstream)');
            }

            termRun.cli.child.kill('SIGTERM');
            const exited = await waitFor(() => termRun.cli.exited, 15000);
            if (!exited) fail('start #2: CLI did not exit within 15s of SIGTERM');
            if (termRun.serverPid) {
                const gone = await waitFor(() => !isAlive(termRun.serverPid), 15000);
                if (!gone) fail(`start #2: server process ${termRun.serverPid} orphaned after SIGTERM`);
            }
            if (fs.existsSync(pidFile)) fail('start #2: pid file left behind after SIGTERM');
            if (exited) log('start #2: clean shutdown on SIGTERM');
        }

        // 5c. `llm-observer stop` must terminate a process started by `llm-observer start`
        const second = await bootAndCheck('start #3');
        if (second && second.serverPid) {
            const stop = spawnSync(process.execPath, [binPath, 'stop'], { cwd: installDir, env, encoding: 'utf8' });
            if (stop.status !== 0) fail(`stop exited with ${stop.status}\n${stop.stdout}${stop.stderr}`);
            const gone = await waitFor(() => !isAlive(second.serverPid), 15000);
            if (!gone) fail(`stop: server process ${second.serverPid} still alive after \`llm-observer stop\``);
            else log('stop: terminated the server started by start');
        }
    } catch (err) {
        fail(err.message);
    } finally {
        for (const srv of servers) { try { srv.close(); } catch { /* already closed */ } }
        for (const state of children) {
            if (!state.exited) { try { state.child.kill('SIGKILL'); } catch { /* already gone */ } }
        }
        try {
            const pid = parseInt(fs.readFileSync(path.join(homeDir, '.llm-observer', 'observer.pid'), 'utf8'), 10);
            if (pid && isAlive(pid)) process.kill(pid, 'SIGKILL');
        } catch { /* no pid file */ }
        if (flag('--keep')) log(`kept ${tmpRoot}`);
        else fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    if (failures.length) {
        console.error(`\n[smoke-pack] ${failures.length} check(s) failed`);
        process.exit(1);
    }
    log('OK: packed artifact installs, boots, serves /health and shuts down cleanly');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
