import type { NativeExerdDocument } from '../exerd/native-document';
import { projectNativeDocument, type NativeDocumentView, type NativeTableView } from '../exerd/view';

export type DiagramSource = NativeExerdDocument | NativeDocumentView;
export interface DiagramSvgResult { svg: string; width: number; height: number; warnings: string[] }
const palette = { slate: '#3A4A5A', ink: '#262626', paper: '#F9F9F9', ice: '#8B9FA8', teal: '#00A19B', emphasis: '#007A76' };
const number = (value: number) => Math.round(value * 100) / 100;
const measure = (value: string) => Array.from(value).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/u.test(char) ? 13 : 7.5), 0);
interface Box { table: NativeTableView; placementUuid: string; x: number; y: number; w: number; h: number; physicalWidth: number; logicalWidth: number; typeWidth: number }
const HEADER = 66, COLUMN_HEADER = 26, ROW = 25;

/** Vector export of one diagram. Full columns are shown; original compact display/routing is not reproduced. */
export function diagramSvg(source: DiagramSource, diagramUuid: string): DiagramSvgResult {
  const view = 'graph' in source ? projectNativeDocument(source) : source;
  const diagram = view.diagrams.find(item => item.uuid === diagramUuid);
  if (!diagram) throw new Error('내보낼 다이어그램을 찾지 못했습니다.');
  const warnings = [...view.warnings], warn = (value: string) => { if (!warnings.includes(value)) warnings.push(value); };
  const clean = (value: string) => Array.from(value).map(char => {
    const code = char.codePointAt(0)!;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)) {
      warn('SVG XML에서 표현할 수 없는 제어 문자를 U+코드 표시로 바꿨습니다. 원본 모델은 변경하지 않았습니다.');
      return `⟦U+${code.toString(16).toUpperCase().padStart(4, '0')}⟧`;
    }
    return char;
  }).join('');
  const escape = (value: string) => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const text = (x: number, y: number, value: string, className = '', extra = '') => `<text x="${number(x)}" y="${number(y)}"${className ? ` class="${className}"` : ''}${extra}>${escape(value)}</text>`;
  const tables = new Map(view.allTables.map(table => [table.uuid, table]));
  const finite = (value: number) => { if (Number.isFinite(value)) return value; warn('유효하지 않은 도형 좌표를 0으로 표시했습니다.'); return 0; };
  const boxes: Box[] = [];
  for (const placement of view.placements.filter(item => item.diagramUuid === diagramUuid)) {
    const table = tables.get(placement.tableUuid);
    if (!table) { warn('테이블 정의가 없는 배치는 제외했습니다.'); continue; }
    const physicalWidth = Math.max(120, ...table.columns.map(column => measure(clean(column.name)) + 20));
    const logicalWidth = Math.max(120, ...table.columns.map(column => measure(clean(column.logicalName)) + 20));
    const typeWidth = Math.max(170, ...table.columns.map(column => measure(clean(column.type)) + 40));
    const titleWidth = Math.max(measure(clean(table.name)), measure(clean(table.logicalName)), measure(clean(table.schemaName))) + 26;
    boxes.push({ table, placementUuid: placement.uuid, x: finite(placement.x), y: finite(placement.y), w: Math.max(64 + physicalWidth + logicalWidth + typeWidth, titleWidth), h: HEADER + COLUMN_HEADER + ROW * Math.max(1, table.columns.length), physicalWidth, logicalWidth, typeWidth });
  }
  let minX = Math.min(0, ...boxes.map(box => box.x)), minY = Math.min(0, ...boxes.map(box => box.y));
  let maxX = Math.max(400, ...boxes.map(box => box.x + box.w)), maxY = Math.max(160, ...boxes.map(box => box.y + box.h));
  const extend = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const first = boxes[a], second = boxes[b];
    if (first.x < second.x + second.w && first.x + first.w > second.x && first.y < second.y + second.h && first.y + first.h > second.y) warn('모든 컬럼을 펼치면 일부 테이블이 겹칩니다. 저장된 배치 좌표를 유지했습니다.');
  }
  const hiddenMetadata = view.diagrams.find(diagram => diagram.uuid === diagramUuid)?.hiddenRelationUuids;
  const hidden = new Set<string>(hiddenMetadata || []);
  if ('graph' in source) {
    const byId = new Map(source.graph.objects.map(object => [object.id, object]));
    const object = source.graph.objects.find(item => (item.features.find(feature => feature.name === 'UUID')?.value || `binary:${item.id}`) === diagramUuid);
    const refs = object?.features.find(feature => feature.name === 'filteredRelations')?.value;
    if (Array.isArray(refs)) for (const ref of refs) if (ref && typeof ref === 'object' && 'ref' in ref) {
      const relation = byId.get(ref.ref); if (relation) hidden.add(String(relation.features.find(feature => feature.name === 'UUID')?.value || `binary:${relation.id}`));
    }
  } else if (view.allRelationships.length && hiddenMetadata === undefined) warn('표시 투영만 제공되어 원본 다이어그램의 숨긴 관계 설정은 확인할 수 없습니다.');
  const edges: string[] = [];
  const cardinality = (value: string) => {
    const label = ({ EXACTLY_ONE: '1', ZERO_OR_ONE: '0..1', ZERO_OR_MORE: '0..N', ONE_OR_MORE: '1..N' } as Record<string, string>)[value];
    if (!label) warn('알 수 없는 관계 카디널리티는 원문 코드로 표시했습니다.');
    return label ?? (value || '?');
  };
  for (const relation of view.allRelationships) {
    if (relation.relationUuid && hidden.has(relation.relationUuid)) continue;
    const parents = boxes.filter(box => box.table.uuid === relation.parentTableUuid), children = boxes.filter(box => box.table.uuid === relation.childTableUuid);
    if (!parents.length || !children.length) continue;
    if (parents.length > 1 || children.length > 1) warn('한 테이블의 배치가 여러 개이면 가장 가까운 배치 쌍에 관계를 연결합니다.');
    let parent = parents[0], child = children[0], distance = Infinity;
    for (const p of parents) for (const c of children) { const candidate = Math.hypot(p.x - c.x, p.y - c.y); if (candidate < distance) { distance = candidate; parent = p; child = c; } }
    const right = child.x + child.w / 2 >= parent.x + parent.w / 2;
    const sy = parent.y + HEADER + COLUMN_HEADER + (Math.max(0, parent.table.columns.findIndex(column => column.uuid === relation.parentColumnUuids[0])) + 0.5) * ROW;
    const ey = child.y + HEADER + COLUMN_HEADER + (Math.max(0, child.table.columns.findIndex(column => column.uuid === relation.childColumnUuids[0])) + 0.5) * ROW;
    const sx = right ? parent.x + parent.w : parent.x, ex = right ? child.x : child.x + child.w;
    const self = parent === child, midX = self ? parent.x + parent.w + 64 : (sx + ex) / 2;
    const endX = self ? parent.x + parent.w : ex, endY = self && sy === ey ? ey + 20 : ey;
    extend(midX + 20, Math.max(sy, endY) + 30);
    const label = relation.name || relation.constraintUuid || '외래키';
    const labelY = Math.min(sy, endY) - 10;
    extend(midX - measure(label) / 2 - 8, labelY - 14); extend(midX + measure(label) / 2 + 8, labelY + 4);
    edges.push(`<g class="relationship"><title>${escape(label)} · 부모 → 자식</title><path d="M ${number(sx)} ${number(sy)} H ${number(midX)} V ${number(endY)} H ${number(endX)}" class="edge${relation.identifying ? ' identifying' : ''}" marker-end="url(#child-arrow)"/>${text(sx + (right ? 8 : -8), sy - 6, cardinality(relation.parentCardinality), 'cardinality', ` text-anchor="${right ? 'start' : 'end'}"`)}${text(endX + (right && !self ? -8 : 8), endY - 6, cardinality(relation.childCardinality), 'cardinality', ` text-anchor="${right && !self ? 'end' : 'start'}"`)}${text(midX, labelY, label, 'edge-label', ' text-anchor="middle"')}</g>`);
  }
  if (edges.length) warn('관계는 부모 → 자식 방향의 직교선으로 생성했습니다. 원본의 수동 경로와 표시 프리셋은 재현하지 않습니다.');
  const foreignColumns = new Set(view.allRelationships.flatMap(relation => relation.childColumnUuids));
  const tableSvg = boxes.map(box => {
    const left = box.x + 64, logical = left + box.physicalWidth, type = logical + box.logicalWidth;
    const rows = box.table.columns.map((column, index) => {
      const y = box.y + HEADER + COLUMN_HEADER + index * ROW, baseline = y + 18;
      return `<g class="column"><line x1="${number(box.x)}" y1="${number(y + ROW)}" x2="${number(box.x + box.w)}" y2="${number(y + ROW)}" class="grid"/>${text(box.x + 8, baseline, [column.primaryKey ? 'PK' : '', foreignColumns.has(column.uuid) ? 'FK' : ''].filter(Boolean).join('/'), 'key')}${text(left + 8, baseline, column.name)}${text(logical + 8, baseline, column.logicalName)}${text(type + 8, baseline, `${column.type}${column.nullable ? '' : ' *'}`)}</g>`;
    }).join('');
    return `<g class="table"><title>${escape(box.table.schemaName)}.${escape(box.table.name)}</title><rect x="${number(box.x)}" y="${number(box.y)}" width="${number(box.w)}" height="${number(box.h)}" rx="4" class="table-body"/><path d="M ${number(box.x)} ${number(box.y + HEADER)} V ${number(box.y + 4)} Q ${number(box.x)} ${number(box.y)} ${number(box.x + 4)} ${number(box.y)} H ${number(box.x + box.w - 4)} Q ${number(box.x + box.w)} ${number(box.y)} ${number(box.x + box.w)} ${number(box.y + 4)} V ${number(box.y + HEADER)} Z" class="table-head"/>${text(box.x + 12, box.y + 22, box.table.name, 'physical')}${text(box.x + 12, box.y + 42, box.table.logicalName, 'logical')}${text(box.x + 12, box.y + 59, box.table.schemaName, 'schema')}<rect x="${number(box.x)}" y="${number(box.y + HEADER)}" width="${number(box.w)}" height="${COLUMN_HEADER}" class="column-head"/>${text(box.x + 8, box.y + HEADER + 18, '키')}${text(left + 8, box.y + HEADER + 18, '물리명')}${text(logical + 8, box.y + HEADER + 18, '논리명')}${text(type + 8, box.y + HEADER + 18, '자료형 (* NOT NULL)')}${rows}${!box.table.columns.length ? text(left + 8, box.y + HEADER + COLUMN_HEADER + 18, '컬럼 없음') : ''}</g>`;
  }).join('');
  const notes = view.allNotes.filter(note => note.diagramUuid === diagramUuid).map(note => {
    const x = finite(note.x), y = finite(note.y), width = note.width && Number.isFinite(note.width) ? Math.max(100, note.width) : 260;
    const lines: string[] = [];
    for (const paragraph of clean(note.text).replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const char of Array.from(paragraph)) { if (line && measure(line + char) > width - 24) { lines.push(line); line = ''; } line += char; }
      lines.push(line);
    }
    const requestedHeight = note.height && Number.isFinite(note.height) ? note.height : 0, height = Math.max(50, requestedHeight, lines.length * 20 + 24);
    if (requestedHeight && height > requestedHeight) warn('메모 전체 텍스트를 표시하기 위해 저장된 메모 높이를 늘렸습니다.');
    extend(x, y); extend(x + width, y + height);
    const target = boxes.find(box => box.placementUuid === note.targetPlacementUuid);
    let connector = '';
    if (target) connector = `<path class="note-link" d="M ${number(x + width / 2)} ${number(y + height / 2)} L ${number(target.x + target.w / 2)} ${number(target.y + target.h / 2)}"/>`;
    else if (note.targetPlacementUuid) warn('현재 다이어그램에 없는 메모 연결 대상은 표시하지 않았습니다.');
    return `${connector}<g class="note"><rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}" rx="4"/>${lines.map((line, index) => text(x + 12, y + 24 + index * 20, line)).join('')}</g>`;
  }).join('');
  maxX = Math.max(maxX, minX + measure(clean(diagram.name)), minX + measure('부모 → 자식(외래키) · 실선: 식별 관계 · 점선: 비식별 관계 · *: NOT NULL'));
  const padding = 64, originX = Math.floor(minX - padding), originY = Math.floor(minY - padding - 64);
  const width = Math.ceil(maxX + padding - originX), height = Math.ceil(maxY + padding - originY);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${originX} ${originY} ${width} ${height}" role="img" aria-labelledby="diagram-title diagram-description"><title id="diagram-title">${escape(diagram.name)}</title><desc id="diagram-description">${escape(view.name)} · ${boxes.length}개 테이블 · 부모에서 자식으로 연결된 외래키 관계. 모든 컬럼 표시.</desc><defs><marker id="child-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0 0 L10 4 L0 8 Z" fill="${palette.slate}"/></marker></defs><style>:root{--action:${palette.teal};--action-ink:${palette.emphasis}}text{font:13px system-ui,"Noto Sans KR","Malgun Gothic",sans-serif;fill:${palette.ink};white-space:pre}.background{fill:${palette.paper}}.table-body{fill:${palette.paper};stroke:${palette.slate};stroke-width:1.5}.table-head{fill:${palette.slate}}.physical{font-weight:700;font-size:16px;fill:${palette.paper}}.logical{fill:${palette.paper}}.schema{fill:${palette.paper};font-size:11px}.column-head{fill:${palette.ice};fill-opacity:.22}.grid{stroke:${palette.ice};stroke-opacity:.45}.key{fill:${palette.slate};font-weight:700;font-size:11px}.edge{fill:none;stroke:${palette.slate};stroke-width:1.8;stroke-dasharray:6 4}.identifying{stroke-dasharray:none}.edge-label,.cardinality{fill:${palette.ink};font-size:12px;paint-order:stroke;stroke:${palette.paper};stroke-width:4px;stroke-linejoin:round}.note rect{fill:${palette.paper};stroke:${palette.ice};stroke-width:1.5}.note-link{stroke:${palette.ice};fill:none;stroke-dasharray:4 4}.diagram-name{fill:${palette.slate};font-size:20px;font-weight:700}.legend{fill:${palette.slate};font-size:12px}</style><rect class="background" x="${originX}" y="${originY}" width="${width}" height="${height}"/>${text(minX, originY + 30, diagram.name, 'diagram-name')}${text(minX, originY + 52, '부모 → 자식(외래키) · 실선: 식별 관계 · 점선: 비식별 관계 · *: NOT NULL', 'legend')}${edges.join('')}${tableSvg}${notes}</svg>`;
  return { svg, width, height, warnings };
}
