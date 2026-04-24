import { expect, test } from '@playwright/test';

test('login redirects to dashboard with mocked APIs', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();

    if (url.endsWith('/api/auth/login')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'demo-token',
          employee: {
            id: 'demo-employee-id',
            name: 'Demo User',
            email: 'demo@ytpo.ai',
            type: 'human',
            role: 'admin',
          },
        }),
      });
      return;
    }

    if (url.includes('/api/agents')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.goto('/login');
  await page.getByLabel('邮箱地址').fill('demo@ytpo.ai');
  await page.getByLabel('密码').fill('demo-password');
  await page.getByRole('button', { name: '登录' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
});
