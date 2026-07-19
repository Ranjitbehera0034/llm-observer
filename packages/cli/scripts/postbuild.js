const fs = require('fs');
const path = require('path');

// Cross-platform replacement for a `cp -r`/`mkdir -p`/`chmod +x` shell chain
// -- POSIX-only syntax that silently fails on Windows ("The syntax of the
// command is incorrect"), the same class of bug found and fixed in
// packages/proxy/package.json's build script while debugging the v2.0.0
// desktop release.

const cliRoot = path.join(__dirname, '..');
const distDir = path.join(cliRoot, 'dist');

fs.cpSync(path.join(cliRoot, '..', 'database', 'src', 'migrations'), path.join(distDir, 'migrations'), { recursive: true });
fs.copyFileSync(path.join(cliRoot, '..', 'proxy', 'dist', 'server.js'), path.join(distDir, 'server.js'));
fs.mkdirSync(path.join(distDir, 'dashboard'), { recursive: true });
fs.cpSync(path.join(cliRoot, '..', 'proxy', 'dist', 'dashboard'), path.join(distDir, 'dashboard'), { recursive: true });

const bin = path.join(distDir, 'index.js');
if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);

console.log('postbuild: bundled migrations, server.js, and dashboard into dist/');
