import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { generateNativeDdl, type NativeDialect } from '../../src/formats/sql/native-ddl';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryRegistry, BinaryValue } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';

const registry = schema as BinaryRegistry;
const value = (object: BinaryObject, key: string) => object.features.find(feature => feature.name === key)?.value;
const uuid = (object: BinaryObject) => value(object, 'UUID') as string;
const named = (document: NativeExerdDocument, className: string, name: string) => document.graph.objects.find(object => object.class.name === className && value(object, 'physicalName') === name)!;
function set(object: BinaryObject, key: string, newValue: BinaryValue) {
  const previous = object.features.find(feature => feature.name === key);
  if (previous) previous.value = newValue; else object.features.push({ id: object.features.length, name: key, kind: 'DATA', value: newValue });
}
function pgObject(document: NativeExerdDocument, className: string, fields: Record<string, BinaryValue>) {
  const object: BinaryObject = { id: document.graph.objects.length, class: { packageUri: 'http://exerd.tomato.com/postgresql/model', name: className }, features: [] };
  for (const [name, field] of Object.entries({ UUID: `property-${object.id}`, ...fields })) set(object, name, field);
  document.graph.objects.push(object); return object;
}
function physical(document: NativeExerdDocument, owner: BinaryObject, className: string, fields: Record<string, BinaryValue>) {
  const object = pgObject(document, className, fields); set(owner, 'physicalProperties', { ref: object.id }); return object;
}
function fixture() {
  let document = appendNativeTable(createNativeDocument('DDL fixture'), { name: 'child' });
  let parent = named(document, 'Table', 'new_table'), child = named(document, 'Table', 'child');
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: uuid(parent), name: 'code', dataType: 'VARCHAR(20)', nullable: false });
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: uuid(child), name: 'parent_id', dataType: 'BIGINT' });
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: uuid(child), name: 'code', dataType: 'VARCHAR(20)' });
  parent = named(document, 'Table', 'new_table'); child = named(document, 'Table', 'child');
  const columns = (table: BinaryObject) => (value(table, 'columns') as { ref: number }[]).map(ref => document.graph.objects.find(object => object.id === ref.ref)!);
  const pc = columns(parent), cc = columns(child);
  document = mutateNativeDocument(document, { type: 'setPrimaryKey', tableUuid: uuid(parent), columnUuids: [uuid(pc[0]), uuid(pc[1])] });
  document = mutateNativeDocument(document, { type: 'addRelationship', name: 'fk_child_parent', parentTableUuid: uuid(parent), childTableUuid: uuid(child), parentColumnUuids: pc.map(uuid), childColumnUuids: [uuid(cc[1]), uuid(cc[2])] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: uuid(parent), kind: 'unique', name: 'uq_parent_code', columnUuids: [uuid(pc[1])] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: uuid(child), kind: 'index', name: 'ix_child_code', columnUuids: [uuid(cc[2]), uuid(cc[1])], sortTypes: ['DESC', 'ASC'] });
  document = mutateNativeDocument(document, { type: 'addCheckConstraint', tableUuid: uuid(parent), name: 'ck_positive', expression: '"id" > 0 AND "code" <> \';--\'' });
  return document;
}

describe('native PostgreSQL DDL', () => {
  it('exports composite keys, named UNIQUE, sorted indexes, CHECK and FK without mutating the graph', () => {
    const document = fixture(), before = structuredClone(document.graph), result = generateNativeDdl(document);
    expect(result.complete).toBe(true); expect(result.executionVerified).toBe(false);
    expect(result.unsupported).toEqual([]); expect(result.diagnostics).toEqual([]);
    expect(result.sql).toContain('PRIMARY KEY ("id", "code")');
    expect(result.sql).toContain('CONSTRAINT "uq_parent_code" UNIQUE ("code")');
    expect(result.sql).toContain('CREATE INDEX "ix_child_code" ON "public"."child" ("code" DESC NULLS LAST, "parent_id" ASC NULLS LAST)');
    expect(result.sql).toContain('CHECK ("id" > 0 AND "code" <> \';--\')');
    expect(result.sql).toContain('FOREIGN KEY ("parent_id", "code") REFERENCES "public"."new_table" ("id", "code")');
    expect(result.sql.indexOf('CREATE TABLE "public"."child"')).toBeLessThan(result.sql.indexOf('FOREIGN KEY'));
    expect(result.statistics).toMatchObject({ tables: 2, columns: 5, primaryKeys: 2, uniqueConstraints: 1, indexes: 1, foreignKeys: 1, checks: 1 });
    expect(document.graph).toEqual(before);
  });
  it('reports invalid or identity-owned sequence extensions instead of silently claiming complete SQL', () => {
    const document = fixture(), sequence = pgObject(document, 'Sequence', { physicalName: 'special_seq', start: '1', increment: '1' });
    const extension = pgObject(document, 'PropertyEntry', { key: 'erd-maker.postgresql.sequence.v1', value: '{broken' });
    extension.class.packageUri = 'http://exerd.tomato.com/model';
    set(sequence, 'extendedProperty', [{ ref: extension.id }]);
    const group = pgObject(document, 'SequenceGroup', { sequences: [{ ref: sequence.id }] });
    physical(document, named(document, 'Schema', 'public'), 'SchemaProperties', { sequenceGroup: { ref: group.id } });
    expect(generateNativeDdl(document).unsupported.map(d => d.code)).toContain('INVALID_SEQUENCE_EXTENSION');
    const table = named(document, 'Table', 'new_table'), column = named(document, 'Column', 'id');
    set(extension, 'value', JSON.stringify({ dataType: 'bigint', persistence: 'p', ownedBy: { tableUuid: uuid(table), columnUuid: uuid(column), dependencyType: 'i' } }));
    const ddl = generateNativeDdl(document); expect(ddl.complete).toBe(false);
    expect(ddl.unsupported.map(d => d.code)).toContain('IDENTITY_SEQUENCE_OWNERSHIP_NOT_IMPLEMENTED');
    expect(ddl.sql).not.toContain('OWNED BY');
  });
  it('preserves explicitly empty column defaults instead of inheriting a domain default', () => {
    const document = fixture(), column = named(document, 'Column', 'code');
    const domain: BinaryObject = { id: document.graph.objects.length, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Domain' }, features: [] };
    set(domain, 'UUID', 'ddl-domain'); set(domain, 'name', 'code'); set(domain, 'suggestedDataType', 'VARCHAR(20)'); set(domain, 'suggestedDefaultValue', "'READY'");
    document.graph.objects.push(domain); set(column, 'domain', { ref: domain.id });
    column.features = column.features.filter(feature => feature.name !== 'dataType' && feature.name !== 'defaultValue');
    expect(generateNativeDdl(document).sql).toContain('"code" VARCHAR(20) DEFAULT \'READY\' NOT NULL');
    set(column, 'defaultValue', '');
    expect(generateNativeDdl(document).sql).not.toContain('DEFAULT \'READY\'');
  });
  it('preserves PG reference actions, deferral and the observed validated=true → NOT VALID rule', () => {
    const document = fixture();
    const fk = document.graph.objects.find(object => object.class.name === 'ForeignKeyConstraint')!;
    physical(document, fk, 'ForeignKeyConstraintProperties', { onDeleteRule: 'CASCADE', onUpdateRule: 'SET NULL', deferrable: true, deferred: true, match: 'FULL', validated: true });
    const check = named(document, 'CheckConstraint', 'ck_positive');
    physical(document, check, 'CheckConstraintProperties', { noInherit: true, validated: true });
    const result = generateNativeDdl(document);
    expect(result.complete).toBe(true);
    expect(result.sql).toContain('MATCH FULL ON DELETE CASCADE ON UPDATE SET NULL DEFERRABLE INITIALLY DEFERRED NOT VALID');
    expect(result.sql).toContain('NO INHERIT NOT VALID');
  });
  it('exports persisted storage, index options, comments and sequences without treating initialized empty groups as settings', () => {
    const document = fixture(), child = named(document, 'Table', 'child'), index = named(document, 'InversionEntryColumnGroup', 'ix_child_code');
    const vacuum = pgObject(document, 'TableVacuum', { autovacuumEnabled: false, autovacuumVacuumThreshold: 100 });
    physical(document, child, 'TableProperties', { unlogged: true, fillfactor: 80, tablespace: 'pg_default', tableVacuum: { ref: vacuum.id } });
    physical(document, index, 'IndexProperties', { methodKind: 'BTREE', fillfactor: 75, condition: '"code" IS NOT NULL' });
    const membership = document.graph.objects.find(object => object.class.name === 'InversionEntryMembership' && (value(object, 'group') as { ref: number } | undefined)?.ref === index.id && value(object, 'sortType') === 'DESC')!;
    physical(document, membership, 'IndexableMembershipProperties', { nulls: true, opclass: 'varchar_pattern_ops', collation: 'pg_catalog."C"' });
    set(child, 'comment', "O'Reilly \\ folder");
    const sequence = pgObject(document, 'Sequence', { physicalName: 'event_seq', increment: '2', start: '10', minValue: '1', cache: '5', cycle: true });
    const group = pgObject(document, 'SequenceGroup', { sequences: [{ ref: sequence.id }] });
    physical(document, named(document, 'Schema', 'public'), 'SchemaProperties', { sequenceGroup: { ref: group.id } });
    const result = generateNativeDdl(document);
    expect(result.complete).toBe(true); expect(result.unsupported).toEqual([]);
    expect(result.sql).toContain('CREATE UNLOGGED TABLE');
    expect(result.sql).toContain('WITH (fillfactor = 80, autovacuum_enabled = false, autovacuum_vacuum_threshold = 100) TABLESPACE "pg_default"');
    expect(result.sql).toContain('COLLATE "pg_catalog"."C" "varchar_pattern_ops" DESC NULLS FIRST');
    expect(result.sql).toContain('WITH (fillfactor = 75) WHERE "code" IS NOT NULL');
    expect(result.sql).toContain("IS 'O''Reilly \\ folder'");
    expect(result.sql).toContain('CREATE SEQUENCE "public"."event_seq" INCREMENT BY 2 START WITH 10 MINVALUE 1 CACHE 5 CYCLE;');
    expect(result.statistics.sequences).toBe(1);
  });
  it('keeps PK table order even when raw membership indices disagree, matching the original PK overload', () => {
    const document = fixture();
    const parent = named(document, 'Table', 'new_table'), pk = (value(parent, 'columnGroups') as { ref: number }[]).map(r => document.graph.objects.find(o => o.id === r.ref)!).find(o => o.class.name === 'PrimaryKeyColumnGroup')!;
    const members = document.graph.objects.filter(o => o.class.name === 'PrimaryKeyMembership' && (value(o, 'group') as { ref: number } | undefined)?.ref === pk.id);
    set(members[0], 'entryIndex', 1); set(members[1], 'entryIndex', 0);
    expect(generateNativeDdl(document).sql).toContain('PRIMARY KEY ("id", "code")');
  });
  it('reports unknown physical options and rejects unverified cross-database conversion', () => {
    const document = fixture(); physical(document, named(document, 'Table', 'child'), 'TableProperties', { type: 'UNEXPLAINED' });
    const partial = generateNativeDdl(document);
    expect(partial.complete).toBe(false); expect(partial.unsupported).toEqual([expect.objectContaining({ code: 'PHYSICAL_PROPERTY_NOT_IMPLEMENTED', feature: 'type' })]);
    for (const dialect of ['mysql', 'mariadb', 'oracle', 'sqlserver', 'db2', 'tibero', 'cubrid'] as NativeDialect[]) {
      const unsupported = generateNativeDdl(document, { dialect }); expect(unsupported.sql).toBe(''); expect(unsupported.complete).toBe(false); expect(unsupported.unsupported[0].code).toBe('CROSS_DATABASE_TYPE_CONVERSION_UNVERIFIED');
    }
    set(document.graph.objects.find(object => object.class.name === 'Document')!, 'productId', 'unknown.database');
    expect(generateNativeDdl(document).diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_DATABASE_PRODUCT' })]);
    expect(generateNativeDdl(document, { dialect: 'postgresql' }).sql).toBe('');
  });
  it('exports an explicit table selection and reports external FK dependencies', () => {
    const document = fixture(), childUuid = uuid(named(document, 'Table', 'child'));
    const result = generateNativeDdl(document, { tableUuids: [childUuid] });
    expect(result.statistics.tables).toBe(1); expect(result.sql).not.toContain('CREATE TABLE "public"."new_table"');
    expect(result.complete).toBe(false); expect(result.unsupported[0].code).toBe('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY');
    expect(generateNativeDdl(document, { tableUuids: [] }).sql).toBe('');
  });
  it('rejects multi-statement expressions while allowing delimiters inside SQL literals', () => {
    const document = fixture(), check = named(document, 'CheckConstraint', 'ck_positive');
    set(check, 'expression', "'\\'; SELECT 1 --'");
    const invalid = generateNativeDdl(document); expect(invalid.complete).toBe(false); expect(invalid.diagnostics.some(d => d.code === 'UNSAFE_SQL_FRAGMENT')).toBe(true);
    set(check, 'expression', "'semi;colon' <> E'escape\\\'value'");
    expect(generateNativeDdl(document).diagnostics).toEqual([]);
  });
  it('quotes only model-column tokens in CHECK expressions and preserves strings, functions and cast syntax', () => {
    const document = fixture(), check = named(document, 'CheckConstraint', 'ck_positive');
    set(check, 'expression', "id > 0 AND length('id') > 0 AND CAST(code AS TEXT) <> 'code'");
    const result = generateNativeDdl(document);
    expect(result.sql).toContain('CHECK ("id" > 0 AND length(\'id\') > 0 AND CAST("code" AS TEXT) <> \'code\')');
    expect(result.complete).toBe(true);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'EXPRESSION_COLUMN_IDENTIFIERS_QUOTED' })]);
    expect(value(check, 'expression')).toBe("id > 0 AND length('id') > 0 AND CAST(code AS TEXT) <> 'code'");
  });
  it('generates an explicitly requested FK index and excludes transient tables from exported schema objects', () => {
    const document = fixture(), foreign = named(document, 'ForeignKeyColumnGroup', 'fk_child_parent');
    set(foreign, 'useIndexing', true);
    const result = generateNativeDdl(document);
    expect(result.statistics.indexes).toBe(2);
    expect(result.sql).toContain('CREATE INDEX "fk_child_parent" ON "public"."child"');
    const transient: BinaryObject = { id: document.graph.objects.length, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Table' }, features: [] };
    set(transient, 'UUID', 'temporary-table'); set(transient, 'physicalName', 'do_not_export');
    document.graph.objects.push(transient); set(document.graph.objects.find(object => object.class.name === 'Document')!, 'temporaryContents', [{ ref: transient.id }]);
    expect(generateNativeDdl(document).sql).not.toContain('do_not_export');
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('user reference DDL coverage', () => {
  it('exports all stored constraints including 492 CHECK and eight explicit UNIQUE constraints', () => {
    const document = openNativeDocument(new Uint8Array(readFileSync(source)), registry), before = structuredClone(document.graph);
    const result = generateNativeDdl(document);
    expect(result.statistics).toEqual({ tables: 609, columns: 10045, primaryKeys: 609, foreignKeys: 561, uniqueConstraints: 8, indexes: 94, checks: 492, sequences: 0 });
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'EXPRESSION_COLUMN_IDENTIFIERS_QUOTED', severity: 'warning' })]); expect(result.unsupported).toEqual([]); expect(result.complete).toBe(true);
    expect((result.sql.match(/\bCHECK \(/g) ?? [])).toHaveLength(492);
    expect((result.sql.match(/\bFOREIGN KEY \(/g) ?? [])).toHaveLength(561);
    expect(document.graph).toEqual(before);
  });
});
