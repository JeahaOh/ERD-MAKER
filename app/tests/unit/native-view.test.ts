import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { BinaryObject, BinaryRegistry, BinaryValue } from '../../src/formats/exerd/binary';
import { openNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import schema from '../../src/formats/exerd/schema.generated.json';

const R = (ref: number) => ({ ref });
function set(object: BinaryObject, name: string, value: BinaryValue) {
  const previous = object.features.find(feature => feature.name === name);
  if (previous) previous.value = value; else object.features.push({ id: object.features.length, name, kind: 'DATA', value });
}
function appendObject(doc: NativeExerdDocument, name: string, values: Record<string, BinaryValue>) {
  const object: BinaryObject = { id: Math.max(...doc.graph.objects.map(object => object.id)) + 1, class: { packageUri: 'http://exerd.tomato.com/model', name }, features: [] };
  for (const [key, value] of Object.entries(values)) set(object, key, value);
  doc.graph.objects.push(object); return object;
}
function fixture(): NativeExerdDocument {
  const object = (id: number, name: string, values: Record<string, BinaryValue>): BinaryObject => ({
    id, class: { packageUri: 'http://exerd.tomato.com/model', name },
    features: Object.entries(values).map(([name, value], id) => ({ id, name, kind: 'DATA', value })),
  });
  const objects = [
    object(0, 'Document', { UUID: 'doc', productId: 'unknown.product', databaseModel: R(1) }),
    object(1, 'DatabaseModel', { logicalName: '독립 테스트', schema: [R(2)] }),
    object(2, 'Schema', { UUID: 's', physicalName: 'sales', tables: [R(3), R(4)] }),
    object(3, 'Table', { UUID: 'parent', physicalName: 'parent', logicalName: '부모', columns: [R(5), R(6)], columnGroups: [R(9)] }),
    object(4, 'Table', { UUID: 'child', physicalName: 'child', columns: [R(7), R(8)], columnGroups: [R(10)] }),
    object(5, 'Column', { UUID: 'pkA', physicalName: 'a', dataType: 'BIGINT', memberships: [R(11)] }),
    object(6, 'Column', { UUID: 'pkB', physicalName: 'b', dataType: 'BIGINT', memberships: [R(13)] }),
    object(7, 'Column', { UUID: 'fkA', physicalName: 'a', domain: R(20), memberships: [R(15)] }),
    object(8, 'Column', { UUID: 'fkB', physicalName: 'b', dataType: 'BIGINT', notNull: 'FALSE', memberships: [R(17)] }),
    object(9, 'PrimaryKeyColumnGroup', { UUID: 'pk' }),
    object(10, 'ForeignKeyColumnGroup', { UUID: 'fk', physicalName: 'fk_child_parent', parentColumnGroup: R(9) }),
    object(11, 'MembershipEntry', { key: R(9), value: R(12) }),
    object(12, 'PrimaryKeyMembership', { group: R(9), entryIndex: 0 }),
    object(13, 'MembershipEntry', { key: R(9), value: R(14) }),
    object(14, 'PrimaryKeyMembership', { group: R(9), entryIndex: 1 }),
    object(15, 'MembershipEntry', { key: R(10), value: R(16) }),
    object(16, 'ColumnReference', { group: R(10), entryIndex: 1, parentColumn: R(5) }),
    object(17, 'MembershipEntry', { key: R(10), value: R(18) }),
    object(18, 'ColumnReference', { group: R(10), entryIndex: 0, parentColumn: R(6) }),
    object(19, 'Domain', { UUID: 'domain-parent', name: '공통', suggestedDataType: 'VARCHAR(20)', suggestedNotNull: 'TRUE', domain: [R(20)] }),
    object(20, 'Domain', { UUID: 'domain-child', name: '자식' }),
    object(21, 'BusinessArea', { UUID: 'area', logicalName: '영역', diagrams: [R(22), R(23)] }),
    object(22, 'Diagram', { UUID: 'd1', logicalName: '첫째', diagramEntry: [R(24), R(25), R(27)] }),
    object(23, 'Diagram', { UUID: 'd2', logicalName: '둘째', diagramEntry: [R(26)] }),
    object(24, 'TableDiagram', { UUID: 'place1', table: R(3), location: 'Point(-12.5, 20.0)' }),
    object(25, 'TableDiagram', { UUID: 'place2', table: R(4), location: 'Point(300.0, 20.0)' }),
    object(26, 'TableDiagram', { UUID: 'place3', table: R(3), location: 'Point(999.0, 123.0)', ref: true }),
    object(27, 'Note', { text: '보존할 메모', location: 'Point(1.0, 2.0)' }),
    object(28, 'Relation', { foreignKeyColumnGroup: R(10), identifying: true, childCardinalityType: 'EXACTLY_ONE' }),
  ];
  // Projection deliberately depends only on the native binary graph.
  return { graph: { version: 0, objects, roots: [0], packages: [], consumedBytes: 0 } } as NativeExerdDocument;
}

describe('native document display projection', () => {
  it('keeps source graph immutable and maintains independent placement identities', () => {
    const doc = fixture(), original = structuredClone(doc.graph);
    const all = projectNativeDocument(doc), first = projectNativeDocument(doc, 'd1'), second = projectNativeDocument(doc, 'd2');
    expect(all.tables).toHaveLength(2);
    expect(all.placements).toHaveLength(3);
    expect(first.tables[0]).toMatchObject({ uuid: 'parent', schemaUuid: 's', schemaName: 'sales', x: -12.5, y: 20, placementUuid: 'place1' });
    expect(second.tables[0]).toMatchObject({ uuid: 'parent', x: 999, y: 123, placementUuid: 'place3' });
    expect(second.allTables).toHaveLength(2);
    expect(second.relationships).toHaveLength(0);
    expect(second.allRelationships).toHaveLength(1);
    expect(all.productId).toBe('unknown.product');
    expect(doc.graph).toEqual(original);
    expect(projectNativeDocument(doc)).toBe(all);
    expect(projectNativeDocument(doc, 'd1')).toBe(first);
  });
  it('projects PK membership, domain inheritance and sorted composite FK mappings', () => {
    const view = projectNativeDocument(fixture());
    expect(view.tables[0].columns.every(column => column.primaryKey && !column.nullable)).toBe(true);
    expect(view.tables[1].columns[0]).toMatchObject({ domainUuid: 'domain-child', type: 'VARCHAR(20)', nullable: false });
    expect(view.tables[1].columns[1].nullable).toBe(true);
    expect(view.relationships[0]).toMatchObject({ uuid: 'fk', parentTableUuid: 'parent', childTableUuid: 'child', parentColumnUuids: ['pkB', 'pkA'], childColumnUuids: ['fkB', 'fkA'], identifying: true });
    expect(view.warnings).toEqual([]);
  });
  it('provides stable local IDs for UUID-less objects and rejects unknown diagrams', () => {
    const doc = fixture(), view = projectNativeDocument(doc, 'd1');
    expect(view.notes[0]).toMatchObject({ uuid: 'binary:27', text: '보존할 메모', x: 1, y: 2 });
    expect(() => projectNativeDocument(doc, 'missing')).toThrow('다이어그램');
  });
  it('distinguishes explicitly empty strings from null/unset domain inheritance and keeps tri-state nullability', () => {
    const explicit = fixture();
    set(explicit.graph.objects[19], 'suggestedDefaultValue', "'INHERITED'");
    set(explicit.graph.objects[7], 'dataType', ''); set(explicit.graph.objects[7], 'defaultValue', ''); set(explicit.graph.objects[7], 'notNull', 'FALSE');
    set(explicit.graph.objects[5], 'notNull', 'FALSE');
    const view = projectNativeDocument(explicit);
    expect(view.allTables[1].columns[0]).toMatchObject({ type: '', defaultValue: '', nullable: true });
    expect(view.allTables[0].columns[0].nullable).toBe(false);
    const inherit = fixture();
    set(inherit.graph.objects[19], 'suggestedDefaultValue', "'INHERITED'");
    set(inherit.graph.objects[7], 'dataType', null); set(inherit.graph.objects[7], 'defaultValue', null); set(inherit.graph.objects[7], 'notNull', '');
    expect(projectNativeDocument(inherit).allTables[1].columns[0]).toMatchObject({ type: 'VARCHAR(20)', defaultValue: "'INHERITED'", nullable: false });
    const emptyDomain = fixture();
    set(emptyDomain.graph.objects[19], 'suggestedDefaultValue', "'INHERITED'");
    set(emptyDomain.graph.objects[20], 'suggestedDataType', ''); set(emptyDomain.graph.objects[20], 'suggestedDefaultValue', ''); set(emptyDomain.graph.objects[20], 'suggestedNotNull', '');
    const emptyDomainView = projectNativeDocument(emptyDomain);
    expect(emptyDomainView.domains.find(domain => domain.uuid === 'domain-child')).toMatchObject({ suggestedDataType: '', suggestedDefaultValue: '', suggestedNotNull: 'TRUE' });
    expect(emptyDomainView.allTables[1].columns[0]).toMatchObject({ type: '', defaultValue: '', nullable: false });
  });
  it('exposes group/check identities and exact constraint names separately from group names', () => {
    const doc = fixture(), parent = doc.graph.objects[3], colA = doc.graph.objects[5], colB = doc.graph.objects[6];
    set(doc.graph.objects[9], 'physicalName', 'pk_index');
    const constraint = appendObject(doc, 'PrimaryKeyConstraint', { UUID: 'pk-constraint', physicalName: 'pk_custom' });
    set(doc.graph.objects[9], 'primaryKeyConstraint', R(constraint.id));
    const unique = appendObject(doc, 'AlternateKeyColumnGroup', { UUID: 'uk', physicalName: 'uk_code' });
    const index = appendObject(doc, 'InversionEntryColumnGroup', { UUID: 'ix', physicalName: 'ix_code' });
    set(parent, 'columnGroups', [R(9), R(unique.id), R(index.id)]);
    const uniqueMembership = appendObject(doc, 'AlternateKeyMembership', { UUID: 'uk-member', group: R(unique.id), entryIndex: 0, sortType: 'ASC' });
    const indexMembership = appendObject(doc, 'InversionEntryMembership', { UUID: 'ix-member', group: R(index.id), entryIndex: 0, sortType: 'DESC' });
    const uniqueEntry = appendObject(doc, 'MembershipEntry', { key: R(unique.id), value: R(uniqueMembership.id) });
    const indexEntry = appendObject(doc, 'MembershipEntry', { key: R(index.id), value: R(indexMembership.id) });
    set(colA, 'memberships', [R(11), R(uniqueEntry.id)]); set(colB, 'memberships', [R(13), R(indexEntry.id)]);
    const check = appendObject(doc, 'CheckConstraint', { UUID: 'check', physicalName: 'ck_parent', expression: 'a > 0' });
    set(parent, 'checkConstraints', [R(check.id)]);
    const view = projectNativeDocument(doc);
    expect(view.schemas).toEqual([{ uuid: 's', name: 'sales', logicalName: '' }]);
    expect(view.businessAreas).toEqual([{ uuid: 'area', name: '영역' }]);
    expect(view.tables[0].groups).toEqual([
      { uuid: 'pk', kind: 'primary', name: 'pk_index', columnUuids: ['pkA', 'pkB'], sortTypes: ['ASC', 'ASC'], constraintUuid: 'pk-constraint', constraintName: 'pk_custom' },
      { uuid: 'uk', kind: 'unique', name: 'uk_code', columnUuids: ['pkA'], sortTypes: ['ASC'] },
      { uuid: 'ix', kind: 'index', name: 'ix_code', columnUuids: ['pkB'], sortTypes: ['DESC'] },
    ]);
    expect(view.tables[1].groups[0]).toMatchObject({ uuid: 'fk', kind: 'foreign', columnUuids: ['fkB', 'fkA'] });
    expect(view.tables[0].checks).toEqual([{ uuid: 'check', name: 'ck_parent', expression: 'a > 0' }]);
  });
  it('projects optional note dimensions/target and distinct relationship/constraint identities', () => {
    const doc = fixture(); set(doc.graph.objects[27], 'manualSize', 'Dimension(240.0, 120.0)'); set(doc.graph.objects[27], 'target', R(24));
    const constraint = appendObject(doc, 'ForeignKeyConstraint', { UUID: 'fk-constraint', physicalName: 'fk_custom' });
    set(doc.graph.objects[10], 'foreignKeyConstraint', R(constraint.id)); set(doc.graph.objects[28], 'UUID', 'relation');
    const view = projectNativeDocument(doc);
    expect(view.notes[0]).toMatchObject({ width: 240, height: 120, targetPlacementUuid: 'place1' });
    expect(view.relationships[0]).toMatchObject({ uuid: 'fk', relationUuid: 'relation', constraintUuid: 'fk-constraint' });
    expect(projectNativeDocument(fixture()).notes[0]).not.toHaveProperty('width');
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('user reference native projection', () => {
  it('projects all semantic objects and every placement without using lossy XML import', () => {
    const doc = openNativeDocument(new Uint8Array(readFileSync(source)), schema as BinaryRegistry);
    const view = projectNativeDocument(doc);
    expect(view.tables).toHaveLength(609);
    expect(view.tables.flatMap(table => table.columns)).toHaveLength(10045);
    expect(view.relationships).toHaveLength(561);
    expect(view.domains).toHaveLength(118);
    expect(view.diagrams).toHaveLength(38);
    expect(view.placements).toHaveLength(615);
    expect(view.notes).toHaveLength(53);
    expect(view.schemas).toHaveLength(10); expect(view.businessAreas).toHaveLength(10);
    const groups = view.allTables.flatMap(table => table.groups);
    expect(groups).toHaveLength(1272);
    expect(groups.filter(group => group.kind === 'primary')).toHaveLength(609);
    expect(groups.filter(group => group.kind === 'foreign')).toHaveLength(561);
    expect(groups.filter(group => group.kind === 'unique')).toHaveLength(9);
    expect(groups.filter(group => group.kind === 'index')).toHaveLength(93);
    expect(groups.filter(group => group.constraintUuid)).toHaveLength(1178);
    expect(view.allTables.flatMap(table => table.checks)).toHaveLength(492);
    expect(view.warnings).toEqual([]);
    for (const relationship of view.relationships) {
      expect(relationship.parentColumnUuids.length).toBeGreaterThan(0);
      expect(relationship.childColumnUuids).toHaveLength(relationship.parentColumnUuids.length);
      expect(relationship.constraintUuid).toBeTruthy(); expect(relationship.relationUuid).toBeTruthy();
    }
    for (const diagram of view.diagrams) {
      const displayed = projectNativeDocument(doc, diagram.uuid);
      expect(displayed.tables).toHaveLength(view.placements.filter(placement => placement.diagramUuid === diagram.uuid).length);
      expect(displayed.allTables).toBe(view.allTables);
    }
  });
});
