import { test, expect } from '@playwright/test';
test('example app accepts records and preserves them across a page refresh', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: /让想法，有个\s*可以运行的样子。/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Task Garden 清晰/ }).click();
  await expect(page.getByText('示例模式', { exact: true })).toBeVisible();
  const app = page.frameLocator('iframe[title="应用预览"]');
  await app.getByLabel('新增任务').fill('Online smoke acceptance');
  await app.getByRole('button', { name: '添加', exact: true }).click();
  await expect(app.getByText('Online smoke acceptance', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Task Garden 清晰/ }).click();
  await expect(app.getByText('Online smoke acceptance', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '手机预览' }).click();
  await expect(page.locator('.preview-area')).toHaveClass(/mobile-preview/);
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.getByText('index.html', { exact: true }).first()).toBeVisible();
});
test('authentication shows real configuration status, never a fake successful login', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: /登录 \/ 注册/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/Supabase 尚未连接，注册登录暂不可用/)).toBeVisible();
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeDisabled();
});
