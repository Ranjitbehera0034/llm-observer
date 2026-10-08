import { defineConfig } from 'tsup';
import fs from 'fs';
import path from 'path';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    // A function, not a shell string: `mkdir -p` and `cp src/*.sql` do not exist in
    // Windows' cmd.exe, which made every Windows build (CI and the desktop installer) fail.
    onSuccess: async () => {
        const src = path.resolve('src', 'migrations');
        const dest = path.resolve('dist', 'migrations');
        fs.mkdirSync(dest, { recursive: true });
        for (const file of fs.readdirSync(src)) {
            if (file.endsWith('.sql')) fs.copyFileSync(path.join(src, file), path.join(dest, file));
        }
    },
});
