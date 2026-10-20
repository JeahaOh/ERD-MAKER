import dagre from '@dagrejs/dagre';
import generated from './schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from './binary';
import { editNativeAttributes, type NativeExerdDocument } from './native-document';
import { projectNativeDocument } from './view';
import type { AttributeEdit } from './xml';

export interface NativeLayoutOptions {
  direction?: 'TB' | 'LR';
  tableUuids?: readonly string[];
  placementUuids?: readonly string[];
  pinnedPlacementUuids?: readonly string[];
  includeReferencePlacements?: boolean;
  origin?: { x: number; y: number };
  nodeSeparation?: number;
  rankSeparation?: number;
  componentSeparation?: number;
  obstacleGap?: number;
  wrapWidth?: number;
  /** Actual measured bounds may override the conservative full-column renderer metrics. */
  dimensionsByPlacement?: Readonly<Record<string, { width: number; height: number }>>;
  dimensionsByNote?: Readonly<Record<string, { width: number; height: number }>>;
}
export interface NativeLayoutBounds {
  uuid: string; kind: 'table' | 'reference' | 'note';
  x: number; y: number; width: number; height: number;
}
interface Node extends NativeLayoutBounds { tableUuid: string; movable: boolean; index: number }
interface Edge { source: string; target: string; weight: number }
interface Component { nodes: Array<{ node: Node; x: number; y: number }>; width: number; height: number; index: number; preferred?: { x: number; y: number } }
const field = (document: NativeExerdDocument, uuid: string, name: string) => document.byUuid.get(uuid)?.features.find(f => f.name === name)?.value;
const finitePositive = (value: number, label: string, allowZero = false) => { if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value > 2147483647) throw new Error(`${label}은 유효한 ${allowZero ? '0 이상' : '양수'} 크기여야 합니다.`); return value; };
function point(value: number): number { if (!Number.isFinite(value) || value < -2147483648 || value > 2147483647) throw new Error('배치 좌표가 32비트 정수 범위를 벗어났습니다.'); return Math.round(value); }
function overlaps(a: NativeLayoutBounds, b: NativeLayoutBounds, gap: number) { return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y; }
function noteSize(document: NativeExerdDocument, uuid: string, text: string) {
  const size = field(document, uuid, 'manualSize');
  const match = typeof size === 'string' ? /^Dimension\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)$/.exec(size) : null;
  if (match && [Number(match[1]), Number(match[2])].every(n => Number.isFinite(n) && n > 0 && n <= 2147483647)) return { width: Number(match[1]), height: Number(match[2]) };
  const width = 280;
  const plain = text.replace(/<\s*br\s*\/?\s*>|<\/(?:p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '');
  const lines = plain.split(/\r\n|\r|\n/).reduce((total, line) => total + Math.max(1, Math.ceil([...line].reduce((n, c) => n + (c.codePointAt(0)! > 255 ? 14 : 7), 0) / (width - 32))), 0);
  return { width, height: Math.max(100, 40 + lines * 20) };
}
function scene(document: NativeExerdDocument, diagramUuid: string, options: NativeLayoutOptions) {
  const view = projectNativeDocument(document, diagramUuid);
  const tables = new Map(view.allTables.map(t => [t.uuid, t]));
  const placements = view.placements.filter(p => p.diagramUuid === diagramUuid);
  const placementIds = new Set(placements.map(p => p.uuid)), tableIds = new Set(placements.map(p => p.tableUuid));
  for (const id of options.tableUuids ?? []) if (!tableIds.has(id)) throw new Error(`선택 테이블이 이 다이어그램에 없습니다: ${id}`);
  for (const id of [...options.placementUuids ?? [], ...options.pinnedPlacementUuids ?? []]) if (!placementIds.has(id)) throw new Error(`선택·고정 배치가 이 다이어그램에 없습니다: ${id}`);
  const selectedTables = options.tableUuids && new Set(options.tableUuids), selectedPlacements = options.placementUuids && new Set(options.placementUuids), pinned = new Set(options.pinnedPlacementUuids ?? []);
  const nodes: Node[] = placements.map((p, index) => {
    const table = tables.get(p.tableUuid); if (!table) throw new Error(`배치의 테이블을 찾지 못했습니다: ${p.uuid}`);
    if (!document.byUuid.has(p.uuid)) throw new Error('UUID가 없는 테이블 배치는 변경할 수 없습니다.');
    const override = options.dimensionsByPlacement && Object.hasOwn(options.dimensionsByPlacement, p.uuid) ? options.dimensionsByPlacement[p.uuid] : undefined;
    const width = finitePositive(override?.width ?? 310, '테이블 폭');
    // Current renderer: heading + labels + footer, then every column's two-line row.
    const height = finitePositive(override?.height ?? 112 + Math.max(1, table.columns.length) * 40, '테이블 높이');
    return { uuid: p.uuid, tableUuid: p.tableUuid, kind: p.reference ? 'reference' : 'table', x: p.x, y: p.y, width, height, index,
      movable: (!selectedTables || selectedTables.has(p.tableUuid)) && (!selectedPlacements || selectedPlacements.has(p.uuid)) && !pinned.has(p.uuid) && (options.includeReferencePlacements !== false || !p.reference) };
  });
  const notes: NativeLayoutBounds[] = view.notes.map(note => {
    const override = options.dimensionsByNote && Object.hasOwn(options.dimensionsByNote, note.uuid) ? options.dimensionsByNote[note.uuid] : undefined;
    const size = override ? { width: finitePositive(override.width, '메모 폭'), height: finitePositive(override.height, '메모 높이') } : noteSize(document, note.uuid, note.text);
    return { uuid: note.uuid, kind: 'note', x: note.x, y: note.y, ...size };
  });
  return { view, nodes, notes };
}

/** Bounds for occupancy checks; a table's full columns contribute to its height. */
export function nativeDiagramBounds(document: NativeExerdDocument, diagramUuid: string, options: NativeLayoutOptions = {}): NativeLayoutBounds[] {
  const { nodes, notes } = scene(document, diagramUuid, options);
  return [...nodes.map(({ uuid, kind, x, y, width, height }) => ({ uuid, kind, x, y, width, height })), ...notes];
}

/** Pure plan: only this diagram's eligible TableDiagram.location attributes are returned. */
export function planNativeLayout(document: NativeExerdDocument, diagramUuid: string, options: NativeLayoutOptions = {}): AttributeEdit[] {
  const direction = options.direction ?? 'TB'; if (direction !== 'TB' && direction !== 'LR') throw new Error('배치 방향은 TB 또는 LR이어야 합니다.');
  const nodeGap = finitePositive(options.nodeSeparation ?? 80, '노드 간격', true), rankGap = finitePositive(options.rankSeparation ?? 120, '계층 간격', true);
  const componentGap = finitePositive(options.componentSeparation ?? 120, '구성요소 간격', true), obstacleGap = finitePositive(options.obstacleGap ?? 40, '장애물 간격', true);
  const origin = { x: point(options.origin?.x ?? 80), y: point(options.origin?.y ?? 80) };
  const { view, nodes, notes } = scene(document, diagramUuid, options), moving = nodes.filter(n => n.movable);
  if (!moving.length) return [];
  const movingIds = new Set(moving.map(n => n.uuid));
  const edges: Edge[] = [], anchors: Array<{ source: Node; target: Node }> = [];
  const allByTable = new Map<string, Node[]>();
  for (const node of nodes) { const list = allByTable.get(node.tableUuid) ?? []; list.push(node); allByTable.set(node.tableUuid, list); }
  for (const relation of view.relationships) {
    const parents = allByTable.get(relation.parentTableUuid) ?? [], children = allByTable.get(relation.childTableUuid) ?? [];
    for (const parent of parents) for (const child of children) {
      if (edges.length + anchors.length >= 100000) throw new Error('참조 배치 조합이 너무 많습니다. 선택 범위를 나누어 배치하세요.');
      if (parent.movable && child.movable) edges.push({ source: parent.uuid, target: child.uuid, weight: relation.identifying ? 2 : 1 });
      else if (parent.movable !== child.movable && relation.parentTableUuid !== relation.childTableUuid) anchors.push({ source: parent, target: child });
    }
  }
  // Weak components are packed separately; cycles and self loops remain inside Dagre.
  const adjacency = new Map(moving.map(n => [n.uuid, new Set<string>()]));
  for (const edge of edges) { adjacency.get(edge.source)!.add(edge.target); adjacency.get(edge.target)!.add(edge.source); }
  const visited = new Set<string>(), components: Component[] = [], nodeMap = new Map(moving.map(n => [n.uuid, n]));
  for (const start of moving) {
    if (visited.has(start.uuid)) continue;
    const ids: string[] = [], queue = [start.uuid]; visited.add(start.uuid);
    for (let i = 0; i < queue.length; i++) { const id = queue[i]; ids.push(id); for (const next of adjacency.get(id)!) if (!visited.has(next)) { visited.add(next); queue.push(next); } }
    const memberIds = new Set(ids), members = ids.map(id => nodeMap.get(id)!).sort((a, b) => a.index - b.index);
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setGraph({ rankdir: direction, nodesep: nodeGap, ranksep: rankGap, marginx: 0, marginy: 0, acyclicer: 'greedy', ranker: 'network-simplex' });
    graph.setDefaultEdgeLabel(() => ({}));
    // Internal IDs avoid using untrusted model UUIDs as graphlib object keys.
    const internal = new Map(members.map((node, index) => [node.uuid, `n${index}`]));
    const self = new Set(edges.filter(e => memberIds.has(e.source) && e.source === e.target).map(e => e.source));
    // Reserve one pixel on each side before integer Point quantization. Measured DOM bounds may be fractional.
    for (const node of members) graph.setNode(internal.get(node.uuid)!, { width: Math.ceil(node.width) + 2 + (self.has(node.uuid) ? 120 : 0), height: Math.ceil(node.height) + 2 });
    let sequence = 0; for (const edge of edges) if (memberIds.has(edge.source) && memberIds.has(edge.target)) graph.setEdge(internal.get(edge.source)!, internal.get(edge.target)!, { weight: edge.weight, minlen: 1 }, `e${sequence++}`);
    dagre.layout(graph);
    const positions = members.map(node => { const result = graph.node(internal.get(node.uuid)!); return { node, x: result.x - node.width / 2, y: result.y - node.height / 2 }; });
    const minX = Math.min(...positions.map(p => p.x - (self.has(p.node.uuid) ? 60 : 0))), minY = Math.min(...positions.map(p => p.y));
    const width = Math.max(...positions.map(p => p.x + p.node.width + (self.has(p.node.uuid) ? 60 : 0))) - minX;
    const height = Math.max(...positions.map(p => p.y + p.node.height)) - minY;
    const local = positions.map(p => ({ ...p, x: p.x - minX, y: p.y - minY }));
    const preferredX: number[] = [], preferredY: number[] = [], lowerX: number[] = [], upperX: number[] = [], lowerY: number[] = [], upperY: number[] = [];
    for (const edge of anchors) {
      const source = local.find(p => p.node.uuid === edge.source.uuid), target = local.find(p => p.node.uuid === edge.target.uuid);
      if (target && !edge.source.movable) {
        preferredX.push(direction === 'TB' ? edge.source.x + edge.source.width / 2 - target.x - target.node.width / 2 : edge.source.x + edge.source.width + rankGap - target.x);
        preferredY.push(direction === 'TB' ? edge.source.y + edge.source.height + rankGap - target.y : edge.source.y + edge.source.height / 2 - target.y - target.node.height / 2);
        (direction === 'TB' ? lowerY : lowerX).push(direction === 'TB' ? preferredY.at(-1)! : preferredX.at(-1)!);
      } else if (source && !edge.target.movable) {
        preferredX.push(direction === 'TB' ? edge.target.x + edge.target.width / 2 - source.x - source.node.width / 2 : edge.target.x - rankGap - source.x - source.node.width);
        preferredY.push(direction === 'TB' ? edge.target.y - rankGap - source.y - source.node.height : edge.target.y + edge.target.height / 2 - source.y - source.node.height / 2);
        (direction === 'TB' ? upperY : upperX).push(direction === 'TB' ? preferredY.at(-1)! : preferredX.at(-1)!);
      }
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const constrained = (values: number[], lower: number[], upper: number[]) => { const min = Math.max(-Infinity, ...lower), max = Math.min(Infinity, ...upper), result = median(values); return min <= max ? Math.max(min, Math.min(max, result)) : result; };
    components.push({ nodes: local, width: Math.ceil(width), height: Math.ceil(height), index: Math.min(...members.map(n => n.index)), ...(preferredX.length ? { preferred: { x: constrained(preferredX, lowerX, upperX), y: constrained(preferredY, lowerY, upperY) } } : {}) });
  }
  components.sort((a, b) => Number(!!b.preferred) - Number(!!a.preferred) || b.nodes.length - a.nodes.length || b.width * b.height - a.width * a.height || a.index - b.index);
  const totalArea = components.reduce((area, c) => area + (c.width + componentGap) * (c.height + componentGap), 0);
  const wrapWidth = finitePositive(options.wrapWidth ?? Math.max(1600, Math.sqrt(totalArea) * 1.5, ...components.map(c => c.width)), '줄바꿈 폭');
  const occupied: NativeLayoutBounds[] = [...nodes.filter(n => !movingIds.has(n.uuid)), ...notes];
  let x = origin.x, y = origin.y, rowHeight = 0;
  const positions = new Map<string, { x: number; y: number }>();
  for (const component of components) {
    const limit = Math.max(origin.x + Math.max(wrapWidth, component.width), (component.preferred?.x ?? origin.x) + component.width);
    if (!component.preferred && x > origin.x && x + component.width > limit) { x = origin.x; y += rowHeight + componentGap; rowHeight = 0; }
    let candidate: NativeLayoutBounds = { uuid: '', kind: 'table', x: point(component.preferred?.x ?? x), y: point(component.preferred?.y ?? y), width: component.width, height: component.height };
    let attempts = 0;
    while (true) {
      const collisions = occupied.filter(box => overlaps(candidate, box, obstacleGap)); if (!collisions.length) break;
      candidate.x = Math.max(...collisions.map(box => box.x + box.width + obstacleGap));
      if (candidate.x + component.width > limit) { candidate.x = origin.x; candidate.y = Math.max(candidate.y + 1, ...collisions.map(box => box.y + box.height + obstacleGap)); }
      if (++attempts > (occupied.length + 1) * 4) { candidate.x = origin.x; candidate.y = Math.max(y, ...occupied.map(box => box.y + box.height + obstacleGap)); }
      point(candidate.x); point(candidate.y);
    }
    candidate.x = point(candidate.x); candidate.y = point(candidate.y);
    for (const p of component.nodes) positions.set(p.node.uuid, { x: point(candidate.x + p.x), y: point(candidate.y + p.y) });
    occupied.push(candidate); x = candidate.x + component.width + componentGap; y = candidate.y; rowHeight = Math.max(rowHeight, component.height);
  }
  return moving.flatMap(node => { const p = positions.get(node.uuid)!; return p.x === node.x && p.y === node.y ? [] : [{ uuid: node.uuid, name: 'location', value: `Point(${p.x}, ${p.y})` }]; });
}

/** Apply one attribute transaction; notes, references and other diagrams retain all metadata. */
export function layoutNativeDiagram(document: NativeExerdDocument, diagramUuid: string, options: NativeLayoutOptions = {}): NativeExerdDocument {
  const edits = planNativeLayout(document, diagramUuid, options); return edits.length ? editNativeAttributes(document, generated as BinaryRegistry, edits) : document;
}
