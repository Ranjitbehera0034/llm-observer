#!/usr/bin/env node
// Boots the staged desktop sidecar exactly the way src-tauri/src/lib.rs does
// (copied Node binary + resources/proxy/server.js, explicit ports, loopback) and checks
// that it comes up: /health on the proxy port, the API and the bundled dashboard on
// the API port, and the CORS answer a tauri://localhost webview needs.
//
//   node packages/proxy/scripts/build-sidecar.js     # produces bin/ and resources/ first
//   node packages/desktop/scripts/check-sidecar.cjs
//
// Ports: LLM_OBSERVER_CHECK_PORT_BASE (uses base and base+1) or two free ports.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const srcTauri = path.join(__dirname, '..', 'src-tauri');
const triple = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
    : (process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu');
const bin = path.join(srcTauri, 'bin', `llm-observer-proxy-${triple}${process.platform === 'win32' ? '.exe' : ''}`);
const resources = path.join(srcTauri, 'resources', 'proxy');

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once('error', reject);
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
}

const failures = [];
function check(name, ok, detail) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` (${detail})`}`);
    if (!ok) failures.push(name);
}

async function main() {
    for (const p of [bin, path.join(resources, 'server.js'), path.join(resources, 'parent-watch.js'), path.join(resources, 'dashboard', 'index.html')]) {
        if (!fs.existsSync(p)) { console.error(`missing ${p} - run packages/proxy/scripts/build-sidecar.js first`); process.exit(1); }
    }
    const base = Number(process.env.LLM_OBSERVER_CHECK_PORT_BASE);
    const api = base || await freePort();
    const proxy = base ? base + 1 : await freePort();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmo-sidecar-check-'));
    let log = '';
    const child = spawn(bin, ['--require', path.join(resources, 'parent-watch.js'), path.join(resources, 'server.js')], {
        env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot, // Windows needs it to load the runtime
            HOME: tmp,
            USERPROFILE: tmp,
            LLM_OBSERVER_DATA_DIR: tmp,
            LLM_OBSERVER_HOST: '127.0.0.1',
            LLM_OBSERVER_PORT: String(api),
            LLM_OBSERVER_PROXY_PORT: String(proxy),
            LLM_OBSERVER_PARENT_PID: String(process.pid),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    let exited = false;
    child.once('exit', () => { exited = true; });

    try {
        let up = false;
        for (let i = 0; i < 120 && !up && !exited; i++) {
            try { up = (await fetch(`http://127.0.0.1:${api}/api/settings`)).ok; } catch { /* not listening yet */ }
            if (!up) await new Promise((r) => setTimeout(r, 250));
        }
        check('sidecar starts and the API port answers', up, exited ? 'process exited' : 'timed out');
        if (up) {
            const health = await fetch(`http://127.0.0.1:${proxy}/health`).then((r) => r.json()).catch(() => null);
            check('/health on the proxy port', health && health.status === 'ok', JSON.stringify(health));
            const root = await fetch(`http://127.0.0.1:${api}/`);
            const html = await root.text();
            check('bundled dashboard is served', root.status === 200 && /<div id="root">/.test(html), `status ${root.status}`);
            const cors = await fetch(`http://127.0.0.1:${api}/api/settings`, { headers: { Origin: 'tauri://localhost' } });
            check('CORS grants tauri://localhost', cors.headers.get('access-control-allow-origin') === 'tauri://localhost', String(cors.headers.get('access-control-allow-origin')));
        }
    } finally {
        if (!exited) {
            child.kill('SIGTERM');
            await new Promise((r) => { child.once('exit', r); setTimeout(r, 6000); });
        }
        if (!exited && child.exitCode === null) child.kill('SIGKILL');
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    if (failures.length) {
        console.error('--- sidecar output ---\n' + log.split('\n').filter((l) => !/Migration applied/.test(l)).slice(-40).join('\n'));
        process.exit(1);
    }
    console.log(`sidecar check passed (api ${api}, proxy ${proxy})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
