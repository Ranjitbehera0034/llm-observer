// Cross-platform replacement for `rm -rf node_modules packages/*/dist packages/*/node_modules`
// (globs and rm do not exist in Windows' cmd.exe).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rm = p => fs.rmSync(p, { recursive: true, force: true });

rm(path.join(root, 'node_modules'));
const packagesDir = path.join(root, 'packages');
for (const name of fs.readdirSync(packagesDir)) {
    rm(path.join(packagesDir, name, 'dist'));
    rm(path.join(packagesDir, name, 'node_modules'));
}
