import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

async function record(checks: Record<string, boolean>) {
  let report = {};
  try {
    report = JSON.parse(await readFile('.artifacts/auth-verification.json', 'utf8'));
  } catch {}
  await mkdir('.artifacts', { recursive: true });
  await writeFile(
    '.artifacts/auth-verification.json',
    JSON.stringify({ ...report, ...checks }, null, 2) + '\n',
  );
}

test('confirmed Supabase account logs in, survives refresh and logs out', async ({ page }) => {
  const fixture = JSON.parse(
    await readFile(process.env.AUTH_FIXTURE_PATH || '.runtime/auth-fixture.json', 'utf8'),
  );
  await page.goto('./');
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  const modal = page.getByRole('dialog', { name: '账户登录' });
  await expect(modal.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
  await modal.getByLabel('邮箱', { exact: true }).fill(fixture.email);
  // Sanitize any fill failure: a browser action's error can include its argument.
  try {
    await modal.getByLabel('密码', { exact: true }).fill(fixture.password);
  } catch {
    throw new Error('Could not fill the login password field.');
  }
  await modal.getByRole('button', { name: '登录', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByText('个人账户', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('个人账户', { exact: true })).toBeVisible();
  await page.locator('.profile').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await record({ ui_login: true, session_refresh: true, logout: true });
});

test('public registration form is configured and validates password length', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await page.getByRole('button', { name: '注册', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '账户登录' });
  await expect(modal.getByLabel('你的名字')).toBeVisible();
  await expect(modal.getByLabel('邮箱', { exact: true })).toHaveAttribute('type', 'email');
  await expect(modal.getByLabel('密码', { exact: true })).toHaveAttribute('minlength', '8');
  await expect(modal.getByRole('button', { name: '创建账户' })).toBeEnabled();
  await record({ registration_form: true });
  // SMTP delivery and real email confirmation are a separate mailbox acceptance.
});
