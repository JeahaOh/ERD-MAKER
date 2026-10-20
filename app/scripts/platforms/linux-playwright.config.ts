import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config';

// Keep the production suite unchanged. Linux verification enables Chromium's OS sandbox.
export default defineConfig(base, {
  testDir: '../../tests/e2e',
  outputDir: '../../../platform-artifacts/browser',
  reporter: [['list'], ['json', { outputFile: 'platform-artifacts/browser-results.json' }]],
  use: { ...base.use, channel: undefined, launchOptions: { chromiumSandbox: true }, screenshot: 'on', trace: 'retain-on-failure' },
});
