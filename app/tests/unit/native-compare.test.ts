import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { compareNativeDocuments } from '../../src/formats/exerd/compare';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { editNativeAttributes, openNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryRegistry, BinaryValue } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';
const registry = schema as BinaryRegistry;
const value = (object: BinaryObject, name: string) => object.features.find(feature => feature.name === name)?.value;
const uuid = (object: BinaryObject) => value(object, 'UUID') as string;
const all = (document: NativeExerdDocument, type: string) => document.graph.objects.filter(object => object.class.name === type);
function set(object: BinaryObject, name: string, newValue: BinaryValue) {
  const previous = object.features.find(feature => feature.name === name);
  if (previous) previous.value = newValue; else object.features.push({ id: object.features.length, name, kind: 'DATA', value: newValue });
}
function fixture() {
  let document = appendNativeTable(createNativeDocument('Compare fixture'), { name: 'child' });
  const parentUuid = uuid(all(document, 'Table')[0]), childUuid = uuid(all(document, 'Table')[1]);
  document = mutateNativeDocument(document, { type: 'addColumn', tableUuid: parentUuid, name: 'code', dataType: 'VARCHAR(20)' });
  const parentColumns = all(document, 'Column').filter(column => (value(document.byUuid.get(parentUuid)!, 'columns') as { ref: number }[]).some(ref => ref.ref === column.id));
  const childColumn = all(document, 'Column').find(column => (value(document.byUuid.get(childUuid)!, 'columns') as { ref: number }[]).some(ref => ref.ref === column.id))!;
  document = mutateNativeDocument(document, { type: 'addRelationship', name: 'fk_child', parentTableUuid: parentUuid, childTableUuid: childUuid, parentColumnUuids: [uuid(parentColumns[0])], childColumnUuids: [uuid(childColumn)] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: parentUuid, kind: 'unique', name: 'uk_code', columnUuids: [uuid(parentColumns[1])] });
  document = mutateNativeDocument(document, { type: 'addColumnGroup', tableUuid: parentUuid, kind: 'index', name: 'ix_code', columnUuids: [uuid(parentColumns[1])] });
  document = mutateNativeDocument(document, { type: 'addCheckConstraint', tableUuid: parentUuid, name: 'ck_id', expression: '"id" > 0' });
  document = mutateNativeDocument(document, { type: 'addDomain', name: 'code-domain', dataType: 'VARCHAR(20)' });
  document = mutateNativeDocument(document, { type: 'addNote', diagramUuid: uuid(all(document, 'Diagram')[0]), text: 'Original note' });
  return document;
}

describe('whole native model comparison', () => {
  it('tracks a same-UUID table rename as one field change rather than remove/add and keeps both inputs unchanged', () => {
    const before = createNativeDocument('Rename'), tableUuid = uuid(all(before, 'Table')[0]);
    const after = editNativeAttributes(before, registry, [{ uuid: tableUuid, name: 'physicalName', value: 'renamed' }]);
    const oldGraph = structuredClone(before.graph), newGraph = structuredClone(after.graph);
    const comparison = compareNativeDocuments(before, after);
    expect(comparison.changes).toEqual([expect.objectContaining({ kind: 'changed', objectType: 'Table', uuid: tableUuid, feature: 'physicalName', before: 'new_table', after: 'renamed', risk: 'rename', match: expect.objectContaining({ strategy: 'uuid', confidence: 'exact' }) })]);
    expect(comparison.summary).toMatchObject({ added: 0, removed: 0, total: 1, tentativeMatches: 0 });
    expect(before.graph).toEqual(oldGraph); expect(after.graph).toEqual(newGraph);
    expect(compareNativeDocuments(before, after).changes[0].id).toBe(comparison.changes[0].id);
  });
  it('reports explicit tentative name/containment matching for independent models instead of UUID noise', () => {
    const before = createNativeDocument('Independent'), after = createNativeDocument('Independent');
    const equal = compareNativeDocuments(before, after);
    expect(equal.changes).toEqual([]); expect(equal.summary.tentativeMatches).toBeGreaterThan(0);
    expect(equal.summary.unmatchedBefore).toBe(0); expect(equal.summary.unmatchedAfter).toBe(0);
    const afterColumn = all(after, 'Column')[0]; set(afterColumn, 'comment', 'Different meaning');
    const changed = compareNativeDocuments(before, after);
    expect(changed.changes).toEqual([expect.objectContaining({ objectType: 'Column', feature: 'comment', match: expect.objectContaining({ strategy: 'qualified-name', confidence: 'tentative', beforeUuid: uuid(all(before, 'Column')[0]), afterUuid: uuid(afterColumn) }) })]);
  });
  it('compares actual attributes for schemas, tables, columns, keys, checks, domains, diagrams and notes', () => {
    const before = fixture(), after = structuredClone(before);
    const edits: Array<[string, string, BinaryValue]> = [
      ['Schema', 'logicalName', 'Changed schema'], ['Table', 'comment', 'Changed table'], ['Column', 'defaultValue', '2'],
      ['PrimaryKeyColumnGroup', 'comment', 'Changed PK'], ['ForeignKeyColumnGroup', 'useIndexing', true],
      ['AlternateKeyColumnGroup', 'comment', 'Changed AK'], ['InversionEntryColumnGroup', 'comment', 'Changed index'],
      ['CheckConstraint', 'expression', '"id" > 1'], ['Domain', 'suggestedDefaultValue', "'NEW'"],
      ['Diagram', 'comment', 'Changed diagram'], ['Note', 'text', 'Changed note'],
    ];
    for (const [type, feature, newValue] of edits) set(all(after, type)[0], feature, newValue);
    const comparison = compareNativeDocuments(before, after);
    expect(comparison.summary).toMatchObject({ added: 0, removed: 0, total: edits.length });
    for (const [type, feature, newValue] of edits) expect(comparison.changes).toContainEqual(expect.objectContaining({ objectType: type, feature, after: newValue }));
  });
  it('distinguishes ordered reference permutations, containment moves and layout moves without child index-shift noise', () => {
    const before = fixture(), ordered = structuredClone(before), parent = all(ordered, 'Table')[0];
    set(parent, 'columns', [...value(parent, 'columns') as BinaryValue[]].reverse());
    const order = compareNativeDocuments(before, ordered);
    expect(order.changes).toEqual([expect.objectContaining({ kind: 'moved', objectType: 'Table', feature: 'columns', risk: 'ordering' })]);
    const layout = structuredClone(before); set(all(layout, 'TableDiagram')[0], 'location', 'Point(900, 200)');
    expect(compareNativeDocuments(before, layout).changes).toEqual([expect.objectContaining({ kind: 'moved', feature: 'location', risk: 'layout' })]);
    const withSchema = mutateNativeDocument(before, { type: 'addSchema', name: 'other' }), moved = structuredClone(withSchema);
    const schemas = all(moved, 'Schema'), movedTable = all(moved, 'Table')[0];
    set(schemas[0], 'tables', (value(schemas[0], 'tables') as { ref: number }[]).filter(ref => ref.ref !== movedTable.id));
    set(schemas[1], 'tables', [{ ref: movedTable.id }]);
    const relocation = compareNativeDocuments(withSchema, moved);
    expect(relocation.summary.total).toBe(3);
    expect(relocation.changes).toContainEqual(expect.objectContaining({ kind: 'moved', objectType: 'Table', feature: '$containment' }));
  });
  it('keeps null/empty distinctions while treating omitted schema defaults and transient state as equivalent', () => {
    const before = createNativeDocument(), defaults = structuredClone(before), config = all(defaults, 'Configuration')[0];
    set(config, 'interactionMode', 'logical');
    set(all(defaults, 'Column')[0], 'indexed', true); // Derived/transient.
    expect(compareNativeDocuments(before, defaults).changes).toEqual([]);
    const empty = structuredClone(before); set(all(empty, 'Column')[0], 'defaultValue', '');
    expect(compareNativeDocuments(before, empty).changes).toEqual([expect.objectContaining({ feature: 'defaultValue', before: null, after: '' })]);
  });
  it('ignores binary object-ID renumbering while preserving reference meaning', () => {
    const before = fixture(), after = structuredClone(before), mapping = new Map(after.graph.objects.map(object => [object.id, object.id * 7 + 101]));
    const remap = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(remap);
      else if (value && typeof value === 'object') {
        if ('ref' in value && typeof value.ref === 'number') value.ref = mapping.get(value.ref)!;
        else if ('value' in value) remap(value.value);
      }
    };
    for (const object of after.graph.objects) { for (const feature of object.features) remap(feature.value); object.id = mapping.get(object.id)!; }
    after.graph.roots = after.graph.roots.map(id => id === null ? null : mapping.get(id)!);
    expect(compareNativeDocuments(before, after).changes).toEqual([]);
  });
  it('detects an FK reference-target change even when object and column counts do not change', () => {
    const before = fixture(), after = structuredClone(before), parent = all(after, 'Table')[0];
    const otherColumn = (value(parent, 'columns') as { ref: number }[])[1];
    set(all(after, 'ColumnReference')[0], 'parentColumn', otherColumn);
    const result = compareNativeDocuments(before, after);
    expect(result.changes).toEqual([expect.objectContaining({ objectType: 'ColumnReference', feature: 'parentColumn', risk: 'reference', before: expect.objectContaining({ objectType: 'Column' }), after: expect.objectContaining({ objectType: 'Column' }) })]);
    expect(result.changes[0].before).not.toEqual(result.changes[0].after);
  });
  it('stabilizes anonymous EMap entries by reference key when one relationship is removed', () => {
    let before = fixture(); const first = all(before, 'ForeignKeyColumnGroup')[0], parent = all(before, 'Table')[0], child = all(before, 'Table')[1];
    const parentColumn = all(before, 'Column').find(column => (value(parent, 'columns') as { ref: number }[]).some(ref => ref.ref === column.id))!;
    const childColumn = all(before, 'Column').find(column => (value(child, 'columns') as { ref: number }[]).some(ref => ref.ref === column.id))!;
    before = mutateNativeDocument(before, { type: 'addRelationship', name: 'fk_second', parentTableUuid: uuid(parent), childTableUuid: uuid(child), parentColumnUuids: [uuid(parentColumn)], childColumnUuids: [uuid(childColumn)] });
    const after = mutateNativeDocument(before, { type: 'removeRelationship', foreignKeyUuid: uuid(first) });
    const result = compareNativeDocuments(before, after);
    expect(result.summary.added).toBe(0); expect(result.summary.changed).toBe(3); expect(result.summary.moved).toBe(0);
    expect(result.summary.removed).toBe(before.graph.objects.length - after.graph.objects.length);
    expect(result.changes.filter(change => change.kind === 'changed').map(change => change.feature).sort()).toEqual(['columnGroups', 'memberships', 'relation']);
    expect(result.changes.some(change => change.uuid === uuid(all(after, 'ForeignKeyColumnGroup')[0]))).toBe(false);
  });
  it('does not guess a renamed external UUID-bearing table from ordinal position alone', () => {
    const before = createNativeDocument('External'), after = createNativeDocument('External');
    set(all(after, 'Table')[0], 'physicalName', 'unmatched_new_name');
    const result = compareNativeDocuments(before, after);
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'removed', objectType: 'Table' }));
    expect(result.changes).toContainEqual(expect.objectContaining({ kind: 'added', objectType: 'Table' }));
    expect(result.changes.some(change => change.objectType === 'Table' && change.feature === 'physicalName' && change.kind === 'changed')).toBe(false);
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('real 609-table whole-model comparison', () => {
  it('compares every persistent object/feature, detects name changes with equal counts, and reports only expected FK deletion effects', () => {
    const before = openNativeDocument(new Uint8Array(readFileSync(source)), registry);
    const same = compareNativeDocuments(before, openNativeDocument(new Uint8Array(readFileSync(source)), registry));
    expect(same.changes).toEqual([]); expect(same.summary).toMatchObject({ beforeObjects: 36057, afterObjects: 36057, matchedObjects: 36057, tentativeMatches: 0 });
    expect(same.summary.comparedFeatures).toBeGreaterThan(90000);
    const tableUuid = uuid(all(before, 'Table')[0]);
    const renamed = editNativeAttributes(before, registry, [{ uuid: tableUuid, name: 'physicalName', value: 'LOCAL_COMPARE_RENAME' }]);
    expect(compareNativeDocuments(before, renamed).changes).toEqual([expect.objectContaining({ uuid: tableUuid, feature: 'physicalName', kind: 'changed', risk: 'rename' })]);
    const removed = mutateNativeDocument(before, { type: 'removeRelationship', foreignKeyUuid: uuid(all(before, 'ForeignKeyColumnGroup')[0]) });
    const delta = compareNativeDocuments(before, removed);
    expect(delta.summary).toMatchObject({ total: 12, added: 0, removed: 9, changed: 3, moved: 0 });
    expect(delta.changes.filter(change => change.kind === 'changed').map(change => change.feature).sort()).toEqual(['columnGroups', 'memberships', 'relation']);
  });
});
