const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const platform = process.platform; // 'darwin', 'win32', etc.
const arch = process.arch; // 'x64', 'arm64'

let target = '';
if (platform === 'darwin') {
    target = arch === 'arm64' ? 'node18-macos-arm64' : 'node18-macos-x64';
} else if (platform === 'win32') {
    target = 'node18-win-x64';
} else if (platform === 'linux') {
    target = 'node18-linux-x64';
}

const tauriTarget = platform === 'darwin'
    ? (arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin')
    : (platform === 'win32' ? 'x86_64-pc-windows-msvc' : 'x86_64-unknown-linux-gnu');

const outputBase = `llm-observer-proxy-${tauriTarget}`;
const output = platform === 'win32' ? `${outputBase}.exe` : outputBase;

console.log(`Building sidecar for ${target}...`);

try {
    // 1. Build the proxy with tsup first to get dist/index.js
    console.log('Building proxy with tsup...');
    execSync('npm run build', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });

    // 2. Run pkg
    // We target dist/server.js which is the entry point for the standalone server
    console.log(`Running pkg for target ${target}...`);
    execSync(`npx pkg dist/server.js --target ${target} --output bin/${output} --public`, {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
    });

    // 3. Copy better-sqlite3 native binding next to the binary
    // pkg doesn't bundle native modules. We need the .node file for the binary to work.
    // However, better-sqlite3 is a bit tricky with pkg. 
    // For now, we'll try to get it to work as is or document it.

    console.log(`✅ Sidecar binary created: bin/${output}`);
} catch (error) {
    console.error('Failed to build sidecar:', error);
    process.exit(1);
}
