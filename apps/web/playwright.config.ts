import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: process.env.WEB_URL ?? 'http://localhost:5173' },
  reporter: 'list',
  timeout: 60000,
  outputDir: process.env.BROWSER_RESULTS ?? '/data/browser-results',
});
