import { describe, expect, it } from 'vitest';
import { createNativeDocument, appendNativeTable, nativeGraph } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import type { BinaryObject, BinaryValue } from '../../src/formats/exerd/binary';
import type { NativeExerdDocument } from '../../src/formats/exerd/native-document';
import { generateNativeEnterpriseDdl, type EnterpriseDialect } from '../../src/formats/sql/native-enterprise-ddl';

const NS = { sqlserver: 'http://exerd.tomato.com/sqlserver/model', db2: 'http://exerd.tomato.com/db2/model', cubrid: 'http://exerd.tomato.com/cubrid/model' };
const PRODUCT = { sqlserver: 'com.tomato.db.sqlserver_2005', db2: 'com.tomato.db.db2', cubrid: 'com.tomato.db.cubrid10' } as const;
const { field, set, reference: ref, push } = nativeGraph;
const uuid = (o: BinaryObject) => String(field(o, 'UUID'));
const named = (d: NativeExerdDocument, cl: string, name: string) => d.graph.objects.find(o => o.class.name === cl && field(o, 'physicalName') === name)!;
const reference = (d: NativeExerdDocument, o: BinaryObject, key: string) => d.graph.objects.find(v => v.id === (field(o, key) as { ref: number } | undefined)?.ref);
function physical(d: NativeExerdDocument, o: BinaryObject, cl: string, fields: Record<string, BinaryValue> = {}) {
  let p = reference(d, o, 'physicalProperties');
  const product = String(field(d.graph.objects.find(o => o.class.name === 'Document')!, 'productId')), dialect = Object.keys(PRODUCT).find(k => PRODUCT[k as EnterpriseDialect] === product) as EnterpriseDialect;
  if (!p) { p = nativeGraph.object(d.graph, cl, {}, NS[dialect], false); set(o, 'physicalProperties', ref(p)); }
  for (const [key, value] of Object.entries(fields)) set(p, key, value); return p;
}
function fixture(dialect: EnterpriseDialect) {
  let d = createNativeDocument(`${dialect} fixture`, { database: { productId: PRODUCT[dialect], ...(dialect === 'cubrid' ? { databaseVersion: 'CUBRID 11.2' } : {}) } });
  set(d.graph.objects.find(o => o.class.name === 'Schema')!, 'physicalName', dialect === 'sqlserver' ? 'dbo' : dialect === 'db2' ? 'APP' : 'DBA');
  d = appendNativeTable(d, { name: 'child' });
  let parent = named(d, 'Table', 'new_table'), child = named(d, 'Table', 'child');
  d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: uuid(parent), name: 'code', dataType: 'VARCHAR(20)', nullable: false });
  d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: uuid(child), name: 'parent_id', dataType: 'INTEGER' });
  d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: uuid(child), name: 'code', dataType: 'VARCHAR(20)' });
  parent = named(d, 'Table', 'new_table'); child = named(d, 'Table', 'child');
  const pc = (field(parent, 'columns') as { ref: number }[]).map(r => d.graph.objects.find(o => o.id === r.ref)!);
  const cc = (field(child, 'columns') as { ref: number }[]).map(r => d.graph.objects.find(o => o.id === r.ref)!);
  d = mutateNativeDocument(d, { type: 'setPrimaryKey', tableUuid: uuid(parent), columnUuids: pc.map(uuid) });
  d = mutateNativeDocument(d, { type: 'addRelationship', name: 'fk_child', parentTableUuid: uuid(parent), childTableUuid: uuid(child), parentColumnUuids: pc.map(uuid), childColumnUuids: [uuid(cc[1]), uuid(cc[2])] });
  d = mutateNativeDocument(d, { type: 'addColumnGroup', tableUuid: uuid(parent), kind: 'unique', name: 'uq_code', columnUuids: [uuid(pc[1])] });
  d = mutateNativeDocument(d, { type: 'addColumnGroup', tableUuid: uuid(child), kind: 'index', name: 'ix_code', columnUuids: [uuid(cc[2])], sortTypes: ['DESC'] });
  if (dialect !== 'cubrid') d = mutateNativeDocument(d, { type: 'addCheckConstraint', tableUuid: uuid(parent), name: 'ck_code', expression: "id > 0 AND code <> ';--'" });
  return d;
}

describe('dedicated enterprise native DDL engines', () => {
  it('recognizes explicitly persisted EMF enum defaults without ignoring nondefault options', () => {
    const d = fixture('sqlserver'), index = named(d, 'InversionEntryColumnGroup', 'ix_code');
    const p = physical(d, index, 'IndexProperties', { optimization: 'NONE' });
    expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).complete).toBe(true);
    set(p, 'optimization', 'FILEGROUP');
    expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).unsupported).toContainEqual(expect.objectContaining({ feature: 'optimization' }));
  });
  it('diagnoses an implicit clustered primary key before a standalone clustered index', () => {
    const d = fixture('sqlserver'), index = named(d, 'InversionEntryColumnGroup', 'ix_code');
    physical(d, index, 'IndexProperties', { clustered: 'CLUSTERED' });
    const r = generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' });
    expect(r.complete).toBe(false); expect(r.diagnostics.map(d => d.code)).toContain('IMPLICIT_PRIMARY_CLUSTER_CONFLICT');
    const child = named(d, 'Table', 'child'), pk = (field(child, 'columnGroups') as { ref: number }[]).map(r => d.graph.objects.find(o => o.id === r.ref)!).find(o => o.class.name === 'PrimaryKeyColumnGroup')!;
    physical(d, pk, 'IndexProperties', { clustered: 'NONCLUSTERED' });
    expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).complete).toBe(true);
  });
  it('does not claim IDENTITY on a noninteger or unknown alias type is supported', () => {
    const d = fixture('sqlserver'), id = named(d, 'Column', 'id');
    const identity = nativeGraph.object(d.graph, 'Identity', { startWith: '1', incrementBy: '1' }, NS.sqlserver, false);
    physical(d, id, 'ColumnProperties', { identity: ref(identity) }); set(id, 'dataType', 'NUMERIC(12, 2)');
    expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).unsupported.map(x => x.code)).toContain('SQLSERVER_IDENTITY_TYPE_UNVERIFIED');
    set(id, 'dataType', 'NUMERIC(12, 0)'); expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).complete).toBe(true);
  });
  it('preserves CAST and CONVERT target type tokens that share a column name', () => {
    let d = fixture('sqlserver');
    d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: uuid(named(d, 'Table', 'new_table')), name: 'converted', dataType: 'INTEGER' });
    const converted = named(d, 'Column', 'converted');
    const computed = nativeGraph.object(d.graph, 'ComputedColumnDetail', { expression: 'CAST(id AS code) + CONVERT(code, id)', persisted: true }, NS.sqlserver, false);
    physical(d, converted, 'ColumnProperties', { computedColumnDetail: ref(computed) });
    expect(generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }).sql).toContain('CAST([id] AS code) + CONVERT(code, [id])');
  });
  it('accepts only neutral nested CUBRID partition initialization and reports actual partition settings', () => {
    const d = fixture('cubrid'), table = named(d, 'Table', 'new_table');
    const algorithm = nativeGraph.object(d.graph, 'PartitionAlgorithm', {}, NS.cubrid, false);
    const partition = nativeGraph.object(d.graph, 'Partition', { partitionAlgorithm: ref(algorithm) }, NS.cubrid, false);
    physical(d, table, 'TableProperties', { partition: ref(partition) });
    expect(generateNativeEnterpriseDdl(d, { dialect: 'cubrid' }).complete).toBe(true);
    set(algorithm, 'type', 'HASH');
    const r = generateNativeEnterpriseDdl(d, { dialect: 'cubrid' }); expect(r.complete).toBe(false);
    expect(r.unsupported).toContainEqual(expect.objectContaining({ feature: 'type' }));
    expect(r.unsupported).toContainEqual(expect.objectContaining({ feature: 'partition' }));
  });
  for (const dialect of ['sqlserver', 'db2', 'cubrid'] as const) it(`${dialect} preserves composite constraints and index order with source identity`, () => {
    const d = fixture(dialect), before = structuredClone(d.graph), result = generateNativeEnterpriseDdl(d, { dialect });
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]); expect(result.unsupported).toEqual([]); expect(result.complete).toBe(true); expect(result.executionVerified).toBe(false);
    expect(result.statistics).toMatchObject({ tables: 2, columns: 5, primaryKeys: 2, foreignKeys: 1, uniqueConstraints: 1, indexes: 1, checks: dialect === 'cubrid' ? 0 : 1 });
    if (dialect === 'sqlserver') { expect(result.sql).toContain('PRIMARY KEY ([id] ASC, [code] ASC)'); expect(result.sql).toContain('REFERENCES [dbo].[new_table] ([id], [code])'); expect(result.sql).toContain('[code] DESC'); }
    else { expect(result.sql).toContain('PRIMARY KEY ("id", "code")'); expect(result.sql).toContain('"code" DESC'); }
    expect(result.sql.indexOf('CREATE TABLE')).toBeLessThan(result.sql.indexOf('FOREIGN KEY')); expect(d.graph).toEqual(before);
  });
  it('SQL Server preserves IDENTITY, computed PERSISTED, named DEFAULT, collation and Unicode descriptions', () => {
    let d = fixture('sqlserver'); const parent = named(d, 'Table', 'new_table');
    d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: uuid(parent), name: 'computed_total', dataType: 'BIGINT' });
    const id = named(d, 'Column', 'id'), code = named(d, 'Column', 'code'), calc = named(d, 'Column', 'computed_total');
    const identity = nativeGraph.object(d.graph, 'Identity', { startWith: '10', incrementBy: '2', notForReplication: true }, NS.sqlserver, false);
    physical(d, id, 'ColumnProperties', { identity: ref(identity) });
    const def = nativeGraph.object(d.graph, 'DefaultValueConstraint', { physicalName: 'df_code', expression: "N'한글'" }, NS.sqlserver, false);
    physical(d, code, 'ColumnProperties', { collationName: 'Latin1_General_CI_AS', defaultValueDetail: ref(def) });
    const computed = nativeGraph.object(d.graph, 'ComputedColumnDetail', { expression: 'id * 2', persisted: true }, NS.sqlserver, false);
    physical(d, calc, 'ColumnProperties', { computedColumnDetail: ref(computed) }); set(code, 'comment', "한글 O'Reilly");
    const r = generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }); expect(r.complete).toBe(true);
    expect(r.sql).toContain('INTEGER IDENTITY(10, 2) NOT FOR REPLICATION NOT NULL');
    expect(r.sql).toContain("COLLATE [Latin1_General_CI_AS] CONSTRAINT [df_code] DEFAULT N'한글'");
    expect(r.sql).toContain('[computed_total] AS ([id] * 2) PERSISTED');
    expect(r.sql).toContain("@value=N'한글 O''Reilly'"); expect(r.sql).toContain("@level2type=N'COLUMN'");
  });
  it('SQL Server preserves INCLUDE, index options, reference actions, disabled checks and replication flags', () => {
    const d = fixture('sqlserver'), child = named(d, 'Table', 'child'), index = named(d, 'InversionEntryColumnGroup', 'ix_code'), check = named(d, 'CheckConstraint', 'ck_code');
    const columns = (field(child, 'columns') as { ref: number }[]).map(r => d.graph.objects.find(o => o.id === r.ref)!);
    const option = nativeGraph.object(d.graph, 'RelationalIndexOption', { padIndex: 'ON', fillFactor: '80', ignoreDupKey: 'OFF', allowRowLocks: 'ON', allowPageLocks: 'OFF' }, NS.sqlserver, false);
    physical(d, index, 'IndexProperties', { clustered: 'NONCLUSTERED', includedColumns: [ref(columns[1])], relationalIndexOption: ref(option), disable: true });
    physical(d, check, 'CheckConstraintProperties', { enable: false, notForReplication: true });
    const fk = d.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!; physical(d, fk, 'ForeignKeyConstraintProperties', { onDeleteReferentialAction: 'SET_DEFAULT', onUpdateReferentialAction: 'CASCADE', enable: false, notForReplication: true });
    const r = generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }); expect(r.complete).toBe(true);
    expect(r.sql).toContain('CREATE NONCLUSTERED INDEX [ix_code]'); expect(r.sql).toContain('INCLUDE ([parent_id])'); expect(r.sql).toContain('FILLFACTOR = 80');
    expect(r.sql).toContain('ALTER INDEX [ix_code] ON [dbo].[child] DISABLE');
    expect(r.sql).toContain('CHECK NOT FOR REPLICATION'); expect(r.sql).toContain('NOCHECK CONSTRAINT [ck_code]');
    expect(r.sql).toContain('ON DELETE SET DEFAULT ON UPDATE CASCADE NOT FOR REPLICATION'); expect(r.sql).toContain('NOCHECK CONSTRAINT [fk_child]');
  });
  it('Db2 uses tablespace object references and limits ON UPDATE to NO ACTION/RESTRICT', () => {
    const d = fixture('db2'), db = d.graph.objects.find(o => o.class.name === 'DatabaseModel')!, table = named(d, 'Table', 'new_table');
    const space = nativeGraph.object(d.graph, 'Tablespace', { physicalName: 'TS_DATA', type: 'REGULAR' }, NS.db2, false);
    physical(d, db, 'DatabaseProperties', { tablespaces: [ref(space)] }); physical(d, table, 'TableProperties', { tablespace: ref(space), indexInTablespace: ref(space) });
    const fk = d.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!; physical(d, fk, 'ForeignKeyConstraintProperties', { onDeleteRule: 'CASCADE', onUpdateRule: 'RESTRICT' }); set(table, 'comment', 'Db2 表');
    const r = generateNativeEnterpriseDdl(d, { dialect: 'db2' }); expect(r.complete).toBe(true); expect(r.sql).toContain('CREATE REGULAR TABLESPACE "TS_DATA"');
    expect(r.sql).toContain('IN "TS_DATA" INDEX IN "TS_DATA"'); expect(r.sql).toContain('ON DELETE CASCADE ON UPDATE RESTRICT'); expect(r.sql).toContain("COMMENT ON TABLE");
    const p = reference(d, fk, 'physicalProperties')!; set(p, 'onUpdateRule', 'CASCADE'); expect(generateNativeEnterpriseDdl(d, { dialect: 'db2' }).diagnostics.map(d => d.code)).toContain('INVALID_REFERENTIAL_ACTION');
  });
  it('CUBRID uses physical initializer flags, literal values, REUSE_OID and existing owner qualification', () => {
    const d = fixture('cubrid'), parent = named(d, 'Table', 'new_table'), column = named(d, 'Column', 'id'), code = named(d, 'Column', 'code');
    physical(d, column, 'ColumnProperties', { useAutoIncrement: true, autoIncrementStartValue: '10', autoIncrementIncrementValue: '2' });
    physical(d, code, 'ColumnProperties', { useDefault: true }); set(code, 'defaultValue', "O'Reilly");
    physical(d, parent, 'TableProperties', { reuseOid: 'FALSE', characterSet: 'utf8', collation: 'utf8_bin' }); set(parent, 'comment', 'CUBRID 설명');
    const r = generateNativeEnterpriseDdl(d, { dialect: 'cubrid' }); expect(r.complete).toBe(true); expect(r.sql).toContain('AUTO_INCREMENT(10, 2)'); expect(r.sql).toContain("DEFAULT 'O''Reilly'");
    expect(r.sql).toContain('DONT_REUSE_OID CHARSET "utf8" COLLATE "utf8_bin"'); expect(r.sql).toContain("COMMENT='CUBRID 설명'"); expect(r.sql).not.toContain('CREATE SCHEMA');
  });
  it('CUBRID table AUTO_INCREMENT never duplicates the column seed/increment clause', () => {
    const d = fixture('cubrid'); physical(d, named(d, 'Column', 'id'), 'ColumnProperties', { useAutoIncrement: true }); physical(d, named(d, 'Table', 'new_table'), 'TableProperties', { autoIncrement: '100' });
    const r = generateNativeEnterpriseDdl(d, { dialect: 'cubrid' }); expect(r.complete).toBe(true); expect(r.sql).toContain('AUTO_INCREMENT NOT NULL'); expect(r.sql).toContain('AUTO_INCREMENT=100'); expect(r.sql).not.toContain('AUTO_INCREMENT(1, 1)');
  });
  it('CUBRID reports schema version uncertainty and never claims ignored CHECK enforcement', () => {
    let d = fixture('cubrid'); const root = d.graph.objects.find(o => o.class.name === 'Document')!; root.features = root.features.filter(f => f.name !== 'databaseVersion');
    d = mutateNativeDocument(d, { type: 'addCheckConstraint', tableUuid: uuid(named(d, 'Table', 'new_table')), name: 'ck_unenforced', expression: 'id > 0' });
    const r = generateNativeEnterpriseDdl(d, { dialect: 'cubrid' }); expect(r.complete).toBe(false); expect(r.unsupported.map(d => d.code)).toEqual(expect.arrayContaining(['CUBRID_SCHEMA_VERSION_UNVERIFIED', 'CUBRID_CHECK_ENFORCEMENT_UNVERIFIED'])); expect(r.sql).not.toContain('CHECK (');
  });
  it('reports unsupported physical options and blocks SQL fragments without changing the model', () => {
    const d = fixture('sqlserver'); physical(d, named(d, 'Column', 'code'), 'ColumnProperties', { fileStream: true });
    set(named(d, 'Column', 'code'), 'defaultValue', "1; DROP TABLE secret");
    const r = generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }); expect(r.complete).toBe(false); expect(r.unsupported.map(d => d.feature)).toContain('fileStream'); expect(r.diagnostics.map(d => d.code)).toContain('UNSAFE_SQL_FRAGMENT'); expect(r.sql).not.toContain('DROP TABLE secret');
  });
  it('selection reports external FK prerequisites and rejects product conversion', () => {
    const d = fixture('db2'), child = named(d, 'Table', 'child'); const selected = generateNativeEnterpriseDdl(d, { dialect: 'db2', tableUuids: [uuid(child)] }); expect(selected.statistics.tables).toBe(1); expect(selected.complete).toBe(false); expect(selected.unsupported.map(d => d.code)).toContain('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY');
    const mismatch = generateNativeEnterpriseDdl(d, { dialect: 'sqlserver' }); expect(mismatch.sql).toBe(''); expect(mismatch.complete).toBe(false);
  });
});
