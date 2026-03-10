import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration
 *
 * Tests the React Dashboard running at localhost:4001.
 * Uses Chromium by default; also includes Firefox + WebKit traces.
 *
 * Run: npx playwright test
 * UI Mode: npx playwright test --ui
 */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,

    reporter: [
        ['html', { outputFolder: 'tests/e2e/reports', open: 'never' }],
        ['list'],
    ],

    use: {
        // Dashboard URL
        baseURL: process.env.DASHBOARD_URL || 'http://localhost:4001',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
    ],

    // Automatically start the dev server before tests if not already running
    webServer: process.env.CI ? {
        command: 'npm run dev:all',
        url: 'http://localhost:4001',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    } : undefined,
});
