import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    onSuccess: 'mkdir -p dist/migrations && cp src/migrations/*.sql dist/migrations/',
});
