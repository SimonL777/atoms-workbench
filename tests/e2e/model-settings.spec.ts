import { test, expect } from '@playwright/test';

test('login prompts for a personal model; editing keeps the key write-only and deletion gates creation', async ({
  page,
}) => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'model-ui@example.com',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const jwt = [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url'),
    'test-only',
  ].join('.');
  const otherUser = {
    ...user,
    id: '00000000-0000-4000-8000-000000000002',
    email: 'other-model@example.com',
  };
  const otherJwt = [
    jwt.split('.')[0],
    Buffer.from(
      JSON.stringify({ sub: otherUser.id, exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url'),
    'test-only',
  ].join('.');
  let saved = {
    configured: false,
    baseUrl: '',
    modelName: '',
    apiKeyConfigured: false,
    updatedAt: null as string | null,
  };
  let creations = 0;
  const updates: Record<string, string>[] = [];
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        supabaseUrl: 'https://model-ui.supabase.co',
        supabaseKey: 'test-public',
        configured: true,
        modelReady: true,
        demoEnabled: true,
        build: 'ui-test',
      },
    }),
  );
  await page.route('https://model-ui.supabase.co/auth/v1/**', (route) => {
    if (route.request().url().includes('/token')) {
      const isOther = route.request().postDataJSON()?.email === otherUser.email;
      return route.fulfill({
        json: {
          access_token: isOther ? otherJwt : jwt,
          token_type: 'bearer',
          refresh_token: 'test-refresh',
          expires_in: 3600,
          user: isOther ? otherUser : user,
        },
      });
    }
    if (route.request().url().includes('/logout')) return route.fulfill({ status: 204 });
    return route.fulfill({
      json:
        route.request().headers().authorization === `Bearer ${otherJwt}` ? otherUser : user,
    });
  });
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'POST') creations++;
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/model-config', (route) => {
    if (route.request().headers().authorization === `Bearer ${otherJwt}`)
      return route.fulfill({
        json: {
          configured: false,
          baseUrl: '',
          modelName: '',
          apiKeyConfigured: false,
          updatedAt: null,
        },
      });
    if (route.request().method() === 'PUT') {
      const value = route.request().postDataJSON();
      updates.push(value);
      saved = {
        configured: true,
        baseUrl: value.baseUrl,
        modelName: value.modelName,
        apiKeyConfigured: true,
        updatedAt: new Date().toISOString(),
      };
    }
    if (route.request().method() === 'DELETE') {
      saved = {
        configured: false,
        baseUrl: '',
        modelName: '',
        apiKeyConfigured: false,
        updatedAt: null,
      };
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: saved });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  const login = page.getByRole('dialog', { name: '账户登录' });
  await login.getByLabel('邮箱', { exact: true }).fill(user.email);
  await login.getByLabel('密码', { exact: true }).fill('test-ui-password');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '连接你的模型' });
  await expect(modal).toBeVisible();
  await page.getByRole('button', { name: '关闭模型配置' }).click();
  await page.getByLabel('项目需求').fill('Build a test project');
  await page.getByRole('button', { name: '开始创建项目' }).click();
  await expect(modal).toBeVisible();
  expect(creations).toBe(0);
  await modal.getByLabel('模型服务 Base URL').fill('https://example.com/v1');
  await modal.getByLabel('模型名称', { exact: true }).fill('personal-model');
  await modal.getByLabel('API Key', { exact: true }).fill('synthetic-ui-key');
  await modal.getByRole('button', { name: '保存配置' }).click();
  await expect(modal).not.toBeVisible();
  expect(updates[0].apiKey).toBe('synthetic-ui-key');
  await page.locator('.model-settings-entry').click();
  modal = page.getByRole('dialog', { name: '管理你的模型' });
  await expect(modal.getByLabel('API Key', { exact: true })).toHaveValue('');
  await modal.getByLabel('模型名称', { exact: true }).fill('updated-model');
  await modal.getByRole('button', { name: '保存配置' }).click();
  await expect(modal).not.toBeVisible();
  expect(updates[1].apiKey).toBeUndefined();
  await page.reload();
  await expect(page.locator('.model-settings-entry')).toContainText('updated-model');
  await expect(page.locator('.model-modal')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    'synthetic-ui-key',
  );
  await page.locator('.profile').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await login.getByLabel('邮箱', { exact: true }).fill(otherUser.email);
  await login.getByLabel('密码', { exact: true }).fill('test-ui-password');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  const otherModal = page.getByRole('dialog', { name: '连接你的模型' });
  await expect(otherModal).toBeVisible();
  await expect(otherModal.getByLabel('模型服务 Base URL')).toHaveValue('');
  await expect(otherModal.getByLabel('模型名称', { exact: true })).toHaveValue('');
  await expect(page.locator('.model-settings-entry')).not.toContainText('updated-model');
  await page.getByRole('button', { name: '关闭模型配置' }).click();
  await page.locator('.profile').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await page.getByRole('button', { name: '登录 / 注册' }).click();
  await login.getByLabel('邮箱', { exact: true }).fill(user.email);
  await login.getByLabel('密码', { exact: true }).fill('test-ui-password');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.model-settings-entry')).toContainText('updated-model');
  await page.locator('.model-settings-entry').click();
  await modal.getByRole('button', { name: '删除配置', exact: true }).click();
  await modal.getByRole('button', { name: '确认删除', exact: true }).click();
  modal = page.getByRole('dialog', { name: '连接你的模型' });
  await expect(modal.getByLabel('API Key', { exact: true })).toHaveAttribute('required', '');
  await page.getByRole('button', { name: '关闭模型配置' }).click();
  await page.getByLabel('项目需求').fill('Build a test project');
  await page.getByRole('button', { name: '开始创建项目' }).click();
  await expect(modal).toBeVisible();
  expect(creations).toBe(0);
  await page.getByRole('button', { name: '关闭模型配置' }).click();
  await page.locator('.profile').click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.locator('.model-settings-entry')).toHaveCount(0);
});
