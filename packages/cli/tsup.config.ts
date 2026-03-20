import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    minify: true,
    clean: true,
    banner: {
        js: '#!/usr/bin/env node',
    },
    noExternal: [
        '@llm-observer/database',
        'chalk',
        'cli-table3',
        'commander',
        'node-fetch'
    ],external: ['better-sqlite3'],
    sourcemap: false,
    shims: true,
});