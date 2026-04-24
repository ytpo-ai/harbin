import { expect, test } from '@playwright/test';

test('login page renders required fields', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByRole('heading', { name: 'ytpo.ai' })).toBeVisible();
  await expect(page.getByLabel('邮箱地址')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
});
