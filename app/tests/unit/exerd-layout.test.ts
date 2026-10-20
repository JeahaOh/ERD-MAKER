import { describe, expect, it } from 'vitest';
import { createNativeDocument, appendNativeTable, rebuildNativeDocument, nativeGraph } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { planNativeLayout, layoutNativeDiagram, nativeDiagramBounds, type NativeLayoutBounds } from '../../src/formats/exerd/layout';
import { saveNativeDocument, type NativeExerdDocument } from '../../src/formats/exerd/native-document';
import type { BinaryObject, BinaryReference } from '../../src/formats/exerd/binary';
const f = (o: BinaryObject, name: string) => o.features.find(f => f.name === name)?.value;
const u = (o: BinaryObject) => f(o, 'UUID') as string;
const all = (d: NativeExerdDocument, type: string) => d.graph.objects.filter(o => o.class.name === type);
const overlaps = (a: NativeLayoutBounds, b: NativeLayoutBounds) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function assertNoOverlap(bounds: NativeLayoutBounds[]) { for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) expect(overlaps(bounds[i], bounds[j]), `${bounds[i].uuid} overlaps ${bounds[j].uuid}`).toBe(false); }
function fixtures() {
  let d = createNativeDocument('배치 검증');
  for (const name of ['b', 'c', 'island']) d = appendNativeTable(d, { name, x: 80, y: 80 });
  const tables = all(d, 'Table'), ids = tables.map(u), cols = tables.map(t => u(d.graph.objects.find(o => o.id === (f(t, 'columns') as BinaryReference[])[0].ref)!));
  for (const [a, b] of [[0, 1], [1, 2], [2, 0], [0, 0]]) d = mutateNativeDocument(d, { type: 'addRelationship', name: `fk_${a}_${b}`, parentTableUuid: ids[a], childTableUuid: ids[b], parentColumnUuids: [cols[a]], childColumnUuids: [cols[b]] });
  return d;
}
describe('native diagram layout', () => {
  it('lays out cycles, a self-reference and an independent component without overlapping full table bounds', () => {
    const d = fixtures(), diagram = u(all(d, 'Diagram')[0]), before = saveNativeDocument(d);
    const planned = planNativeLayout(d, diagram);
    expect(planned).toHaveLength(4); expect(planned.every(e => e.name === 'location' && /^Point\(\d+, \d+\)$/.test(e.value!))).toBe(true);
    const laid = layoutNativeDiagram(d, diagram); assertNoOverlap(nativeDiagramBounds(laid, diagram));
    expect(saveNativeDocument(d)).toEqual(before);
    expect(planNativeLayout(laid, diagram)).toEqual([]);
    expect(all(laid, 'ForeignKeyColumnGroup').map(u)).toEqual(all(d, 'ForeignKeyColumnGroup').map(u));
  });
  it('honors TB and LR relationship direction using the entire column height', () => {
    let d = appendNativeTable(createNativeDocument(), { name: 'child' }); const [parent, child] = all(d, 'Table'), diagram = u(all(d, 'Diagram')[0]);
    for (let i = 0; i < 30; i++) d = mutateNativeDocument(d, { type: 'addColumn', tableUuid: u(parent), name: `col_${i}` });
    const p = d.graph.objects.find(o => o.id === (f(d.byUuid.get(u(parent))!, 'columns') as BinaryReference[])[0].ref)!;
    const c = d.graph.objects.find(o => o.id === (f(d.byUuid.get(u(child))!, 'columns') as BinaryReference[])[0].ref)!;
    d = mutateNativeDocument(d, { type: 'addRelationship', name: 'fk_child', parentTableUuid: u(parent), childTableUuid: u(child), parentColumnUuids: [u(p)], childColumnUuids: [u(c)] });
    for (const direction of ['TB', 'LR'] as const) {
      const laid = layoutNativeDiagram(d, diagram, { direction }); const bounds = nativeDiagramBounds(laid, diagram); assertNoOverlap(bounds);
      const placement = all(laid, 'TableDiagram').find(o => (f(o, 'table') as BinaryReference).ref === laid.byUuid.get(u(parent))!.id)!;
      const first = bounds.find(b => b.uuid === u(placement))!, next = bounds.find(b => b.uuid !== first.uuid)!;
      expect(first.height).toBe(112 + 31 * 40);
      if (direction === 'TB') expect(next.y).toBeGreaterThanOrEqual(first.y + first.height + 100); else expect(next.x).toBeGreaterThanOrEqual(first.x + first.width + 100);
    }
  });
  it('leaves pinned/unselected placements, notes and all other diagrams unchanged', () => {
    let d = fixtures(); const diagram = u(all(d, 'Diagram')[0]), placements = all(d, 'TableDiagram').map(u);
    d = mutateNativeDocument(d, { type: 'addNote', diagramUuid: diagram, text: '고정 메모', x: 80, y: 80, width: 500, height: 350 });
    d = mutateNativeDocument(d, { type: 'duplicateDiagram', diagramUuid: diagram, name: '다른 화면' });
    // Give the fixed placement its own region; original tables deliberately overlap in this fixture.
    const graph = structuredClone(d.graph), pinned = graph.objects.find(o => nativeGraph.uuid(o) === placements[0])!;
    nativeGraph.set(pinned, 'location', 'Point(1000, 80)'); d = rebuildNativeDocument(graph, d.container);
    const other = u(all(d, 'Diagram').find(o => u(o) !== diagram)!);
    const otherBefore = nativeDiagramBounds(d, other), notesBefore = all(d, 'Note').map(o => structuredClone(o));
    const laid = layoutNativeDiagram(d, diagram, { pinnedPlacementUuids: [placements[0]], placementUuids: placements.slice(0, 3) });
    expect(f(laid.byUuid.get(placements[0])!, 'location')).toBe('Point(1000, 80)');
    expect(f(laid.byUuid.get(placements[3])!, 'location')).toBe(f(d.byUuid.get(placements[3])!, 'location'));
    expect(nativeDiagramBounds(laid, other)).toEqual(otherBefore);
    for (const old of notesBefore) expect(laid.byUuid.get(u(old))!.features).toEqual(old.features);
    const moved = new Set(placements.slice(1, 3)), bounds = nativeDiagramBounds(laid, diagram);
    for (const a of bounds.filter(b => moved.has(b.uuid))) for (const b of bounds.filter(b => b.uuid !== a.uuid)) expect(overlaps(a, b)).toBe(false);
  });
  it('positions a selected child after a fixed parent along the requested axis', () => {
    let d = createNativeDocument();
    const graph = structuredClone(d.graph), placement = graph.objects.find(o => o.class.name === 'TableDiagram')!;
    nativeGraph.set(placement, 'location', 'Point(1000, 1000)'); d = rebuildNativeDocument(graph, d.container);
    d = appendNativeTable(d, { name: 'child', x: 80, y: 80 });
    const [parent, child] = all(d, 'Table'), diagram = u(all(d, 'Diagram')[0]);
    const firstColumn = (o: BinaryObject) => u(d.graph.objects.find(c => c.id === (f(o, 'columns') as BinaryReference[])[0].ref)!);
    d = mutateNativeDocument(d, { type: 'addRelationship', name: 'fk_anchor', parentTableUuid: u(parent), childTableUuid: u(child), parentColumnUuids: [firstColumn(parent)], childColumnUuids: [firstColumn(child)] });
    for (const direction of ['TB', 'LR'] as const) {
      const options = { direction, tableUuids: [u(child)] };
      const laid = layoutNativeDiagram(d, diagram, options), bounds = nativeDiagramBounds(laid, diagram);
      const fixed = bounds.find(b => b.uuid === u(placement))!, moved = bounds.find(b => b.uuid !== fixed.uuid)!;
      expect(fixed.x).toBe(1000); expect(fixed.y).toBe(1000);
      if (direction === 'TB') expect(moved.y).toBeGreaterThanOrEqual(fixed.y + fixed.height + 120); else expect(moved.x).toBeGreaterThanOrEqual(fixed.x + fixed.width + 120);
      expect(planNativeLayout(laid, diagram, options)).toEqual([]);
    }
  });
  it('treats duplicate reference placements as separate nodes and can pin all references', () => {
    let d = createNativeDocument(), graph = structuredClone(d.graph), diagram = graph.objects.find(o => o.class.name === 'Diagram')!, table = graph.objects.find(o => o.class.name === 'Table')!;
    const ref = nativeGraph.object(graph, 'TableDiagram', { table: nativeGraph.reference(table), ref: true, location: 'Point(80, 80)' }); nativeGraph.push(diagram, 'diagramEntry', ref); d = rebuildNativeDocument(graph, d.container);
    const dia = u(all(d, 'Diagram')[0]), placements = all(d, 'TableDiagram');
    const planned = planNativeLayout(d, dia); expect(new Set(planned.map(p => p.uuid)).size).toBe(2);
    const laid = layoutNativeDiagram(d, dia); assertNoOverlap(nativeDiagramBounds(laid, dia));
    expect(f(laid.byUuid.get(u(ref))!, 'ref')).toBe(true);
    const fixed = layoutNativeDiagram(d, dia, { includeReferencePlacements: false }); expect(f(fixed.byUuid.get(u(ref))!, 'location')).toBe('Point(80, 80)');
    const selected = planNativeLayout(d, dia, { placementUuids: [u(placements[0])], dimensionsByPlacement: { [u(placements[0])]: { width: 500, height: 1000 } } }); expect(selected.every(e => e.uuid === u(placements[0]))).toBe(true);
  });
  it('packs 609 independently generated tables with variable full-column heights without overlap', () => {
    const initial = createNativeDocument('609 synthetic tables'), graph = structuredClone(initial.graph), schema = graph.objects.find(o => o.class.name === 'Schema')!, area = graph.objects.find(o => o.class.name === 'BusinessArea')!, diagram = graph.objects.find(o => o.class.name === 'Diagram')!;
    for (let i = 1; i < 609; i++) {
      const table = nativeGraph.object(graph, 'Table', { physicalName: `table_${i}`, logicalName: `테이블 ${i}` });
      const columns = Array.from({ length: i % 24 + 1 }, (_, c) => nativeGraph.object(graph, 'Column', { physicalName: `column_${c}`, dataType: 'BIGINT', notNull: 'FALSE' }));
      nativeGraph.set(table, 'columns', columns.map(nativeGraph.reference)); nativeGraph.push(schema, 'tables', table); nativeGraph.push(area, 'tables', table);
      nativeGraph.push(diagram, 'diagramEntry', nativeGraph.object(graph, 'TableDiagram', { table: nativeGraph.reference(table), location: 'Point(0, 0)' }));
    }
    const d = rebuildNativeDocument(graph, initial.container), id = u(all(d, 'Diagram')[0]), edits = planNativeLayout(d, id);
    expect(edits).toHaveLength(609);
    const positions = new Map(edits.map(e => { const match = /^Point\((-?\d+), (-?\d+)\)$/.exec(e.value!)!; return [e.uuid, { x: Number(match[1]), y: Number(match[2]) }]; }));
    const bounds = nativeDiagramBounds(d, id).map(b => ({ ...b, ...positions.get(b.uuid) })); let collisions = 0;
    for (let i = 0; i < bounds.length; i++) for (let j = i + 1; j < bounds.length; j++) if (overlaps(bounds[i], bounds[j])) collisions++;
    expect(collisions).toBe(0); expect(new Set(edits.map(e => e.uuid)).size).toBe(609);
  });
  it('uses internal graph keys for arbitrary source UUIDs and ignores inherited dimension properties', () => {
    const initial = createNativeDocument(), graph = structuredClone(initial.graph);
    nativeGraph.set(graph.objects.find(o => o.class.name === 'TableDiagram')!, 'UUID', '__proto__'); nativeGraph.set(graph.objects.find(o => o.class.name === 'Table')!, 'UUID', 'constructor');
    const d = rebuildNativeDocument(graph, initial.container), id = u(all(d, 'Diagram')[0]);
    const laid = layoutNativeDiagram(d, id, { dimensionsByPlacement: {} });
    expect(f(laid.byUuid.get('__proto__')!, 'location')).toBe('Point(80, 80)');
    expect(laid.byUuid.has('constructor')).toBe(true);
  });
  it('keeps fractional DOM measurements separated after integer rounding even with zero requested spacing', () => {
    let d = createNativeDocument(); for (const name of ['a', 'b', 'c']) d = appendNativeTable(d, { name });
    const tables = all(d, 'Table'), tableIds = tables.map(u), columnIds = tables.map(t => u(d.graph.objects.find(c => c.id === (f(t, 'columns') as BinaryReference[])[0].ref)!));
    for (const [p, c] of [[0, 1], [0, 2], [1, 3], [2, 3]]) d = mutateNativeDocument(d, { type: 'addRelationship', name: `fk_${p}_${c}`, parentTableUuid: tableIds[p], childTableUuid: tableIds[c], parentColumnUuids: [columnIds[p]], childColumnUuids: [columnIds[c]] });
    const ids = all(d, 'TableDiagram').map(u), sizes = [[310.3, 151.7], [311, 151.1], [310.4, 150.2], [311.8, 151.3]];
    const options = { nodeSeparation: 0, rankSeparation: 0, componentSeparation: 0, obstacleGap: 0, dimensionsByPlacement: Object.fromEntries(ids.map((id, i) => [id, { width: sizes[i][0], height: sizes[i][1] }])) };
    const laid = layoutNativeDiagram(d, u(all(d, 'Diagram')[0]), options);
    assertNoOverlap(nativeDiagramBounds(laid, u(all(d, 'Diagram')[0]), options));
  });
  it('does not change unrelated metadata, validates options and supports an empty explicit selection', () => {
    const d = fixtures(), diagram = u(all(d, 'Diagram')[0]), laid = layoutNativeDiagram(d, diagram), changed = new Set(planNativeLayout(d, diagram).map(e => e.uuid));
    for (const [id, old] of d.byUuid) {
      const actual = laid.byUuid.get(id)!;
      const filtered = (o: BinaryObject) => o.features.filter(f => !(changed.has(id) && f.name === 'location'));
      expect(filtered(actual)).toEqual(filtered(old));
    }
    expect(planNativeLayout(d, diagram, { tableUuids: [] })).toEqual([]);
    expect(() => planNativeLayout(d, 'missing')).toThrow('다이어그램');
    expect(() => planNativeLayout(d, diagram, { pinnedPlacementUuids: ['missing'] })).toThrow('고정');
    expect(() => planNativeLayout(d, diagram, { direction: 'INVALID' as any })).toThrow('방향');
    expect(() => planNativeLayout(d, diagram, { nodeSeparation: -1 })).toThrow('간격');
  });
});
