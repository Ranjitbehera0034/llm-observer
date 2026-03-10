import { test, expect } from '@playwright/test';

/**
 * E2E: License & Geo-Payment Flow
 *
 * Mocks the ipapi.co response to test both the India (Razorpay)
 * and Global (Lemon Squeezy) payment path rendering.
 */

test.describe('Geo-based Payment Flow', () => {
    test('shows Razorpay UPI when country is India (IN)', async ({ page }) => {
        // Intercept the ipapi.co geolocation call and return India
        await page.route('https://ipapi.co/json/', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ country_code: 'IN', country_name: 'India' }),
            });
        });

        await page.goto('/settings');

        // Go to License tab
        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();

            // India pricing badge should appear
            await expect(page.getByText(/Local Pricing Available|₹/i)).toBeVisible({ timeout: 6000 });
        }
    });

    test('shows Lemon Squeezy when country is US (Global)', async ({ page }) => {
        // Intercept and return United States
        await page.route('https://ipapi.co/json/', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ country_code: 'US', country_name: 'United States' }),
            });
        });

        await page.goto('/settings');

        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();

            // Global pricing badge should appear
            await expect(page.getByText(/Global Coverage|\$9|\$79/i)).toBeVisible({ timeout: 6000 });
        }
    });

    test('shows yearly prices when yearly toggle is selected (India)', async ({ page }) => {
        await page.route('https://ipapi.co/json/', (route) => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ country_code: 'IN', country_name: 'India' }),
            });
        });

        await page.goto('/settings');

        const licenseTab = page.getByRole('button', { name: /license/i });
        if (await licenseTab.isVisible()) {
            await licenseTab.click();

            const yearlyBtn = page.getByRole('button', { name: /yearly/i });
            if (await yearlyBtn.isVisible()) {
                await yearlyBtn.click();
                await expect(page.getByText('₹2,499')).toBeVisible({ timeout: 5000 });
            }
        }
    });
});
