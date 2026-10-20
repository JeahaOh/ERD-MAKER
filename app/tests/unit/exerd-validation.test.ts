import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { validateNativeDocument } from '../../src/formats/exerd/validation';
import { openNativeDocument, saveNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryRegistry, BinaryValue } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';

const reference = (object: BinaryObject) => ({ ref: object.id });
function fixture(): NativeExerdDocument {
  const objects: BinaryObject[] = [];
  const object = (name: string, uuid: string, values: Record<string, BinaryValue> = {}) => {
    const result: BinaryObject = { id: objects.length, class: { packageUri: 'http://exerd.tomato.com/model', name }, features: [] };
    objects.push(result); set(result, 'UUID', uuid); for (const [key, value] of Object.entries(values)) set(result, key, value); return result;
  };
  const root = object('Document', 'doc'), database = object('DatabaseModel', 'database'), schema = object('Schema', 'schema', { physicalName: 'public' });
  set(root, 'databaseModel', reference(database)); set(database, 'schema', [reference(schema)]);
  const parent = object('Table', 'parent', { physicalName: 'parent' }), child = object('Table', 'child', { physicalName: 'child' });
  set(schema, 'tables', [reference(parent), reference(child)]);
  const parentColumns = ['pa', 'pb'].map(name => object('Column', name, { physicalName: name, dataType: 'BIGINT' }));
  const childColumns = ['ca', 'cb'].map(name => object('Column', name, { physicalName: name, dataType: 'BIGINT' }));
  set(parent, 'columns', parentColumns.map(reference)); set(child, 'columns', childColumns.map(reference));
  const parentPk = object('PrimaryKeyColumnGroup', 'parent-pk'), childPk = object('PrimaryKeyColumnGroup', 'child-pk');
  const fk = object('ForeignKeyColumnGroup', 'fk', { parentColumnGroup: reference(parentPk) });
  set(parent, 'columnGroups', [reference(parentPk)]); set(child, 'columnGroups', [reference(childPk), reference(fk)]);
  function membership(column: BinaryObject, group: BinaryObject, name: string, index: number, parentColumn?: BinaryObject) {
    const value = object(parentColumn ? 'ColumnReference' : 'PrimaryKeyMembership', name, { group: reference(group), entryIndex: index, ...(parentColumn ? { parentColumn: reference(parentColumn) } : {}) });
    const entry = object('MembershipEntry', name + '-entry', { key: reference(group), value: reference(value) });
    const existing = get(column, 'memberships') as BinaryValue[] | undefined;
    set(column, 'memberships', [...existing ?? [], reference(entry)]);
  }
  parentColumns.forEach((column, i) => membership(column, parentPk, `p-member-${i}`, i));
  childColumns.forEach((column, i) => { membership(column, childPk, `c-member-${i}`, i); membership(column, fk, `fk-member-${i}`, i, parentColumns[i]); });
  const area = object('BusinessArea', 'area'), diagram = object('Diagram', 'diagram'), placement = object('TableDiagram', 'placement', { table: reference(parent) });
  set(root, 'businessAreas', [reference(area)]); set(area, 'diagrams', [reference(diagram)]); set(diagram, 'diagramEntry', [reference(placement)]);
  return { graph: { version: 0, roots: [0], objects, packages: [], consumedBytes: 0 } } as NativeExerdDocument;
}
function set(object: BinaryObject, name: string, value: BinaryValue) {
  const previous = object.features.find(f => f.name === name);
  if (previous) previous.value = value; else object.features.push({ id: object.features.length, name, kind: 'DATA', value });
}
const get = (object: BinaryObject, name: string) => object.features.find(f => f.name === name)?.value;
const find = (doc: NativeExerdDocument, uuid: string) => doc.graph.objects.find(object => get(object, 'UUID') === uuid)!;
const codes = (doc: NativeExerdDocument) => validateNativeDocument(doc).map(issue => issue.code);

describe('native model structural diagnostics', () => {
  it('accepts coherent composite keys reconstructed from persisted memberships without mutating the document', () => {
    const doc = fixture(), before = structuredClone(doc);
    expect(validateNativeDocument(doc)).toEqual([]); expect(doc).toEqual(before);
  });
  it('checks table names only within their schema and column names only within their table', () => {
    const doc = fixture(); set(find(doc, 'child'), 'physicalName', 'parent'); set(find(doc, 'pb'), 'physicalName', 'pa');
    expect(codes(doc)).toEqual(expect.arrayContaining(['DUPLICATE_TABLE_NAME', 'DUPLICATE_COLUMN_NAME']));
  });
  it('reports missing names and absent primary keys as advisory warnings', () => {
    const doc = fixture(); set(find(doc, 'parent'), 'physicalName', '');
    const primary = find(doc, 'child-pk'); primary.class.name = 'InversionEntryColumnGroup';
    const issues = validateNativeDocument(doc);
    expect(issues.find(issue => issue.code === 'EMPTY_NAME')?.severity).toBe('warning');
    expect(issues.find(issue => issue.code === 'MISSING_PRIMARY_KEY')?.severity).toBe('warning');
  });
  it('detects repeated key members and cross-table memberships while accepting tied stored indices', () => {
    const doc = fixture(); set(find(doc, 'p-member-1'), 'entryIndex', 0); expect(codes(doc)).toEqual([]);
    set(find(doc, 'pa'), 'memberships', [reference(find(doc, 'p-member-0-entry')), reference(find(doc, 'p-member-0-entry'))]);
    expect(codes(doc)).toContain('DUPLICATE_KEY_COLUMN');
    set(find(doc, 'p-member-0'), 'group', reference(find(doc, 'child-pk')));
    expect(codes(doc)).toEqual(expect.arrayContaining(['MEMBERSHIP_TABLE_MISMATCH', 'MEMBERSHIP_GROUP_MISMATCH']));
  });
  it('detects foreign-key length, parent membership and duplicate mapping errors', () => {
    const doc = fixture(); set(find(doc, 'fk-member-1'), 'parentColumn', reference(find(doc, 'pa')));
    expect(codes(doc)).toContain('FOREIGN_KEY_DUPLICATE_PARENT_COLUMN');
    set(find(doc, 'fk-member-1'), 'parentColumn', reference(find(doc, 'cb')));
    expect(codes(doc)).toContain('FOREIGN_KEY_PARENT_COLUMN_MISMATCH');
    const entries = get(find(doc, 'cb'), 'memberships') as BinaryValue[]; set(find(doc, 'cb'), 'memberships', entries.slice(0, 1));
    expect(codes(doc)).toContain('FOREIGN_KEY_LENGTH_MISMATCH');
  });
  it('distinguishes DB-dependent type verification gaps from structural errors', () => {
    const doc = fixture(); set(find(doc, 'ca'), 'dataType', 'VARCHAR(20)');
    const diagnostics = validateNativeDocument(doc);
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'FOREIGN_KEY_TYPE_UNVERIFIED', severity: 'warning', uuid: 'ca' })]);
  });
  it('detects orphan graph references and invalid diagram table references', () => {
    const doc = fixture(); set(find(doc, 'placement'), 'table', { ref: 99999 });
    expect(codes(doc)).toEqual(expect.arrayContaining(['ORPHAN_REFERENCE', 'INVALID_DIAGRAM_TABLE_REFERENCE']));
    set(find(doc, 'diagram'), 'filteredRelations', [reference(find(doc, 'parent'))]);
    expect(codes(doc)).toContain('INVALID_DIAGRAM_RELATION_REFERENCE');
  });
  it('excludes temporaryContents subtrees from persistent model diagnostics', () => {
    const doc = fixture();
    const temporary: BinaryObject = { id: 200, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Table' }, features: [] };
    set(temporary, 'UUID', 'temporary-table'); set(temporary, 'columns', [{ ref: 999999 }]);
    doc.graph.objects.push(temporary); set(find(doc, 'doc'), 'temporaryContents', [reference(temporary)]);
    expect(validateNativeDocument(doc)).toEqual([]);
  });
  it('detects cyclic domains and resolves inherited data types without hanging', () => {
    const doc = fixture();
    const a: BinaryObject = { id: 100, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Domain' }, features: [] };
    const b: BinaryObject = { id: 101, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Domain' }, features: [] };
    set(a, 'UUID', 'domain-a'); set(b, 'UUID', 'domain-b'); set(a, 'domain', [reference(b)]); set(b, 'domain', [reference(a)]);
    doc.graph.objects.push(a, b); set(find(doc, 'ca'), 'domain', reference(a)); set(find(doc, 'ca'), 'dataType', '');
    expect(codes(doc)).toEqual(expect.arrayContaining(['DOMAIN_CYCLE', 'COLUMN_TYPE_UNSPECIFIED']));
  });
  it('does not hide explicitly empty column/domain types behind inherited types', () => {
    const doc = fixture();
    const parent: BinaryObject = { id: 100, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Domain' }, features: [] };
    const child: BinaryObject = { id: 101, class: { packageUri: 'http://exerd.tomato.com/model', name: 'Domain' }, features: [] };
    set(parent, 'UUID', 'domain-parent'); set(parent, 'suggestedDataType', 'BIGINT'); set(parent, 'domain', [reference(child)]);
    set(child, 'UUID', 'domain-child'); set(child, 'suggestedDataType', '');
    doc.graph.objects.push(parent, child); set(find(doc, 'ca'), 'domain', reference(child));
    set(find(doc, 'ca'), 'dataType', '');
    expect(validateNativeDocument(doc).find(issue => issue.uuid === 'ca')?.code).toBe('COLUMN_TYPE_UNSPECIFIED');
    find(doc, 'ca').features = find(doc, 'ca').features.filter(feature => feature.name !== 'dataType');
    expect(validateNativeDocument(doc).find(issue => issue.uuid === 'ca')?.code).toBe('COLUMN_TYPE_UNSPECIFIED');
    child.features = child.features.filter(feature => feature.name !== 'suggestedDataType');
    expect(validateNativeDocument(doc)).toEqual([]);
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('original user model structural audit', () => {
  it('does not invent errors for derived fields or equal persisted entryIndex values', () => {
    const doc = openNativeDocument(new Uint8Array(readFileSync(source)), schema as BinaryRegistry);
    const before = saveNativeDocument(doc);
    expect(validateNativeDocument(doc)).toEqual([]);
    expect(saveNativeDocument(doc)).toEqual(before);
  });
});
