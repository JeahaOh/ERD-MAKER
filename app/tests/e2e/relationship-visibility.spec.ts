import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
const registry = JSON.parse(readFileSync('app/src/formats/exerd/schema.generated.json', 'utf8')) as BinaryRegistry;

test('diagram relationship visibility persists without deleting the foreign key and supports undo/redo', async ({ page }) => {
  let document = appendNativeTable(createNativeDocument('관계 표시 검증'), { name: 'child', x: 650, y: 100 });
  const [parent, child] = projectNativeDocument(document).allTables;
  document = mutateNativeDocument(document, { type: 'addRelationship', name: 'fk_visibility', parentTableUuid: parent.uuid, childTableUuid: child.uuid, parentColumnUuids: [parent.columns[0].uuid], childColumnUuids: [child.columns[0].uuid] });
  const diagramUuid = projectNativeDocument(document).diagrams[0].uuid, originalSql = generateNativeDdl(document).sql;
  await page.goto('/');
  await page.getByLabel('eXERD 모델 파일', { exact: true }).setInputFiles({ name: '관계 표시.exerd', mimeType: 'application/octet-stream', buffer: Buffer.from(saveNativeDocument(document)) });
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByText('모델 관리', { exact: true }).click(); await page.getByRole('button', { name: '관계 표시·숨김', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '다이어그램 관계 표시' });
  const checkbox = page.getByLabel('관계 표시: fk_visibility', { exact: true });
  // The authoritative checked state comes back asynchronously from the Worker.
  await checkbox.click(); await expect(checkbox).not.toBeChecked();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('1 관계');
  await dialog.locator('footer').getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click(); await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click(); await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  const saved = openNativeDocument(readFileSync((await (await waiting).path())!), registry);
  expect(projectNativeDocument(saved, diagramUuid).relationships).toHaveLength(0);
  expect(projectNativeDocument(saved).allRelationships).toHaveLength(1);
  expect(generateNativeDdl(saved).sql).toBe(originalSql);
  await page.getByRole('button', { name: 'SQL', exact: true }).click();
  await expect(page.getByLabel('생성 SQL')).toContainText('FOREIGN KEY');
});
