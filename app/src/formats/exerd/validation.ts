import schema from './schema.generated.json' with { type: 'json' };
import type { BinaryMapEntry, BinaryObject, BinaryRegistry, BinaryValue } from './binary';
import type { NativeExerdDocument } from './native-document';

export interface NativeDiagnostic {
  code: string; severity: 'error' | 'warning'; message: string; uuid: string; relatedUuids?: string[];
}
const CORE = 'http://exerd.tomato.com/model';
const registry = schema as BinaryRegistry;
const definitions = new Map(registry.packages.flatMap(pkg => pkg.classes.map(cls => [pkg.namespaceURI + '#' + cls.name, cls.features] as const)));

/** Advisory, immutable diagnostics. Existing documents are never repaired or rejected.
 * Structural errors are separate from DB-dependent warnings and unsupported rules.
 * Derived member/owner/childColumn fields are reconstructed from containment, not
 * treated as missing persisted data. SQL equality/collation rules need a real DB.
 */
export function validateNativeDocument(document: NativeExerdDocument): NativeDiagnostic[] {
  const diagnostics: NativeDiagnostic[] = [], emitted = new Set<string>();
  const objects = document.graph.objects;
  const fields = new Map(objects.map(o => [o.id, new Map(o.features.map(f => [f.name, f.value]))]));
  const field = (o: BinaryObject | undefined, key: string) => o && fields.get(o.id)?.get(key);
  const text = (o: BinaryObject | undefined, key: string) => { const v = field(o, key); return typeof v === 'string' ? v : ''; };
  const identity = (o: BinaryObject | undefined) => o ? text(o, 'UUID') || `binary:${o.id}` : 'document';
  const report = (code: string, severity: NativeDiagnostic['severity'], message: string, object: BinaryObject | undefined, related: BinaryObject[] = []) => {
    const uuid = identity(object), relatedUuids = [...new Set(related.map(identity))];
    const key = [code, uuid, ...relatedUuids.slice().sort()].join('\0');
    if (emitted.has(key)) return;
    emitted.add(key); diagnostics.push({ code, severity, message, uuid, ...(relatedUuids.length ? { relatedUuids } : {}) });
  };
  const byId = new Map<number, BinaryObject>();
  const uuidOwner = new Map<string, BinaryObject>();
  for (const object of objects) {
    if (byId.has(object.id)) report('DUPLICATE_OBJECT_ID', 'error', '바이너리 객체 식별자가 중복됩니다.', object, [byId.get(object.id)!]);
    byId.set(object.id, object);
    const uuid = text(object, 'UUID');
    if (uuid && uuidOwner.has(uuid)) report('DUPLICATE_UUID', 'error', '모델 UUID가 중복됩니다.', object, [uuidOwner.get(uuid)!]);
    if (uuid) uuidOwner.set(uuid, object);
  }
  const refIds = (value: BinaryValue | BinaryMapEntry | undefined): number[] => {
    if (Array.isArray(value)) return (value as BinaryValue[]).flatMap(refIds);
    if (value && typeof value === 'object') {
      if ('ref' in value) return [value.ref];
      if ('value' in value) return refIds(value.value as BinaryValue);
    }
    return [];
  };
  const refs = (object: BinaryObject | undefined, key: string) => refIds(field(object, key)).map(id => byId.get(id)).filter((o): o is BinaryObject => !!o);
  const ref = (object: BinaryObject | undefined, key: string) => refs(object, key)[0];
  const excludedTransient = new Set<number>();
  const type = (name: string) => objects.filter(o => !excludedTransient.has(o.id) && o.class.packageUri === CORE && o.class.name === name);
  const root = document.graph.roots.map(id => id === null ? undefined : byId.get(id)).find(o => o?.class.name === 'Document');
  if (!root) report('MISSING_DOCUMENT_ROOT', 'error', '유효한 Document 루트 객체가 없습니다.', undefined);
  const persistent = new Set<number>(), transient = new Set<number>();
  function walkContainment(seeds: number[], visited: Set<number>, includeTransient: boolean) {
    const stack = [...seeds];
    while (stack.length) {
      const id = stack.pop()!; if (visited.has(id)) continue;
      visited.add(id); const object = byId.get(id); if (!object) continue;
      const schema = definitions.get(object.class.packageUri + '#' + object.class.name);
      for (const feature of object.features) {
        const definition = schema?.find(f => f.name === feature.name);
        if (definition?.containment && (includeTransient || !definition.transient && !definition.derived)) stack.push(...refIds(feature.value));
      }
    }
  }
  walkContainment(document.graph.roots.filter((id): id is number => id !== null), persistent, false);
  for (const object of objects) {
    const schema = definitions.get(object.class.packageUri + '#' + object.class.name);
    for (const feature of object.features) {
      const definition = schema?.find(f => f.name === feature.name);
      if (definition?.containment && (definition.transient || definition.derived)) walkContainment(refIds(feature.value), transient, true);
    }
  }
  for (const id of transient) if (!persistent.has(id)) excludedTransient.add(id);
  const containmentOwners = new Map<number, BinaryObject>();
  for (const object of objects) {
    if (excludedTransient.has(object.id)) continue;
    if (object.proxy) report('EXTERNAL_PROXY_UNVERIFIED', 'warning', '외부 proxy 참조의 대상과 사용 가능 여부는 별도 확인이 필요합니다.', object);
    const schema = definitions.get(object.class.packageUri + '#' + object.class.name);
    for (const feature of object.features) {
      const definition = schema?.find(f => f.name === feature.name);
      for (const id of refIds(feature.value)) {
        const target = byId.get(id);
        if (!target) { report('ORPHAN_REFERENCE', 'error', `${feature.name} 속성이 존재하지 않는 객체를 참조합니다.`, object); continue; }
        if (definition?.containment && !definition.transient && !definition.derived) {
          const previous = containmentOwners.get(id);
          if (previous) report('MULTIPLE_CONTAINMENT_OWNERS', 'error', '하나의 객체가 여러 포함 위치에 중복 소유됩니다.', target, [previous, object]);
          else containmentOwners.set(id, object);
        }
      }
    }
  }
  const tables = type('Table'), columns = type('Column'), domains = type('Domain');
  const tableSchema = new Map<number, BinaryObject>(), columnTable = new Map<number, BinaryObject>(), groupTable = new Map<number, BinaryObject>();
  const label = (object: BinaryObject) => (text(object, 'physicalName') || text(object, 'name') || text(object, 'logicalName')).trim();
  function duplicateNames(children: BinaryObject[], owner: BinaryObject, code: string, message: string) {
    const seen = new Map<string, BinaryObject>();
    for (const child of children) {
      const name = label(child); if (!name) continue;
      const prior = seen.get(name);
      if (prior && prior.id !== child.id) report(code, 'error', message, child, [prior, owner]);
      else seen.set(name, child);
    }
  }
  for (const schema of type('Schema')) {
    const children = refs(schema, 'tables');
    duplicateNames(children, schema, 'DUPLICATE_TABLE_NAME', '같은 스키마에 동일한 테이블 이름이 있습니다.');
    for (const table of children) {
      if (table.class.name !== 'Table' || table.class.packageUri !== CORE) report('INVALID_SCHEMA_TABLE', 'error', '스키마의 tables 목록에 테이블이 아닌 객체가 있습니다.', schema, [table]);
      tableSchema.set(table.id, schema);
    }
  }
  const keyTypes = new Set(['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup', 'InversionEntryColumnGroup', 'ForeignKeyColumnGroup', 'LogicalColumnGroup']);
  for (const table of tables) {
    if (!tableSchema.has(table.id)) report('TABLE_WITHOUT_SCHEMA', 'error', '테이블을 소유한 스키마를 찾지 못했습니다.', table);
    const children = refs(table, 'columns'), groups = refs(table, 'columnGroups');
    duplicateNames(children, table, 'DUPLICATE_COLUMN_NAME', '같은 테이블에 동일한 컬럼 이름이 있습니다.');
    if (!children.length) report('EMPTY_TABLE', 'warning', '테이블에 컬럼이 없습니다. 작성 중인 모델인지 확인해 주세요.', table);
    for (const column of children) {
      if (column.class.name !== 'Column' || column.class.packageUri !== CORE) report('INVALID_TABLE_COLUMN', 'error', 'columns 목록에 컬럼이 아닌 객체가 있습니다.', table, [column]);
      columnTable.set(column.id, table);
    }
    for (const group of groups) {
      if (!keyTypes.has(group.class.name) || group.class.packageUri !== CORE) report('INVALID_COLUMN_GROUP', 'error', 'columnGroups 목록에 지원되는 컬럼 그룹이 아닌 객체가 있습니다.', table, [group]);
      groupTable.set(group.id, table);
    }
    const primaryKeys = groups.filter(group => group.class.name === 'PrimaryKeyColumnGroup');
    if (!primaryKeys.length) report('MISSING_PRIMARY_KEY', 'warning', '기본키가 없습니다. 설계 의도를 확인해 주세요.', table);
    if (primaryKeys.length > 1) report('MULTIPLE_PRIMARY_KEYS', 'error', '한 테이블에 기본키 그룹이 여러 개 있습니다.', table, primaryKeys);
  }
  for (const object of [...tables, ...columns]) {
    if (!label(object)) report('EMPTY_NAME', 'warning', '논리명과 물리명이 모두 비어 있습니다.', object);
    if (object.class.name === 'Column' && !columnTable.has(object.id)) report('COLUMN_WITHOUT_TABLE', 'error', '컬럼을 소유한 테이블을 찾지 못했습니다.', object);
  }
  const domainParent = new Map<number, BinaryObject>();
  for (const domain of domains) for (const child of refs(domain, 'domain')) {
    if (child.class.name !== 'Domain' || child.class.packageUri !== CORE) report('INVALID_DOMAIN_CHILD', 'error', '도메인 하위 목록에 도메인이 아닌 객체가 있습니다.', domain, [child]);
    domainParent.set(child.id, domain);
  }
  const visited = new Set<number>();
  for (const domain of domains) {
    if (visited.has(domain.id)) continue;
    const path: BinaryObject[] = [], at = new Map<number, number>(); let current: BinaryObject | undefined = domain;
    while (current && !visited.has(current.id)) {
      if (at.has(current.id)) { const cycle = path.slice(at.get(current.id)!); report('DOMAIN_CYCLE', 'error', '도메인 포함 계층이 순환합니다.', current, cycle); break; }
      at.set(current.id, path.length); path.push(current); current = domainParent.get(current.id);
    }
    for (const item of path) visited.add(item.id);
  }
  function effectiveType(column: BinaryObject): string {
    const own = field(column, 'dataType'); if (typeof own === 'string') return own.trim();
    let domain: BinaryObject | undefined = ref(column, 'domain'); const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) {
      seen.add(domain.id); const result = field(domain, 'suggestedDataType'); if (typeof result === 'string') return result.trim();
      domain = domainParent.get(domain.id);
    }
    return '';
  }
  const members = new Map<number, Array<{ column: BinaryObject; membership: BinaryObject; index: number }>>();
  for (const column of columns) {
    const domain = ref(column, 'domain');
    if (domain && (domain.class.name !== 'Domain' || domain.class.packageUri !== CORE)) report('INVALID_COLUMN_DOMAIN', 'error', '컬럼의 domain 참조가 도메인이 아닙니다.', column, [domain]);
    if (!effectiveType(column)) report('COLUMN_TYPE_UNSPECIFIED', 'warning', '컬럼과 연결 도메인에서 자료형을 확인하지 못했습니다.', column);
    for (const entry of refs(column, 'memberships')) {
      const membership = ref(entry, 'value'), entryGroup = ref(entry, 'key');
      if (!membership) { report('MISSING_MEMBERSHIP_VALUE', 'error', '컬럼 그룹 멤버십 값이 없습니다.', column, [entry]); continue; }
      const group = ref(membership, 'group') ?? entryGroup;
      if (!group) { report('MISSING_MEMBERSHIP_GROUP', 'error', '멤버십의 컬럼 그룹을 찾지 못했습니다.', column, [membership]); continue; }
      if (entryGroup && entryGroup.id !== group.id) report('MEMBERSHIP_GROUP_MISMATCH', 'error', '멤버십 key와 group이 서로 다른 그룹을 가리킵니다.', membership, [entryGroup, group]);
      if (columnTable.get(column.id)?.id !== groupTable.get(group.id)?.id || !groupTable.has(group.id)) report('MEMBERSHIP_TABLE_MISMATCH', 'error', '컬럼과 키 그룹의 소유 테이블이 다릅니다.', column, [group]);
      if (group.class.name === 'PrimaryKeyColumnGroup' && membership.class.name !== 'PrimaryKeyMembership') report('PRIMARY_KEY_MEMBERSHIP_TYPE', 'error', '기본키 그룹에 기본키가 아닌 멤버십이 연결돼 있습니다.', column, [group, membership]);
      if (group.class.name === 'ForeignKeyColumnGroup' && membership.class.name !== 'ColumnReference') report('FOREIGN_KEY_MEMBERSHIP_TYPE', 'error', '외래키 그룹에 컬럼 참조가 아닌 멤버십이 연결돼 있습니다.', column, [group, membership]);
      const list = members.get(group.id) ?? [];
      if (list.some(item => item.column.id === column.id)) report('DUPLICATE_KEY_COLUMN', 'error', '같은 컬럼이 하나의 키 그룹에 중복 연결돼 있습니다.', column, [group]);
      const rawIndex = field(membership, 'entryIndex'), index = typeof rawIndex === 'number' ? rawIndex : -1;
      // Equal stored indices occur in valid original PK/FK models. Membership
      // order is a derived runtime concern; do not invent a uniqueness rule.
      list.push({ column, membership, index }); members.set(group.id, list);
    }
  }
  for (const group of type('PrimaryKeyColumnGroup')) if (!members.get(group.id)?.length) report('EMPTY_PRIMARY_KEY', 'warning', '기본키 그룹에 연결된 컬럼이 없습니다.', group);
  const normalType = (type: string) => type.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1');
  for (const group of type('ForeignKeyColumnGroup')) {
    const parentGroup = ref(group, 'parentColumnGroup'), childTable = groupTable.get(group.id);
    if (!parentGroup || !['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup'].includes(parentGroup.class.name)) {
      report('INVALID_FOREIGN_KEY_PARENT_KEY', 'error', '외래키가 유효한 부모 기본키 또는 대체키를 참조하지 않습니다.', group, parentGroup ? [parentGroup] : []); continue;
    }
    const parentTable = groupTable.get(parentGroup.id), childMembers = members.get(group.id) ?? [], parentMembers = members.get(parentGroup.id) ?? [];
    if (!childTable || !parentTable) report('FOREIGN_KEY_TABLE_MISSING', 'error', '외래키의 부모 또는 자식 테이블 소속을 확인하지 못했습니다.', group);
    if (childMembers.length !== parentMembers.length) report('FOREIGN_KEY_LENGTH_MISMATCH', 'error', '부모키와 외래키의 구성 컬럼 수가 다릅니다.', group, [parentGroup]);
    const mappedParents = new Set<number>();
    for (const member of childMembers) {
      const parentColumn = ref(member.membership, 'parentColumn');
      if (!parentColumn || parentColumn.class.name !== 'Column') { report('FOREIGN_KEY_PARENT_COLUMN_MISSING', 'error', '외래키 멤버십에 유효한 부모 컬럼이 없습니다.', member.membership, [group]); continue; }
      if (columnTable.get(parentColumn.id)?.id !== parentTable?.id || !parentMembers.some(item => item.column.id === parentColumn.id)) report('FOREIGN_KEY_PARENT_COLUMN_MISMATCH', 'error', '부모 컬럼이 참조한 부모키의 구성 컬럼이 아닙니다.', member.membership, [group, parentColumn]);
      if (mappedParents.has(parentColumn.id)) report('FOREIGN_KEY_DUPLICATE_PARENT_COLUMN', 'error', '외래키의 여러 컬럼이 동일한 부모키 컬럼에 대응합니다.', group, [parentColumn]);
      mappedParents.add(parentColumn.id);
      const childType = effectiveType(member.column), parentType = effectiveType(parentColumn);
      if (childType && parentType && normalType(childType) !== normalType(parentType)) report('FOREIGN_KEY_TYPE_UNVERIFIED', 'warning', '외래키 양끝의 자료형이 다릅니다. 별칭·길이·암묵 변환·비교 연산자 호환성은 대상 DB에서 확인해야 합니다.', member.column, [parentColumn, group]);
    }
  }
  const diagramEntries = new Set<number>();
  for (const area of type('BusinessArea')) for (const diagram of refs(area, 'diagrams')) {
    if (diagram.class.name !== 'Diagram' || diagram.class.packageUri !== CORE) report('INVALID_BUSINESS_AREA_DIAGRAM', 'error', '업무영역의 diagrams 목록에 다이어그램이 아닌 객체가 있습니다.', area, [diagram]);
  }
  for (const diagram of type('Diagram')) {
    for (const relation of refs(diagram, 'filteredRelations')) if (relation.class.name !== 'Relation' || relation.class.packageUri !== CORE) report('INVALID_DIAGRAM_RELATION_REFERENCE', 'error', '다이어그램의 숨긴 관계 목록에 관계가 아닌 객체가 있습니다.', diagram, [relation]);
    for (const entry of refs(diagram, 'diagramEntry')) {
    diagramEntries.add(entry.id);
    if (!['TableDiagram', 'Note'].includes(entry.class.name) || entry.class.packageUri !== CORE) report('INVALID_DIAGRAM_ENTRY', 'error', '다이어그램 표시 목록에 지원되는 배치·메모가 아닌 객체가 있습니다.', diagram, [entry]);
    if (entry.class.name === 'TableDiagram') {
      const table = ref(entry, 'table');
      if (!table || table.class.name !== 'Table' || table.class.packageUri !== CORE) report('INVALID_DIAGRAM_TABLE_REFERENCE', 'error', '테이블 배치의 table 참조가 유효하지 않습니다.', entry, table ? [table] : []);
    }
    }
  }
  for (const placement of type('TableDiagram')) if (!diagramEntries.has(placement.id)) report('PLACEMENT_WITHOUT_DIAGRAM', 'error', '테이블 배치를 소유한 다이어그램을 찾지 못했습니다.', placement);
  return diagnostics;
}
