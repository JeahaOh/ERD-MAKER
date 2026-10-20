import type { BinaryGraph, BinaryObject, BinaryReference, BinaryValue } from './binary';
import { rebuildNativeDocument, nativeGraph } from './create';
import type { NativeExerdDocument } from './native-document';
import { editForeignKeyOptions } from './foreign-key-options';

export type NativeSortType = 'ASC' | 'DESC';
export type NativeCardinality = 'ZERO_OR_MORE' | 'ONE_OR_MORE' | 'ZERO_OR_ONE' | 'EXACTLY_ONE';
export type NativeCommand =
  | { type: 'addColumn'; tableUuid: string; name: string; logicalName?: string; dataType?: string; nullable?: boolean; defaultValue?: string }
  | { type: 'removeColumn'; columnUuid: string; cascade?: boolean }
  | { type: 'reorderColumns'; tableUuid: string; columnUuids: string[] }
  | { type: 'setPrimaryKey'; tableUuid: string; columnUuids: string[]; cascade?: boolean }
  | { type: 'addRelationship'; name: string; parentTableUuid: string; childTableUuid: string; parentColumnUuids: string[]; childColumnUuids: string[]; identifying?: boolean; parentCardinality?: NativeCardinality; childCardinality?: NativeCardinality }
  | { type: 'editRelationship'; foreignKeyUuid: string; parentKeyUuid?: string; childColumnUuids?: string[]; identifying?: boolean; parentCardinality?: NativeCardinality; childCardinality?: NativeCardinality }
  | { type: 'removeRelationship'; foreignKeyUuid: string; cascade?: boolean }
  | { type: 'editForeignKeyOptions'; foreignKeyUuid: string; values: Record<string, string | null> }
  | { type: 'setTermDictionaryPath'; path: string | null }
  | { type: 'applyNamingPolicy'; changes: Array<{ uuid: string; before: string; after: string; logicalName: string }> }
  | { type: 'removeTable'; tableUuid: string; cascade?: boolean }
  | { type: 'addDiagram'; businessAreaUuid: string; name: string; tableUuids?: string[] }
  | { type: 'duplicateDiagram'; diagramUuid: string; name: string }
  | { type: 'setRelationshipVisibility'; diagramUuid: string; foreignKeyUuid: string; visible: boolean }
  | { type: 'addDomain'; name: string; dataType?: string; parentDomainUuid?: string; defaultValue?: string; nullable?: boolean }
  | { type: 'setColumnDomain'; columnUuid: string; domainUuid: string | null; inherit?: boolean }
  | { type: 'addColumnGroup'; tableUuid: string; kind: 'unique' | 'index'; name: string; columnUuids: string[]; sortTypes?: NativeSortType[] }
  | { type: 'removeColumnGroup'; groupUuid: string; cascade?: boolean }
  | { type: 'reorderGroupMembers'; groupUuid: string; columnUuids: string[]; sortTypes?: NativeSortType[] }
  | { type: 'addCheckConstraint'; tableUuid: string; name: string; expression: string }
  | { type: 'removeCheckConstraint'; constraintUuid: string }
  | { type: 'addNote'; diagramUuid: string; text: string; x?: number; y?: number; width?: number; height?: number; targetPlacementUuid?: string }
  | { type: 'editNote'; noteUuid: string; text?: string; x?: number; y?: number; width?: number; height?: number; targetPlacementUuid?: string | null }
  | { type: 'removeNote'; noteUuid: string; cascade?: boolean }
  | { type: 'renameSchema'; schemaUuid: string; name: string; logicalName?: string }
  | { type: 'addSchema'; name: string; logicalName?: string }
  | { type: 'addBusinessArea'; name: string }
  | { type: 'removeDiagram'; diagramUuid: string; cascade?: boolean };

export class NativeDependencyError extends Error {
  constructor(public readonly dependencies: string[]) { super(`참조 중인 객체가 있어 변경할 수 없습니다: ${dependencies.join(', ')}. 종속 항목 삭제에는 cascade:true가 필요합니다.`); this.name = 'NativeDependencyError'; }
}
const { field, uuid, reference, set, object, push, definitions, viewSettings } = nativeGraph;
const refs = (v: BinaryValue | undefined): BinaryReference[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).filter(v => typeof v === 'object' && v !== null && 'ref' in v) as BinaryReference[];
const list = (o: BinaryObject, name: string) => refs(field(o, name));
const has = (o: BinaryObject, name: string, id: number) => list(o, name).some(r => r.ref === id);
const unset = (o: BinaryObject, name: string) => { o.features = o.features.filter(f => f.name !== name); };
const requiredName = (name: string) => { if (!name.trim()) throw new Error('이름이 필요합니다.'); return name.trim(); };
const equalIds = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i]);

function expressionMentions(expression: string, name: string): boolean {
  // CHECK expressions are lexical SQL, not EObject references. Ignore strings/comments and function names.
  let i = 0;
  while (i < expression.length) {
    if (expression.startsWith('--', i)) { const end = expression.indexOf('\n', i + 2); i = end < 0 ? expression.length : end + 1; continue; }
    if (expression.startsWith('/*', i)) { let depth = 1; i += 2; while (i < expression.length && depth) { if (expression.startsWith('/*', i)) { depth++; i += 2; } else if (expression.startsWith('*/', i)) { depth--; i += 2; } else i++; } continue; }
    const dollar = /^\$(?:[A-Za-z_]\w*)?\$/.exec(expression.slice(i));
    if (dollar) { const end = expression.indexOf(dollar[0], i + dollar[0].length); i = end < 0 ? expression.length : end + dollar[0].length; continue; }
    const char = expression[i];
    if ((char === 'q' || char === 'Q') && expression[i + 1] === "'" && i + 2 < expression.length) { const begin = expression[i + 2], endChar = ({ '[': ']', '(': ')', '{': '}', '<': '>' } as Record<string, string>)[begin] ?? begin; const end = expression.indexOf(endChar + "'", i + 3); i = end < 0 ? expression.length : end + 2; continue; }
    if (char === "'") { i++; while (i < expression.length) { const c = expression[i++]; if (c === '\\' && i < expression.length) i++; else if (c === "'") { if (expression[i] === "'") i++; else break; } } continue; }
    if (char === '"' || char === '`' || char === '[') {
      const end = char === '[' ? ']' : char; i++; let value = '';
      while (i < expression.length) { const c = expression[i++]; if (c === end) { if (expression[i] === end) { value += end; i++; } else break; } else value += c; }
      if (value === name) return true; continue;
    }
    const match = /^[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*/.exec(expression.slice(i));
    if (match) { i += match[0].length; if (match[0].toLowerCase() === name.toLowerCase() && !/^\s*\(/.test(expression.slice(i))) return true; } else i++;
  }
  return false;
}
function coordinate(value: number): number { if (!Number.isFinite(value) || value < -2147483648 || value > 2147483647) throw new Error('좌표가 32비트 정수 범위를 벗어났습니다.'); return Math.trunc(value); }
function pointValues(value: BinaryValue | undefined, fallback: number[]): number[] { const match = typeof value === 'string' ? /^(?:Point|Dimension)\(\s*([^,]+),\s*([^\)]+)\)$/.exec(value) : null; return match && Number.isFinite(Number(match[1])) && Number.isFinite(Number(match[2])) ? [Number(match[1]), Number(match[2])] : fallback; }

class Editor {
  graph: BinaryGraph;
  private idIndex: Map<number, BinaryObject>;
  private ownership = new Map<number, { owner: BinaryObject; feature: string }>();
  constructor(document: NativeExerdDocument) {
    this.graph = structuredClone(document.graph); this.idIndex = new Map(this.graph.objects.map(o => [o.id, o]));
    for (const o of this.graph.objects) for (const f of o.features) if (definitions(o)?.find(d => d.name === f.name)?.containment) for (const ref of refs(f.value)) this.ownership.set(ref.ref, { owner: o, feature: f.name });
  }
  byId(id: number) { const result = this.idIndex.get(id) ?? this.graph.objects.find(o => o.id === id); if (result) this.idIndex.set(id, result); if (!result) throw new Error(`모델 객체가 없습니다: ${id}`); return result; }
  get(id: string, type?: string) { const result = this.graph.objects.find(o => uuid(o) === id); if (!result || type && result.class.name !== type) throw new Error(`${type ?? '모델 객체'}를 찾지 못했습니다: ${id}`); return result; }
  all(type: string) { return this.graph.objects.filter(o => o.class.name === type); }
  objects(o: BinaryObject, name: string) { return list(o, name).map(r => this.byId(r.ref)); }
  owner(child: BinaryObject, name?: string) { const known = this.ownership.get(child.id); if (known && (!name || known.feature === name)) return known.owner; return this.graph.objects.find(o => o.features.some(f => (!name || f.name === name) && definitions(o)?.find(d => d.name === f.name)?.containment && refs(f.value).some(r => r.ref === child.id))); }
  columns(table: BinaryObject) { return this.objects(table, 'columns'); }
  usedGroupName(table: BinaryObject, name: string) { return [...this.objects(table, 'columnGroups'), ...this.objects(table, 'checkConstraints')].some(o => field(o, 'physicalName') === name || o.features.some(f => ['primaryKeyConstraint', 'foreignKeyConstraint', 'uniqueConstraint'].includes(f.name) && refs(f.value).some(r => field(this.byId(r.ref), 'physicalName') === name))); }
  selectedColumns(table: BinaryObject, ids: string[]) {
    if (new Set(ids).size !== ids.length) throw new Error('컬럼 목록에 중복 식별자가 있습니다.');
    return ids.map(id => { const c = this.get(id, 'Column'); if (!has(table, 'columns', c.id)) throw new Error('선택한 테이블에 속하지 않은 컬럼입니다.'); return c; });
  }
  groupMembers(group: BinaryObject) {
    const table = this.owner(group, 'columnGroups');
    const columns = table ? this.columns(table) : [];
    return columns.flatMap(column => this.objects(column, 'memberships').filter(entry => has(entry, 'key', group.id)).map(entry => ({ column, entry, membership: this.objects(entry, 'value')[0] })))
      .sort((a, b) => Number(field(a.membership, 'entryIndex') ?? -1) - Number(field(b.membership, 'entryIndex') ?? -1));
  }
  primary(table: BinaryObject) { return this.objects(table, 'columnGroups').find(g => g.class.name === 'PrimaryKeyColumnGroup'); }
  foreignTo(group: BinaryObject) { return this.all('ForeignKeyColumnGroup').filter(g => has(g, 'parentColumnGroup', group.id)); }
  /** Remove an explicitly selected containment subtree; reject unexplained external refs. */
  erase(roots: BinaryObject[], cascade = false) {
    const doomed = new Set<number>();
    const include = (o: BinaryObject) => { if (doomed.has(o.id)) return; doomed.add(o.id); for (const f of o.features) if (definitions(o)?.find(d => d.name === f.name)?.containment) refs(f.value).forEach(r => include(this.byId(r.ref))); };
    roots.forEach(include);
    let added = true;
    while (added) { added = false; for (const note of this.all('Note')) if (!doomed.has(note.id) && list(note, 'target').some(r => doomed.has(r.ref))) { if (!cascade) throw new NativeDependencyError([`Note:${uuid(note)}`]); include(note); added = true; } }
    const unexpected: string[] = [];
    for (const o of this.graph.objects) if (!doomed.has(o.id)) for (const f of o.features) {
      if (!refs(f.value).some(r => doomed.has(r.ref))) continue;
      const def = definitions(o)?.find(d => d.name === f.name);
      const knownIndex = o.class.name === 'BusinessArea' && f.name === 'tables' || o.class.name === 'Diagram' && f.name === 'filteredRelations';
      if (!def?.containment && !knownIndex) { unexpected.push(`${o.class.name}.${f.name}:${uuid(o) ?? o.id}`); continue; }
    }
    if (unexpected.length) throw new NativeDependencyError(unexpected);
    for (const o of this.graph.objects) if (!doomed.has(o.id)) for (const f of [...o.features]) {
      if (!refs(f.value).some(r => doomed.has(r.ref))) continue;
      if (Array.isArray(f.value)) f.value = refs(f.value).filter(r => !doomed.has(r.ref)); else unset(o, f.name);
    }
    this.graph.objects = this.graph.objects.filter(o => !doomed.has(o.id));
    for (const id of doomed) { this.idIndex.delete(id); this.ownership.delete(id); }
  }
  removeRelationship(group: BinaryObject, cascade = false) {
    const entries = this.all('MembershipEntry').filter(e => has(e, 'key', group.id));
    const relationEntries = this.all('RelationEntry').filter(e => has(e, 'key', group.id));
    this.erase([group, ...entries, ...relationEntries], cascade);
  }
  normalize(group: BinaryObject) { this.groupMembers(group).forEach(({ membership }, index) => set(membership, 'entryIndex', index)); }
  setPrimary(table: BinaryObject, columns: BinaryObject[], cascade = false) {
    let group = this.primary(table);
    if (!group) { group = object(this.graph, 'PrimaryKeyColumnGroup', { physicalName: `pk_${field(table, 'physicalName')}` }); set(group, 'primaryKeyConstraint', reference(object(this.graph, 'PrimaryKeyConstraint', { physicalName: `pk_${field(table, 'physicalName')}` }))); push(table, 'columnGroups', group); }
    const invalidParents = this.foreignTo(group).filter(fk => {
      const refs = this.groupMembers(fk).map(m => this.objects(m.membership, 'parentColumn')[0]?.id);
      return refs.length !== columns.length || refs.some(id => !columns.some(c => c.id === id));
    });
    const invalidChildren = this.objects(table, 'columnGroups').filter(g => g.class.name === 'ForeignKeyColumnGroup' && this.all('Relation').some(r => has(r, 'foreignKeyColumnGroup', g.id) && field(r, 'identifying') === true) && this.groupMembers(g).some(m => !columns.some(c => c.id === m.column.id)));
    const invalid = [...new Set([...invalidParents, ...invalidChildren])];
    if (invalid.length && !cascade) throw new NativeDependencyError(invalid.map(g => `ForeignKeyColumnGroup:${uuid(g)}`));
    invalid.forEach(g => this.removeRelationship(g, cascade));
    const previous = this.groupMembers(group);
    this.erase(previous.filter(m => !columns.some(c => c.id === m.column.id)).map(m => m.entry));
    columns.forEach((column, index) => {
      const existing = previous.find(m => m.column.id === column.id);
      if (existing) set(existing.membership, 'entryIndex', index);
      else {
        const membership = object(this.graph, 'PrimaryKeyMembership', { group: reference(group!), entryIndex: index, sortType: 'ASC' });
        const entry = object(this.graph, 'MembershipEntry', { key: reference(group!), value: reference(membership) });
        push(column, 'memberships', entry);
      }
      set(column, 'notNull', 'TRUE');
    });
    for (const fk of this.foreignTo(group)) for (const m of this.groupMembers(fk)) { const parent = this.objects(m.membership, 'parentColumn')[0]; set(m.membership, 'entryIndex', columns.findIndex(c => c.id === parent.id)); }
  }
  columnType(column: BinaryObject) {
    const own = field(column, 'dataType'); if (typeof own === 'string') return own.replace(/\s+/g, '').toUpperCase();
    let domain = this.objects(column, 'domain')[0]; const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) { seen.add(domain.id); const value = field(domain, 'suggestedDataType'); if (typeof value === 'string') return value.replace(/\s+/g, '').toUpperCase(); const parent = this.owner(domain); domain = parent?.class.name === 'Domain' ? parent : undefined!; }
    return '';
  }
  apply(command: NativeCommand) {
    switch (command.type) {
      case 'editForeignKeyOptions': editForeignKeyOptions(this.graph, command.foreignKeyUuid, command.values); return;
      case 'setTermDictionaryPath': {
        const configuration = this.objects(this.all('Document')[0], 'configuration')[0];
        if (!configuration) throw new Error('모델 설정이 없습니다.');
        if (command.path === null) unset(configuration, 'termFilePath');
        else { if (!command.path.trim()) throw new Error('사전 경로가 필요합니다.'); set(configuration, 'termFilePath', command.path.trim()); }
        return;
      }
      case 'applyNamingPolicy': {
        if (!command.changes.length || new Set(command.changes.map(c => c.uuid)).size !== command.changes.length) throw new Error('이름 변경 목록이 비어 있거나 중복됐습니다.');
        for (const change of command.changes) {
          const target = this.get(change.uuid);
          if (!['Table', 'Column'].includes(target.class.name) || String(field(target, 'physicalName') || field(target, 'name') || field(target, 'logicalName') || '') !== change.before || String(field(target, 'logicalName') || '') !== change.logicalName) throw new Error('미리보기 후 모델이 변경됐습니다. 이름 변환을 다시 검토하세요.');
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(change.after)) throw new Error('물리명은 영문자·숫자·밑줄로 지정하고 영문자 또는 밑줄로 시작하세요.');
          set(target, 'physicalName', change.after); set(target, 'derivedPhysicalName', false);
        }
        for(const change of command.changes.filter(c=>c.before!==c.after))for(const object of this.graph.objects.filter(o=>/(?:View|Function|Procedure|Trigger)$/.test(o.class.name))){
          if(object.features.some(f=>f.kind==='STRING'&&!['UUID','physicalName','logicalName','name','comment'].includes(f.name)&&typeof f.value==='string'&&f.value.toUpperCase().includes(change.before.toUpperCase())))throw new Error('SQL 정의가 변경할 이름을 포함합니다. 뷰·함수·프로시저·트리거 정의를 먼저 검토하세요. 자동 치환하지 않습니다.');
        }
        for (const schema of this.all('Schema')) {
          const tables = this.objects(schema, 'tables');
          if (new Set(tables.map(t => String(field(t, 'physicalName')).toUpperCase())).size !== tables.length) throw new Error('같은 스키마에 물리명이 충돌하는 테이블이 있습니다.');
        }
        for (const table of this.all('Table')) {
          const columns = this.columns(table);
          if (new Set(columns.map(c => String(field(c, 'physicalName')).toUpperCase())).size !== columns.length) throw new Error('같은 테이블에 물리명이 충돌하는 컬럼이 있습니다.');
          const renamed = command.changes.filter(c => columns.some(column => uuid(column) === c.uuid) && c.before !== c.after);
          if (renamed.some(c => this.objects(table, 'checkConstraints').some(check => expressionMentions(String(field(check, 'expression') || ''), c.before)))) throw new Error('CHECK 표현식이 이름 변경 컬럼을 참조합니다. 표현식을 먼저 검토하세요. 자동 치환하지 않습니다.');
        }
        return;
      }
      case 'addColumn': {
        const table = this.get(command.tableUuid, 'Table'), name = requiredName(command.name);
        if (this.columns(table).some(c => field(c, 'physicalName') === name)) throw new Error('같은 물리명의 컬럼이 있습니다.');
        const column = object(this.graph, 'Column', { physicalName: name, logicalName: command.logicalName ?? name, dataType: requiredName(command.dataType ?? 'VARCHAR(255)'), notNull: command.nullable === false ? 'TRUE' : 'FALSE' });
        if (command.defaultValue !== undefined) set(column, 'defaultValue', command.defaultValue); push(table, 'columns', column); return;
      }
      case 'removeColumn': {
        const column = this.get(command.columnUuid, 'Column');
        const owner = this.owner(column, 'columns');
        const checks = owner ? this.objects(owner, 'checkConstraints').filter(c => expressionMentions(String(field(c, 'expression') ?? ''), String(field(column, 'physicalName')))) : [];
        if (checks.length && !command.cascade) throw new NativeDependencyError(checks.map(c => `CheckConstraint:${uuid(c)}`));
        if (checks.length) this.erase(checks);
        const memberships = this.objects(column, 'memberships');
        const incoming = this.all('ColumnReference').filter(m => has(m, 'parentColumn', column.id)).map(m => this.objects(m, 'group')[0]);
        const groups = [...new Set([...memberships.map(e => this.objects(e, 'key')[0]), ...incoming])];
        if (groups.length && !command.cascade) throw new NativeDependencyError(groups.map(g => `${g.class.name}:${uuid(g)}`));
        for (const group of groups) {
          if (!this.graph.objects.some(o => o.id === group.id)) continue;
          if (group.class.name === 'ForeignKeyColumnGroup') this.removeRelationship(group, command.cascade);
          else if (group.class.name === 'PrimaryKeyColumnGroup') { for (const fk of this.foreignTo(group)) this.removeRelationship(fk, command.cascade); this.erase(this.groupMembers(group).filter(m => m.column.id === column.id).map(m => m.entry)); this.normalize(group); }
          else { for (const fk of this.foreignTo(group)) this.removeRelationship(fk, command.cascade); this.erase([group, ...this.groupMembers(group).map(m => m.entry)], command.cascade); }
        }
        this.erase([column], command.cascade); return;
      }
      case 'reorderColumns': {
        const table = this.get(command.tableUuid, 'Table'); const columns = this.selectedColumns(table, command.columnUuids);
        if (columns.length !== this.columns(table).length) throw new Error('컬럼 전체의 정확한 순열을 지정해야 합니다.');
        // Membership order is a separate key/index order. Stable ties use the OLD physical column order.
        const memberships = this.objects(table, 'columnGroups').map(g => this.groupMembers(g));
        set(table, 'columns', columns.map(reference));
        for (const members of memberships) members.forEach((m, index) => set(m.membership, 'entryIndex', index));
        return;
      }
      case 'setPrimaryKey': { const table = this.get(command.tableUuid, 'Table'); this.setPrimary(table, this.selectedColumns(table, command.columnUuids), command.cascade); return; }
      case 'addRelationship': {
        const parent = this.get(command.parentTableUuid, 'Table'), child = this.get(command.childTableUuid, 'Table');
        const parents = this.selectedColumns(parent, command.parentColumnUuids), children = this.selectedColumns(child, command.childColumnUuids), name = requiredName(command.name);
        if (!parents.length || parents.length !== children.length) throw new Error('부모·자식 컬럼을 같은 개수로 하나 이상 지정해야 합니다.');
        const parentGroup = this.objects(parent, 'columnGroups').find(g => ['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup'].includes(g.class.name) && equalIds(this.groupMembers(g).map(m => m.column.id), parents.map(c => c.id)));
        if (!parentGroup) throw new Error('부모 컬럼 순서는 기존 PK 또는 고유키 컬럼 순서와 일치해야 합니다.');
        if (this.usedGroupName(child, name)) throw new Error('같은 이름의 컬럼 그룹이 있습니다.');
        if (parents.some((p, i) => !this.columnType(p) || this.columnType(p) !== this.columnType(children[i]))) throw new Error('부모·자식 컬럼의 자료형이 일치해야 합니다.');
        if (command.identifying) { const primary = this.primary(child); const current = primary ? this.groupMembers(primary).map(m => m.column) : []; this.setPrimary(child, [...current, ...children.filter(c => !current.some(m => m.id === c.id))]); }
        const group = object(this.graph, 'ForeignKeyColumnGroup', { logicalName: name, physicalName: name, parentColumnGroup: reference(parentGroup) });
        set(group, 'foreignKeyConstraint', reference(object(this.graph, 'ForeignKeyConstraint', { physicalName: name, logicalName: name }))); push(child, 'columnGroups', group);
        children.forEach((column, index) => {
          const membership = object(this.graph, 'ColumnReference', { group: reference(group), parentColumn: reference(parents[index]), entryIndex: index, sortType: 'ASC' });
          push(column, 'memberships', object(this.graph, 'MembershipEntry', { key: reference(group), value: reference(membership) }));
        });
        const cardinalities = new Set(['ZERO_OR_MORE', 'ONE_OR_MORE', 'ZERO_OR_ONE', 'EXACTLY_ONE']);
        if (!cardinalities.has(command.parentCardinality ?? 'EXACTLY_ONE') || !cardinalities.has(command.childCardinality ?? 'ZERO_OR_MORE')) throw new Error('관계 카디널리티가 올바르지 않습니다.');
        const relation = object(this.graph, 'Relation', { foreignKeyColumnGroup: reference(group), identifying: command.identifying ?? false, parentCardinalityType: command.parentCardinality ?? 'EXACTLY_ONE', childCardinalityType: command.childCardinality ?? 'ZERO_OR_MORE' });
        const manager = this.all('RelationManager')[0]; if (!manager) throw new Error('관계 관리자가 없습니다.');
        push(manager, 'relation', object(this.graph, 'RelationEntry', { key: reference(group), value: reference(relation) })); return;
      }
      case 'editRelationship': {
        const group = this.get(command.foreignKeyUuid, 'ForeignKeyColumnGroup'), child = this.owner(group, 'columnGroups');
        if (!child || child.class.name !== 'Table') throw new Error('외래키의 자식 테이블을 찾지 못했습니다.');
        const relations = this.all('Relation').filter(r => has(r, 'foreignKeyColumnGroup', group.id));
        if (relations.length !== 1) throw new Error('외래키에 대응하는 관계를 하나로 확인하지 못했습니다.');
        const relation = relations[0], cardinalities = new Set(['ZERO_OR_MORE', 'ONE_OR_MORE', 'ZERO_OR_ONE', 'EXACTLY_ONE']);
        for (const value of [command.parentCardinality, command.childCardinality]) if (value !== undefined && !cardinalities.has(value)) throw new Error('관계 카디널리티가 올바르지 않습니다.');
        if (command.identifying !== undefined && typeof command.identifying !== 'boolean') throw new Error('식별 관계 여부가 올바르지 않습니다.');
        const remap = command.parentKeyUuid !== undefined || command.childColumnUuids !== undefined;
        if (remap) {
          if (!command.parentKeyUuid || !command.childColumnUuids) throw new Error('부모 키와 자식 컬럼 대응을 함께 지정해야 합니다.');
          const parentKey = this.get(command.parentKeyUuid), parent = this.owner(parentKey, 'columnGroups');
          if (!parent || parent.class.name !== 'Table' || !['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup'].includes(parentKey.class.name)) throw new Error('부모 키는 기존 기본키 또는 고유키여야 합니다.');
          const parents = this.groupMembers(parentKey).map(m => m.column), children = this.selectedColumns(child, command.childColumnUuids);
          if (!parents.length || parents.length !== children.length) throw new Error('부모·자식 컬럼을 같은 개수로 하나 이상 지정해야 합니다.');
          if (parents.some((p, i) => !this.columnType(p) || this.columnType(p) !== this.columnType(children[i]))) throw new Error('부모·자식 컬럼의 자료형이 일치해야 합니다.');
          const previous = this.groupMembers(group), available = new Set(previous);
          // Prefer the existing parent mapping, then the same child, then an
          // existing slot. Preserve membership identities and physical options.
          const mappings = parents.map((parentColumn, index) => {
            const column = children[index];
            const old = [...available].find(m => has(m.membership, 'parentColumn', parentColumn.id)) ?? [...available].find(m => m.column.id === column.id) ?? [...available][0];
            if (old) available.delete(old);
            return { parentColumn, column, old, index };
          });
          this.erase([...available].map(m => m.entry));
          for (const { parentColumn, column, old, index } of mappings) {
            if (old) {
              if (old.column.id !== column.id) {
                set(old.column, 'memberships', list(old.column, 'memberships').filter(r => r.ref !== old.entry.id)); push(column, 'memberships', old.entry);
              }
              set(old.membership, 'parentColumn', reference(parentColumn)); set(old.membership, 'entryIndex', index);
            } else {
              const membership = object(this.graph, 'ColumnReference', { group: reference(group), parentColumn: reference(parentColumn), entryIndex: index, sortType: 'ASC' });
              push(column, 'memberships', object(this.graph, 'MembershipEntry', { key: reference(group), value: reference(membership) }));
            }
          }
          set(group, 'parentColumnGroup', reference(parentKey));
        }
        if (command.identifying === true || command.identifying === undefined && field(relation, 'identifying') === true && remap) {
          const primary = this.primary(child), current = primary ? this.groupMembers(primary).map(m => m.column) : [], children = this.groupMembers(group).map(m => m.column);
          const missing = children.filter(c => !current.some(m => m.id === c.id));
          if (missing.length) this.setPrimary(child, [...current, ...missing]);
        }
        if (command.identifying !== undefined) set(relation, 'identifying', command.identifying);
        if (command.parentCardinality !== undefined) set(relation, 'parentCardinalityType', command.parentCardinality);
        if (command.childCardinality !== undefined) set(relation, 'childCardinalityType', command.childCardinality);
        return;
      }
      case 'removeRelationship': this.removeRelationship(this.get(command.foreignKeyUuid, 'ForeignKeyColumnGroup'), command.cascade); return;
      case 'removeTable': {
        const table = this.get(command.tableUuid, 'Table'), columnIds = new Set(this.columns(table).map(c => c.id));
        const groups = this.all('ForeignKeyColumnGroup').filter(g => this.owner(g)?.id === table.id || this.groupMembers(g).some(m => this.objects(m.membership, 'parentColumn').some(c => columnIds.has(c.id))));
        if (groups.length && !command.cascade) throw new NativeDependencyError(groups.map(g => `ForeignKeyColumnGroup:${uuid(g)}`));
        groups.forEach(g => this.removeRelationship(g, command.cascade));
        const placements = this.all('TableDiagram').filter(p => has(p, 'table', table.id)); this.erase([table, ...placements], command.cascade); return;
      }
      case 'addDiagram': {
        const area = this.get(command.businessAreaUuid, 'BusinessArea'), name = requiredName(command.name);
        if (this.objects(area, 'diagrams').some(d => field(d, 'logicalName') === name)) throw new Error('같은 이름의 다이어그램이 있습니다.');
        const ids = command.tableUuids ?? []; if (new Set(ids).size !== ids.length) throw new Error('테이블 목록에 중복이 있습니다.');
        const tables = ids.map(id => this.get(id, 'Table'));
        const diagram = object(this.graph, 'Diagram', { logicalName: name, physicalName: name });
        set(diagram, 'viewSettings', reference(viewSettings(this.graph))); set(diagram, 'printSettings', reference(object(this.graph, 'PrintSettings', { paperKind: 'A4', paperOrientation: 'landscape' })));
        tables.forEach((table, i) => { push(diagram, 'diagramEntry', object(this.graph, 'TableDiagram', { table: reference(table), location: `Point(${100 + i % 4 * 300}, ${100 + Math.floor(i / 4) * 300})` })); if (!has(area, 'tables', table.id)) push(area, 'tables', table); });
        push(area, 'diagrams', diagram); push(this.all('Document')[0], 'openedDiagrams', diagram); return;
      }
      case 'setRelationshipVisibility': {
        const diagram = this.get(command.diagramUuid, 'Diagram'), group = this.get(command.foreignKeyUuid, 'ForeignKeyColumnGroup');
        if (typeof command.visible !== 'boolean') throw new Error('관계 표시 여부가 올바르지 않습니다.');
        const relations = this.all('Relation').filter(relation => has(relation, 'foreignKeyColumnGroup', group.id));
        if (relations.length !== 1) throw new Error('외래키에 대응하는 다이어그램 관계를 하나로 확인하지 못했습니다.');
        const relation = relations[0];
        if (command.visible) set(diagram, 'filteredRelations', list(diagram, 'filteredRelations').filter(r => r.ref !== relation.id));
        else {
          const parentGroup = this.objects(group, 'parentColumnGroup')[0], parent = parentGroup && this.owner(parentGroup, 'columnGroups'), child = this.owner(group, 'columnGroups');
          const placed = new Set(this.objects(diagram, 'diagramEntry').filter(o => o.class.name === 'TableDiagram').flatMap(o => list(o, 'table').map(r => r.ref)));
          if (!parent || !child || !placed.has(parent.id) || !placed.has(child.id)) throw new Error('관계 양쪽 테이블이 현재 다이어그램에 있어야 합니다.');
          if (!has(diagram, 'filteredRelations', relation.id)) push(diagram, 'filteredRelations', relation);
        }
        return;
      }
      case 'duplicateDiagram': {
        const source = this.get(command.diagramUuid, 'Diagram'), area = this.owner(source, 'diagrams'), name = requiredName(command.name);
        if (!area) throw new Error('다이어그램의 업무영역이 없습니다.');
        if (this.objects(area, 'diagrams').some(d => field(d, 'logicalName') === name)) throw new Error('같은 이름의 다이어그램이 있습니다.');
        const cloned = new Map<number, BinaryObject>();
        const clone = (o: BinaryObject): BinaryObject => { const result = object(this.graph, o.class.name, {}, o.class.packageUri, false); result.features = structuredClone(o.features); if (uuid(o)) set(result, 'UUID', `${o.class.name}_${crypto.randomUUID().replaceAll('-', '')}`); cloned.set(o.id, result); for (const f of o.features) if (definitions(o)?.find(d => d.name === f.name)?.containment) refs(f.value).forEach(r => clone(this.byId(r.ref))); return result; };
        const diagram = clone(source);
        for (const o of cloned.values()) for (const f of o.features) if (f.kind.startsWith('EOBJECT')) f.value = Array.isArray(f.value) ? refs(f.value).map(r => ({ ref: cloned.get(r.ref)?.id ?? r.ref })) : f.value === null ? null : { ref: cloned.get((f.value as BinaryReference).ref)?.id ?? (f.value as BinaryReference).ref };
        set(diagram, 'logicalName', name); set(diagram, 'physicalName', name); push(area, 'diagrams', diagram); push(this.all('Document')[0], 'openedDiagrams', diagram); return;
      }
      case 'addDomain': {
        const name = requiredName(command.name), parent = command.parentDomainUuid ? this.get(command.parentDomainUuid, 'Domain') : this.all('DomainDefinition')[0];
        if (!parent) throw new Error('도메인 정의가 없습니다.');
        if (this.objects(parent, 'domain').some(d => field(d, 'name') === name)) throw new Error('같은 이름의 도메인이 있습니다.');
        const domain = object(this.graph, 'Domain', { name }); if (command.dataType !== undefined) set(domain, 'suggestedDataType', command.dataType); if (command.defaultValue !== undefined) set(domain, 'suggestedDefaultValue', command.defaultValue); if (command.nullable !== undefined) set(domain, 'suggestedNotNull', command.nullable ? 'FALSE' : 'TRUE'); push(parent, 'domain', domain); return;
      }
      case 'setColumnDomain': {
        const column = this.get(command.columnUuid, 'Column');
        if (command.domainUuid === null) {
          let domain = this.objects(column, 'domain')[0]; const seen = new Set<number>();
          const inherited: Record<string, BinaryValue> = {};
          while (domain && !seen.has(domain.id)) { seen.add(domain.id); for (const [source, target] of [['suggestedDataType', 'dataType'], ['suggestedDefaultValue', 'defaultValue'], ['suggestedNotNull', 'notNull']]) { const v = field(domain, source); if (inherited[target] === undefined && v !== undefined && v !== null && v !== '') inherited[target] = v; } const parent = this.owner(domain); domain = parent?.class.name === 'Domain' ? parent : undefined!; }
          for (const [name, value] of Object.entries(inherited)) if (field(column, name) === undefined) set(column, name, value);
          unset(column, 'domain');
        } else { const domain = this.get(command.domainUuid, 'Domain'); set(column, 'domain', reference(domain)); if (command.inherit) { unset(column, 'dataType'); unset(column, 'defaultValue'); unset(column, 'notNull'); } }
        if (command.inherit && this.objects(column, 'memberships').some(e => this.objects(e, 'key')[0]?.class.name === 'PrimaryKeyColumnGroup')) set(column, 'notNull', 'TRUE');
        for (const group of this.all('ForeignKeyColumnGroup')) {
          for (const member of this.groupMembers(group)) {
            const parent = this.objects(member.membership, 'parentColumn')[0];
            if ((member.column.id === column.id || parent?.id === column.id) && this.columnType(member.column) !== this.columnType(parent)) throw new NativeDependencyError([`ForeignKeyColumnGroup:${uuid(group)}`]);
          }
        }
        return;
      }
      case 'addColumnGroup': {
        const table = this.get(command.tableUuid, 'Table'), name = requiredName(command.name), columns = this.selectedColumns(table, command.columnUuids);
        if (!columns.length) throw new Error('컬럼을 하나 이상 지정해야 합니다.');
        if (command.kind !== 'unique' && command.kind !== 'index') throw new Error('컬럼 그룹 종류가 올바르지 않습니다.');
        if (this.usedGroupName(table, name)) throw new Error('같은 이름의 컬럼 그룹이 있습니다.');
        const sorts = command.sortTypes ?? columns.map(() => 'ASC' as const);
        if (sorts.length !== columns.length || sorts.some(s => s !== 'ASC' && s !== 'DESC')) throw new Error('컬럼별 정렬 순서를 올바르게 지정해야 합니다.');
        const group = object(this.graph, command.kind === 'unique' ? 'AlternateKeyColumnGroup' : 'InversionEntryColumnGroup', { physicalName: name, logicalName: name });
        if (command.kind === 'unique') set(group, 'uniqueConstraint', reference(object(this.graph, 'UniqueConstraint', { physicalName: name, logicalName: name })));
        push(table, 'columnGroups', group);
        columns.forEach((column, index) => { const membership = object(this.graph, command.kind === 'unique' ? 'AlternateKeyMembership' : 'InversionEntryMembership', { group: reference(group), entryIndex: index, sortType: sorts[index] }); push(column, 'memberships', object(this.graph, 'MembershipEntry', { key: reference(group), value: reference(membership) })); });
        return;
      }
      case 'removeColumnGroup': {
        const group = this.get(command.groupUuid);
        if (!['AlternateKeyColumnGroup', 'InversionEntryColumnGroup'].includes(group.class.name)) throw new Error('PK/FK는 전용 명령으로 변경해야 합니다.');
        const incoming = this.foreignTo(group); if (incoming.length && !command.cascade) throw new NativeDependencyError(incoming.map(g => `ForeignKeyColumnGroup:${uuid(g)}`));
        incoming.forEach(g => this.removeRelationship(g, command.cascade)); this.erase([group, ...this.groupMembers(group).map(m => m.entry)], command.cascade); return;
      }
      case 'reorderGroupMembers': {
        const group = this.get(command.groupUuid);
        if (!['AlternateKeyColumnGroup', 'InversionEntryColumnGroup'].includes(group.class.name)) throw new Error('PK/FK는 전용 명령으로 변경해야 합니다.');
        const owner = this.owner(group, 'columnGroups'); if (!owner) throw new Error('컬럼 그룹의 테이블이 없습니다.');
        const columns = this.selectedColumns(owner, command.columnUuids), members = this.groupMembers(group);
        if (columns.length !== members.length || columns.some(c => !members.some(m => m.column.id === c.id))) throw new Error('그룹 컬럼 전체의 정확한 순열을 지정해야 합니다.');
        if (command.sortTypes && (command.sortTypes.length !== columns.length || command.sortTypes.some(s => s !== 'ASC' && s !== 'DESC'))) throw new Error('컬럼별 정렬 순서를 올바르게 지정해야 합니다.');
        columns.forEach((column, i) => { const membership = members.find(m => m.column.id === column.id)!.membership; set(membership, 'entryIndex', i); if (command.sortTypes) set(membership, 'sortType', command.sortTypes[i]); });
        for (const fk of this.foreignTo(group)) for (const m of this.groupMembers(fk)) set(m.membership, 'entryIndex', columns.findIndex(c => has(m.membership, 'parentColumn', c.id)));
        return;
      }
      case 'addCheckConstraint': {
        const table = this.get(command.tableUuid, 'Table'), name = requiredName(command.name);
        if (!command.expression.trim()) throw new Error('CHECK 표현식이 필요합니다.');
        if (this.usedGroupName(table, name)) throw new Error('같은 이름의 CHECK 제약이 있습니다.');
        push(table, 'checkConstraints', object(this.graph, 'CheckConstraint', { physicalName: name, logicalName: name, expression: command.expression })); return;
      }
      case 'removeCheckConstraint': this.erase([this.get(command.constraintUuid, 'CheckConstraint')]); return;
      case 'addNote': {
        const diagram = this.get(command.diagramUuid, 'Diagram'), note = object(this.graph, 'Note', { text: command.text, location: `Point(${coordinate(command.x ?? 100)}, ${coordinate(command.y ?? 100)})` });
        if (command.width !== undefined || command.height !== undefined) { const w = coordinate(command.width ?? 240), h = coordinate(command.height ?? 120); if (w <= 0 || h <= 0) throw new Error('메모 크기는 양수여야 합니다.'); set(note, 'manualSize', `Dimension(${w}, ${h})`); }
        if (command.targetPlacementUuid) { const target = this.get(command.targetPlacementUuid, 'TableDiagram'); if (this.owner(target)?.id !== diagram.id) throw new Error('연결할 배치는 같은 다이어그램에 있어야 합니다.'); set(note, 'target', reference(target)); }
        push(diagram, 'diagramEntry', note); return;
      }
      case 'editNote': {
        const note = this.get(command.noteUuid, 'Note'); if (command.text !== undefined) set(note, 'text', command.text);
        if (command.x !== undefined || command.y !== undefined) { const old = pointValues(field(note, 'location'), [100, 100]); set(note, 'location', `Point(${coordinate(command.x ?? old[0])}, ${coordinate(command.y ?? old[1])})`); }
        if (command.width !== undefined || command.height !== undefined) { const old = pointValues(field(note, 'manualSize'), [240, 120]), w = coordinate(command.width ?? old[0]), h = coordinate(command.height ?? old[1]); if (w <= 0 || h <= 0) throw new Error('메모 크기는 양수여야 합니다.'); set(note, 'manualSize', `Dimension(${w}, ${h})`); }
        if (command.targetPlacementUuid === null) unset(note, 'target'); else if (command.targetPlacementUuid !== undefined) { const target = this.get(command.targetPlacementUuid, 'TableDiagram'); if (this.owner(target)?.id !== this.owner(note)?.id) throw new Error('연결할 배치는 같은 다이어그램에 있어야 합니다.'); set(note, 'target', reference(target)); }
        return;
      }
      case 'removeNote': this.erase([this.get(command.noteUuid, 'Note')], command.cascade); return;
      case 'addSchema': {
        const name = requiredName(command.name), database = this.all('DatabaseModel')[0]; if (!database) throw new Error('데이터베이스 모델이 없습니다.');
        if (this.objects(database, 'schema').some(s => field(s, 'physicalName') === name)) throw new Error('같은 물리명의 스키마가 있습니다.');
        push(database, 'schema', object(this.graph, 'Schema', { physicalName: name, logicalName: command.logicalName ?? name })); return;
      }
      case 'renameSchema': {
        const source = this.get(command.schemaUuid, 'Schema'), name = requiredName(command.name), database = this.owner(source, 'schema'); if (!database) throw new Error('스키마의 데이터베이스 모델이 없습니다.');
        if (this.objects(database, 'schema').some(s => s.id !== source.id && field(s, 'physicalName') === name)) throw new Error('같은 물리명의 스키마가 있습니다.');
        set(source, 'physicalName', name); if (command.logicalName !== undefined) set(source, 'logicalName', command.logicalName); return;
      }
      case 'addBusinessArea': {
        const name = requiredName(command.name), root = this.all('Document')[0];
        if (this.objects(root, 'businessAreas').some(a => field(a, 'logicalName') === name)) throw new Error('같은 이름의 업무영역이 있습니다.');
        push(root, 'businessAreas', object(this.graph, 'BusinessArea', { logicalName: name, physicalName: name })); return;
      }
      case 'removeDiagram': {
        const diagram = this.get(command.diagramUuid, 'Diagram'), root = this.all('Document')[0];
        const opened = field(root, 'openedDiagrams'); if (opened !== undefined) set(root, 'openedDiagrams', refs(opened).filter(r => r.ref !== diagram.id));
        this.erase([diagram], command.cascade); return;
      }
      default: throw new Error('지원하지 않는 구조 명령입니다.');
    }
  }
}

/** One structural transaction. Exceptions leave both source representations unchanged. */
export function mutateNativeDocument(document: NativeExerdDocument, command: NativeCommand): NativeExerdDocument {
  const editor = new Editor(document); editor.apply(command); return rebuildNativeDocument(editor.graph, document.container);
}
