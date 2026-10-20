import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';
import schema from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
test('FK options edit preserves identity, validates deferment, supports undo and survives a real download', async ({
  page,
}) => {
  let d = appendNativeTable(createNativeDocument('FK 옵션 검증'), {
    name: 'child',
    x: 650,
    y: 100,
  });
  let [parent, child] = projectNativeDocument(d).allTables;
  d = mutateNativeDocument(d, {
    type: 'addColumn',
    tableUuid: child.uuid,
    name: 'parent_id',
    dataType: 'BIGINT',
    nullable: true,
  });
  [parent, child] = projectNativeDocument(d).allTables;
  d = mutateNativeDocument(d, {
    type: 'addRelationship',
    name: 'fk_options',
    parentTableUuid: parent.uuid,
    childTableUuid: child.uuid,
    parentColumnUuids: [parent.columns[0].uuid],
    childColumnUuids: [child.columns[1].uuid],
  });
  const before = projectNativeDocument(d).allRelationships[0];
  await page.goto('/');
  await page
    .getByLabel('eXERD 모델 파일', { exact: true })
    .setInputFiles({
      name: 'fk-options.exerd',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(saveNativeDocument(d)),
    });
  await page.getByRole('button', { name: '전체 화면에 맞추기', exact: true }).click();
  await page.getByRole('button', { name: '관계 fk_options · public.child', exact: true }).click();
  await page.getByLabel('FK 처음부터 지연', { exact: true }).selectOption('true');
  await expect(page.getByRole('button', { name: 'FK 옵션 적용', exact: true })).toBeDisabled();
  await page.getByLabel('FK 지연 가능', { exact: true }).selectOption('true');
  await page.getByLabel('FK 삭제 동작', { exact: true }).selectOption('SET_NULL');
  await page.getByLabel('FK 갱신 동작', { exact: true }).selectOption('CASCADE');
  await page.getByLabel('FK MATCH 방식', { exact: true }).selectOption('FULL');
  await page.getByLabel('FK NOT VALID · 기존 행 검증 생략', { exact: true }).selectOption('true');
  await page.getByRole('button', { name: 'FK 옵션 적용', exact: true }).click();
  await expect(page.getByRole('button', { name: 'FK 옵션 적용', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByLabel('FK 삭제 동작', { exact: true })).toHaveValue('__UNSET__');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(page.getByLabel('FK 삭제 동작', { exact: true })).toHaveValue('SET_NULL');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  const downloaded = await waiting;
  const saved = openNativeDocument(
      readFileSync((await downloaded.path())!),
      schema as BinaryRegistry,
    ),
    after = projectNativeDocument(saved).allRelationships[0];
  expect(after).toMatchObject({
    uuid: before.uuid,
    constraintUuid: before.constraintUuid,
    parentKeyUuid: before.parentKeyUuid,
    childColumnUuids: before.childColumnUuids,
    parentColumnUuids: before.parentColumnUuids,
    identifying: false,
    childCardinality: before.childCardinality,
  });
  expect(generateNativeDdl(saved).sql).toContain(
    'MATCH FULL ON DELETE SET NULL ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID',
  );
  expect(
    projectNativeDocument(saved).allTables.find((t) => t.uuid === child.uuid)!.columns[1],
  ).toMatchObject({ nullable: true, primaryKey: false });
  mkdirSync('.analysis/compatibility', { recursive: true });
  await downloaded.saveAs('.analysis/compatibility/browser-fk-options.exerd');
  await page.screenshot({ path: 'test-results/fk-options.png', fullPage: true });
});
