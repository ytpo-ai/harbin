import { expect, test } from '@playwright/test';

const realToken = process.env.E2E_AUTH_TOKEN;

test.describe('real backend smoke', () => {
  test.skip(!realToken, 'Set E2E_AUTH_TOKEN to run real backend smoke e2e.');

  test('can open dashboard with real token @smoke-real', async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem('auth_token', token);
    }, realToken!);

    await page.goto('/');

    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
  });
});
