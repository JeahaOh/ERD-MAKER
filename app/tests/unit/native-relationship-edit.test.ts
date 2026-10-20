import { describe, expect, it } from 'vitest';
import { createNativeDocument, appendNativeTable, rebuildNativeDocument, nativeGraph } from '../../src/formats/exerd/create';
import { mutateNativeDocument, NativeDependencyError, type NativeCommand } from '../../src/formats/exerd/mutations';
import { openNativeDocument, saveNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { compareNativeDocuments } from '../../src/formats/exerd/compare';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';
import type { BinaryObject, BinaryRegistry } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';
const { field, uuid, set } = nativeGraph;
const all = (d: NativeExerdDocument, type: string) => d.graph.objects.filter(o => o.class.name === type);
const named = (d: NativeExerdDocument, type: string, name: string) => all(d, type).find(o => field(o, 'physicalName') === name)!;
const uid = (o: BinaryObject) => uuid(o)!;
const columns = (d: NativeExerdDocument, table: BinaryObject) => (field(table, 'columns') as { ref: number }[]).map(r => d.graph.objects.find(o => o.id === r.ref)!);
function run(d: NativeExerdDocument, command: NativeCommand) {
  const before = saveNativeDocument(d), next = mutateNativeDocument(d, command);
  expect(saveNativeDocument(d)).toEqual(before);
  const restored = openNativeDocument(saveNativeDocument(next), schema as BinaryRegistry);
  expect(restored.graph.objects).toEqual(next.graph.objects);
  return restored;
}
function fixture() {
  let d = appendNativeTable(createNativeDocument('관계 수정 검증'), { name: 'child' });
  for (const table of all(d, 'Table')) d = run(d, { type: 'addColumn', tableUuid: uid(table), name: 'code', dataType: 'BIGINT' });
  const parent = named(d, 'Table', 'new_table'), child = named(d, 'Table', 'child');
  d = run(d, { type: 'setPrimaryKey', tableUuid: uid(parent), columnUuids: columns(d, parent).map(uid) });
  const currentParent = named(d, 'Table', 'new_table'), currentChild = named(d, 'Table', 'child');
  return run(d, { type: 'addRelationship', name: 'fk_child', parentTableUuid: uid(currentParent), childTableUuid: uid(currentChild), parentColumnUuids: columns(d, currentParent).map(uid), childColumnUuids: columns(d, currentChild).map(uid) });
}
describe('native relationship editing', () => {
  it('changes cardinality alone without changing memberships, constraints, physical metadata or SQL', () => {
    const d = fixture(), fk = all(d, 'ForeignKeyColumnGroup')[0], sql = generateNativeDdl(d).sql;
    const next = run(d, { type: 'editRelationship', foreignKeyUuid: uid(fk), parentCardinality: 'ZERO_OR_ONE', childCardinality: 'ONE_OR_MORE' });
    expect(projectNativeDocument(next).allRelationships[0]).toMatchObject({ parentCardinality: 'ZERO_OR_ONE', childCardinality: 'ONE_OR_MORE' });
    expect(compareNativeDocuments(d, next).changes.map(c => c.feature).sort()).toEqual(['childCardinalityType', 'parentCardinalityType']);
    expect(generateNativeDdl(next).sql).toBe(sql);
  });
  it('swaps composite child mappings while preserving all membership identities, FK identity and physical options', () => {
    let d = fixture(); const group = all(d, 'ForeignKeyColumnGroup')[0], constraint = all(d, 'ForeignKeyConstraint')[0];
    set(group, 'useIndexing', true);
    const properties = d.graph.objects.find(o => o.id === (field(constraint, 'physicalProperties') as { ref: number }).ref)!;
    set(properties, 'onDeleteRule', 'CASCADE'); set(properties, 'deferrable', true);
    const memberships = all(d, 'ColumnReference'); set(memberships[0], 'sortType', 'DESC');
    d = rebuildNativeDocument(d.graph);
    const view = projectNativeDocument(d), relationship = view.allRelationships[0], beforeIds = all(d, 'ColumnReference').map(uid);
    const next = run(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, parentKeyUuid: relationship.parentKeyUuid, childColumnUuids: [...relationship.childColumnUuids].reverse() });
    expect(new Set(all(next, 'ColumnReference').map(uid))).toEqual(new Set(beforeIds));
    expect(projectNativeDocument(next).allRelationships[0]).toMatchObject({ uuid: relationship.uuid, constraintUuid: relationship.constraintUuid, childColumnUuids: [...relationship.childColumnUuids].reverse(), parentColumnUuids: relationship.parentColumnUuids, onDelete: 'CASCADE' });
    expect(next.byUuid.get(uid(properties))!.features).toEqual(d.byUuid.get(uid(properties))!.features);
    expect(field(next.byUuid.get(relationship.uuid)!, 'useIndexing')).toBe(true);
    expect(field(next.byUuid.get(beforeIds[0])!, 'sortType')).toBe('DESC');
    expect(generateNativeDdl(next).sql).toContain('FOREIGN KEY ("code", "id") REFERENCES "public"."new_table" ("id", "code") ON DELETE CASCADE');
  });
  it('switches between unique keys of different lengths without replacing the FK or unrelated memberships', () => {
    let d = fixture(); const parent = named(d, 'Table', 'new_table'), child = named(d, 'Table', 'child'), pc = columns(d, parent), cc = columns(d, child);
    d = run(d, { type: 'addColumnGroup', kind: 'unique', tableUuid: uid(parent), name: 'uk_code', columnUuids: [uid(pc[1])] });
    const relationship = projectNativeDocument(d).allRelationships[0], key = named(d, 'AlternateKeyColumnGroup', 'uk_code'), oldIds = all(d, 'ColumnReference').map(uid), pkIds = all(d, 'PrimaryKeyMembership').map(uid);
    d = run(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, parentKeyUuid: uid(key), childColumnUuids: [uid(cc[1])] });
    expect(all(d, 'ColumnReference')).toHaveLength(1); expect(oldIds).toContain(uid(all(d, 'ColumnReference')[0]));
    expect(projectNativeDocument(d).allRelationships[0]).toMatchObject({ uuid: relationship.uuid, parentKeyUuid: uid(key), parentColumnUuids: [uid(pc[1])], childColumnUuids: [uid(cc[1])] });
    d = run(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, parentKeyUuid: relationship.parentKeyUuid, childColumnUuids: cc.map(uid) });
    expect(all(d, 'ColumnReference')).toHaveLength(2); expect(all(d, 'PrimaryKeyMembership').map(uid)).toEqual(pkIds);
    expect(projectNativeDocument(d).allRelationships[0].constraintUuid).toBe(relationship.constraintUuid);
  });
  it('adds identifying columns to the child PK explicitly and leaves the PK intact when identification is cleared', () => {
    let d = fixture(); const relationship = projectNativeDocument(d).allRelationships[0], child = named(d, 'Table', 'child');
    d = run(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, identifying: true });
    expect(projectNativeDocument(d).allRelationships[0].identifying).toBe(true);
    expect(projectNativeDocument(d).allTables.find(t => t.uuid === uid(child))!.columns.every(c => c.primaryKey)).toBe(true);
    const pk = all(d, 'PrimaryKeyMembership').map(uid);
    d = run(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, identifying: false });
    expect(projectNativeDocument(d).allRelationships[0].identifying).toBe(false);
    expect(all(d, 'PrimaryKeyMembership').map(uid)).toEqual(pk);
  });
  it('reparents an existing FK without replacing the relation or its names', () => {
    let d = fixture(); const original = projectNativeDocument(d).allRelationships[0];
    d = appendNativeTable(d, { name: 'another_parent' });
    const parent = projectNativeDocument(d).allTables.find(t => t.name === 'another_parent')!, key = parent.groups.find(g => g.kind === 'primary')!;
    const next = run(d, { type: 'editRelationship', foreignKeyUuid: original.uuid, parentKeyUuid: key.uuid, childColumnUuids: [original.childColumnUuids[1]] });
    expect(projectNativeDocument(next).allRelationships[0]).toMatchObject({ uuid: original.uuid, constraintUuid: original.constraintUuid, name: original.name, constraintName: original.constraintName, parentTableUuid: parent.uuid, parentKeyUuid: key.uuid, parentColumnUuids: [parent.columns[0].uuid] });
    expect(generateNativeDdl(next).sql).toContain('FOREIGN KEY ("code") REFERENCES "public"."another_parent" ("id")');
  });
  it('rejects an identifying change that would invalidate a downstream FK instead of deleting that dependency', () => {
    let d = fixture(); const original = projectNativeDocument(d).allRelationships[0], child = projectNativeDocument(d).allTables.find(t => t.name === 'child')!;
    d = appendNativeTable(d, { name: 'grandchild' });
    const grandchild = projectNativeDocument(d).allTables.find(t => t.name === 'grandchild')!;
    d = run(d, { type: 'addRelationship', name: 'fk_grandchild', parentTableUuid: child.uuid, childTableUuid: grandchild.uuid, parentColumnUuids: [child.columns[0].uuid], childColumnUuids: [grandchild.columns[0].uuid] });
    const before = saveNativeDocument(d);
    expect(() => mutateNativeDocument(d, { type: 'editRelationship', foreignKeyUuid: original.uuid, identifying: true })).toThrow(NativeDependencyError);
    expect(saveNativeDocument(d)).toEqual(before); expect(projectNativeDocument(d).allRelationships).toHaveLength(2);
  });
  it('rejects invalid remapping atomically, including blank explicit types rather than inheriting over them', () => {
    let d = fixture(); const relationship = projectNativeDocument(d).allRelationships[0], parent = named(d, 'Table', 'new_table'), before = saveNativeDocument(d);
    for (const change of [
      { parentKeyUuid: relationship.parentKeyUuid },
      { parentKeyUuid: relationship.parentKeyUuid, childColumnUuids: [relationship.childColumnUuids[0]] },
      { parentKeyUuid: relationship.parentKeyUuid, childColumnUuids: [relationship.childColumnUuids[0], relationship.childColumnUuids[0]] },
      { parentKeyUuid: uid(parent), childColumnUuids: relationship.childColumnUuids },
      { childCardinality: 'INVALID' },
    ]) expect(() => mutateNativeDocument(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, ...change } as NativeCommand)).toThrow();
    expect(saveNativeDocument(d)).toEqual(before);
    d = run(d, { type: 'addDomain', name: '타입', dataType: 'BIGINT' });
    const column = d.byUuid.get(relationship.childColumnUuids[0])!;
    set(column, 'domain', { ref: all(d, 'Domain')[0].id }); set(column, 'dataType', ''); d = rebuildNativeDocument(d.graph);
    expect(() => mutateNativeDocument(d, { type: 'editRelationship', foreignKeyUuid: relationship.uuid, parentKeyUuid: relationship.parentKeyUuid, childColumnUuids: relationship.childColumnUuids })).toThrow('자료형');
  });
});
