import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { generateNativeOracleDdl } from '../../src/formats/sql/native-oracle-ddl';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryRegistry, BinaryValue } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';
const R = (ref: number) => ({ ref });
const field = (object: BinaryObject, name: string) => object.features.find(feature => feature.name === name)?.value;
const uuid = (object: BinaryObject) => field(object, 'UUID') as string;
const named = (document: NativeExerdDocument, type: string, name: string) => document.graph.objects.find(object => object.class.name === type && field(object, 'physicalName') === name)!;
function set(object: BinaryObject, name: string, value: BinaryValue) { const existing = object.features.find(feature => feature.name === name); if (existing) existing.value = value; else object.features.push({ id: object.features.length, name, kind: 'DATA', value }); }
function extension(document: NativeExerdDocument, name: string, values: Record<string, BinaryValue>, dialect: 'oracle' | 'tibero' = 'oracle') {
  const object: BinaryObject = { id: Math.max(...document.graph.objects.map(object => object.id)) + 1, class: { packageUri: dialect === 'oracle' ? 'http://exerd.tomato.com/oracle10g' : 'http://exerd.tomato.com/tibero/model', name }, features: [] };
  for (const [key, value] of Object.entries(values)) set(object, key, value); document.graph.objects.push(object); return object;
}
function props(document: NativeExerdDocument, owner: BinaryObject, name: string, values: Record<string, BinaryValue>, dialect: 'oracle' | 'tibero' = 'oracle') { const object = extension(document, name, values, dialect); set(owner, 'physicalProperties', R(object.id)); return object; }
function fixture(dialect: 'oracle' | 'tibero' = 'oracle') {
  let document = appendNativeTable(createNativeDocument('한글 DDL 독립 모델', { database: { productId: dialect === 'oracle' ? 'com.tomato.db.oracle_10g' : 'com.tomato.db.tibero' } }), { name: 'child' });
  const parentId = uuid(named(document, 'Table', 'new_table')), childId = uuid(named(document, 'Table', 'child'));
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: parentId, name: 'code', dataType: 'VARCHAR2(20)', nullable: false });
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: childId, name: 'parent_id', dataType: 'INTEGER' });
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: childId, name: 'code', dataType: 'VARCHAR2(20)' });
  const parent = named(document, 'Table', 'new_table'), child = named(document, 'Table', 'child');
  const columns = (object: BinaryObject) => (field(object, 'columns') as { ref: number }[]).map(reference => document.graph.objects.find(object => object.id === reference.ref)!);
  const pc = columns(parent), cc = columns(child);
  document = mutateNativeDocument(document, { type: 'setPrimaryKey', tableUuid: parentId, columnUuids: pc.map(uuid) });
  document = mutateNativeDocument(document, { type: 'addRelationship', name: 'fk_child_parent', parentTableUuid: parentId, childTableUuid: childId, parentColumnUuids: pc.map(uuid), childColumnUuids: [uuid(cc[1]), uuid(cc[2])] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: parentId, kind: 'unique', name: 'uk_code', columnUuids: [uuid(pc[1])] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: childId, kind: 'index', name: 'ix_child', columnUuids: [uuid(cc[2]), uuid(cc[1])], sortTypes: ['DESC', 'ASC'] });
  document = mutateNativeDocument(document, { type: 'addCheckConstraint', tableUuid: parentId, name: 'ck_code', expression: 'id > 0 AND code <> \';--\'' });
  set(named(document, 'Table', 'new_table'), 'comment', "고객's 테이블");
  return document;
}
describe.each(['oracle', 'tibero'] as const)('%s native DDL', dialect => {
  it('exports native composite PK/FK, unique, index order, CHECK, Korean comments and nullability without graph edits', () => {
    const document = fixture(dialect), before = structuredClone(document.graph), result = generateNativeOracleDdl(document, { dialect });
    expect(result.complete).toBe(true); expect(result.executionVerified).toBe(false); expect(result.unsupported).toEqual([]);
    expect(result.sql).toContain('PRIMARY KEY ("id", "code")'); expect(result.sql).toContain('UNIQUE ("code")');
    expect(result.sql).toContain('("code" DESC, "parent_id" ASC)');
    expect(result.sql).toContain('FOREIGN KEY ("parent_id", "code") REFERENCES "default_schema"."new_table" ("id", "code")');
    expect(result.sql).toContain('CHECK ("id" > 0 AND "code" <> \';--\')');
    expect(result.sql).toContain("IS '고객''s 테이블'"); expect(result.sql).toContain('"id" INTEGER NOT NULL');
    expect(result.sql).not.toContain('CREATE SCHEMA'); expect(result.statistics).toMatchObject({ tables: 2, columns: 5, primaryKeys: 2, foreignKeys: 1, uniqueConstraints: 1, indexes: dialect === 'oracle' ? 4 : 1, checks: 1 });
    expect(document.graph).toEqual(before);
  });
  it('rejects cross-product conversion and identifies partial selections and unsupported physical semantics', () => {
    const document = fixture(dialect), table = named(document, 'Table', 'child');
    expect(generateNativeOracleDdl(document, { dialect: dialect === 'oracle' ? 'tibero' : 'oracle' })).toMatchObject({ sql: '', complete: false });
    const result = generateNativeOracleDdl(document, { dialect, tableUuids: [uuid(table)] });
    expect(result.statistics.tables).toBe(1); expect(result.sql).not.toContain('CREATE TABLE "default_schema"."new_table"');
    expect(result.unsupported.map(item => item.code)).toContain('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY');
    expect(generateNativeOracleDdl(document, { dialect, tableUuids: [] }).sql).toBe('');
    const properties = props(document, table, 'TableProperties', { newUnknownOption: 123 }, dialect);
    expect(generateNativeOracleDdl(document, { dialect }).unsupported).toContainEqual(expect.objectContaining({ code: 'PHYSICAL_PROPERTY_NOT_IMPLEMENTED', uuid: `binary:${properties.id}`, feature: 'newUnknownOption' }));
  });
});
describe('separate Oracle and Tibero physical properties', () => {
  it('makes Oracle table getter defaults explicit rather than inheriting tablespace logging or compression', () => {
    const document = fixture(), before = structuredClone(document.graph);
    const defaults = generateNativeOracleDdl(document, { dialect: 'oracle' });
    expect(defaults.sql).toContain('LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT');
    expect(document.graph).toEqual(before);
    props(document, named(document, 'Table', 'new_table'), 'TableProperties', { logging: false, compression: true, cache: true, rowDependencies: true, rowMovement: true });
    expect(generateNativeOracleDdl(document, { dialect: 'oracle' }).sql).toContain('NOLOGGING COMPRESS CACHE ROWDEPENDENCIES ENABLE ROW MOVEMENT');
  });
  it('preserves original implicit Oracle UNIQUE/NOLOGGING and Tibero CASCADE/UNLIMITED defaults', () => {
    const oracle = fixture(), index = named(oracle, 'InversionEntryColumnGroup', 'ix_child');
    props(oracle, index, 'IndexProperties', {});
    expect(generateNativeOracleDdl(oracle, { dialect: 'oracle' }).sql).toContain('CREATE UNIQUE INDEX "default_schema"."ix_child" ON "default_schema"."child" ("code" DESC, "parent_id" ASC) NOLOGGING');
    const tibero = fixture('tibero'), fk = named(tibero, 'ForeignKeyConstraint', 'fk_child_parent');
    const cp = props(tibero, fk, 'ForeignKeyConstraintProperties', {}, 'tibero');
    const storage = extension(tibero, 'Storage', { maxExtents: 32n }, 'tibero'), segment = extension(tibero, 'SegmentAttribute', { storage: R(storage.id) }, 'tibero');
    props(tibero, named(tibero, 'Table', 'new_table'), 'TableProperties', { segmentAttribute: R(segment.id) }, 'tibero');
    const inherited = generateNativeOracleDdl(tibero, { dialect: 'tibero' });
    expect(inherited.sql).toContain('ON DELETE CASCADE'); expect(inherited.sql).toContain('MAXEXTENTS UNLIMITED'); expect(inherited.sql).not.toContain('MAXEXTENTS 32');
    set(cp, 'onDeleteRule', ''); expect(generateNativeOracleDdl(tibero, { dialect: 'tibero' }).sql).not.toContain('ON DELETE');
  });
  it('uses Oracle state/deleteRule/storage spelling and supports deferrable keys with nonunique indexes', () => {
    const document = fixture(), table = named(document, 'Table', 'new_table'), pk = named(document, 'PrimaryKeyConstraint', 'pk_new_table'), fk = named(document, 'ForeignKeyConstraint', 'fk_child_parent');
    const detail = extension(document, 'StorageDetail', { initialExtentSize: 65536n, nextExtentSize: 131072n, minExtents: 1n, maxExtents: 9n, percentIncrease: 0, bufferPool: 'KEEP' });
    const storage = extension(document, 'PhysicalStorageAttributes', { freeSpacePercent: 15, usedSpacePercent: 40, initialTransations: 3, storage: R(detail.id) });
    props(document, table, 'TableProperties', { tablespaceName: 'USERS', storageAttributes: R(storage.id), logging: false, compression: true, rowMovement: true, rowDependencies: true });
    props(document, pk, 'PrimaryKeyConstraintProperties', { deferrable: true, deferred: true, enabled: false, validated: false });
    props(document, named(document, 'PrimaryKeyColumnGroup', 'pk_new_table'), 'IndexProperties', { uniqueness: 'NONUNIQUE' });
    props(document, fk, 'ForeignKeyConstraintProperties', { deleteRule: 'CASCADE', enabled: false });
    const result = generateNativeOracleDdl(document, { dialect: 'oracle' });
    expect(result.complete).toBe(true); expect(result.sql).toContain('PCTFREE 15 PCTUSED 40 INITRANS 3 STORAGE (INITIAL 65536 NEXT 131072 MINEXTENTS 1 MAXEXTENTS 9 PCTINCREASE 0 BUFFER_POOL KEEP)');
    expect(result.sql).toContain('TABLESPACE "USERS"'); expect(result.sql).toContain('NOLOGGING COMPRESS NOCACHE ROWDEPENDENCIES ENABLE ROW MOVEMENT');
    expect(result.sql).toContain('CREATE INDEX "default_schema"."pk_new_table"'); expect(result.sql).not.toContain('CREATE UNIQUE INDEX "default_schema"."pk_new_table"');
    expect(result.sql).toContain('DEFERRABLE INITIALLY DEFERRED DISABLE NOVALIDATE'); expect(result.sql).toContain('ON DELETE CASCADE'); expect(result.sql).not.toContain('ON UPDATE');
    expect(result.sql).not.toContain('USING INDEX "default_schema"."pk_new_table"');
  });
  it('uses Tibero SegmentAttribute and onDeleteRule while refusing to guess the status flag', () => {
    const document = fixture('tibero'), table = named(document, 'Table', 'new_table'), fk = named(document, 'ForeignKeyConstraint', 'fk_child_parent');
    const detail = extension(document, 'Storage', { maxExtentsType: 'UNLIMITED', bufferPool: 'RECYCLE' }, 'tibero');
    const segment = extension(document, 'SegmentAttribute', { freeSpacePercent: 11, initialTransactions: 5, logging: false, storage: R(detail.id) }, 'tibero');
    props(document, table, 'TableProperties', { tablespaceName: 'USERS', segmentAttribute: R(segment.id), compress: true }, 'tibero');
    props(document, fk, 'ForeignKeyConstraintProperties', { onDeleteRule: 'SET NULL', status: true }, 'tibero');
    const result = generateNativeOracleDdl(document, { dialect: 'tibero' });
    expect(result.sql).toContain('PCTFREE 11 INITRANS 5 NOLOGGING STORAGE (MAXEXTENTS UNLIMITED BUFFER_POOL RECYCLE) COMPRESS TABLESPACE "USERS"');
    expect(result.sql).toContain('ON DELETE SET NULL'); expect(result.sql).not.toContain('ENABLE VALIDATE');
    expect(result.complete).toBe(false); expect(result.unsupported).toContainEqual(expect.objectContaining({ code: 'PHYSICAL_PROPERTY_NOT_IMPLEMENTED', feature: 'status' }));
  });
  it('keeps null/empty default inheritance and safely handles standard and Oracle alternative literal syntax', () => {
    const document = fixture(), column = named(document, 'Column', 'code');
    const domain = extension(document, 'Domain', { UUID: 'domain', name: 'code', suggestedDataType: 'VARCHAR2(20)', suggestedDefaultValue: "q'[customer's;--name]'" }); domain.class.packageUri = 'http://exerd.tomato.com/model';
    set(column, 'domain', R(domain.id)); set(column, 'defaultValue', null);
    expect(generateNativeOracleDdl(document, { dialect: 'oracle' }).sql).toContain("DEFAULT q'[customer's;--name]'");
    set(column, 'defaultValue', ''); expect(generateNativeOracleDdl(document, { dialect: 'oracle' }).sql).not.toContain("DEFAULT q'");
    set(column, 'defaultValue', '0; DROP TABLE parent');
    expect(generateNativeOracleDdl(document, { dialect: 'oracle' }).diagnostics.map(item => item.code)).toContain('UNSAFE_SQL_FRAGMENT');
  });
  it('reports invalid storage, reverse/descending conflicts and explicit unimplemented index options', () => {
    const document = fixture(), table = named(document, 'Table', 'new_table'), index = named(document, 'InversionEntryColumnGroup', 'ix_child');
    const storage = extension(document, 'PhysicalStorageAttributes', { freeSpacePercent: 120, initialTransations: 0 });
    props(document, table, 'TableProperties', { storageAttributes: R(storage.id) });
    props(document, index, 'IndexProperties', { indexType: 'NORMAL/REV', partitioned: true });
    const result = generateNativeOracleDdl(document, { dialect: 'oracle' });
    expect(result.complete).toBe(false); expect(result.diagnostics.map(item => item.code)).toContain('INVALID_PHYSICAL_INTEGER');
    expect(result.diagnostics.map(item => item.code)).toContain('INCOMPATIBLE_INDEX_OPTIONS');
    expect(result.unsupported).toContainEqual(expect.objectContaining({ feature: 'partitioned' }));
  });
  it('exports Oracle sequences before defaults and flags invalid zero increments', () => {
    const document = fixture(), owner = document.graph.objects.find(object => object.class.name === 'Schema')!;
    const sequence = extension(document, 'Sequence', { physicalName: 'customer_seq', start: '100', increment: '2', minValue: '1', maxValue: '9999', cache: '0', cycle: false, order: true });
    const group = extension(document, 'SequenceGroup', { sequences: [R(sequence.id)] });
    props(document, owner, 'SchemaProperties', { sequenceGroup: R(group.id) });
    const result = generateNativeOracleDdl(document, { dialect: 'oracle' });
    expect(result.complete).toBe(true); expect(result.statistics.sequences).toBe(1);
    expect(result.sql).toContain('CREATE SEQUENCE "default_schema"."customer_seq" START WITH 100 INCREMENT BY 2 MINVALUE 1 MAXVALUE 9999 NOCACHE NOCYCLE ORDER;');
    expect(result.sql.indexOf('CREATE SEQUENCE')).toBeLessThan(result.sql.indexOf('CREATE TABLE'));
    set(sequence, 'increment', '0'); expect(generateNativeOracleDdl(document, { dialect: 'oracle' }).diagnostics.map(item => item.code)).toContain('INVALID_SEQUENCE_INTEGER');
  });
});
for (const dialect of ['oracle', 'tibero'] as const) {
  const path = `.analysis/db-matrix/original-generated/${dialect}-original-factory.exerd`;
  describe.skipIf(!existsSync(path))(`${dialect} original factory model`, () => {
    it('reads native DB identity and preserves observed tablespace, PK/FK and actual column names', () => {
      const document = openNativeDocument(readFileSync(path), schema as BinaryRegistry), before = structuredClone(document.graph);
      const result = generateNativeOracleDdl(document, { dialect });
      expect(result.complete).toBe(true); expect(result.statistics).toMatchObject({ tables: 2, columns: 3, primaryKeys: 2, foreignKeys: 1 });
      expect(result.sql).toContain('TABLESPACE "USERS"'); expect(result.sql).toContain('"factory_parent"'); expect(result.sql).toContain('"parent_id"');
      if (dialect === 'tibero') expect(result.sql).toContain('ON DELETE CASCADE');
      expect(document.graph).toEqual(before);
    });
  });
}

const guiDirectory = '.analysis/oracle/ui/input/enterprise-comparison-v1';
describe.skipIf(!existsSync(`${guiDirectory}/oracle-original-headless-forward-v3.sql`))('Oracle original headless generation API', () => {
  it('compares fixed native input with original API defaults, ordered keys, index names and comment values', () => {
    const document = openNativeDocument(readFileSync(`${guiDirectory}/oracle-independent-ddl-sequence-v2.exerd`), schema as BinaryRegistry), before = structuredClone(document.graph);
    const original = readFileSync(`${guiDirectory}/oracle-original-headless-forward-v3.sql`, 'utf8').replace(/\s+/g, ' ').replaceAll('( ', '(').replaceAll(' )', ')');
    const result = generateNativeOracleDdl(document, { dialect: 'oracle' }), output = result.sql.replace(/\s+/g, ' ');
    for (const clause of ['TABLESPACE "USERS" LOGGING NOCOMPRESS NOCACHE NOROWDEPENDENCIES DISABLE ROW MOVEMENT', 'CONSTRAINT "pk_new_table" PRIMARY KEY ("id", "code")', 'CONSTRAINT "uk_code" UNIQUE ("code")', 'CONSTRAINT "pk_child" PRIMARY KEY ("id")', 'FOREIGN KEY ("parent_id", "code") REFERENCES "default_schema"."new_table" ("id", "code")', '"code" DESC, "parent_id" ASC', "IS '고객''s 테이블'"]) {
      expect(original).toContain(clause); expect(output).toContain(clause);
    }
    for (const index of ['pk_new_table', 'uk_code', 'pk_child', 'ix_child']) {
      expect(original).toContain(`INDEX "default_schema"."${index}"`); expect(output).toContain(`INDEX "default_schema"."${index}"`);
    }
    expect(original).toContain('NOLOGGING NOCOMPRESS'); expect(output).toContain('NOLOGGING');
    expect(original).toContain('MONITORING'); expect(output).not.toContain('MONITORING');
    expect(output).toContain('USING INDEX "default_schema"."pk_new_table"');
    expect(result.complete).toBe(true); expect(result.executionVerified).toBe(false); expect(document.graph).toEqual(before);
  });
});
describe.skipIf(!existsSync(`${guiDirectory}/tibero-original-forward.sql`))('Tibero actual original GUI export', () => {
  it('compares named objects and ordered mappings while retaining explicit SQL differences', () => {
    const document = openNativeDocument(readFileSync(`${guiDirectory}/tibero-independent-ddl.exerd`), schema as BinaryRegistry);
    const original = readFileSync(`${guiDirectory}/tibero-original-forward.sql`, 'utf8'), output = generateNativeOracleDdl(document, { dialect: 'tibero' });
    // Strip only actual line comments: the CHECK literal contains ;-- as data.
    let cleaned = '', quote = '';
    for (let index = 0; index < original.length; index++) {
      const char = original[index];
      if (quote) { cleaned += char; if (char === quote) { if (original[index + 1] === quote) cleaned += original[++index]; else quote = ''; } continue; }
      if (char === "'" || char === '"') { quote = char; cleaned += char; continue; }
      if (original.startsWith('--', index)) { while (index < original.length && original[index] !== '\n') index++; cleaned += ' '; } else cleaned += char;
    }
    const originalSql = cleaned.replace(/\s+/g, ' '), appSql = output.sql.replace(/\s+/g, ' ');
    for (const clause of ['CREATE TABLE "default_schema"."new_table"', 'CREATE TABLE "default_schema"."child"', '"id" INTEGER NOT NULL', '"code" VARCHAR2(20) NOT NULL', '"parent_id" INTEGER NULL', 'CONSTRAINT "pk_new_table" PRIMARY KEY ( "id", "code" )', 'CONSTRAINT "uk_code" UNIQUE ( "code" )', 'CONSTRAINT "pk_child" PRIMARY KEY ( "id" )']) {
      const comparable = clause.replaceAll('( ', '(').replaceAll(' )', ')');
      expect(originalSql.replaceAll('( ', '(').replaceAll(' )', ')')).toContain(comparable);
      expect(appSql).toContain(comparable);
    }
    const compactOriginal = originalSql.replaceAll('( ', '(').replaceAll(' )', ')');
    expect(compactOriginal).toContain('FOREIGN KEY ("parent_id", "code") REFERENCES "default_schema"."new_table" ("id", "code")');
    expect(appSql).toContain('FOREIGN KEY ("parent_id", "code") REFERENCES "default_schema"."new_table" ("id", "code")');
    expect(compactOriginal).toContain('"code" DESC, "parent_id" ASC'); expect(appSql).toContain('"code" DESC, "parent_id" ASC');
    expect(originalSql).toContain("IS '고객''s 테이블'"); expect(appSql).toContain("IS '고객''s 테이블'");
    for (const key of ['pk_new_table', 'uk_code', 'pk_child']) expect(originalSql).toContain(`CREATE UNIQUE INDEX "default_schema"."${key}"`);
    expect(appSql).not.toContain('CREATE UNIQUE INDEX');
    expect(originalSql).toContain('TABLESPACE USERS'); expect(appSql).toContain('TABLESPACE "USERS"');
    expect(originalSql).toContain("CHECK (id > 0 AND code <> ';--')"); expect(appSql).toContain("CHECK (\"id\" > 0 AND \"code\" <> ';--')");
    expect(appSql).not.toContain('ON DELETE'); expect(originalSql).not.toContain('ON DELETE'); expect(output.executionVerified).toBe(false);
  });
});
