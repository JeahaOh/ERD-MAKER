import { describe, expect, it } from 'vitest';
import { importPostgresCatalog, POSTGRES_CATALOG_SQL } from '../../src/formats/sql/postgres-catalog';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';
import { nativeGraph } from '../../src/formats/exerd/create';
const table = (oid: string, name: string) => ({ oid, name, schemaOid: '1', kind: 'r', persistence: 'p', comment: null, partition: false, partitionKey: null, parents: [], rowSecurity: false, forceRowSecurity: false, replicaIdentity: 'd', options: null, tablespace: null });
const column = (tableOid: string, number: number, name: string) => ({ tableOid, number, name, dataType: 'bigint', typeOid: '20', typeSchema: 'pg_catalog', typeName: 'int8', typeKind: 'b', notNull: true, defaultExpression: null, comment: null, identity: '', generated: '', collation: null, inherited: 0, local: true, storage: 'p', typeStorage: 'p', compression: '', options: null, fdwOptions: null, statisticsTarget: null as number | null });
const index = (oid: string, tableOid: string, name: string, columns: number[], constraintOid: string | null = null) => ({ oid, tableOid, name, method: 'btree', unique: !!constraintOid, primary: !!constraintOid, exclusion: false, constraintOid, valid: true, ready: true, live: true, clustered: false, replicaIdentity: false, nullsNotDistinct: false, predicate: null, options: null, tablespace: null, comment: null, definition: 'CREATE INDEX', keys: columns.map((attributeNumber, n) => ({ number: n + 1, attributeNumber, definition: 'id', descending: false, nullsFirst: false, opclass: null, collation: null })), includedColumns: [] });
const constraint = (oid: string, tableOid: string, name: string, type: string, columns: number[], indexOid: string | null) => ({ oid, tableOid, name, type, columns, referencedTableOid: null as string | null, referencedColumns: [] as number[], indexOid, deferrable: false, deferred: false, validated: true, deleteAction: ' ', updateAction: ' ', match: ' ', deleteSetColumns: null, noInherit: false, inherited: 0, local: true, parentOid: null, expression: null as string | null, definition: '', comment: null });
function fixture() {
  const fk = { ...constraint('32', '11', 'fk_child', 'f', [2], '20'), referencedTableOid: '10', referencedColumns: [1], deleteAction: 'c', updateAction: 'r', match: 'f', deferrable: true, deferred: true, validated: false };
  return { format: 'erd-maker.postgresql-catalog', version: 1, serverVersionNum: 170011, serverVersion: '17.11', database: '역공학 시험', schemas: [{ oid: '1', name: 'odd"schema', comment: '스키마 설명' }], tables: [table('10', 'Parent'), table('11', 'child')], columns: [column('10', 1, 'id'), column('11', 1, 'id'), { ...column('11', 2, 'parent id'), notNull: false, comment: '참조\n설명' }], constraints: [constraint('30', '10', 'pk_Parent', 'p', [1], '20'), constraint('31', '11', 'pk_child', 'p', [1], '21'), fk, { ...constraint('33', '11', 'ck_positive', 'c', [2], null), expression: '("parent id" > 0)' }], indexes: [index('20', '10', 'pk_Parent', [1], '30'), index('21', '11', 'pk_child', [1], '31'), { ...index('22', '11', 'ix_parent', [2]), keys: [{ number: 1, attributeNumber: 2, definition: '"parent id" DESC', descending: true, nullsFirst: true, opclass: null, collation: null }], predicate: '("parent id" IS NOT NULL)' }], unsupportedObjects: [] };
}
describe('PostgreSQL catalog metadata reverse engineering', () => {
  it('exposes a single read-only catalog query', () => {
    expect(POSTGRES_CATALOG_SQL).toContain('pg_catalog.pg_attribute');
    expect(POSTGRES_CATALOG_SQL).toContain("'format', 'erd-maker.postgresql-catalog'");
    expect(POSTGRES_CATALOG_SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|COPY)\s/i);
  });
  it('initializes each schema folder exactly once even without sequences or user types', () => {
    const data = fixture(); data.schemas.push({ oid: '2', name: 'empty', comment: '' });
    const imported = importPostgresCatalog(data);
    expect(imported.complete).toBe(true);
    const objects = imported.document!.graph.objects;
    expect(objects.filter(o => o.class.name === 'SchemaProperties')).toHaveLength(2);
    expect(objects.filter(o => o.class.name === 'SequenceGroup')).toHaveLength(2);
    expect(objects.filter(o => o.class.name === 'UserDatatypeGroup')).toHaveLength(2);
    for (const schema of objects.filter(o => o.class.name === 'Schema')) {
      const properties = objects.find(o => o.id === (nativeGraph.field(schema, 'physicalProperties') as { ref: number }).ref)!;
      for (const [feature, type] of [['sequenceGroup', 'SequenceGroup'], ['userDatatypeGroup', 'UserDatatypeGroup']]) {
        const group = objects.find(o => o.id === (nativeGraph.field(properties, feature) as { ref: number }).ref)!;
        expect(group.class).toEqual({ packageUri: 'http://exerd.tomato.com/postgresql/model', name: type });
      }
    }
    const ddl = generateNativeDdl(imported.document!);
    expect(ddl.complete).toBe(true); expect(ddl.statistics.sequences).toBe(0);
  });
  it('preserves identifiers, exact type/default/comments, key order and FK options', () => {
    const data = fixture(); data.columns[1].dataType = 'numeric(12,3)'; data.columns[1].defaultExpression = '3.125' as never;
    const imported = importPostgresCatalog(data);
    expect(imported.diagnostics).toEqual([]); expect(imported.unsupported).toEqual([]); expect(imported.complete).toBe(true);
    const graph = imported.document!.graph;
    const actual = graph.objects.find(o => o.class.name === 'Column' && nativeGraph.field(o, 'dataType') === 'numeric(12,3)')!;
    expect(nativeGraph.field(actual, 'defaultValue')).toBe('3.125');
    const ddl = generateNativeDdl(imported.document!);
    expect(ddl.sql).toContain('"odd""schema"."Parent"');
    expect(ddl.sql).toContain('numeric(12,3) DEFAULT 3.125 NOT NULL');
    expect(ddl.sql).toContain('ON DELETE CASCADE ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED NOT VALID');
    expect(ddl.sql).toContain('MATCH FULL'); expect(ddl.sql).toContain('DESC NULLS FIRST');
    expect(ddl.sql).toContain("IS '참조\n설명'");
    expect(ddl.statistics).toMatchObject({ tables: 2, columns: 3, primaryKeys: 2, foreignKeys: 1, indexes: 1, checks: 1 });
  });
  it('does not turn generated expressions into defaults and reports unsupported semantics', () => {
    const data = fixture(); Object.assign(data.columns[1], { generated: 's', defaultExpression: '(id * 2)', identity: 'a', compression: 'p' });
    Object.assign(data.indexes[2], { includedColumns: [1], nullsNotDistinct: true });
    const imported = importPostgresCatalog(data); expect(imported.document).not.toBeNull(); expect(imported.complete).toBe(false);
    expect(imported.unsupported.map(d => d.code)).toEqual(expect.arrayContaining(['GENERATED_COLUMN_NOT_REPRESENTED', 'IDENTITY_COLUMN_NOT_REPRESENTED', 'COLUMN_PHYSICAL_OPTIONS_NOT_REPRESENTED', 'INDEX_OPTIONS_NOT_REPRESENTED']));
    expect(generateNativeDdl(imported.document!).sql).not.toContain('DEFAULT (id * 2)');
  });
  it('fails closed for broken references, malformed contract and unknown FK options', () => {
    expect(importPostgresCatalog({}).document).toBeNull();
    const data = fixture(); data.constraints[2].referencedColumns = [900];
    expect(importPostgresCatalog(data).diagnostics.map(d => d.code)).toContain('COLUMN_REFERENCE_NOT_FOUND');
    expect(importPostgresCatalog(data).document).toBeNull();
    const data2 = fixture(); data2.constraints[2].deleteAction = '?';
    expect(importPostgresCatalog(data2).diagnostics.map(d => d.code)).toContain('INVALID_FOREIGN_KEY_OPTION');
  });
  it('reports physical column order versus PK order instead of silently changing the table', () => {
    const data = fixture(); data.columns.unshift(column('10', 2, 'second')); data.constraints[0].columns = [2, 1]; data.indexes[0].keys = index('20', '10', 'pk_Parent', [2, 1], '30').keys;
    const imported = importPostgresCatalog(data); expect(imported.unsupported.map(d => d.code)).toContain('PRIMARY_KEY_ORDER_NOT_REPRESENTABLE');
  });
  it('preserves a foreign key that references a permutation of the parent key', () => {
    const data = fixture(); data.columns.push(column('10', 2, 'second'));
    data.constraints[0].columns = [1, 2]; data.indexes[0].keys = index('20', '10', 'pk_Parent', [1, 2], '30').keys;
    data.constraints[2].columns = [1, 2]; data.constraints[2].referencedColumns = [2, 1];
    const imported = importPostgresCatalog(data); expect(imported.diagnostics).toEqual([]); expect(imported.complete).toBe(true);
    expect(imported.document!.graph.objects.filter(o => o.class.name === 'SchemaProperties')).toHaveLength(1);
    expect(imported.document!.graph.objects.filter(o => o.class.name === 'SequenceGroup')).toHaveLength(1);
    expect(generateNativeDdl(imported.document!).sql).toContain('FOREIGN KEY ("id", "parent id") REFERENCES "odd""schema"."Parent" ("second", "id")');
  });
  it('reports unknown metadata rather than accepting unrecognized semantics as complete', () => {
    const data = fixture(); Object.assign(data.tables[0], { futureOption: { value: true } });
    const imported = importPostgresCatalog(data);
    expect(imported.document).not.toBeNull(); expect(imported.complete).toBe(false);
    expect(imported.unsupported).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_CATALOG_FIELD', path: 'tables[0].futureOption' }));
    const bad = fixture(); Object.assign(bad.indexes[2], { unique: 'false' });
    expect(importPostgresCatalog(bad).document).toBeNull();
  });
  it('imports precise sequence options and ownership without rewriting the nextval expression', () => {
    const base = fixture(), expression = `nextval('"odd""schema"."id sequence"'::regclass)`;
    Object.assign(base.columns[0], { defaultExpression: expression });
    const data = { ...base, sequences: [{ oid: '90', schemaOid: '1', name: 'id sequence', dataType: 'integer', persistence: 'p', start: '1', minValue: '1', maxValue: '2147483647', increment: '1', cache: '7', cycle: false, comment: "sequence's comment", ownedBy: { tableOid: '10', columnNumber: 1, dependencyType: 'a' } }] };
    const imported = importPostgresCatalog(data); expect(imported.diagnostics).toEqual([]); expect(imported.complete).toBe(true);
    const ddl = generateNativeDdl(imported.document!); expect(ddl.complete).toBe(true); expect(ddl.statistics.sequences).toBe(1);
    expect(ddl.sql).toContain('CREATE SEQUENCE "odd""schema"."id sequence" AS integer INCREMENT BY 1 START WITH 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 7;');
    expect(ddl.sql).toContain(`DEFAULT ${expression}`);
    expect(ddl.sql).toContain('ALTER SEQUENCE "odd""schema"."id sequence" OWNED BY "odd""schema"."Parent"."id";');
    expect(ddl.sql.indexOf('CREATE SEQUENCE')).toBeLessThan(ddl.sql.indexOf('CREATE TABLE'));
    expect(ddl.sql.indexOf('ALTER SEQUENCE')).toBeGreaterThan(ddl.sql.lastIndexOf('CREATE TABLE'));
    expect(ddl.sql).toContain("IS 'sequence''s comment'");
    expect(nativeGraph.field(imported.document!.graph.objects.find(o => o.class.name === 'Sequence')!, 'maxValue')).toBe('2147483647');
  });
  it('exports unowned sequences from a schema that has no tables', () => {
    const base = fixture(); base.tables = []; base.columns = []; base.constraints = []; base.indexes = [];
    const data = { ...base, sequences: [{ oid: '90', schemaOid: '1', name: 'large_seq', dataType: 'bigint', persistence: 'u', start: '1', minValue: '1', maxValue: '9223372036854775807', increment: '1', cache: '1', cycle: false, comment: null, ownedBy: null }] };
    const imported = importPostgresCatalog(data); expect(imported.complete).toBe(true);
    const ddl = generateNativeDdl(imported.document!); expect(ddl.complete).toBe(true);
    expect(ddl.sql).toContain('CREATE UNLOGGED SEQUENCE "odd""schema"."large_seq" AS bigint');
    expect(ddl.sql).toContain('MAXVALUE 9223372036854775807'); expect(ddl.sql).not.toContain('OWNED BY');
  });
  it('builds 609 tables in one bulk import without per-command serialization', () => {
    const data = fixture(); data.tables = []; data.columns = []; data.constraints = []; data.indexes = [];
    for (let i = 0; i < 609; i++) { const oid = String(1000 + i); data.tables.push(table(oid, `table_${i}`)); for (let j = 1; j <= 16; j++) data.columns.push(column(oid, j, `c_${j}`)); }
    const start = performance.now(), imported = importPostgresCatalog(data), duration = performance.now() - start;
    expect(imported.diagnostics.filter(d => d.severity === 'error')).toEqual([]); expect(imported.complete).toBe(true);
    expect(imported.document!.graph.objects.filter(o => o.class.name === 'Table')).toHaveLength(609);
    expect(duration).toBeLessThan(15000);
  });
});
