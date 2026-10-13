import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/live',
  timeout: Number(process.env.RUN_TIMEOUT_MS || 1_800_000) * 3 + 180_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'list',
});
