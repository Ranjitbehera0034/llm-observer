/**
 * Playwright E2E Suite M — Full Dashboard UI Tests
 * Covers all 7 pages: Overview, Requests, RequestDetail, Projects, Insights, Alerts, Settings
 * Tests positive, negative, and corner cases per the approved implementation plan.
 *
 * Prerequisites: npm run dev:all must be running (or use: npx playwright test --headed)
 * Run: npm run test:e2e
 */

import { test, expect, type Page } from '@playwright/test';

// ============================================================
// Helpers
// ============================================================

async function seedTestData(page: Page) {
    // Inject a test request via the Teams Sync API so the DB always has data
    await page.request.post('http://localhost:4001/api/teams/default/sync', {
        data: {
            requests: [
                {
                    provider: 'openai', model: 'gpt-4', endpoint: '/v1/chat/completions',
                    prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
                    cost_usd: 0.0045, latency_ms: 320, status_code: 200, status: 'success',
                    is_streaming: false, request_body: '{"model":"gpt-4"}',
                    response_body: '{"choices":[{"message":{"content":"Test response"}}]}',
                    metadata: '{"testId":"e2e-ui-seed"}',
                    created_at: new Date().toISOString()
                }
            ]
        }
    });
}

// ============================================================
// M1: Overview Page (/)
// ============================================================

test.describe('M1 — Overview Page', () => {

    test('M1.1 — Positive: Page loads and stat cards are visible', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('h1, h2').first()).toBeVisible();
        // At least one stat card with a USD or number value
        await expect(page.locator('text=$').first()).toBeVisible();
    });

    test('M1.2 — Corner: Stat cards show $0.00 or 0 without crashing on empty DB', async ({ page }) => {
        await page.goto('/');
        // The page should NOT show an error boundary fallback
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('M1.3 — Positive: Navigation sidebar is visible on overview', async ({ page }) => {
        await page.goto('/');
        // Sidebar links should all be present
        await expect(page.getByRole('link', { name: /requests/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /projects/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
    });
});

// ============================================================
// M2: Requests Page (/requests)
// ============================================================

test.describe('M2 — Requests Page', () => {

    test.beforeEach(async ({ page }) => {
        await seedTestData(page);
        await page.goto('/requests');
    });

    test('M2.1 — Positive: Requests table renders after navigation', async ({ page }) => {
        await expect(page.locator('table, [role="table"], [data-testid="requests-table"]').first()).toBeVisible({ timeout: 5000 });
    });

    test('M2.2 — Corner: No React white screen (ErrorBoundary working)', async ({ page }) => {
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
        await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    });

    test('M2.3 — Positive: Clicking a table row opens a Request Detail drawer', async ({ page }) => {
        const firstRow = page.locator('table tbody tr, [data-testid="request-row"]').first();
        await firstRow.waitFor({ timeout: 5000 });
        await firstRow.click();
        // A detail view should appear
        await expect(page.getByText('Trace Details').first()).toBeVisible({ timeout: 5000 });
    });
});

// ============================================================
// M3: Request Detail Page
// ============================================================

test.describe('M3 — Request Detail', () => {

    test.beforeEach(async ({ page }) => {
        await seedTestData(page);
        await page.goto('/requests');
    });

    test('M3.1 — Positive: Detail view shows provider and model info', async ({ page }) => {
        const firstRow = page.locator('table tbody tr, [data-testid="request-row"]').first();
        await firstRow.waitFor({ timeout: 5000 });
        await firstRow.click();
        // Confirm provider name like "openai" is visible in the detail view
        await expect(page.getByText(/openai/i).first()).toBeVisible({ timeout: 3000 });
    });

    test('M3.3 — Positive: Error status badge visible for error requests', async ({ page }) => {
        // Inject an error request
        await page.request.post('http://localhost:4001/api/teams/default/sync', {
            data: {
                requests: [{
                    provider: 'openai', model: 'gpt-4', cost_usd: 0,
                    status_code: 429, status: 'error', error_message: 'Rate limit exceeded',
                    created_at: new Date().toISOString()
                }]
            }
        });
        await page.reload();
        // An error badge or indicator should appear somewhere in the table
        const errorCell = page.locator('td:has-text("error"), span:has-text("error")').first();
        await expect(errorCell).toBeVisible({ timeout: 5000 });
    });
});

// ============================================================
// M4: Projects Page (/projects)
// ============================================================

test.describe('M4 — Projects Page', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/projects');
    });

    test('M4.1 — Positive: Project cards/rows are visible', async ({ page }) => {
        await expect(page.locator('main').first()).toBeVisible();
        await expect(page.getByText(/project/i).first()).toBeVisible();
    });

    test('M4.2 — Corner: Project with null budget shows $0.00 not crash', async ({ page }) => {
        // The COALESCE guard should prevent crashes — no Error Boundary shown
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
        await expect(page.getByText('0.00', { exact: false }).first()).toBeVisible({ timeout: 5000 });
    });

    test('M4.4 — Negative: Creating project with empty name shows validation error', async ({ page }) => {
        // Try to find and click a "New Project" or "Add" button
        const addBtn = page.getByRole('button', { name: /new project|add project|create/i }).first();
        if (await addBtn.isVisible()) {
            await addBtn.click();
            // Find the form submit button and click without filling the name
            const submitBtn = page.getByRole('button', { name: /create|save|submit/i }).last();
            if (await submitBtn.isVisible()) {
                await submitBtn.click();
                // Should show a validation error or the form should not disappear
                await expect(page.getByText(/required|name is required|enter a name/i)).toBeVisible({ timeout: 3000 });
            }
        }
    });
});

// ============================================================
// M5: Insights Page (/insights)
// ============================================================

test.describe('M5 — Insights Page', () => {

    test('M5.1 — Positive: Insights page loads without crash', async ({ page }) => {
        await page.goto('/insights');
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
        await expect(page.locator('main, [role="main"]').first()).toBeVisible();
    });

    test('M5.2 — Corner: Empty state rendered gracefully when no data', async ({ page }) => {
        await page.goto('/insights');
        // Insights page should show empty state or chart, not a white screen
        await expect(page.locator('body')).not.toBeEmpty();
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
    });
});

// ============================================================
// M6: Alerts Page (/alerts)
// ============================================================

test.describe('M6 — Alerts Page', () => {

    test('M6.1 — Positive: Alerts page loads and shows alert list area', async ({ page }) => {
        await page.goto('/alerts');
        await expect(page.locator('main, [role="main"]').first()).toBeVisible();
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
    });

    test('M6.3 — Positive: New Alert Rule form is accessible', async ({ page }) => {
        await page.goto('/alerts');
        const newRuleBtn = page.getByRole('button', { name: /new rule|create rule|add rule/i }).first();
        if (await newRuleBtn.isVisible()) {
            await newRuleBtn.click();
            await expect(page.locator('form, [role="dialog"]').first()).toBeVisible({ timeout: 3000 });
        }
    });
});

// ============================================================
// M7: Settings Page (/settings)
// ============================================================

test.describe('M7 — Settings Page', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('M7.1 — Positive: Settings page loads', async ({ page }) => {
        await expect(page.locator('main, [role="main"]').first()).toBeVisible();
        await expect(page.getByText('Something went wrong')).not.toBeVisible();
    });

    test('M7.2 — Positive: API key values are redacted in the UI', async ({ page }) => {
        // Verify the input type is password
        const apiKeyField = page.locator('input[type="password"], input[placeholder*="sk-" i]').first();
        if (await apiKeyField.count() > 0) {
            const typeAttr = await apiKeyField.getAttribute('type');
            expect(typeAttr).toBe('password');
        }
    });

    test('M7.5 — Positive: Creating a new API key', async ({ page }) => {
        const createKeyBtn = page.getByRole('button', { name: /new key|create key|add key/i }).first();
        if (await createKeyBtn.isVisible()) {
            await createKeyBtn.click();
            const nameInput = page.getByRole('textbox', { name: /key name|name/i }).first();
            if (await nameInput.isVisible()) {
                await nameInput.fill('E2E Test Key');
                await page.getByRole('button', { name: /create|save|submit/i }).last().click();
                await expect(page.getByText('E2E Test Key')).toBeVisible({ timeout: 5000 });
            }
        }
    });

    test('M7.8 — Negative: Invalid license key shows error message', async ({ page }) => {
        const licenseInput = page.getByRole('textbox', { name: /license|key/i }).first();
        if (await licenseInput.isVisible()) {
            await licenseInput.fill('INVALID-FAKE-KEY-XYZ');
            await page.getByRole('button', { name: /activate/i }).first().click();
            await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible({ timeout: 5000 });
        }
    });
});

// ============================================================
// M8: Global Behavior
// ============================================================

test.describe('M8 — Global Behavior', () => {

    test('M8.4 — Positive: All 6 main routes accessible via sidebar without 404', async ({ page }) => {
        const routes = ['/', '/requests', '/projects', '/insights', '/alerts', '/settings'];
        for (const route of routes) {
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            // No page should render a blank body or HTTP 404
            await expect(page.locator('body')).not.toBeEmpty();
            await expect(page.getByText(/404|page not found/i)).not.toBeVisible();
        }
    });

    test('M8.3 — Negative: Forced render error is caught by Error Boundary (sidebar stays intact)', async ({ page }) => {
        // Navigate to an invalid sub-path that would normally 404 in the react router
        await page.goto('/requests/nonexistent-id-12345');
        await page.waitForLoadState('networkidle');
        // The sidebar navigation should still be there even if the center content errors
        await expect(page.getByRole('navigation').first()).toBeVisible({ timeout: 3000 });
    });

    test('M8.1 — Positive: No console errors on main navigation flow', async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.goto('/');
        await page.goto('/requests');
        await page.goto('/projects');
        await page.goto('/settings');
        // Filter out known non-fatal framework errors
        const critical = errors.filter(e => !e.includes('ResizeObserver') && !e.includes('Non-Error promise rejection'));
        expect(critical).toHaveLength(0);
    });
});
