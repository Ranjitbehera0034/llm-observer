const fs = require('fs');
const path = require('path');

// Cross-platform replacement for the old `mkdir -p && cp -r` shell chain in
// package.json's build script -- that syntax is POSIX-only and silently
// fails on Windows ("The syntax of the command is incorrect"), which meant
// dist/migrations and dist/dashboard never got created there. Never caught
// before because no existing CI path builds this package on Windows except
// release.yml's desktop matrix.

const proxyRoot = path.join(__dirname, '..');

const copies = [
    [path.join(proxyRoot, '..', 'dashboard', 'dist'), path.join(proxyRoot, 'dist', 'dashboard')],
    [path.join(proxyRoot, '..', 'database', 'src', 'migrations'), path.join(proxyRoot, 'dist', 'migrations')],
];

for (const [src, dest] of copies) {
    if (!fs.existsSync(src)) {
        console.log(`postbuild: skipping ${path.relative(proxyRoot, src)} (not built yet)`);
        continue;
    }
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(`postbuild: copied ${path.relative(proxyRoot, src)} -> ${path.relative(proxyRoot, dest)}`);
}
