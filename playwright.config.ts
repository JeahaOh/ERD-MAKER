import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './app/tests/e2e', timeout: 60_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome', viewport: { width: 1560, height: 1040 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  // Exercise the same immutable static output used by Electron. Development HMR
  // must not reset a model while another source file is being edited.
  webServer: { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 30_000 },
});
