import type { NativeExerdDocument } from '../exerd/native-document';
import { projectNativeDocument, type NativeDocumentView, type NativeTableView } from '../exerd/view';

export type DefinitionSource = NativeExerdDocument | NativeDocumentView;
export interface DefinitionOptions { tableUuids?: string[] }
const viewOf = (source: DefinitionSource): NativeDocumentView => 'graph' in source ? projectNativeDocument(source) : source;
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const kinds = { primary: '기본키', unique: '대체키/UNIQUE', index: '인덱스', foreign: '외래키' };
function tablesFor(view: NativeDocumentView, options: DefinitionOptions): NativeTableView[] {
  if (!options.tableUuids) return view.allTables;
  const wanted = new Set(options.tableUuids), known = new Set(view.allTables.map(table => table.uuid));
  if ([...wanted].some(uuid => !known.has(uuid))) throw new Error('정의서에 포함할 테이블을 찾지 못했습니다.');
  return view.allTables.filter(table => wanted.has(table.uuid));
}
function domainName(view: NativeDocumentView, uuid?: string): string {
  const domains = new Map(view.domains.map(domain => [domain.uuid, domain])), names: string[] = [], seen = new Set<string>();
  while (uuid && !seen.has(uuid)) { seen.add(uuid); const domain = domains.get(uuid); if (!domain) { names.unshift(`[미확인: ${uuid}]`); uuid = undefined; break; } names.unshift(domain.name); uuid = domain.parentUuid; }
  if (uuid && seen.has(uuid)) names.unshift('[순환]');
  return names.join(' / ');
}
function groupText(table: NativeTableView): string {
  const columns = new Map(table.columns.map(column => [column.uuid, column.name]));
  return table.groups.map(group => `${kinds[group.kind]}: ${group.name}${group.constraintName ? ` (제약: ${group.constraintName})` : ''} [${group.columnUuids.map((uuid, index) => `${columns.get(uuid) ?? `[미확인: ${uuid}]`} ${group.sortTypes[index] ?? 'ASC'}`).join(', ')}]`).join('\n');
}
function foreignText(view: NativeDocumentView, tableUuid: string, columnUuid: string): string {
  const tables = new Map(view.allTables.map(table => [table.uuid, table]));
  return view.allRelationships.filter(relation => relation.childTableUuid === tableUuid && relation.childColumnUuids.includes(columnUuid)).map(relation => {
    const parent = tables.get(relation.parentTableUuid), index = relation.childColumnUuids.indexOf(columnUuid), target = parent?.columns.find(column => column.uuid === relation.parentColumnUuids[index]);
    return `${relation.constraintUuid ? relation.name || '(이름 없음)' : relation.name || '(제약 미지정)'} → ${parent?.schemaName ? `${parent.schemaName}.` : ''}${parent?.name ?? '[미확인 테이블]'}.${target?.name ?? '[미확인 컬럼]'}; DELETE ${relation.onDelete || '기본값'}; UPDATE ${relation.onUpdate || '기본값'}`;
  }).join('\n');
}

/** Standalone, script-free print document. This is a definition report, not a native save format. */
export function exportDefinitionHtml(source: DefinitionSource, options: DefinitionOptions = {}): string {
  const view = viewOf(source), tables = tablesFor(view, options), h = escape;
  const body = tables.map((table, index) => {
    const rows = table.columns.map((column, ordinal) => `<tr><td>${ordinal + 1}</td><td>${h(column.name)}</td><td>${h(column.logicalName)}</td><td>${h(column.type)}</td><td>${column.nullable ? '허용' : '불가'}</td><td>${column.primaryKey ? 'PK' : ''}</td><td>${h(foreignText(view, table.uuid, column.uuid))}</td><td>${h(column.defaultValue)}</td><td>${h(domainName(view, column.domainUuid))}</td><td>${h(column.comment)}</td></tr>`).join('');
    const checks = table.checks.map(check => `${check.name || '(이름 없음)'}: ${check.expression}`).join('\n');
    return `<section class="table-definition" id="table-${index}"><h2>${index + 1}. ${h(table.name)}${table.logicalName ? ` · ${h(table.logicalName)}` : ''}</h2><table class="metadata"><tbody><tr><th>스키마</th><td>${h(table.schemaName)}</td><th>컬럼 수</th><td>${table.columns.length}</td></tr><tr><th>설명</th><td colspan="3">${h(table.comment)}</td></tr></tbody></table><table class="columns"><thead><tr>${['순서', '물리명', '논리명', '자료형', 'NULL', 'PK', 'FK / 참조 / 동작', '기본값', '도메인 경로', '설명'].map(title => `<th>${title}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="10">컬럼 없음</td></tr>'}</tbody></table><h3>키 및 인덱스</h3><pre>${h(groupText(table) || '없음')}</pre><h3>CHECK 제약</h3><pre>${h(checks || '없음')}</pre></section>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(view.name)} · 테이블 정의서</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px/1.5 system-ui,"Noto Sans KR","Malgun Gothic",sans-serif;color:#262626;background:#F9F9F9;margin:24px}h1,h2,h3{color:#3A4A5A;break-after:avoid}h2{font-size:20px}h3{font-size:14px}table{width:100%;border-collapse:collapse;margin:12px 0;table-layout:fixed}th,td{border:1px solid #8B9FA8;padding:6px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#3A4A5A;color:#F9F9F9}.metadata th{width:12%}.columns th:first-child{width:4%}.columns th:nth-child(5),.columns th:nth-child(6){width:5%}thead{display:table-header-group}tr{break-inside:avoid}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #8B9FA8;padding:8px}.table-definition{margin-top:32px}.notice{color:#3A4A5A}a{color:#007A76}a:hover{color:#00A19B}@media print{body{margin:0;background:white}.table-definition{break-before:page;margin:0}a{color:inherit;text-decoration:none}}</style></head><body><h1>${h(view.name)} · 테이블 정의서</h1><p>대상 테이블 ${tables.length}개 · 컬럼 ${tables.reduce((sum, table) => sum + table.columns.length, 0)}개</p><p class="notice">모델에 저장된 논리·물리 정의 및 상속된 컬럼 속성을 표시합니다. DB별 물리 옵션과 원본 파일의 전체 속성은 이 정의서의 범위에 포함되지 않습니다.</p><ol>${tables.map((table, index) => `<li><a href="#table-${index}">${h(table.schemaName ? `${table.schemaName}.${table.name}` : table.name)}${table.logicalName ? ` · ${h(table.logicalName)}` : ''}</a></li>`).join('')}</ol>${body}</body></html>`;
}

/** RFC4180 quoting plus an explicit text prefix for spreadsheet formula-like cells. */
export function exportDefinitionCsv(source: DefinitionSource, options: DefinitionOptions = {}): string {
  const view = viewOf(source), rows: string[][] = [['스키마', '테이블 물리명', '테이블 논리명', '테이블 설명', '컬럼 순서', '컬럼 물리명', '컬럼 논리명', '자료형', 'NULL 허용', 'PK', 'FK / 참조 / 동작', '기본값', '도메인 경로', '컬럼 설명', '키 및 인덱스', 'CHECK 제약']];
  for (const table of tablesFor(view, options)) {
    const prefix = [table.schemaName, table.name, table.logicalName, table.comment], suffix = [groupText(table), table.checks.map(check => `${check.name}: ${check.expression}`).join('\n')];
    if (!table.columns.length) rows.push([...prefix, ...Array<string>(10).fill(''), ...suffix]);
    for (const [index, column] of table.columns.entries()) rows.push([...prefix, String(index + 1), column.name, column.logicalName, column.type, column.nullable ? 'Y' : 'N', column.primaryKey ? 'PK' : '', foreignText(view, table.uuid, column.uuid), column.defaultValue, domainName(view, column.domainUuid), column.comment, ...suffix]);
  }
  return '\uFEFF' + rows.map(row => row.map(value => {
    const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n') + '\r\n';
}
