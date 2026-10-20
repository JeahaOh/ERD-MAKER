import { expect, test } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { createNativeDocument } from '../../src/formats/exerd/create';
import {
  editNativeAttributes,
  saveNativeDocument,
  openNativeDocument,
} from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import {
  createTermDictionary,
  upsertTag,
  upsertTerm,
  saveTermDictionary,
  openTermDictionary,
} from '../../src/formats/terms/dictionary';
import { importTermXlsx, importTermCsv } from '../../src/formats/terms/exchange';
import schema from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
test('dictionary editing, exchange, recovery, model linking and naming policy are real file operations with independent undo', async ({
  page,
}) => {
  let model = createNativeDocument('용어 모델');
  const table = projectNativeDocument(model).allTables[0];
  model = editNativeAttributes(model, schema as BinaryRegistry, [
    { uuid: table.uuid, name: 'logicalName', value: '고객' },
    { uuid: table.columns[0].uuid, name: 'logicalName', value: '번호' },
  ]);
  model = mutateNativeDocument(model, {
    type: 'setTermDictionaryPath',
    path: '/missing/original.xdic',
  });
  let d = upsertTag(createTermDictionary(), { name: '공통', description: '표준 태그' });
  for (const [name, physicalName, synonyms] of [
    ['고객', 'CUST', ['회원']],
    ['번호', 'ID', ['식별자']],
  ] as const)
    d = upsertTerm(d, {
      name,
      physicalName,
      synonyms: [...synonyms],
      physicalSynonyms: [],
      description: '줄1\n줄2 & 내용',
      physicalDescription: '',
      tags: ['tag:0'],
    });
  await page.goto('/');
  await page.getByLabel('eXERD 모델 파일', { exact: true }).setInputFiles({
    name: 'terms-model.exerd',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(saveNativeDocument(model)),
  });
  await page.getByRole('button', { name: '용어사전 열기', exact: true }).click();
  await page.getByLabel('용어사전 파일', { exact: true }).setInputFiles({
    name: 'standard.xdic',
    mimeType: 'application/xml',
    buffer: Buffer.from(saveTermDictionary(d)),
  });
  await expect(page.getByText('가져오기 검토: standard.xdic', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '가져온 사전으로 교체', exact: true }).click();
  await expect(page.locator('.term-list button')).toHaveCount(2);
  await page.getByRole('button', { name: '사전 실행 취소', exact: true }).click();
  await expect(page.locator('.term-list button')).toHaveCount(0);
  await page.getByRole('button', { name: '사전 다시 실행', exact: true }).click();
  await expect(page.locator('.term-list button')).toHaveCount(2);
  await page.locator('.term-list button').filter({ hasText: 'CUST' }).click();
  await page.getByLabel('사전 물리 설명', { exact: true }).fill('CUSTOMER');
  await page.getByRole('button', { name: '용어 변경 적용', exact: true }).click();
  await page.getByRole('button', { name: '사전 실행 취소', exact: true }).click();
  await page.locator('.term-list button').filter({ hasText: 'CUST' }).click();
  await expect(page.getByLabel('사전 물리 설명', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '사전 다시 실행', exact: true }).click();
  const save = page.waitForEvent('download');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  const xdic = await save;
  expect(xdic.suggestedFilename()).toBe('standard.xdic');
  const parsed = openTermDictionary(readFileSync((await xdic.path())!));
  expect(parsed.terms[0]).toMatchObject({
    physicalDescription: 'CUSTOMER',
    synonyms: ['회원'],
    tags: ['tag:0'],
    description: '줄1\n줄2 & 내용',
  });
  await page.getByText('태그 · 구분자 · 파일 교환', { exact: true }).click();
  await page.getByRole('button', { name: '구분자 저장', exact: true }).click();
  const finalWaiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '사전 저장', exact: true }).click();
  const finalDictionary = await finalWaiting;
  expect(openTermDictionary(readFileSync((await finalDictionary.path())!)).delimiters).toHaveLength(
    1,
  );
  let waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '사전 XLSX 내보내기', exact: true }).click();
  const xlsx = await waiting;
  expect(importTermXlsx(readFileSync((await xlsx.path())!)).terms).toEqual(parsed.terms);
  waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '사전 CSV 내보내기', exact: true }).click();
  expect(importTermCsv(readFileSync((await (await waiting).path())!, 'utf8')).terms).toEqual(
    parsed.terms,
  );
  await page.getByText('이름 정책 · 모델 적용', { exact: true }).click();
  await expect(page.getByText(/현재 모델의 사전 경로:/)).toContainText('/missing/original.xdic');
  await page.getByRole('button', { name: '현재 사전 경로 연결', exact: true }).click();
  await expect(page.getByText(/현재 모델의 사전 경로:/)).toContainText('standard.xdic');
  await page.getByRole('button', { name: '이름 변환 미리보기', exact: true }).click();
  await expect(page.locator('.term-proposals tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: '선택 이름 적용', exact: true }).click();
  await expect(
    page.getByText('이름을 한 번의 변경으로 적용했습니다. 모델 파일도 저장하세요.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  let saved = openNativeDocument(
    readFileSync((await (await waiting).path())!),
    schema as BinaryRegistry,
  );
  expect(projectNativeDocument(saved).allTables[0].name).toBe('new_table');
  expect(projectNativeDocument(saved).termFilePath).toBe('standard.xdic');
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '파일 저장', exact: true }).click();
  const renamed = await waiting;
  saved = openNativeDocument(readFileSync((await renamed.path())!), schema as BinaryRegistry);
  expect(projectNativeDocument(saved).allTables[0]).toMatchObject({
    uuid: table.uuid,
    name: 'CUST',
  });
  expect(projectNativeDocument(saved).allTables[0].columns[0]).toMatchObject({
    uuid: table.columns[0].uuid,
    name: 'ID',
    primaryKey: true,
  });
  mkdirSync('.analysis/compatibility', { recursive: true });
  await renamed.saveAs('.analysis/compatibility/browser-naming-policy.exerd');
  await finalDictionary.saveAs('.analysis/compatibility/browser-terms.xdic');
  await xlsx.saveAs('.analysis/compatibility/browser-terms.xlsx');
  await page.reload();
  await page.getByRole('button', { name: '용어사전 열기', exact: true }).click();
  await expect(page.locator('.term-list button')).toHaveCount(2);
  await page.locator('.term-list button').filter({ hasText: 'CUST' }).click();
  await expect(page.getByLabel('사전 물리 설명', { exact: true })).toHaveValue('CUSTOMER');
  await page.screenshot({ path: 'test-results/term-dictionary.png', fullPage: true });
});

test('dictionary remains downloadable when local recovery storage fails and invalid imports preserve the current draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, 'setItem', {
      configurable: true,
      value() {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '용어사전 열기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('사전 복구본 저장에 실패');
  await page.getByLabel('사전 용어명', { exact: true }).fill('저장 검증');
  await page.getByLabel('사전 물리 약어', { exact: true }).fill('SAVE_TEST');
  await page.getByLabel('사전 용어 설명', { exact: true }).fill('첫 줄\n둘째 줄');
  await page.getByRole('button', { name: '용어 추가', exact: true }).click();
  await expect(page.locator('.term-list button')).toHaveCount(1);
  await page
    .getByLabel('용어사전 파일', { exact: true })
    .setInputFiles({
      name: 'invalid.xdic',
      mimeType: 'application/xml',
      buffer: Buffer.from('<bad/>'),
    });
  await expect(page.getByRole('alert')).toContainText('TermDictionary');
  await expect(page.locator('.term-list button')).toHaveCount(1);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: '사전 저장', exact: true }).click();
  const saved = openTermDictionary(readFileSync((await (await waiting).path())!));
  expect(saved.terms[0]).toMatchObject({
    name: '저장 검증',
    physicalName: 'SAVE_TEST',
    description: '첫 줄\n둘째 줄',
  });
});
