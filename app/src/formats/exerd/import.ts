import { inflateSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createModel, type Model, type Table, type Column, type Relationship } from '../../core/model';

export interface ExerdImportResult { model: Model; warnings: string[] }
interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[] }
const MAX_FILE = 64 * 1024 * 1024;
const MAX_XML = 32 * 1024 * 1024;
const local = (name: string) => name.split(':').pop()!;
const children = (node: XmlNode, tag: string) => node.children.filter(n => n.tag === tag);
const descendants = (node: XmlNode, tag: string): XmlNode[] => node.children.flatMap(n => [ ...(n.tag === tag ? [n] : []), ...descendants(n, tag)]);
function xmlNodes(records: Record<string, unknown>[]): XmlNode[] {
  return records.flatMap(record => Object.entries(record).filter(([k]) => k !== ':@' && !k.startsWith('?') && !k.startsWith('#')).map(([tag, value]) => ({
    tag: local(tag),
    attrs: Object.fromEntries(Object.entries((record[':@'] || {}) as Record<string, unknown>).map(([k, v]) => [k.replace(/^@_/, ''), String(v)])),
    children: Array.isArray(value) ? xmlNodes(value) : [],
  })));
}
const attr = (n: XmlNode, key: string, fallback = '') => n.attrs[key] ?? fallback;
const kind = (n: XmlNode) => local(n.attrs['xsi:type'] || n.attrs.type || '');
const refs = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Maps the observed eXERD XMI model. Does not claim lossless eXERD round-trip support. */
export function importExerd(text: string): ExerdImportResult {
  if (text.length > MAX_XML) throw new Error('eXERD XML이 32 MiB 제한을 초과합니다.');
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) throw new Error('DTD와 사용자 정의 엔티티가 포함된 XML은 지원하지 않습니다.');
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(`eXERD XML 형식 오류: ${valid.err.msg}`);
  const parsed = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseAttributeValue: false, trimValues: false }).parse(text);
  const root = xmlNodes(parsed).find(n => n.tag === 'Document');
  if (!root || !Object.values(root.attrs).includes('http://exerd.tomato.com/model')) throw new Error('지원하는 eXERD Document XML이 아닙니다.');
  const warnings: string[] = [];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const database = children(root, 'databaseModel')[0];
  if (!database) throw new Error('eXERD 데이터베이스 모델을 찾지 못했습니다.');
  const model = createModel(attr(database, 'logicalName') || attr(database, 'physicalName') || 'eXERD 가져온 모델');
  model.id = attr(root, 'UUID', model.id);
  const product = attr(root, 'productId') || attr(root, 'product');
  if (/mysql|mariadb/i.test(product)) model.dialect = 'mysql';
  else if (/sqlite/i.test(product)) model.dialect = 'sqlite';
  else if (!/postgres/i.test(product)) warn(`원본 DBMS '${product || '미상'}'은 지원 목록에 없습니다. PostgreSQL을 임시 선택했습니다. 원본 자료형은 보존했으므로 DDL 생성 전 DBMS와 자료형을 검토하세요.`);
  const domains = new Map(descendants(root, 'domain').map(n => [attr(n, 'UUID'), n]));
  const businessAreas = children(root, 'businessAreas');
  model.subjects = businessAreas.map((n, i) => ({ id: attr(n, 'UUID', `subject-${i}`), name: attr(n, 'logicalName') || attr(n, 'physicalName') || `업무영역 ${i + 1}`, color: '#0f9f8f' }));
  const diagrams = businessAreas.flatMap(n => children(n, 'diagrams'));
  const activeDiagram = refs(attr(root, 'openedDiagrams'))[0];
  const diagram = diagrams.find(n => attr(n, 'UUID') === activeDiagram) || diagrams[0];
  const locations = new Map((diagram ? children(diagram, 'diagramEntry') : []).filter(n => attr(n, 'table')).map(n => [attr(n, 'table'), attr(n, 'location')]));
  if (diagrams.length > 1) warn(`원본 다이어그램 ${diagrams.length}개 중 '${diagram ? attr(diagram, 'logicalName') || attr(diagram, 'physicalName') : ''}'의 좌표만 가져왔습니다. 다중 다이어그램은 보존되지 않습니다.`);
  const memberships = new Map<string, { column: Column; node: XmlNode; table: Table }[]>();
  const groups = new Map<string, { node: XmlNode; table: Table }>();
  const columnOwners = new Map<string, Table>();
  const identity = new Set<string>();
  function id(node: XmlNode, fallback: string) {
    const value = attr(node, 'UUID', fallback);
    if (identity.has(value)) throw new Error(`eXERD에 중복 식별자가 있습니다: ${value}`);
    identity.add(value); return value;
  }
  const schemas = children(database, 'schema');
  for (const schema of schemas) for (const node of children(schema, 'tables')) {
    const tableId = id(node, `table-${model.tables.length}`);
    const point = /Point\(\s*([-\d.eE+]+)\s*,\s*([-\d.eE+]+)\s*\)/.exec(locations.get(tableId) || '');
    const area = businessAreas.find(n => refs(attr(n, 'tables')).includes(tableId));
    if (businessAreas.filter(n => refs(attr(n, 'tables')).includes(tableId)).length > 1) warn('여러 업무영역에 속한 테이블은 첫 업무영역만 연결했습니다.');
    const table: Table = { id: tableId, name: attr(node, 'physicalName') || attr(node, 'logicalName') || 'unnamed_table', logicalName: attr(node, 'logicalName'), schema: attr(schema, 'physicalName'), comment: attr(node, 'comment'), color: '#0f9f8f', x: point && Number.isFinite(+point[1]) ? +point[1] : 100 + model.tables.length % 4 * 330, y: point && Number.isFinite(+point[2]) ? +point[2] : 100 + Math.floor(model.tables.length / 4) * 340, columns: [], indexes: [], subjectId: area ? attr(area, 'UUID') : '' };
    for (const c of children(node, 'columns')) {
      const domain = domains.get(attr(c, 'domain'));
      let type = attr(c, 'dataType');
      let current = domain;
      const visited = new Set<XmlNode>();
      while (!type && current && !visited.has(current)) { visited.add(current); type = attr(current, 'suggestedDataType'); current = domains.get(attr(current, 'domain')); }
      if (!type) { type = 'VARCHAR(255)'; warn('자료형 또는 도메인 자료형을 확인하지 못한 컬럼에 VARCHAR(255)를 임시 지정했습니다.'); }
      const column: Column = { id: id(c, `${tableId}-column-${table.columns.length}`), name: attr(c, 'physicalName') || attr(c, 'logicalName') || 'unnamed_column', logicalName: attr(c, 'logicalName'), type, nullable: attr(c, 'notNull') !== 'TRUE', primaryKey: false, unique: false, defaultValue: attr(c, 'defaultValue'), comment: attr(c, 'comment') };
      if (!['TRUE', 'FALSE'].includes(attr(c, 'notNull'))) warn('NULL 허용 여부가 명시되지 않은 컬럼은 NULL 허용으로 가져왔습니다.');
      table.columns.push(column); columnOwners.set(column.id, table);
      for (const membership of children(c, 'memberships')) for (const value of children(membership, 'value')) {
        const group = attr(value, 'group') || attr(membership, 'key');
        const entries = memberships.get(group) || []; entries.push({ column, node: value, table }); memberships.set(group, entries);
        if (kind(value) === 'PrimaryKeyMembership') { column.primaryKey = true; column.nullable = false; }
      }
    }
    for (const group of children(node, 'columnGroups')) groups.set(id(group, `${tableId}-group-${groups.size}`), { node: group, table });
    model.tables.push(table);
  }
  for (const list of memberships.values()) list.sort((a, b) => Number(attr(a.node, 'entryIndex', '-1')) - Number(attr(b.node, 'entryIndex', '-1')));
  const relationNodes = descendants(root, 'relation').flatMap(n => children(n, 'value'));
  for (const [groupId, { node, table }] of groups) {
    const groupType = kind(node);
    const members = memberships.get(groupId) || [];
    if (groupType === 'PrimaryKeyColumnGroup') continue;
    if (groupType === 'AlternateKeyColumnGroup' || groupType === 'InversionEntryColumnGroup') {
      if (members.length) { table.indexes.push({ id: groupId, name: attr(node, 'physicalName') || attr(node, 'logicalName') || `idx_${table.name}`, columnIds: members.map(n => n.column.id), unique: groupType === 'AlternateKeyColumnGroup' }); }
      continue;
    }
    if (groupType !== 'ForeignKeyColumnGroup') { warn(`지원하지 않는 컬럼 그룹 '${groupType}'은 제외했습니다.`); continue; }
    const parent = groups.get(attr(node, 'parentColumnGroup'));
    const invalid = members.length === 0 || !parent || members.some(m => m.table !== table || columnOwners.get(attr(m.node, 'parentColumn')) !== parent.table);
    if (invalid) { warn(`외래키 '${attr(node, 'physicalName') || groupId}'의 참조를 확인하지 못해 제외했습니다.`); continue; }
    const relation = relationNodes.find(n => attr(n, 'foreignKeyColumnGroup') === groupId);
    const identifying = relation ? attr(relation, 'identifying', 'false') === 'true' : members.every(m => m.column.primaryKey);
    const cardinality = relation && ['EXACTLY_ONE', 'ZERO_OR_ONE'].includes(attr(relation, 'childCardinalityType')) ? '1:1' : '1:N';
    const relationship: Relationship = { id: groupId, name: attr(node, 'physicalName') || attr(node, 'logicalName'), parentTableId: parent!.table.id, childTableId: table.id, parentColumnIds: members.map(m => attr(m.node, 'parentColumn')), childColumnIds: members.map(m => m.column.id), identifying, cardinality, onDelete: 'NO ACTION' };
    model.relationships.push(relationship);
  }
  if (!model.tables.length) throw new Error('가져올 테이블이 없습니다.');
  warn('부분 호환 가져오기입니다. DBMS 고유 물리 속성, 삭제/갱신 참조 동작, CHECK 제약, 도메인 계층, 용어사전 연결, 메모, 테마, 관계선 경로, 변경 이력은 보존하지 않습니다. 원본 .exerd를 별도로 보관하세요.');
  return { model, warnings };
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ -1) >>> 0;
}
/** Reads observed 2.x / 3.x local-entry containers, or extracted XML. Synchronous in browser and Node. */
export function importExerdFile(bytes: Uint8Array): ExerdImportResult {
  if (bytes.byteLength > MAX_FILE) throw new Error('eXERD 파일이 64 MiB 제한을 초과합니다.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  if (/^\s*</.test(new TextDecoder().decode(bytes.subarray(0, 64)).replace(/^\uFEFF/, ''))) return importExerd(decoder.decode(bytes));
  if (bytes.length < 47 || new TextDecoder().decode(bytes.subarray(0, 10)) !== 'eXERD File') throw new Error('eXERD 파일 헤더가 아닙니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const qualifierLength = view.getUint32(22, false);
  const start = 26 + qualifierLength + 8;
  if (qualifierLength > 1024 || start + 30 > bytes.length) throw new Error('손상된 eXERD 버전 헤더입니다.');
  if (view.getUint32(start - 8, false) !== 0) throw new Error('4 GiB 이상 eXERD 컨테이너는 지원하지 않습니다.');
  const entryLength = view.getUint32(start - 4, false);
  const end = start + entryLength;
  if (end > bytes.length || entryLength < 46 || view.getUint32(start, true) !== 0x04034b50) throw new Error('손상된 eXERD XML 엔트리입니다.');
  const flags = view.getUint16(start + 6, true), method = view.getUint16(start + 8, true);
  if (flags & 1 || method !== 8 || !(flags & 8)) throw new Error('지원하지 않는 eXERD ZIP 방식입니다.');
  const nameLength = view.getUint16(start + 26, true), extraLength = view.getUint16(start + 28, true);
  const dataStart = start + 30 + nameLength + extraLength;
  if (dataStart > end - 16 || decoder.decode(bytes.subarray(start + 30, start + 30 + nameLength)) !== 'xml-content.xml') throw new Error('eXERD XML 엔트리 이름이 올바르지 않습니다.');
  const descriptor = end - 16;
  if (view.getUint32(descriptor, true) !== 0x08074b50) throw new Error('eXERD ZIP 데이터 서술자가 없습니다.');
  const expectedCrc = view.getUint32(descriptor + 4, true), compressedSize = view.getUint32(descriptor + 8, true), size = view.getUint32(descriptor + 12, true);
  if (size > MAX_XML || compressedSize !== descriptor - dataStart) throw new Error('eXERD XML 크기가 올바르지 않거나 32 MiB 제한을 초과합니다.');
  let xml: Uint8Array;
  try { xml = inflateSync(bytes.subarray(dataStart, descriptor), { out: new Uint8Array(size) }); }
  catch { throw new Error('eXERD XML 압축을 해제하지 못했습니다.'); }
  if (xml.length !== size || crc32(xml) !== expectedCrc) throw new Error('eXERD XML CRC 검증 실패: 파일이 손상되었습니다.');
  return importExerd(decoder.decode(xml));
}
