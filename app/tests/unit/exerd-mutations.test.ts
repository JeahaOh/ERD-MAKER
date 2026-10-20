import { describe, expect, it } from 'vitest';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument, NativeDependencyError, type NativeCommand } from '../../src/formats/exerd/mutations';
import { saveNativeDocument, openNativeDocument, editNativeAttributes, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryReference, BinaryRegistry } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';
const field = (o: BinaryObject, key: string) => o.features.find(f => f.name === key)?.value;
const uuid = (o: BinaryObject) => field(o, 'UUID') as string;
const all = (d: NativeExerdDocument, cls: string) => d.graph.objects.filter(o => o.class.name === cls);
const table = (d: NativeExerdDocument, name: string) => all(d, 'Table').find(o => field(o, 'physicalName') === name)!;
const columns = (d: NativeExerdDocument, t: BinaryObject) => (field(t, 'columns') as BinaryReference[]).map(ref => d.graph.objects.find(o => o.id === ref.ref)!);
function two() { return appendNativeTable(createNativeDocument('구조 명령'), { name: 'child', logicalName: '자식', x: 500 }); }
const mutate = (d: NativeExerdDocument, c: NativeCommand) => {
  const before = saveNativeDocument(d), result = mutateNativeDocument(d, c);
  expect(saveNativeDocument(d)).toEqual(before);
  expect(openNativeDocument(saveNativeDocument(result), schema as BinaryRegistry).graph.objects).toEqual(result.graph.objects);
  expect(new Set(result.xml.byUuid.keys())).toEqual(new Set(result.byUuid.keys()));
  return result;
};
function related(composite = false, identifying = false) {
  let d = two(); const parentUuid = uuid(table(d, 'new_table')), childUuid = uuid(table(d, 'child'));
  if (composite) for (const id of [parentUuid, childUuid]) d = mutate(d, { type: 'addColumn', tableUuid: id, name: 'tenant_id', dataType: 'BIGINT', nullable: false });
  const parents = columns(d, table(d, 'new_table')), children = columns(d, table(d, 'child'));
  if (composite) d = mutate(d, { type: 'setPrimaryKey', tableUuid: parentUuid, columnUuids: parents.map(uuid) });
  return mutate(d, { type: 'addRelationship', name: 'fk_child_parent', parentTableUuid: parentUuid, childTableUuid: childUuid, parentColumnUuids: parents.map(uuid), childColumnUuids: children.map(uuid), identifying });
}
describe('native structural commands', () => {
  it('adds and removes an ordinary column immutably and rejects duplicate column names', () => {
    let d = two(); const id = uuid(table(d, 'child'));
    d = mutate(d, { type: 'addColumn', tableUuid: id, name: 'title', logicalName: '제목', dataType: 'VARCHAR(100)', nullable: true, defaultValue: "'a b'" });
    expect(columns(d, table(d, 'child'))).toHaveLength(2);
    expect(() => mutateNativeDocument(d, { type: 'addColumn', tableUuid: id, name: 'title' })).toThrow('같은');
    const col = columns(d, table(d, 'child')).find(c => field(c, 'physicalName') === 'title')!;
    d = mutate(d, { type: 'removeColumn', columnUuid: uuid(col) }); expect(columns(d, table(d, 'child'))).toHaveLength(1);
  });
  it('requires a complete permutation to reorder columns and preserves stable UUIDs', () => {
    let d = two(), id = uuid(table(d, 'child')); d = mutate(d, { type: 'addColumn', tableUuid: id, name: 'name' });
    const ids = columns(d, table(d, 'child')).map(uuid);
    d = mutate(d, { type: 'reorderColumns', tableUuid: id, columnUuids: ids.toReversed() }); expect(columns(d, table(d, 'child')).map(uuid)).toEqual(ids.toReversed());
    expect(() => mutateNativeDocument(d, { type: 'reorderColumns', tableUuid: id, columnUuids: [ids[0]] })).toThrow('순열');
    expect(() => mutateNativeDocument(d, { type: 'reorderColumns', tableUuid: id, columnUuids: [ids[0], ids[0]] })).toThrow('중복');
  });
  it('creates composite PK and FK structures including constraints, ordered references and relation manager entries', () => {
    const d = related(true); expect(all(d, 'ForeignKeyColumnGroup')).toHaveLength(1); expect(all(d, 'ForeignKeyConstraint')).toHaveLength(1);
    expect(field(all(d, 'ForeignKeyConstraint')[0], 'physicalName')).toBe('fk_child_parent');
    expect(all(d, 'RelationEntry')).toHaveLength(1); expect(all(d, 'Relation')).toHaveLength(1);
    const references = all(d, 'ColumnReference'); expect(references.map(r => field(r, 'entryIndex'))).toEqual([0, 1]);
    const parentIds = columns(d, table(d, 'new_table')).map(c => c.id); expect(references.map(r => (field(r, 'parentColumn') as BinaryReference).ref)).toEqual(parentIds);
    expect(all(d, 'TableDiagram')).toHaveLength(2); // Relationship lines derive from relations and placements, not extra scene objects.
  });
  it('preserves FK mappings and reindexes memberships when a parent composite PK is reordered', () => {
    let d = related(true); const parent = table(d, 'new_table'), ids = columns(d, parent).map(uuid);
    const references = all(d, 'ColumnReference').map(r => ({ uuid: uuid(r), parent: field(r, 'parentColumn') }));
    d = mutate(d, { type: 'setPrimaryKey', tableUuid: uuid(parent), columnUuids: ids.toReversed() });
    expect(all(d, 'ColumnReference').map(r => ({ uuid: uuid(r), parent: field(r, 'parentColumn') }))).toEqual(references);
    expect(all(d, 'ColumnReference').map(r => field(r, 'entryIndex'))).toEqual([1, 0]);
  });
  it('preserves independent key order across physical moves when legacy membership indices are duplicated or absent', () => {
    let d = related(true); const parent = table(d, 'new_table');
    const parentColumnIds = columns(d, parent).map(uuid);
    const memberships = all(d, 'PrimaryKeyMembership').filter(m => { const group = (field(m, 'group') as BinaryReference).ref; return (field(parent, 'columnGroups') as BinaryReference[]).some(r => r.ref === group); });
    d = editNativeAttributes(d, schema as BinaryRegistry, memberships.map(m => ({ uuid: uuid(m), name: 'entryIndex', value: '2' })));
    const beforeMemberships = memberships.map(uuid);
    d = mutate(d, { type: 'reorderColumns', tableUuid: uuid(parent), columnUuids: parentColumnIds.toReversed() });
    expect(columns(d, table(d, 'new_table')).map(uuid)).toEqual(parentColumnIds.toReversed());
    expect(beforeMemberships.map(id => field(d.byUuid.get(id)!, 'entryIndex'))).toEqual([0, 1]);
    expect(all(d, 'ColumnReference').map(m => field(m, 'parentColumn'))).toHaveLength(2);
  });
  it('blocks key or referenced column deletion without explicit cascade and removes all dependent FK graph layers with it', () => {
    let d = related(true); const parent = table(d, 'new_table'), cols = columns(d, parent);
    expect(() => mutateNativeDocument(d, { type: 'setPrimaryKey', tableUuid: uuid(parent), columnUuids: [uuid(cols[0])] })).toThrow(NativeDependencyError);
    expect(() => mutateNativeDocument(d, { type: 'removeColumn', columnUuid: uuid(cols[1]) })).toThrow(NativeDependencyError);
    d = mutate(d, { type: 'removeColumn', columnUuid: uuid(cols[1]), cascade: true });
    for (const cls of ['ForeignKeyColumnGroup', 'ColumnReference', 'Relation', 'RelationEntry', 'ForeignKeyConstraint']) expect(all(d, cls)).toHaveLength(0);
    expect(columns(d, table(d, 'new_table'))).toHaveLength(1);
  });
  it('removes a relationship without dropping table columns or primary keys', () => {
    let d = related(); d = mutate(d, { type: 'removeRelationship', foreignKeyUuid: uuid(all(d, 'ForeignKeyColumnGroup')[0]) });
    expect(all(d, 'Column')).toHaveLength(2); expect(all(d, 'PrimaryKeyMembership')).toHaveLength(2); expect(all(d, 'Relation')).toHaveLength(0);
  });
  it('blocks related table deletion then explicitly cascades relationships and all placements', () => {
    let d = related(); const parent = uuid(table(d, 'new_table'));
    expect(() => mutateNativeDocument(d, { type: 'removeTable', tableUuid: parent })).toThrow(NativeDependencyError);
    d = mutate(d, { type: 'removeTable', tableUuid: parent, cascade: true });
    expect(all(d, 'Table')).toHaveLength(1); expect(all(d, 'TableDiagram')).toHaveLength(1); expect(all(d, 'Relation')).toHaveLength(0);
  });
  it('adds another diagram with existing tables and duplicates its complete owned scene with fresh UUIDs', () => {
    let d = two(); const area = uuid(all(d, 'BusinessArea')[0]), ids = all(d, 'Table').map(uuid);
    d = mutate(d, { type: 'addDiagram', businessAreaUuid: area, name: '분석용', tableUuids: ids });
    const source = all(d, 'Diagram').find(o => field(o, 'logicalName') === '분석용')!, oldPlacements = all(d, 'TableDiagram').map(uuid);
    d = mutate(d, { type: 'duplicateDiagram', diagramUuid: uuid(source), name: '분석용 복제' });
    expect(all(d, 'Diagram')).toHaveLength(3); expect(all(d, 'Table')).toHaveLength(2); expect(all(d, 'TableDiagram')).toHaveLength(6);
    expect(new Set(all(d, 'TableDiagram').map(uuid)).size).toBe(6); expect(oldPlacements.every(id => d.byUuid.has(id))).toBe(true);
    expect(() => mutateNativeDocument(d, { type: 'duplicateDiagram', diagramUuid: uuid(source), name: '분석용' })).toThrow('같은');
  });
  it('creates nested domains, assigns and removes a domain without discarding scalar overrides by default', () => {
    let d = two(); const columnUuid = uuid(columns(d, table(d, 'child'))[0]);
    d = mutate(d, { type: 'addDomain', name: '식별자', dataType: 'BIGINT', nullable: false, defaultValue: '0' });
    const parent = all(d, 'Domain')[0]; d = mutate(d, { type: 'addDomain', name: '고객식별자', parentDomainUuid: uuid(parent) });
    const domain = all(d, 'Domain').find(o => field(o, 'name') === '고객식별자')!;
    d = mutate(d, { type: 'setColumnDomain', columnUuid, domainUuid: uuid(domain) }); expect(field(d.byUuid.get(columnUuid)!, 'dataType')).toBe('BIGINT');
    d = mutate(d, { type: 'setColumnDomain', columnUuid, domainUuid: uuid(domain), inherit: true }); expect(field(d.byUuid.get(columnUuid)!, 'dataType')).toBeUndefined(); expect(field(d.byUuid.get(columnUuid)!, 'notNull')).toBe('TRUE');
    d = mutate(d, { type: 'setColumnDomain', columnUuid, domainUuid: null }); expect(field(d.byUuid.get(columnUuid)!, 'domain')).toBeUndefined();
  });
  it('identifying relations extend the child PK and protect it from inconsistent key changes', () => {
    const d = related(false, true); const child = table(d, 'child');
    expect(field(all(d, 'Relation')[0], 'identifying')).toBe(true);
    expect(() => mutateNativeDocument(d, { type: 'setPrimaryKey', tableUuid: uuid(child), columnUuids: [] })).toThrow(NativeDependencyError);
  });
  it('rejects mismatched types, non-key parent columns, invalid cardinality and foreign table columns atomically', () => {
    let d = two(); const p = table(d, 'new_table'), c = table(d, 'child'), pi = uuid(columns(d, p)[0]), ci = uuid(columns(d, c)[0]);
    d = mutate(d, { type: 'addColumn', tableUuid: uuid(c), name: 'bad', dataType: 'TEXT' }); const bad = uuid(columns(d, table(d, 'child'))[1]);
    const base = { type: 'addRelationship' as const, name: 'fk', parentTableUuid: uuid(p), childTableUuid: uuid(c), parentColumnUuids: [pi], childColumnUuids: [ci] };
    expect(() => mutateNativeDocument(d, { ...base, childColumnUuids: [bad] })).toThrow('자료형');
    expect(() => mutateNativeDocument(d, { ...base, parentColumnUuids: [ci] })).toThrow('속하지');
    expect(() => mutateNativeDocument(d, { ...base, childCardinality: 'INVALID' as any })).toThrow('카디널리티');
  });
});
