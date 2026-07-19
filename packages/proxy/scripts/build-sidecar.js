const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// This produces the Tauri "sidecar" for packages/desktop: the desktop app's
// Rust code (src-tauri/src/lib.rs) spawns `bin/llm-observer-proxy-<target-triple>`
// with the resource-relative path to resources/proxy/server.js as its argument.
//
// Earlier this repo tried to snapshot everything (including better-sqlite3's
// native binding) into a single file via `pkg`. That doesn't work reliably:
// pkg's embedded Node runtime is capped at Node 18 (unmaintained since ~2023),
// so any native module has to be recompiled for that exact ABI, AND pkg's
// handling of `bindings`-style dynamic native-module resolution leaks a
// build-machine absolute path rather than truly bundling the file -- verified
// by hand while debugging the v2.0.0 release.
//
// Instead: ship the REAL Node binary that built this bundle (so its ABI is
// guaranteed to match whatever native modules it needs, no cross-version
// packaging required) alongside dist/server.js and exactly the node_modules
// packages actually required at runtime. That set is traced by really
// booting the built server against a throwaway data dir and inspecting
// require.cache, rather than hand-maintaining a package list that goes
// stale the next time a new dependency gets added.

const platform = process.platform;
const arch = process.arch;

const tauriTarget = platform === 'darwin'
    ? (arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
    : (platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu');

const proxyRoot = path.join(__dirname, '..');
const repoRoot = path.join(proxyRoot, '..', '..');
const desktopSrcTauri = path.join(repoRoot, 'packages', 'desktop', 'src-tauri');
const binDir = path.join(desktopSrcTauri, 'bin');
const resourcesDir = path.join(desktopSrcTauri, 'resources', 'proxy');

console.log(`Building sidecar bundle for ${tauriTarget}...`);

console.log('Building proxy with tsup...');
execSync('npm run build', { cwd: proxyRoot, stdio: 'inherit' });

console.log('Tracing runtime dependencies (booting the real built server against a throwaway data dir)...');
const traceDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-trace-'));
const serverPath = path.join(proxyRoot, 'dist', 'server.js');
const traceScript = `
process.env.LLM_OBSERVER_DATA_DIR = ${JSON.stringify(traceDataDir)};
process.env.LLM_OBSERVER_PORT = '0';
process.env.LLM_OBSERVER_PROXY_PORT = '0';
require(${JSON.stringify(serverPath)});
setTimeout(() => {
    const pkgs = new Set();
    for (const p of Object.keys(require.cache)) {
        const m = p.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
        if (m) pkgs.add(m[1]);
    }
    process.stdout.write('\\n__SIDECAR_DEPS__' + JSON.stringify([...pkgs]) + '\\n');
    process.exit(0);
}, 3000);
`;
const traceResult = spawnSync(process.execPath, ['-e', traceScript], { cwd: proxyRoot, encoding: 'utf8' });
fs.rmSync(traceDataDir, { recursive: true, force: true });

const match = traceResult.stdout.match(/__SIDECAR_DEPS__(\[.*\])/);
if (!match) {
    console.error('Failed to trace runtime dependencies. Server output:');
    console.error(traceResult.stdout);
    console.error(traceResult.stderr);
    process.exit(1);
}
const deps = JSON.parse(match[1]);
console.log(`Runtime dependencies found (${deps.length}): ${deps.join(', ')}`);

console.log('Staging sidecar resources...');
fs.rmSync(resourcesDir, { recursive: true, force: true });
fs.mkdirSync(resourcesDir, { recursive: true });
fs.copyFileSync(serverPath, path.join(resourcesDir, 'server.js'));
// server.js is a CJS bundle (require()), but packages/desktop/package.json has
// "type": "module" -- Node resolves module type via the nearest ancestor
// package.json, and without one here it'd wrongly treat this as ESM.
fs.writeFileSync(path.join(resourcesDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
// db.ts locates migrations relative to its own file location at runtime, so
// this needs to sit next to server.js in the bundle, not just in dist/.
fs.cpSync(path.join(proxyRoot, 'dist', 'migrations'), path.join(resourcesDir, 'migrations'), { recursive: true });

const rootNodeModules = path.join(repoRoot, 'node_modules');
const bundleNodeModules = path.join(resourcesDir, 'node_modules');
fs.mkdirSync(bundleNodeModules, { recursive: true });
for (const dep of deps) {
    const src = path.join(rootNodeModules, dep);
    const dest = path.join(bundleNodeModules, dep);
    if (!fs.existsSync(src)) {
        console.error(`Traced dependency "${dep}" not found at ${src} -- cannot bundle it.`);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
}

console.log('Copying the real Node binary as the sidecar executable...');
fs.mkdirSync(binDir, { recursive: true });
const outputBase = `llm-observer-proxy-${tauriTarget}`;
const output = platform === 'win32' ? `${outputBase}.exe` : outputBase;
const outputPath = path.join(binDir, output);
fs.copyFileSync(process.execPath, outputPath);
if (platform !== 'win32') fs.chmodSync(outputPath, 0o755);

console.log(`✅ Sidecar binary: bin/${output}`);
console.log(`✅ Sidecar resources: resources/proxy/ (server.js + ${deps.length} runtime dependency dirs)`);
