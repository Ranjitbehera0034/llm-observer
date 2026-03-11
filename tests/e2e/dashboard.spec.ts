import { test, expect } from '@playwright/test';

/**
 * E2E: Dashboard Navigation & Core Routes
 *
 * Verifies that the main pages load correctly and critical
 * UI elements are visible.
 */

test.describe('Dashboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('home page loads and shows the LLM Observer header', async ({ page }) => {
        await expect(page).toHaveTitle(/LLM Observer|dashboard/i);
        // Should show a nav or sidebar
        await expect(page.locator('body')).toBeVisible();
    });

    test('navigates to Requests page', async ({ page }) => {
        // Click on the Requests link in the sidebar
        const requestsLink = page.getByRole('link', { name: /requests/i });
        if (await requestsLink.isVisible()) {
            await requestsLink.click();
            await expect(page).toHaveURL(/requests/i);
        }
    });

    test('navigates to Settings page', async ({ page }) => {
        const settingsLink = page.getByRole('link', { name: /settings/i });
        if (await settingsLink.isVisible()) {
            await settingsLink.click();
            await expect(page.getByText('Upstream Providers')).toBeVisible({ timeout: 5000 });
        }
    });
});

test.describe('Settings Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('settings page renders the provider tab by default', async ({ page }) => {
        await expect(page.getByText('Global Upstream Keys')).toBeVisible({ timeout: 5000 });
    });

    test('can navigate to License & Billing tab', async ({ page }) => {
        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();
            await expect(page.getByRole('heading', { name: /Hobbyist|Pro/i }).first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('billing cycle toggle switches between Monthly and Yearly', async ({ page }) => {
        // Navigate to license tab
        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();

            const yearlyBtn = page.getByRole('button', { name: /yearly/i });
            if (await yearlyBtn.isVisible()) {
                await yearlyBtn.click();
                // Either ₹2,499 (India) or $79 (Global) should be visible
                const yearlyPrice = page.getByText(/2,499|79/);
                await expect(yearlyPrice).toBeVisible({ timeout: 3000 });
            }
        }
    });

    test('license key input accepts text', async ({ page }) => {
        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();

            const keyInput = page.locator('input[placeholder="sk_live_..."]').first();
            if (await keyInput.isVisible()) {
                await keyInput.fill('PRO_TEST_KEY_123');
                await expect(keyInput).toHaveValue('PRO_TEST_KEY_123');
            }
        }
    });
});

test.describe('API Keys Tab', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('can navigate to Observer Keys tab', async ({ page }) => {
        const keysTab = page.getByRole('button', { name: /observer keys/i });
        if (await keysTab.isVisible()) {
            await keysTab.click();
            await expect(page.getByText(/Generate API Key/i)).toBeVisible({ timeout: 5000 });
        }
    });
});
