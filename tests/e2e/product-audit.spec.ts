import { test, expect } from '@playwright/test';
const routes = ['/', '/sessions', '/agents', '/tools', '/optimize', '/compare', '/requests', '/projects', '/wrapped', '/alerts', '/settings', '/sync', '/apps', '/limits', '/insights'];
for (const route of routes) {
    test(`page ${route} loads without a crash`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(route);
        await expect(page.locator('main')).toBeVisible();
        await expect(page.getByRole('status', { name: 'Loading page…' })).toHaveCount(0);
        await expect(page.locator('main')).not.toContainText('The dashboard failed to render');
        await expect(page.locator('main')).not.toBeEmpty();
        await expect(page.locator('main').locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
        expect(errors).toEqual([]);
    });
}
test('repeated navigation leaves the app responsive', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    for (let cycle = 0; cycle < 3; cycle++) {
        for (const name of ['Sessions', 'Projects', 'Settings']) {
            await page.getByRole('link', { name, exact: true }).click();
            await expect(page.locator('main').locator('h1, h2').first()).toBeVisible();
        }
    }
    expect(errors).toEqual([]);
});
test('settings remains usable on a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/settings');
    await expect(page.locator('main')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
