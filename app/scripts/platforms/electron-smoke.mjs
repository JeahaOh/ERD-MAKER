import { _electron as electron } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const directory = 'platform-artifacts';
mkdirSync(directory, { recursive: true });
let application;
try {
  application = await electron.launch({ chromiumSandbox: true, args: ['--enable-sandbox', '.'], timeout: 30000 });
  const window = await application.firstWindow();
  await window.locator('.welcome').getByRole('button', { name: '새 모델', exact: true }).click();
  await window.getByLabel('새 모델 이름').fill('Linux sandbox smoke');
  await window.getByRole('button', { name: '모델 만들기', exact: true }).click();
  await window.locator('.entity-tree > button').first().waitFor();
  const security = await application.evaluate(({ BrowserWindow, app }) => {
    const win = BrowserWindow.getAllWindows()[0], preferences = win.webContents.getLastWebPreferences();
    return { platform: process.platform, arch: process.arch, versions: process.versions, sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity, args: process.argv, noSandboxSwitch: app.commandLine.hasSwitch('no-sandbox'), disableSetuidSandbox: app.commandLine.hasSwitch('disable-setuid-sandbox') };
  });
  const renderer = await window.evaluate(() => ({ requireType: typeof (globalThis).require, processType: typeof (globalThis).process, tables: document.querySelectorAll('.entity-tree > button').length, fileProtocol: location.protocol }));
  writeFileSync(`${directory}/electron-security.json`, JSON.stringify({ ...security, renderer }, null, 2));
  if (!security.sandbox || !security.contextIsolation || security.nodeIntegration || !security.webSecurity || security.noSandboxSwitch || security.disableSetuidSandbox || renderer.requireType !== 'undefined' || renderer.processType !== 'undefined' || renderer.tables !== 1 || renderer.fileProtocol !== 'file:') throw new Error('Electron security or renderer smoke assertion failed.');
  const image = await window.screenshot({ path: `${directory}/electron-linux.png`, fullPage: true });
  writeFileSync(`${directory}/electron-security.json`, JSON.stringify({ ...security, renderer, screenshotSha256: createHash('sha256').update(image).digest('hex') }, null, 2));
  console.log(JSON.stringify({ result: 'passed', platform: security.platform, arch: security.arch, sandbox: security.sandbox, tables: renderer.tables }));
} finally { await application?.close(); }
