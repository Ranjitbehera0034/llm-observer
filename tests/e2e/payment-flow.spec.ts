import { test, expect } from '@playwright/test';
test('billing has one activation form, clear pricing, and no geolocation request', async ({ page }) => {
    const external: string[] = [];
    page.on('request', request => { if (request.url().includes('ipapi.co')) external.push(request.url()); });
    await page.goto('/settings');
    await page.getByRole('button', { name: /license.*billing/i }).click();
    await expect(page.getByPlaceholder('PRO_...')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /See Pro plans/ })).toContainText('$9/month or $79/year');
    await page.getByPlaceholder('PRO_...').fill('not-a-license');
    await page.getByRole('button', { name: 'Activate Pro Features' }).click();
    await expect(page.getByText('Enter the PRO_ license key from your purchase email.')).toBeVisible();
    expect(external).toEqual([]);
});
