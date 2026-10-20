import { _electron, expect } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';

// Run after npm run build. On headless Linux, use xvfb-run; keep Chromium's sandbox enabled.
const desktop = await _electron.launch({ chromiumSandbox: true, ...(process.argv[2] ? { executablePath: process.argv[2], args: [] } : { args: ['.'] }), cwd: process.cwd(), timeout: 30_000 });
try {
  const page = await desktop.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('body')).toContainText(/ERD/i);
  await expect(page.locator('.app-header')).toHaveCSS('background-color', 'rgb(58, 74, 90)');
  await expect(page.locator('.header-primary')).toHaveCSS('background-color', 'rgb(0, 161, 155)');
  await expect(page.locator('.header-primary')).toHaveCSS('color', 'rgb(38, 38, 38)');
  await page.locator('.welcome').getByRole('button', { name: '새 모델', exact: true }).click();
  await page.getByLabel('새 모델 이름').fill('Electron 네이티브 엔진 검증');
  await page.getByRole('button', { name: '모델 만들기', exact: true }).click();
  await expect(page.locator('.entity-tree > button')).toHaveCount(1);
  await page.locator('.entity-tree > button').first().click();
  await expect(page.getByLabel('테이블 물리명', { exact: true })).toHaveValue('new_table');
  await page.getByLabel('테이블 논리명', { exact: true }).fill('데스크톱 수정 검증');
  await page.getByLabel('테이블 논리명', { exact: true }).press('Enter');
  await expect(page.locator('.entity-tree > button').first()).toContainText('데스크톱 수정 검증');
  const reference = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
  if (existsSync(reference)) {
    await page.getByLabel('eXERD 모델 파일', { exact: true }).setInputFiles(reference);
    await expect(page.locator('.entity-tree > button')).toHaveCount(609);
    await expect(page.locator('.statusbar')).toContainText('10045 컬럼');
  }
  mkdirSync('.analysis/desktop', { recursive: true });
  await page.screenshot({ path: '.analysis/desktop/smoke.png', fullPage: true });
  const browserAccess = await page.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
  }));
  expect(browserAccess).toEqual({ require: 'undefined', process: 'undefined' });

  const preferences = await desktop.evaluate(({ BrowserWindow, app }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    const prefs = contents.getLastWebPreferences();
    return { url: contents.getURL(), sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, noSandbox: app.commandLine.hasSwitch('no-sandbox'), disableSetuidSandbox: app.commandLine.hasSwitch('disable-setuid-sandbox') };
  });
  expect(preferences.url).toMatch(/^file:\/\//);
  expect(preferences.sandbox).toBe(true);
  expect(preferences.nodeIntegration).toBe(false);
  expect(preferences.contextIsolation).toBe(true);
  expect(preferences.noSandbox).toBe(false);
  expect(preferences.disableSetuidSandbox).toBe(false);
  // Exercise the actual session policy against a local TCP sink. No external
  // server or user model data is involved; a cancelled request opens no socket.
  let connections = 0;
  const sink = createServer(socket => { connections++; socket.destroy(); });
  await new Promise((resolve, reject) => { sink.once('error', reject); sink.listen(0, '127.0.0.1', resolve); });
  try {
    const networking = await desktop.evaluate(async ({ session }, port) => {
      const results = [];
      for (const scheme of ['http', 'https']) {
        try {
          await session.defaultSession.fetch(`${scheme}://127.0.0.1:${port}/erd-maker-network-policy-probe`);
          results.push({ scheme, blocked: false });
        } catch (error) {
          results.push({ scheme, blocked: String(error).includes('ERR_BLOCKED_BY_CLIENT') });
        }
      }
      return results;
    }, sink.address().port);
    expect(networking).toEqual([{ scheme: 'http', blocked: true }, { scheme: 'https', blocked: true }]);
    expect(connections).toBe(0);
  } finally {
    await new Promise(resolve => sink.close(resolve));
  }
  console.log('Electron smoke passed: file-based worker created and edited a native model; local reference open checked when present; Node access absent; sandbox and context isolation enabled.');
  console.log('Electron network policy passed: HTTP/HTTPS session requests cancelled before TCP connection (local sink connections: 0).');
} finally {
  await desktop.close();
}
