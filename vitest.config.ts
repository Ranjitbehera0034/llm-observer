import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        testTimeout: 15000,
        include: ['tests/integration/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: 'tests/integration/coverage',
            include: ['packages/proxy/src/**'],
            exclude: ['packages/proxy/src/providers/**'],
        },
    },
    resolve: {
        alias: {
            '@llm-observer/database': new URL('./packages/database/src/index.ts', import.meta.url).pathname,
        },
    },
});
