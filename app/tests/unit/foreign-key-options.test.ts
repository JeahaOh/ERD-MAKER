import { describe, expect, it } from 'vitest';
import {
  appendNativeTable,
  createNativeDocument,
  nativeGraph,
  NATIVE_DATABASE_PRODUCTS,
} from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { compareNativeDocuments } from '../../src/formats/exerd/compare';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';
import schema from '../../src/formats/exerd/schema.generated.json';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
function fixture(productId = 'com.tomato.db.postgresql') {
  let d = appendNativeTable(
    createNativeDocument('FK options', {
      database: { productId: productId as (typeof NATIVE_DATABASE_PRODUCTS)[number]['productId'] },
    }),
    { name: 'child' },
  );
  let [p, c] = projectNativeDocument(d).allTables;
  d = mutateNativeDocument(d, {
    type: 'addColumn',
    tableUuid: c.uuid,
    name: 'parent_id',
    dataType: p.columns[0].type,
    nullable: true,
  });
  [p, c] = projectNativeDocument(d).allTables;
  return mutateNativeDocument(d, {
    type: 'addRelationship',
    name: 'fk_parent',
    parentTableUuid: p.uuid,
    childTableUuid: c.uuid,
    parentColumnUuids: [p.columns[0].uuid],
    childColumnUuids: [c.columns[1].uuid],
  });
}
function edit(d: ReturnType<typeof fixture>, values: Record<string, string | null>) {
  const next = mutateNativeDocument(d, {
    type: 'editForeignKeyOptions',
    foreignKeyUuid: projectNativeDocument(d).allRelationships[0].uuid,
    values,
  });
  return openNativeDocument(saveNativeDocument(next), schema as BinaryRegistry);
}
describe('DB-specific native FK options', () => {
  it.each(NATIVE_DATABASE_PRODUCTS.map((p) => p.productId))(
    'preserves FK identity and mapping when editing %s',
    (product) => {
      const d = fixture(product),
        before = projectNativeDocument(d).allRelationships[0],
        bytes = saveNativeDocument(d);
      const deletion = before.options.find((o) =>
        ['onDeleteRule', 'deleteRule', 'onDeleteReferentialAction'].includes(o.name),
      )!;
      const next = edit(d, { [deletion.name]: 'CASCADE', useIndexing: 'true' }),
        after = projectNativeDocument(next).allRelationships[0];
      expect(after).toMatchObject({
        uuid: before.uuid,
        constraintUuid: before.constraintUuid,
        parentKeyUuid: before.parentKeyUuid,
        parentColumnUuids: before.parentColumnUuids,
        childColumnUuids: before.childColumnUuids,
        identifying: before.identifying,
        childCardinality: before.childCardinality,
      });
      expect(after.options.find((o) => o.name === deletion.name)?.value).toBe('CASCADE');
      expect(nativeGraph.field(next.byUuid.get(before.uuid)!, 'useIndexing')).toBe(true);
      expect(saveNativeDocument(d)).toEqual(bytes);
      expect(
        compareNativeDocuments(d, next).changes.every((c) =>
          [deletion.name, 'useIndexing'].includes(c.feature || ''),
        ),
      ).toBe(true);
    },
  );
  it('updates PG SQL options atomically and removes explicit values without changing nullability or cardinality', () => {
    const d = fixture(),
      before = projectNativeDocument(d),
      next = edit(d, {
        onDeleteRule: 'SET_NULL',
        onUpdateRule: 'CASCADE',
        deferrable: 'true',
        deferred: 'true',
        validated: 'true',
        match: 'FULL',
      });
    const ddl = generateNativeDdl(next).sql;
    expect(ddl).toContain(
      'MATCH FULL ON DELETE SET NULL ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED NOT VALID',
    );
    expect(projectNativeDocument(next).allTables).toEqual(before.allTables);
    expect(projectNativeDocument(next).allRelationships[0].childCardinality).toBe(
      before.allRelationships[0].childCardinality,
    );
    const cleared = edit(next, { onDeleteRule: null, deferred: null, validated: null });
    expect(
      projectNativeDocument(cleared).allRelationships[0].options.find(
        (o) => o.name === 'onDeleteRule',
      )?.value,
    ).toBe(null);
    expect(generateNativeDdl(cleared).sql).not.toContain('ON DELETE SET NULL');
  });
  it('rejects invalid combinations, unsupported DB fields and nullable/default conflicts without partial edits', () => {
    const d = fixture(),
      r = projectNativeDocument(d).allRelationships[0],
      bytes = saveNativeDocument(d);
    for (const values of [
      { deferred: 'true' },
      { onDeleteRule: 'SET_DEFAULT' },
      { onDeleteRule: 'INVALID' },
      { onDeleteRule: 'SET NULL' },
      { match: 'PARTIAL' },
      { physicalName: 'changed' },
    ])
      expect(() => edit(d, values)).toThrow();
    expect(saveNativeDocument(d)).toEqual(bytes);
    const child = projectNativeDocument(d).allTables.find((t) => t.name === 'child')!;
    const identifying = mutateNativeDocument(d, {
      type: 'editRelationship',
      foreignKeyUuid: r.uuid,
      identifying: true,
    });
    expect(() => edit(identifying, { onDeleteRule: 'SET_NULL' })).toThrow('NULL');
    expect(
      projectNativeDocument(identifying)
        .allTables.find((t) => t.uuid === child.uuid)!
        .columns.every((c) => c.primaryKey),
    ).toBe(true);
    expect(() => edit(fixture('com.tomato.db.mysql'), { onDeleteRule: 'SET DEFAULT' })).toThrow();
    expect(() => edit(fixture('com.tomato.db.mysql'), { deferrable: 'true' })).toThrow();
  });
});
