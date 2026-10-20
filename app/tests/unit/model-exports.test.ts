import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { diagramSvg } from '../../src/formats/export/diagram-svg';
import { exportDefinitionCsv, exportDefinitionHtml } from '../../src/formats/export/definition-report';
import { createNativeDocument, appendNativeTable } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import { openNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument, type NativeDocumentView } from '../../src/formats/exerd/view';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';

function fixture(): NativeDocumentView {
  const parent = { uuid: 'parent', name: 'customer<&"', logicalName: '고객', schemaUuid: 's', schemaName: 'sales', comment: '설명\n"따옴표", 한글', x: 0, y: 0,
    columns: [{ uuid: 'id', name: 'customer_id', logicalName: '고객 번호', type: 'BIGINT', nullable: false, primaryKey: true, defaultValue: '-1', comment: '<img src=x onerror="alert(1)">', domainUuid: 'domain' }, { uuid: 'name', name: 'name', logicalName: '=HYPERLINK("x")', type: 'VARCHAR(100)', nullable: true, primaryKey: false, defaultValue: "'홍길동'", comment: '줄1\n줄2,"인용"' }],
    groups: [{ uuid: 'pk', kind: 'primary' as const, name: 'pk_index', constraintName: 'pk_customer', constraintUuid: 'pk-constraint', columnUuids: ['id'], sortTypes: ['ASC' as const] }, { uuid: 'ix', kind: 'index' as const, name: 'ix_name', columnUuids: ['name'], sortTypes: ['DESC' as const] }], checks: [{ uuid: 'check', name: 'ck_positive', expression: 'customer_id > 0 AND name <> \'<script>\'' }] };
  const child = { ...parent, uuid: 'child', name: 'orders', logicalName: '주문', comment: '', columns: [{ ...parent.columns[0], uuid: 'customer_ref', name: 'customer_ref', primaryKey: false, comment: '', domainUuid: undefined }], groups: [], checks: [] };
  const other = { ...parent, uuid: 'secret', name: 'OTHER_DIAGRAM_ONLY', columns: [], groups: [], checks: [] };
  const relationship = { uuid: 'fk', name: 'fk_orders_customer', relationUuid: 'relation', constraintUuid: 'fk-constraint', parentTableUuid: 'parent', childTableUuid: 'child', parentColumnUuids: ['id'], childColumnUuids: ['customer_ref'], identifying: false, parentCardinality: 'EXACTLY_ONE', childCardinality: 'ZERO_OR_MORE', onDelete: 'CASCADE', onUpdate: 'NO_ACTION' };
  return { name: '한글 모델 <script>alert(1)</script>', productId: 'pg', tables: [parent, child, other], allTables: [parent, child, other], diagrams: [{ uuid: 'diagram', name: '고객 주문', businessAreaUuid: 'area', businessAreaName: '업무', tableUuids: ['parent', 'child'] }, { uuid: 'other', name: '다른 도면', businessAreaUuid: 'area', businessAreaName: '업무', tableUuids: ['secret'] }], domains: [{ uuid: 'domain', name: '고객 식별자', parentUuid: 'domain-parent', suggestedDataType: 'BIGINT', suggestedDefaultValue: '', suggestedNotNull: 'TRUE', comment: '' }, { uuid: 'domain-parent', name: '공통', suggestedDataType: '', suggestedDefaultValue: '', suggestedNotNull: '', comment: '' }], relationships: [relationship], allRelationships: [relationship], notes: [], allNotes: [{ uuid: 'note', diagramUuid: 'diagram', text: '<script>alert("XSS")</script>\n한국어 메모 & 원문', x: -100, y: -100, width: 220, height: 30, targetPlacementUuid: 'place-parent' }, { uuid: 'private-note', diagramUuid: 'other', text: 'OTHER_NOTE_ONLY', x: 0, y: 0 }], placements: [{ uuid: 'place-parent', diagramUuid: 'diagram', tableUuid: 'parent', x: -300, y: -20, reference: false }, { uuid: 'place-child', diagramUuid: 'diagram', tableUuid: 'child', x: 800, y: 80, reference: false }, { uuid: 'place-secret', diagramUuid: 'other', tableUuid: 'secret', x: 0, y: 0, reference: false }], warnings: [], schemas: [{ uuid: 's', name: 'sales', logicalName: '영업' }], businessAreas: [{ uuid: 'area', name: '업무' }] };
}
function parseCsv(csv: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push([...row]); row.length = 0; cell = ''; i++; }
    else cell += char;
  }
  expect(quoted).toBe(false); return rows;
}
describe('portable model exports', () => {
  it('exports selected diagram vectors with every column, Korean labels, keys, cardinality and no executable user markup', () => {
    const view = fixture(), before = structuredClone(view), output = diagramSvg(view, 'diagram');
    expect(XMLValidator.validate(output.svg)).toBe(true);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(output.svg);
    expect(parsed.svg['@_width']).toBe(String(output.width));
    expect(output.svg).toContain('고객 번호'); expect(output.svg).toContain('VARCHAR(100)');
    expect(output.svg).toContain('0..N'); expect(output.svg).toContain('marker-end="url(#child-arrow)"');
    expect(output.svg).toContain('>FK</text>'); expect(output.svg).toContain('>PK</text>');
    expect(output.svg).toContain('&lt;script&gt;alert(&quot;XSS&quot;)');
    expect(output.svg).not.toMatch(/<script|<foreignObject|<image|\son\w+=|href=/i);
    expect(output.svg).not.toContain('OTHER_DIAGRAM_ONLY'); expect(output.svg).not.toContain('OTHER_NOTE_ONLY');
    for (const color of ['#3A4A5A', '#262626', '#F9F9F9', '#8B9FA8', '#00A19B', '#007A76']) expect(output.svg).toContain(color);
    expect(output.svg).toContain('.key{fill:#3A4A5A'); expect(output.svg).toContain('.edge{fill:none;stroke:#3A4A5A');
    expect(output.svg).toContain('.physical{font-weight:700;font-size:16px;fill:#F9F9F9');
    const bounds = /viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/.exec(output.svg)!.slice(1).map(Number);
    expect(bounds[0]).toBeLessThan(-300); expect(bounds[1]).toBeLessThan(-100); expect(bounds[0] + bounds[2]).toBeGreaterThan(800);
    expect(output.warnings.some(warning => warning.includes('高さ') || warning.includes('높이'))).toBe(true);
    expect(view).toEqual(before);
  });
  it('handles duplicate placements, self-references, invalid control text and empty diagrams without corrupting XML', () => {
    const view = fixture();
    view.placements.push({ ...view.placements[0], uuid: 'place-parent-copy', x: 1400 });
    view.allRelationships.push({ ...view.allRelationships[0], uuid: 'self', childTableUuid: 'parent', childColumnUuids: ['id'] });
    view.allNotes[0].text = '메모\u0001\ud800';
    const output = diagramSvg(view, 'diagram');
    expect(XMLValidator.validate(output.svg)).toBe(true);
    expect(output.svg).toContain('⟦U+0001⟧'); expect(output.svg).toContain('⟦U+D800⟧');
    expect(output.warnings.some(warning => warning.includes('배치 쌍'))).toBe(true);
    view.placements = []; view.allNotes = [];
    expect(diagramSvg(view, 'diagram').width).toBeGreaterThan(0);
    expect(() => diagramSvg(view, 'missing')).toThrow('다이어그램');
  });
  it('accepts a native document and honors explicitly hidden source relations', () => {
    let document = appendNativeTable(createNativeDocument('Native SVG'), { name: 'child' });
    const projected = projectNativeDocument(document), parent = projected.allTables[0], child = projected.allTables[1];
    document = mutateNativeDocument(document, { type: 'addRelationship', name: 'hidden_fk', parentTableUuid: parent.uuid, childTableUuid: child.uuid, parentColumnUuids: [parent.columns[0].uuid], childColumnUuids: [child.columns[0].uuid] });
    const relation = document.graph.objects.find(object => object.class.name === 'Relation')!, diagram = document.graph.objects.find(object => object.class.name === 'Diagram')!;
    const diagramUuid = diagram.features.find(feature => feature.name === 'UUID')!.value as string;
    expect(diagramSvg(document, diagramUuid).svg).toContain('class="relationship"');
    diagram.features.push({ id: 999, name: 'filteredRelations', kind: 'EOBJECT_LIST', value: [{ ref: relation.id }] });
    const before = structuredClone(document.graph), output = diagramSvg(document, diagramUuid);
    expect(XMLValidator.validate(output.svg)).toBe(true); expect(output.svg).not.toContain('class="relationship"');
    expect(document.graph).toEqual(before);
  });
  it('prints a selected table definition with inherited domain, keys, checks, foreign targets and safe text', () => {
    const view = fixture(), html = exportDefinitionHtml(view, { tableUuids: ['parent', 'child'] });
    expect(html).toContain('lang="ko"'); expect(html).toContain('size:A4 landscape');
    expect(html).toContain('colspan="3"'); expect(html).toContain('table-header-group');
    expect(html).toContain('공통 / 고객 식별자'); expect(html).toContain('pk_customer'); expect(html).toContain('ix_name');
    expect(html).toContain('ck_positive'); expect(html).toContain('DELETE CASCADE'); expect(html).toContain('sales.customer&lt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toMatch(/<script|<img|<iframe|<object|<input/i);
    expect(html).not.toContain('OTHER_DIAGRAM_ONLY');
    expect(() => exportDefinitionHtml(view, { tableUuids: ['unknown'] })).toThrow('테이블');
    expect(exportDefinitionHtml(view, { tableUuids: [] })).toContain('대상 테이블 0개');
  });
  it('roundtrips CSV quotes/newlines and makes formula-like values explicit spreadsheet text', () => {
    const view = fixture(); view.allTables[0].comment = '\t@SUM(1,2)';
    const csv = exportDefinitionCsv(view), rows = parseCsv(csv);
    expect(csv.charCodeAt(0)).toBe(0xfeff); expect(csv.endsWith('\r\n')).toBe(true);
    expect(rows).toHaveLength(5); expect(rows.every(row => row.length === 16)).toBe(true);
    expect(rows[1][3]).toBe("'\t@SUM(1,2)"); expect(rows[1][11]).toBe("'-1");
    expect(rows[2][6]).toBe('\'=HYPERLINK("x")'); expect(rows[2][13]).toBe('줄1\n줄2,"인용"');
    expect(rows[1][12]).toBe('공통 / 고객 식별자'); expect(rows[1][14]).toContain('pk_customer');
    expect(rows[1][15]).toContain('customer_id > 0');
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('real native model exports', () => {
  it('exports all 609 definitions and 10045 column rows and separates one diagram from the full model', () => {
    const document = openNativeDocument(readFileSync(source), schema as BinaryRegistry), view = projectNativeDocument(document);
    const html = exportDefinitionHtml(document), rows = parseCsv(exportDefinitionCsv(document));
    expect((html.match(/class="table-definition"/g) ?? []).length).toBe(609);
    expect(rows.length).toBe(10046); expect(rows.slice(1).every(row => row.length === 16)).toBe(true);
    const diagram = view.diagrams[0], svg = diagramSvg(document, diagram.uuid);
    expect(XMLValidator.validate(svg.svg)).toBe(true);
    expect((svg.svg.match(/class="table"/g) ?? []).length).toBe(view.placements.filter(placement => placement.diagramUuid === diagram.uuid).length);
    expect((svg.svg.match(/class="column"/g) ?? []).length).toBe(view.placements.filter(placement => placement.diagramUuid === diagram.uuid).reduce((sum, placement) => sum + view.allTables.find(table => table.uuid === placement.tableUuid)!.columns.length, 0));
  }, 20000);
});
