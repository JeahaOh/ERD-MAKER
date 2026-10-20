import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { createNativeDocument } from '../../src/formats/exerd/create';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
const registry = JSON.parse(readFileSync('app/src/formats/exerd/schema.generated.json', 'utf8')) as BinaryRegistry;

async function create(page: Page, name: string, tableName: string) {
  await page.goto('/'); await page.locator('.welcome').getByRole('button', { name: '새 모델', exact: true }).click();
  await page.getByLabel('새 모델 이름').fill(name);
  await page.getByRole('button', { name: '모델 만들기', exact: true }).click();
  await expect(page.locator('.entity-tree > button')).toHaveCount(1);
  await page.locator('.entity-tree > button').click();
  await page.getByLabel('테이블 논리명', { exact: true }).fill(tableName);
  await page.getByLabel('테이블 논리명', { exact: true }).press('Enter');
  await expect(page.locator('.entity-tree > button')).toContainText(tableName);
  await expect(page.locator('.save-state')).toContainText('로컬 복구본 저장됨');
}
async function savedTable(page: Page) {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  return projectNativeDocument(openNativeDocument(readFileSync((await (await waiting).path())!), registry)).allTables[0].logicalName;
}
test('two tabs preserve separate recoveries; restoring forks and deletion affects only the chosen snapshot', async ({ page, context }) => {
  await create(page, '첫째 모델', '첫 탭의 원본');
  const second = await context.newPage(); await create(second, '둘째 모델', '둘째 탭의 원본');
  await page.reload(); await page.getByRole('button', { name: '이 기기의 이전 작업 복구', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '로컬 작업 복구' });
  await expect(dialog.locator('.recovery-entry')).toHaveCount(2);
  await expect(dialog.getByRole('button', { name: '복구: 첫째 모델.exerd', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '복구: 첫째 모델.exerd', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(await savedTable(page)).toBe('첫 탭의 원본');
  await page.locator('.entity-tree > button').click();
  await page.getByLabel('테이블 논리명', { exact: true }).fill('복구 후 별도 편집');
  await page.getByLabel('테이블 논리명', { exact: true }).press('Enter');
  await expect(page.locator('.entity-tree > button')).toContainText('복구 후 별도 편집');
  await expect(page.locator('.save-state')).toContainText('로컬 복구본 저장됨');
  await second.reload(); await second.getByRole('button', { name: '이 기기의 이전 작업 복구', exact: true }).click();
  const otherDialog = second.getByRole('dialog', { name: '로컬 작업 복구' });
  await expect(otherDialog.locator('.recovery-entry')).toHaveCount(3);
  // The older snapshot remains unchanged after another tab restores and edits it.
  await otherDialog.getByRole('button', { name: '복구: 첫째 모델.exerd', exact: true }).last().click();
  expect(await savedTable(second)).toBe('첫 탭의 원본');
  await second.getByRole('button', { name: '로컬 작업 복구', exact: true }).click();
  await expect(otherDialog.locator('.recovery-entry')).toHaveCount(4);
  await otherDialog.getByRole('button', { name: '복구본 삭제: 둘째 모델.exerd', exact: true }).click();
  await expect(otherDialog.locator('.recovery-entry')).toHaveCount(4);
  await otherDialog.getByRole('button', { name: '삭제 확인: 둘째 모델.exerd', exact: true }).click();
  await expect(otherDialog.locator('.recovery-entry')).toHaveCount(3);
  await expect(otherDialog).not.toContainText('둘째 모델.exerd');
  await second.screenshot({ path: 'test-results/recovery-model.png', fullPage: true });
});

test('local storage failure reports failure while native file export remains available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(IDBFactory.prototype, 'open', { value() { throw new DOMException('Injected storage failure', 'QuotaExceededError'); } });
  });
  await page.goto('/'); await page.locator('.welcome').getByRole('button', { name: '새 모델', exact: true }).click();
  await page.getByLabel('새 모델 이름').fill('저장소 실패 검증'); await page.getByRole('button', { name: '모델 만들기', exact: true }).click();
  await expect(page.locator('.entity-tree > button')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('복구본을 저장하지 못했습니다');
  await expect(page.locator('.save-state')).not.toContainText('로컬 복구본 저장됨');
  expect(await savedTable(page)).toBe('새 테이블');
});

test('upgrading the legacy single-slot recovery preserves its native bytes and filename', async ({ page }) => {
  const bytes = [...saveNativeDocument(createNativeDocument('이전 버전 복구'))];
  await page.goto('/');
  await page.evaluate(async data => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('erd-maker-local', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('recovery');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('recovery', 'readwrite');
        tx.objectStore('recovery').put({ filename: '이전 버전.exerd', bytes: new Uint8Array(data), savedAt: Date.now() }, 'current');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, bytes);
  await page.getByRole('button', { name: '이 기기의 이전 작업 복구', exact: true }).click();
  await expect(page.locator('.breadcrumb')).toContainText('이전 버전 복구');
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  const saved = await waiting; expect(saved.suggestedFilename()).toBe('이전 버전.exerd');
  const original = openNativeDocument(new Uint8Array(bytes), registry), restored = openNativeDocument(readFileSync((await saved.path())!), registry);
  expect(restored.container.binary).toEqual(original.container.binary);
  expect(restored.container.xml).toEqual(original.container.xml);
});
