/** Create independent per-product FK-option fixtures; originals are never modified. */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import {
  createNativeDocument,
  appendNativeTable,
  NATIVE_DATABASE_PRODUCTS,
} from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';

const output = resolve(process.argv[2] || '');
if (!process.argv[2] || !output.startsWith(resolve('.analysis') + sep) || existsSync(output))
  throw new Error('결과는 .analysis 아래의 새 디렉터리에만 생성할 수 있습니다.');
mkdirSync(output, { recursive: true });
const samples: object[] = [];
for (const product of NATIVE_DATABASE_PRODUCTS) {
  let d = appendNativeTable(
    createNativeDocument('독립 FK 옵션 검증', { database: { productId: product.productId } }),
    { name: 'child' },
  );
  let [parent, child] = projectNativeDocument(d).allTables;
  d = mutateNativeDocument(d, {
    type: 'addColumn',
    tableUuid: child.uuid,
    name: 'parent_id',
    dataType: parent.columns[0].type,
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
  const relation = projectNativeDocument(d).allRelationships[0],
    values: Record<string, string> = {};
  for (const option of relation.options) {
    if (['onDeleteRule', 'deleteRule', 'onDeleteReferentialAction'].includes(option.name))
      values[option.name] = product.namespace.includes('tibero') ? 'SET NULL' : 'CASCADE';
    else if (['onUpdateRule', 'onUpdateReferentialAction'].includes(option.name))
      values[option.name] = option.choices?.includes('CASCADE') ? 'CASCADE' : 'RESTRICT';
    else if (
      [
        'deferrable',
        'deferred',
        'useIndexing',
        'notForReplication',
        'generated',
        'status',
      ].includes(option.name)
    )
      values[option.name] = 'true';
    else if (['enabled', 'enable'].includes(option.name)) values[option.name] = 'false';
    else if (option.name === 'validated')
      values[option.name] = product.namespace.includes('oracle') ? 'false' : 'true';
    else if (option.name === 'match' && product.namespace.includes('postgresql'))
      values.match = 'FULL';
  }
  d = mutateNativeDocument(d, {
    type: 'editForeignKeyOptions',
    foreignKeyUuid: relation.uuid,
    values,
  });
  const filename = product.productId.split('.').at(-1)! + '-fk-options.exerd',
    bytes = saveNativeDocument(d);
  writeFileSync(resolve(output, filename), bytes, { flag: 'wx' });
  samples.push({
    productId: product.productId,
    file: relative(process.cwd(), resolve(output, filename)),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    options: values,
    groupUuid: relation.uuid,
    constraintUuid: relation.constraintUuid,
    originalReaderVerified: false,
    liveDatabaseVerified: false,
  });
}
writeFileSync(
  resolve(output, 'manifest.json'),
  JSON.stringify(
    {
      scope: 'independent FK option model fixtures; no live database or GUI verification',
      samples,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ generated: samples.length, output: relative(process.cwd(), output) }));
