import { describe, expect, it } from 'vitest';
import { createNativeDocument, appendNativeTable, rebuildNativeDocument, nativeGraph, NATIVE_DATABASE_PRODUCTS, type NativeDatabaseProductId } from '../../src/formats/exerd/create';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import schema from '../../src/formats/exerd/schema.generated.json';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import type { BinaryObject, BinaryRegistry } from '../../src/formats/exerd/binary';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';

const registry = schema as BinaryRegistry;
const count = (doc: ReturnType<typeof createNativeDocument>, name: string) => doc.graph.objects.filter(o => o.class.name === name).length;
describe('new native eXERD documents', () => {
  it('builds a new document with fresh identities, complete primary-key membership and synchronized representations', () => {
    const first = createNativeDocument('신규 모델 <&é>'); const second = createNativeDocument('신규 모델 <&é>');
    expect([...first.byUuid.keys()].some(id => second.byUuid.has(id))).toBe(false);
    for (const cls of ['Document', 'DatabaseModel', 'Schema', 'Table', 'Column', 'PrimaryKeyColumnGroup', 'PrimaryKeyMembership', 'MembershipEntry', 'BusinessArea', 'Diagram', 'TableDiagram', 'Configuration', 'ViewSettings', 'PrintSettings', 'PrimaryKeyConstraint']) expect(count(first, cls)).toBe(1);
    expect(new Set(first.xml.byUuid.keys())).toEqual(new Set(first.byUuid.keys()));
    expect(first.xml.text).toContain('<cellsToShow>name</cellsToShow>');
    expect(first.xml.text).toContain('<cellsToShow>dataType</cellsToShow>');
    expect(first.xml.text).not.toContain('cellsToShow=');
    expect(first.xml.text).toContain('<e:Document ');
    expect(first.xml.text).toContain('xmlns:e="http://exerd.tomato.com/model"');
    const roundtrip = openNativeDocument(saveNativeDocument(first), registry);
    expect(roundtrip.graph.objects).toEqual(first.graph.objects);
    expect(roundtrip.graph.objects.find(o => o.class.name === 'DatabaseModel')!.features.find(f => f.name === 'logicalName')!.value).toBe('신규 모델 <&é>');
    const constraint = first.graph.objects.find(o => o.class.name === 'PrimaryKeyConstraint')!;
    expect(constraint.features.find(f => f.name === 'physicalName')!.value).toBe('pk_new_table');
    const col = first.graph.objects.find(o => o.class.name === 'Column')!;
    expect(col.features.find(f => f.name === 'notNull')!.value).toBe('TRUE');
    const members = col.features.find(f => f.name === 'memberships')!.value as { ref: number }[];
    expect(first.graph.objects[members[0].ref].class.name).toBe('MembershipEntry');
  });
  it('declares XML 1.1 when preserving legal control characters as numeric references', () => {
    const name = '제어\u0001문자\t줄\n바꿈';
    const document = createNativeDocument(name);
    expect(document.xml.text).toContain('<?xml version="1.1"');
    expect(document.xml.text).toContain('&#x1;');
    expect(document.xml.text).toContain('&#x9;');
    const model = document.graph.objects.find(o => o.class.name === 'DatabaseModel')!;
    expect(document.xml.byUuid.get(model.features.find(f => f.name === 'UUID')!.value as string)!.attributes.find(a => a.name === 'logicalName')!.value).toBe(name);
    const reopened = openNativeDocument(saveNativeDocument(document), registry);
    expect(reopened.graph.objects.find(o => o.class.name === 'DatabaseModel')!.features.find(f => f.name === 'logicalName')!.value).toBe(name);
  });
  it('appends a new table immutably with a unique primary key, placement and business-area membership', () => {
    const first = createNativeDocument(); const before = saveNativeDocument(first);
    const next = appendNativeTable(first, { name: 'customer', logicalName: '고객', x: -50.5, y: 200 });
    expect(saveNativeDocument(first)).toEqual(before);
    expect(count(next, 'Table')).toBe(2); expect(count(next, 'PrimaryKeyMembership')).toBe(2); expect(count(next, 'TableDiagram')).toBe(2);
    const placement = next.graph.objects.filter(o => o.class.name === 'TableDiagram').at(-1)!;
    expect(placement.features.find(f => f.name === 'location')!.value).toBe('Point(-50, 200)');
    expect(new Set(next.xml.byUuid.keys())).toEqual(new Set(next.byUuid.keys()));
    expect(openNativeDocument(saveNativeDocument(next), registry).graph.objects).toEqual(next.graph.objects);
  });
  it('rejects empty names, duplicate table names, nonexistent diagrams and invalid coordinates', () => {
    expect(() => createNativeDocument(' ')).toThrow('이름'); const doc = createNativeDocument();
    expect(() => appendNativeTable(doc, { name: 'new_table' })).toThrow('같은');
    expect(() => appendNativeTable(doc, { name: '' })).toThrow('물리명');
    expect(() => appendNativeTable(doc, { name: 'ok', diagramUuid: 'missing' })).toThrow('다이어그램');
    expect(() => appendNativeTable(doc, { name: 'ok', x: Infinity })).toThrow('좌표');
    expect(() => appendNativeTable(doc, { name: 'ok', y: 2147483648 })).toThrow('좌표');
  });
});

describe('native database creation contexts', () => {
  it.each(NATIVE_DATABASE_PRODUCTS)('creates $name with its own physical namespace and preserved DB identity', product => {
    const document = createNativeDocument('DB별 신규', { database: { productId: product.productId } });
    const root = document.graph.objects.find(o => o.class.name === 'Document')!;
    expect(root.features.find(f => f.name === 'productId')?.value).toBe(product.productId);
    expect(root.features.some(f => f.name === 'databaseVersion')).toBe(false);
    expect(document.graph.objects.find(o => o.class.name === 'DomainDefinition')!.features.find(f => f.name === 'productId')?.value).toBe(product.productId);
    expect(document.graph.objects.find(o => o.class.name === 'Schema')!.features.find(f => f.name === 'physicalName')?.value).toBe(product.defaultSchema);
    expect(document.graph.objects.find(o => o.class.name === 'Column')!.features.find(f => f.name === 'dataType')?.value).toBe(product.defaultType);
    const extensionObjects = document.graph.objects.filter(o => o.class.packageUri !== 'http://exerd.tomato.com/model');
    expect(extensionObjects.length).toBeGreaterThan(0);
    expect(new Set(extensionObjects.map(o => o.class.packageUri))).toEqual(new Set([product.namespace]));
    const extended = appendNativeTable(document, { name: 'child', x: 500 });
    const tables = extended.graph.objects.filter(o => o.class.name === 'Table');
    const uuid = (o: BinaryObject) => o.features.find(f => f.name === 'UUID')!.value as string;
    const column = (table: BinaryObject) => extended.graph.objects[(table.features.find(f => f.name === 'columns')!.value as { ref: number }[])[0].ref];
    const related = mutateNativeDocument(extended, { type: 'addRelationship', name: 'fk_parent', parentTableUuid: uuid(tables[0]), childTableUuid: uuid(tables[1]), parentColumnUuids: [uuid(column(tables[0]))], childColumnUuids: [uuid(column(tables[1]))] });
    const fk = related.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!;
    const fkProperties = related.graph.objects[(fk.features.find(f => f.name === 'physicalProperties')!.value as { ref: number }).ref];
    expect(fkProperties.class).toEqual({ packageUri: product.namespace, name: 'ForeignKeyConstraintProperties' });
    if (product.productId === 'com.tomato.db.tibero') expect(fkProperties.features.find(f => f.name === 'onDeleteRule')?.value).toBe('');
    const next = mutateNativeDocument(related, { type: 'addColumn', tableUuid: uuid(tables[1]), name: 'description' });
    expect(new Set(next.graph.objects.filter(o => o.class.packageUri !== 'http://exerd.tomato.com/model').map(o => o.class.packageUri))).toEqual(new Set([product.namespace]));
    if (product.productId === 'com.tomato.db.db2') expect(next.graph.objects.some(o => o.class.name === 'ColumnProperties')).toBe(false);
    if (product.productId === 'com.tomato.db.tibero') expect(next.graph.objects.some(o => o.class.name === 'ColumnProperties')).toBe(false);
    expect(openNativeDocument(saveNativeDocument(next), registry).graph.objects).toEqual(next.graph.objects);
  });
  it('dispatches native SQL by the original product without substituting PostgreSQL', () => {
    for (const product of NATIVE_DATABASE_PRODUCTS) {
      const document = createNativeDocument('방언 연결', { database: { productId: product.productId } });
      const result = generateNativeDdl(document);
      expect(result.sql, product.productId).toContain('CREATE TABLE');
      expect(result.statistics.tables, product.productId).toBe(1);
      expect(result.diagnostics.filter(d => d.severity === 'error'), product.productId).toEqual([]);
      expect(result.unsupported.some(d => d.code === 'DIALECT_NOT_IMPLEMENTED'), product.productId).toBe(false);
      expect(result.executionVerified).toBe(false);
    }
  });
  it('marks a newly requested Oracle ordinary index as NONUNIQUE and preserves that choice through save', () => {
    let document = createNativeDocument('일반 인덱스', { database: { productId: 'com.tomato.db.oracle_10g' } });
    const table = document.graph.objects.find(o => o.class.name === 'Table')!, column = document.graph.objects.find(o => o.class.name === 'Column')!;
    document = mutateNativeDocument(document, { type: 'addColumnGroup', kind: 'index', name: 'ix_id', tableUuid: nativeGraph.uuid(table)!, columnUuids: [nativeGraph.uuid(column)!] });
    const index = document.graph.objects.find(o => o.class.name === 'InversionEntryColumnGroup')!;
    const properties = document.graph.objects.find(o => o.id === (nativeGraph.field(index, 'physicalProperties') as { ref: number }).ref)!;
    expect(nativeGraph.field(properties, 'uniqueness')).toBe('NONUNIQUE');
    const reopened = openNativeDocument(saveNativeDocument(document), registry);
    expect(nativeGraph.field(reopened.graph.objects.find(o => nativeGraph.uuid(o) === nativeGraph.uuid(properties))!, 'uniqueness')).toBe('NONUNIQUE');
    expect(generateNativeDdl(reopened).sql).toContain('CREATE INDEX "default_schema"."ix_id"');
    expect(generateNativeDdl(reopened).sql).not.toContain('CREATE UNIQUE INDEX "default_schema"."ix_id"');
  });
  it('distinguishes imported Tibero implicit CASCADE from an explicit no-action relationship', () => {
    let document = appendNativeTable(createNativeDocument('삭제 규칙', { database: { productId: 'com.tomato.db.tibero' } }), { name: 'child' });
    const tables = document.graph.objects.filter(o => o.class.name === 'Table'), columns = document.graph.objects.filter(o => o.class.name === 'Column');
    document = mutateNativeDocument(document, { type: 'addRelationship', name: 'fk_child', parentTableUuid: nativeGraph.uuid(tables[0])!, childTableUuid: nativeGraph.uuid(tables[1])!, parentColumnUuids: [nativeGraph.uuid(columns[0])!], childColumnUuids: [nativeGraph.uuid(columns[1])!] });
    expect(projectNativeDocument(document).allRelationships[0].onDelete).toBe('NO ACTION');
    const constraint = document.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!;
    const properties = document.graph.objects.find(o => o.id === (nativeGraph.field(constraint, 'physicalProperties') as { ref: number }).ref)!;
    properties.features = properties.features.filter(f => f.name !== 'onDeleteRule');
    const imported = rebuildNativeDocument(document.graph);
    expect(projectNativeDocument(imported).allRelationships[0].onDelete).toBe('CASCADE');
    expect(generateNativeDdl(imported).sql).toContain('ON DELETE CASCADE');
    expect(projectNativeDocument(openNativeDocument(saveNativeDocument(imported), registry)).allRelationships[0].onDelete).toBe('CASCADE');
  });
  it('keeps legacy PostgreSQL starting choices, preserves an explicit version and rejects unknown identity', () => {
    const legacy = createNativeDocument();
    expect(legacy.graph.objects.find(o => o.class.name === 'Schema')!.features.find(f => f.name === 'physicalName')?.value).toBe('public');
    expect(legacy.graph.objects.find(o => o.class.name === 'Column')!.features.find(f => f.name === 'dataType')?.value).toBe('BIGINT');
    expect(legacy.graph.objects.find(o => o.class.name === 'Document')!.features.some(f => f.name === 'databaseVersion')).toBe(false);
    const explicit = createNativeDocument('버전 지정', { database: { productId: 'com.tomato.db.postgresql', databaseVersion: 'PostgreSQL 14.0' } });
    expect(explicit.graph.objects.find(o => o.class.name === 'Document')!.features.find(f => f.name === 'databaseVersion')?.value).toBe('PostgreSQL 14.0');
    expect(() => createNativeDocument('오류', { database: { productId: 'unknown' as NativeDatabaseProductId } })).toThrow('DB 제품');
    expect(() => createNativeDocument('오류', { database: { productId: 'com.tomato.db.mysql', databaseVersion: ' ' } })).toThrow('DB 버전');
  });
  it('adds physical properties only to new objects, preserving existing omissions in legacy documents', () => {
    const graph = structuredClone(createNativeDocument().graph);
    graph.objects = graph.objects.filter(o => o.class.packageUri === 'http://exerd.tomato.com/model');
    graph.objects.forEach(o => { o.features = o.features.filter(f => f.name !== 'physicalProperties'); });
    graph.packages = graph.packages.filter(p => p.namespaceURI === 'http://exerd.tomato.com/model');
    const legacy = rebuildNativeDocument(graph), table = legacy.graph.objects.find(o => o.class.name === 'Table')!;
    const tableUuid = table.features.find(f => f.name === 'UUID')!.value as string;
    const next = mutateNativeDocument(legacy, { type: 'addColumn', tableUuid, name: 'new_value' });
    expect(next.byUuid.get(tableUuid)!.features.some(f => f.name === 'physicalProperties')).toBe(false);
    expect(next.graph.objects.filter(o => o.class.name === 'ColumnProperties')).toHaveLength(1);
    expect(legacy.graph.objects.some(o => o.class.packageUri !== 'http://exerd.tomato.com/model')).toBe(false);
  });
});

it('initializes the Oracle sequence folder for newly created schemas without populating existing omissions', () => {
  let d = createNativeDocument('Oracle Forward', { database: { productId: 'com.tomato.db.oracle_10g' } });
  const props = d.graph.objects.find(o => o.class.packageUri === 'http://exerd.tomato.com/oracle10g' && o.class.name === 'SchemaProperties')!;
  const folder = d.graph.objects[(props.features.find(f => f.name === 'sequenceGroup')!.value as { ref: number }).ref];
  expect(folder.class).toEqual({ packageUri: 'http://exerd.tomato.com/oracle10g', name: 'SequenceGroup' });
  expect(folder.features.some(f => f.name === 'sequences')).toBe(false);
  d = mutateNativeDocument(d, { type: 'addSchema', name: 'archive' });
  expect(d.graph.objects.filter(o => o.class.name === 'SequenceGroup' && o.class.packageUri === 'http://exerd.tomato.com/oracle10g')).toHaveLength(2);
  expect(openNativeDocument(saveNativeDocument(d), registry).graph.objects).toEqual(d.graph.objects);
});

it('initializes PostgreSQL Forward sequence/type folders without adding sequences or data types', () => {
  const d = createNativeDocument();
  const props = d.graph.objects.find(o => o.class.packageUri === 'http://exerd.tomato.com/postgresql/model' && o.class.name === 'SchemaProperties')!;
  for (const [feature, name] of [['sequenceGroup', 'SequenceGroup'], ['userDatatypeGroup', 'UserDatatypeGroup']]) {
    const folder = d.graph.objects[(props.features.find(f => f.name === feature)!.value as { ref: number }).ref];
    expect(folder.class).toEqual({ packageUri: 'http://exerd.tomato.com/postgresql/model', name });
  }
  expect(d.graph.objects.some(o => ['Sequence', 'UserDatatype'].includes(o.class.name))).toBe(false);
  expect(openNativeDocument(saveNativeDocument(d), registry).graph.objects).toEqual(d.graph.objects);
});

it('initializes only neutral SQL Server index options on newly created groups', () => {
  let d = createNativeDocument('SQL Server Forward', { database: { productId: 'com.tomato.db.sqlserver_2005' } });
  const column = d.graph.objects.find(o => o.class.name === 'Column')!, table = d.graph.objects.find(o => o.class.name === 'Table')!;
  d = mutateNativeDocument(d, { type: 'addColumnGroup', tableUuid: nativeGraph.uuid(table)!, kind: 'index', name: 'ix_new_id', columnUuids: [nativeGraph.uuid(column)!] });
  for (const p of d.graph.objects.filter(o => o.class.packageUri === 'http://exerd.tomato.com/sqlserver/model' && o.class.name === 'IndexProperties')) {
    const options = d.graph.objects[(nativeGraph.field(p, 'relationalIndexOption') as { ref: number }).ref];
    expect(options.class).toEqual({ packageUri: p.class.packageUri, name: 'RelationalIndexOption' });
    expect(options.features.map(f => f.name)).toEqual(['UUID']);
  }
  const graph = structuredClone(d.graph), first = graph.objects.find(o => o.class.name === 'IndexProperties')!;
  const oldOption = (nativeGraph.field(first, 'relationalIndexOption') as { ref: number }).ref;
  first.features = first.features.filter(f => f.name !== 'relationalIndexOption'); graph.objects = graph.objects.filter(o => o.id !== oldOption);
  const legacy = rebuildNativeDocument(graph, d.container), rebuilt = openNativeDocument(saveNativeDocument(legacy), registry);
  expect(nativeGraph.field(rebuilt.byUuid.get(nativeGraph.uuid(first)!)!, 'relationalIndexOption')).toBeUndefined();
});
it.each(['com.tomato.db.cubrid', 'com.tomato.db.cubrid10'] as const)('initializes empty CUBRID partition scaffolding for %s without enabling partitioning', productId => {
  let d = createNativeDocument('CUBRID Forward', { database: { productId } }); d = appendNativeTable(d, { name: 'next_table' });
  for (const p of d.graph.objects.filter(o => o.class.packageUri === 'http://exerd.tomato.com/cubrid/model' && o.class.name === 'TableProperties')) {
    const partition = d.graph.objects[(nativeGraph.field(p, 'partition') as { ref: number }).ref];
    const algorithm = d.graph.objects[(nativeGraph.field(partition, 'partitionAlgorithm') as { ref: number }).ref];
    expect(partition.class.name).toBe('Partition'); expect(algorithm.class.name).toBe('PartitionAlgorithm');
    expect(partition.features.map(f => f.name).sort()).toEqual(['UUID', 'partitionAlgorithm']);
    expect(algorithm.features.map(f => f.name)).toEqual(['UUID']);
  }
  expect(openNativeDocument(saveNativeDocument(d), registry).graph.objects).toEqual(d.graph.objects);
});
