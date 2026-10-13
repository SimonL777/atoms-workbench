import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/auth',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.VERIFY_URL || 'http://127.0.0.1:5173',
    // Auth credentials and session tokens must not appear in browser artifacts.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'list',
});
