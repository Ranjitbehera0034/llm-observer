import { defineConfig } from 'tsup';

export default defineConfig({
    define: { __LICENSE_SERVER_URL__: JSON.stringify(process.env.LICENSE_SERVER_URL || '') },
    entry: ['src/index.ts', 'src/server.ts'],
    format: ['cjs'],
    minify: true,
    clean: true,
    noExternal: [
        '@llm-observer/database',
        'chalk',
        'cors',
        'express',
        'http-proxy',
        'node-fetch'
    ],
    external: ['better-sqlite3'],
    sourcemap: false,
    shims: true,
});
