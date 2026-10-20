import type { BinaryObject, BinaryValue, BinaryRegistry } from '../exerd/binary';
import type { NativeExerdDocument } from '../exerd/native-document';
import generated from '../exerd/schema.generated.json' with { type: 'json' };
import { validateNativeDocument } from '../exerd/validation';
import type { NativeDdlResult, NativeDdlDiagnostic, NativeDdlUnsupported } from './native-ddl';

export type EnterpriseDialect = 'sqlserver' | 'db2' | 'cubrid';
export interface EnterpriseDdlOptions { dialect: EnterpriseDialect; tableUuids?: string[] }
const CORE = 'http://exerd.tomato.com/model';
const NS: Record<EnterpriseDialect, string> = { sqlserver: 'http://exerd.tomato.com/sqlserver/model', db2: 'http://exerd.tomato.com/db2/model', cubrid: 'http://exerd.tomato.com/cubrid/model' };
const PRODUCTS: Record<string, EnterpriseDialect> = { 'com.tomato.db.sqlserver_2005': 'sqlserver', 'com.tomato.db.sqlserver': 'sqlserver', 'com.tomato.db.db2': 'db2', 'com.tomato.db.cubrid': 'cubrid', 'com.tomato.db.cubrid10': 'cubrid' };
const registry = generated as BinaryRegistry;
const schemasByType = new Map(registry.packages.flatMap(pkg => pkg.classes.map(cl => [`${pkg.namespaceURI}#${cl.name}`, cl.features] as const)));
const enumsByType = new Map(generated.packages.flatMap(pkg => pkg.enumerations.map(enumeration => [`${pkg.namespaceURI}#${enumeration.name}`, enumeration.literals] as const)));

/** SQL Server, Db2 LUW and CUBRID each retain their own physical semantics.
 * Generates text only. complete describes supported persisted model semantics;
 * executionVerified remains false without an independent real-server report.
 */
export function generateNativeEnterpriseDdl(document: NativeExerdDocument, options: EnterpriseDdlOptions): NativeDdlResult {
  const { dialect } = options, namespace = NS[dialect];
  const diagnostics: NativeDdlDiagnostic[] = [], unsupported: NativeDdlUnsupported[] = [];
  const statistics = { tables: 0, columns: 0, primaryKeys: 0, foreignKeys: 0, uniqueConstraints: 0, indexes: 0, checks: 0, sequences: 0 };
  const objects = document.graph.objects, byId = new Map(objects.map(o => [o.id, o]));
  const values = new Map(objects.map(o => [o.id, new Map(o.features.map(f => [f.name, f.value]))]));
  const field = (o: BinaryObject | undefined, key: string) => o && values.get(o.id)?.get(key);
  const string = (o: BinaryObject | undefined, key: string) => typeof field(o, key) === 'string' ? field(o, key) as string : '';
  const name = (o: BinaryObject | undefined) => string(o, 'physicalName') || string(o, 'name');
  const uuid = (o: BinaryObject | undefined) => o ? string(o, 'UUID') || `binary:${o.id}` : undefined;
  const refs = (o: BinaryObject | undefined, key: string): BinaryObject[] => {
    const v = field(o, key), list = Array.isArray(v) ? v : [v];
    return (list as BinaryValue[]).flatMap(v => v && typeof v === 'object' && !Array.isArray(v) && 'ref' in v && byId.has(v.ref) ? [byId.get(v.ref)!] : []);
  };
  const ref = (o: BinaryObject | undefined, key: string): BinaryObject | undefined => refs(o, key)[0];
  const definition = (o: BinaryObject, key: string) => schemasByType.get(`${o.class.packageUri}#${o.class.name}`)?.find(f => f.name === key);
  function schemaDefault(o: BinaryObject, key: string): BinaryValue | undefined {
    const d = definition(o, key); if (!d) return undefined;
    if (d.defaultValueLiteral !== null && d.defaultValueLiteral !== undefined) return d.kind === 'BOOLEAN' ? d.defaultValueLiteral === 'true' : String(d.defaultValueLiteral);
    // EMF EEnum's implicit default is its first declared literal, irrespective
    // of the literal's integer value. Only exact local enum definitions qualify.
    const type = typeof d.type === 'string' ? d.type : '';
    if (type.startsWith('#//')) return enumsByType.get(`${o.class.packageUri}#${type.slice(3)}`)?.[0]?.literal;
    if (d.kind === 'BOOLEAN') return false;
    return undefined;
  }
  function effective(o: BinaryObject | undefined, key: string): BinaryValue | undefined {
    const v = field(o, key); if (v !== undefined || !o) return v;
    return schemaDefault(o, key);
  }
  const error = (code: string, message: string, o?: BinaryObject) => diagnostics.push({ code, severity: 'error', message, uuid: uuid(o) });
  const warned = new Set<string>(), omitted = (code: string, message: string, o?: BinaryObject, feature?: string) => {
    const key = `${code}:${o?.id}:${feature}`; if (warned.has(key)) return; warned.add(key);
    unsupported.push({ code, message, uuid: uuid(o), ...(feature ? { feature } : {}) });
  };
  const result = (sql = ''): NativeDdlResult => ({ sql, dialect, diagnostics, unsupported, statistics, complete: !unsupported.length && !diagnostics.some(d => d.severity === 'error'), executionVerified: false });
  const root = objects.find(o => o.class.packageUri === CORE && o.class.name === 'Document');
  if (!namespace || !root || PRODUCTS[string(root, 'productId')] !== dialect) { omitted('ENTERPRISE_DATABASE_MISMATCH', '원본 DB 제품과 대상 방언이 다릅니다. 자료형을 다른 DB로 자동 변환하지 않습니다.', root); return result(); }
  const database = ref(root, 'databaseModel'), schemas = refs(database, 'schema');
  const schemaOf = new Map<number, BinaryObject>(), ownerOfColumn = new Map<number, BinaryObject>(), ownerOfGroup = new Map<number, BinaryObject>();
  for (const schema of schemas) for (const table of refs(schema, 'tables')) { schemaOf.set(table.id, schema); for (const column of refs(table, 'columns')) ownerOfColumn.set(column.id, table); for (const group of refs(table, 'columnGroups')) ownerOfGroup.set(group.id, table); }
  const tables = [...new Map(schemas.flatMap(s => refs(s, 'tables')).map(t => [t.id, t])).values()];
  const requested = options.tableUuids ? new Set(options.tableUuids) : undefined;
  const selected = tables.filter(t => !requested || requested.has(uuid(t)!)), selectedIds = new Set(selected.map(t => t.id));
  if (requested) for (const id of requested) if (!tables.some(t => uuid(t) === id)) error('UNKNOWN_TABLE_SELECTION', '내보낼 테이블 식별자가 없습니다.');
  const selectedSchemas = schemas.filter(s => !requested || refs(s, 'tables').some(t => selectedIds.has(t.id)));
  const relevantCore = new Set<number>([root.id, ...selectedSchemas.map(s => s.id), ...selected.map(t => t.id)]);
  const markCore = (o: BinaryObject) => { if (relevantCore.has(o.id)) return; relevantCore.add(o.id); for (const f of o.features) if (definition(o, f.name)?.containment) refs(o, f.name).forEach(markCore); };
  selected.forEach(t => { relevantCore.delete(t.id); markCore(t); });
  for (const d of validateNativeDocument(document)) if (!d.uuid || selected.length === tables.length || [...relevantCore].some(id => uuid(byId.get(id)) === d.uuid)) diagnostics.push(d);
  const handled = new Map<number, Set<string>>(), physicalObjects = new Map<number, BinaryObject>();
  const used = (o: BinaryObject | undefined, ...keys: string[]) => { if (!o) return; const set = handled.get(o.id) ?? new Set<string>(); keys.forEach(k => set.add(k)); handled.set(o.id, set); };
  const physical = (o: BinaryObject | undefined) => {
    const p = ref(o, 'physicalProperties'); if (!p) return undefined;
    if (p.class.packageUri !== namespace) { omitted('FOREIGN_DATABASE_PHYSICAL_PROPERTIES', '다른 DB의 물리 속성을 변환하지 않았습니다.', p); return undefined; }
    physicalObjects.set(p.id, p); return p;
  };
  function identifier(value: string, o?: BinaryObject): string {
    if (!value || /[\0\r\n]/.test(value)) { error('INVALID_SQL_IDENTIFIER', '식별자가 비어 있거나 지원하지 않는 제어 문자를 포함합니다.', o); return dialect === 'sqlserver' ? '[<invalid>]' : '"<invalid>"'; }
    const limit = dialect === 'cubrid' ? 254 : 128, length = dialect === 'sqlserver' ? value.length : new TextEncoder().encode(value).length;
    if (length > limit) omitted('IDENTIFIER_LENGTH_UNVERIFIED', 'DB 기본 식별자 길이 범위를 넘습니다.', o);
    return dialect === 'sqlserver' ? `[${value.replaceAll(']', ']]')}]` : `"${value.replaceAll('"', '""')}"`;
  }
  const literal = (value: string) => {
    if (value.includes('\0')) { error('INVALID_SQL_LITERAL', '문자열 값에 NUL 문자가 있습니다.'); return "'<invalid>'"; }
    if (dialect === 'cubrid' && value.includes('\\')) omitted('CUBRID_STRING_ESCAPE_CONFIGURATION_UNVERIFIED', '역슬래시 문자열은 서버 no_backslash_escapes 설정과 대조해야 합니다.');
    return `${dialect === 'sqlserver' ? 'N' : ''}'${value.replaceAll("'", "''")}'`;
  };
  const version = /(?:CUBRID\s*)?(\d+)\.(\d+)/i.exec(string(root, 'databaseVersion'));
  const cubridSchema = dialect === 'cubrid' && !!version && (Number(version[1]) > 11 || Number(version[1]) === 11 && Number(version[2]) >= 2);
  for (const schema of selectedSchemas) if (dialect === 'cubrid' && name(schema) && !cubridSchema) omitted('CUBRID_SCHEMA_VERSION_UNVERIFIED', '사용자 스키마 한정명은 CUBRID 11.2 이상에서 지원됩니다. 버전이 확인되지 않아 한정명을 생략했습니다.', schema);
  if (dialect === 'cubrid' && !cubridSchema && new Set(selected.map(t => name(t).toLowerCase())).size !== selected.length) error('CUBRID_UNQUALIFIED_TABLE_COLLISION', '스키마 한정명을 생략하면 테이블 이름이 충돌합니다.');
  const tableName = (table: BinaryObject) => { const s = schemaOf.get(table.id); return `${name(s) && (dialect !== 'cubrid' || cubridSchema) ? identifier(name(s), s) + '.' : ''}${identifier(name(table), table)}`; };
  const indexName = (group: BinaryObject, table: BinaryObject) => dialect === 'db2' && name(schemaOf.get(table.id)) ? `${identifier(name(schemaOf.get(table.id)))}.${identifier(name(group), group)}` : identifier(name(group), group);
  function fragment(value: string, o: BinaryObject, feature: string): string | undefined {
    let quote = '', depth = 0, token = '';
    const prohibited = /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|GO|CALL|COMMIT|ROLLBACK)$/i;
    const endToken = () => { if (prohibited.test(token)) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 독립 SQL 문장 키워드가 있습니다.`, o); return false; } token = ''; return true; };
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (quote) { if (ch === quote) { if (value[i + 1] === quote) i++; else quote = ''; } continue; }
      if (/[A-Za-z_0-9$]/.test(ch)) { token += ch; continue; }
      if (!endToken()) return undefined;
      if (ch === "'" || ch === '"' || ch === '`' || ch === '[') quote = ch === '[' ? ']' : ch;
      else if (ch === ';' || ch === '\0' || value.startsWith('--', i) || value.startsWith('/*', i)) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 독립 문장·주석이 있습니다.`, o); return undefined; }
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth < 0) { error('INVALID_SQL_FRAGMENT', `${feature} 괄호가 닫히지 않았습니다.`, o); return undefined; }
    }
    if (!endToken()) return undefined;
    if (quote || depth) { error('INVALID_SQL_FRAGMENT', `${feature} 인용 또는 괄호가 닫히지 않았습니다.`, o); return undefined; }
    if (dialect === 'cubrid' && value.includes('\\')) omitted('CUBRID_STRING_ESCAPE_CONFIGURATION_UNVERIFIED', '역슬래시가 있는 표현식은 서버 no_backslash_escapes 설정과 대조해야 합니다.', o, feature);
    return value;
  }
  const sqlExpression = (value: string, table: BinaryObject, o: BinaryObject, feature: string) => {
    const safe = fragment(value, o, feature); if (safe === undefined) return undefined;
    const columns = new Map(refs(table, 'columns').map(c => [name(c).toLowerCase(), c]));
    const keywords = new Set('AND OR NOT NULL TRUE FALSE IS IN LIKE BETWEEN CASE WHEN THEN ELSE END AS DISTINCT FROM COLLATE ANY ALL SOME CAST CONVERT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP USER CURRENT_USER SESSION_USER SYSTEM_USER INTERVAL'.split(' '));
    let output = '';
    for (let i = 0; i < safe.length;) {
      const ch = safe[i];
      if (["'", '"', '[', '`'].includes(ch)) { const start = i++, close = ch === '[' ? ']' : ch; while (i < safe.length) { if (safe[i++] === close) { if (safe[i] === close) i++; else break; } } output += safe.slice(start, i); continue; }
      const match = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(safe.slice(i));
      if (match) {
        const word = match[0], col = columns.get(word.toLowerCase()), tail = safe.slice(i + word.length).trimStart(), prefix = safe.slice(0, i);
        // CAST/CONVERT's target type can share a name with a column. Rewriting
        // that type token as a column would silently change the expression.
        const typePosition = /\b(?:AS\s+|(?:TRY_)?CONVERT\s*\(\s*)(?:[A-Za-z_][A-Za-z_0-9$]*\s*\.\s*)*$/i.test(prefix);
        output += col && !typePosition && !keywords.has(word.toUpperCase()) && !tail.startsWith('(') && !(word.toUpperCase() === 'N' && tail.startsWith("'")) ? identifier(name(col), col) : word; i += word.length;
      }
      else output += safe[i++];
    }
    return output;
  };
  function integer(o: BinaryObject, key: string, fallback?: string): string | undefined {
    const v = effective(o, key) ?? fallback; if (v === undefined || v === null || v === '') return undefined;
    if (!/^[+-]?\d+$/.test(String(v))) { error('INVALID_INTEGER_OPTION', `${key}는 정수여야 합니다.`, o); return undefined; } return String(v);
  }
  const domainParents = new Map<number, BinaryObject>(); for (const d of objects.filter(o => o.class.name === 'Domain')) for (const child of refs(d, 'domain')) domainParents.set(child.id, d);
  function inherited(column: BinaryObject, own: string, suggested: string): string {
    const value = field(column, own); if (typeof value === 'string' && (own !== 'notNull' || value)) return value;
    let domain = ref(column, 'domain'); const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) { seen.add(domain.id); const v = field(domain, suggested); if (typeof v === 'string' && v) return v; domain = domainParents.get(domain.id); }
    return '';
  }
  interface Member { column: BinaryObject; membership: BinaryObject; index: number; position: number }
  const memberships = new Map<number, Member[]>();
  for (const table of tables) refs(table, 'columns').forEach((column, position) => { for (const entry of refs(column, 'memberships')) { const membership = ref(entry, 'value'), group = ref(entry, 'key'); if (!membership || !group) continue; const items = memberships.get(group.id) ?? []; const i = field(membership, 'entryIndex'); items.push({ column, membership, index: typeof i === 'number' ? i : -1, position }); memberships.set(group.id, items); } });
  for (const [id, members] of memberships) if (byId.get(id)?.class.name !== 'PrimaryKeyColumnGroup') members.sort((a, b) => a.index - b.index || a.position - b.position);
  const primaryIds = new Set(objects.filter(o => o.class.name === 'PrimaryKeyColumnGroup').flatMap(g => memberships.get(g.id)?.map(m => m.column.id) ?? []));
  const before: string[] = [], creates: string[] = [], after: string[] = [], foreign: string[] = [], comments: string[] = [];
  if (dialect === 'sqlserver') before.push('SET QUOTED_IDENTIFIER ON;');
  for (const schema of selectedSchemas) {
    const p = physical(schema);
    if (name(schema) && dialect === 'sqlserver') before.push(`IF SCHEMA_ID(${literal(name(schema))}) IS NULL EXEC(${literal(`CREATE SCHEMA ${identifier(name(schema), schema)}`)});`);
    else if (name(schema) && dialect === 'db2') before.push(`CREATE SCHEMA ${identifier(name(schema), schema)};`);
    if (dialect === 'sqlserver') { used(p, 'comment'); const value = string(schema, 'comment') || string(p, 'comment'); if (value) comments.push(`EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=${literal(value)}, @level0type=N'SCHEMA', @level0name=${literal(name(schema))};`); }
    else if (string(schema, 'comment') || string(p, 'comment')) omitted('SCHEMA_COMMENT_UNIMPLEMENTED', '스키마 설명의 DB 카탈로그 반영을 구현하지 않았습니다.', schema);
  }
  function comment(table: BinaryObject, owner: BinaryObject, objectKind: 'TABLE' | 'COLUMN' | 'CONSTRAINT' | 'INDEX') {
    const value = string(owner, 'comment'); if (!value) return;
    if (dialect === 'sqlserver') {
      if (objectKind === 'CONSTRAINT' && effective(physical(owner), 'systemGeneratedName') === true) { omitted('SQLSERVER_SYSTEM_NAME_COMMENT_UNRESOLVED', '서버가 생성할 제약 이름을 알 수 없어 설명을 지정하지 않았습니다.', owner); return; }
      if (value.length * 2 > 7500) omitted('SQLSERVER_EXTENDED_PROPERTY_SIZE', 'MS_Description 값이 sql_variant 7,500바이트 한도를 넘습니다.', owner);
      const schema = name(schemaOf.get(table.id)); if (!schema) { omitted('SQLSERVER_COMMENT_SCHEMA_MISSING', '확장 설명의 스키마를 찾지 못했습니다.', owner); return; }
      comments.push(`EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=${literal(value)}, @level0type=N'SCHEMA', @level0name=${literal(schema)}, @level1type=N'TABLE', @level1name=${literal(name(table))}${objectKind !== 'TABLE' ? `, @level2type=${literal(objectKind)}, @level2name=${literal(name(owner))}` : ''};`);
    } else if (dialect === 'db2' && ['TABLE', 'COLUMN', 'INDEX'].includes(objectKind)) comments.push(`COMMENT ON ${objectKind} ${objectKind === 'TABLE' ? tableName(table) : objectKind === 'COLUMN' ? `${tableName(table)}.${identifier(name(owner), owner)}` : indexName(owner, table)} IS ${literal(value)};`);
    else if (dialect === 'db2') omitted('DB2_CONSTRAINT_COMMENT_UNIMPLEMENTED', '제약 설명의 Db2 카탈로그 반영을 구현하지 않았습니다.', owner);
  }
  const dbPhysical = physical(database);
  if (dialect === 'db2') {
    used(dbPhysical, 'tablespaces');
    for (const space of refs(dbPhysical, 'tablespaces')) { physicalObjects.set(space.id, space); used(space, 'type', 'name', 'logicalName', 'physicalName', 'oppositeModeName', 'derivedName', 'derivedPhysicalName', 'derivedLogicalName', 'derivedOppositeModeName', 'comment');
      const kind = string(space, 'type'); if (kind && kind !== 'NONE' && !['REGULAR', 'LARGE', 'USER_TEMPORARY', 'SYSTEM_TEMPORARY'].includes(kind)) { error('INVALID_DB2_TABLESPACE_TYPE', '알 수 없는 Db2 테이블스페이스 유형입니다.', space); continue; }
      before.push(`CREATE${kind && kind !== 'NONE' ? ' ' + kind.replaceAll('_', ' ') : ''} TABLESPACE ${identifier(name(space), space)};`);
      diagnostics.push({ code: 'DB2_DEFAULT_STORAGE_REQUIRED', severity: 'warning', message: '테이블스페이스는 DB의 기본 자동 저장소·버퍼풀 설정을 사용합니다.', uuid: uuid(space) });
    }
  }
  function dataSpace(owner: BinaryObject, p: BinaryObject | undefined, feature: string, table: BinaryObject): string {
    const space = ref(p, feature); used(p, feature); if (!space) return '';
    const type = string(space, 'dataSpaceType');
    if (type === 'PARTITION_SCHEME') { const column = ref(p, 'partitionColumn'); used(p, 'partitionColumn'); if (!column || ownerOfColumn.get(column.id)?.id !== table.id) { error('PARTITION_COLUMN_MISSING', '분할 스키마의 소속 컬럼을 찾지 못했습니다.', owner); return ''; } return ` ON ${identifier(name(space), space)}(${identifier(name(column), column)})`; }
    if (type && !['ROWS_FILEGROUP', ''].includes(type)) { omitted('SQLSERVER_DATA_SPACE_TYPE_UNIMPLEMENTED', '해당 데이터 공간 유형을 구현하지 않았습니다.', owner, feature); return ''; }
    return ` ON ${identifier(name(space), space)}`;
  }
  function indexOptions(p: BinaryObject | undefined): string {
    used(p, 'relationalIndexOption'); const option = ref(p, 'relationalIndexOption'); if (!option) return ''; physicalObjects.set(option.id, option);
    const parts: string[] = []; used(option, 'padIndex', 'fillFactor', 'ignoreDupKey', 'allowRowLocks', 'allowPageLocks');
    for (const [key, sql] of [['padIndex', 'PAD_INDEX'], ['ignoreDupKey', 'IGNORE_DUP_KEY'], ['allowRowLocks', 'ALLOW_ROW_LOCKS'], ['allowPageLocks', 'ALLOW_PAGE_LOCKS']]) { const v = string(option, key); if (v === 'ON' || v === 'OFF') parts.push(`${sql} = ${v}`); else if (v) error('INVALID_SQLSERVER_INDEX_OPTION', '인덱스 옵션은 ON/OFF여야 합니다.', option); }
    const fill = integer(option, 'fillFactor'); if (fill !== undefined) { if (Number(fill) < 0 || Number(fill) > 100) error('INVALID_FILL_FACTOR', 'FILLFACTOR는 0–100 범위여야 합니다.', option); else parts.push(`FILLFACTOR = ${fill}`); }
    return parts.length ? ` WITH (${parts.join(', ')})` : '';
  }
  function clustered(p: BinaryObject | undefined): string { used(p, 'clustered'); const v = string(p, 'clustered'); if (v && !['CLUSTERED', 'NONCLUSTERED'].includes(v)) { error('INVALID_CLUSTERED_OPTION', 'CLUSTERED/NONCLUSTERED 값을 해석하지 못했습니다.', p); return ''; } return v ? ` ${v}` : ''; }
  function keyColumns(group: BinaryObject, constraint: boolean): string {
    return (memberships.get(group.id) ?? []).map(m => { const p = physical(m.membership); if (p?.features.some(f => f.name !== 'UUID')) omitted('MEMBERSHIP_PHYSICAL_OPTION_UNIMPLEMENTED', '멤버십의 DB 물리 옵션을 구현하지 않았습니다.', p); const sort = string(m.membership, 'sortType'); if (sort && !['ASC', 'DESC', 'NONE'].includes(sort)) error('INVALID_INDEX_SORT', '인덱스 정렬 방향을 해석하지 못했습니다.', m.membership); if (constraint && dialect !== 'sqlserver' && sort === 'DESC') omitted('CONSTRAINT_INDEX_SORT_UNIMPLEMENTED', '키 제약 소유 인덱스의 DESC 저장 옵션은 구현하지 않았습니다.', group); return identifier(name(m.column), m.column) + (!constraint || dialect === 'sqlserver' ? sort === 'DESC' ? ' DESC' : ' ASC' : ''); }).join(', ');
  }
  function constraintPrefix(constraint: BinaryObject | undefined, group?: BinaryObject): string {
    const p = physical(constraint); if (dialect === 'sqlserver') { used(p, 'systemGeneratedName'); if (effective(p, 'systemGeneratedName') === true) return ''; }
    return name(constraint) || name(group) ? `CONSTRAINT ${identifier(name(constraint) || name(group), constraint ?? group)} ` : '';
  }
  for (const table of selected) {
    const p = physical(table), body: string[] = []; let identityCount = 0;
    const cubridTableAuto = dialect === 'cubrid' && p ? integer(p, 'autoIncrement') : undefined; let cubridCustomSeed = false;
    for (const column of refs(table, 'columns')) {
      const cp = physical(column), computed = dialect === 'sqlserver' ? ref(cp, 'computedColumnDetail') : undefined, identity = dialect === 'sqlserver' ? ref(cp, 'identity') : undefined;
      let text = `${identifier(name(column), column)} `;
      if (computed) {
        used(cp, 'computedColumnDetail'); physicalObjects.set(computed.id, computed); used(computed, 'expression', 'persisted'); const expression = sqlExpression(string(computed, 'expression'), table, computed, 'computed expression');
        if (!expression?.trim()) { error('COMPUTED_EXPRESSION_MISSING', '계산 컬럼 표현식이 없습니다.', column); continue; }
        text += `AS (${expression})${effective(computed, 'persisted') === true ? ' PERSISTED' : ''}`;
        if (identity || inherited(column, 'defaultValue', 'suggestedDefaultValue')) error('COMPUTED_COLUMN_CONFLICT', '계산 컬럼에 IDENTITY 또는 DEFAULT가 함께 지정됐습니다.', column);
        if (inherited(column, 'notNull', 'suggestedNotNull') === 'TRUE') { if (effective(computed, 'persisted') === true) text += ' NOT NULL'; else omitted('NONPERSISTED_COMPUTED_NULLABILITY', '비지속 계산 컬럼의 명시 NOT NULL을 출력하지 않았습니다.', column); }
      } else {
        const dataType = fragment(inherited(column, 'dataType', 'suggestedDataType'), column, 'dataType'); if (!dataType?.trim()) { error('COLUMN_TYPE_MISSING', '컬럼 물리 자료형이 필요합니다.', column); continue; } text += dataType;
        let defaultValue = inherited(column, 'defaultValue', 'suggestedDefaultValue');
        if (dialect === 'sqlserver') {
          used(cp, 'collationName', 'identity', 'rowGuidColumn', 'defaultValueDetail'); const collation = string(cp, 'collationName'); if (collation) text += ` COLLATE ${identifier(collation, cp)}`;
          if (identity) { identityCount++; physicalObjects.set(identity.id, identity); used(identity, 'startWith', 'incrementBy', 'notForReplication'); const start = integer(identity, 'startWith', '1'), increment = integer(identity, 'incrementBy', '1'); if (increment && BigInt(increment) === 0n) error('ZERO_IDENTITY_INCREMENT', 'IDENTITY 증가값이 0입니다.', identity); text += ` IDENTITY(${start}, ${increment})${effective(identity, 'notForReplication') === true ? ' NOT FOR REPLICATION' : ''}`; if (defaultValue || ref(cp, 'defaultValueDetail')) error('IDENTITY_DEFAULT_CONFLICT', 'IDENTITY 컬럼은 DEFAULT와 함께 쓸 수 없습니다.', column); }
          if (identity && !/^(?:tinyint|smallint|int|integer|bigint|(?:decimal|numeric)(?:\s*\(\s*\d+\s*(?:,\s*0\s*)?\))?)$/i.test(dataType.trim())) omitted('SQLSERVER_IDENTITY_TYPE_UNVERIFIED', 'IDENTITY는 정수형 또는 소수 자릿수가 0인 decimal/numeric 자료형만 지원합니다. 사용자 정의 자료형은 별도 확인이 필요합니다.', column, 'dataType');
          if (effective(cp, 'rowGuidColumn') === 'TRUE') { if (!/^uniqueidentifier$/i.test(dataType.trim())) error('ROWGUIDCOL_TYPE', 'ROWGUIDCOL은 uniqueidentifier 자료형이어야 합니다.', column); text += ' ROWGUIDCOL'; }
          const def = ref(cp, 'defaultValueDetail'); if (def) { physicalObjects.set(def.id, def); used(def, 'physicalName', 'logicalName', 'name', 'oppositeModeName', 'derivedName', 'derivedPhysicalName', 'derivedLogicalName', 'derivedOppositeModeName', 'systemGeneratedName', 'expression'); const expression = string(def, 'expression'); if (defaultValue && expression && defaultValue !== expression) error('DEFAULT_DEFINITION_CONFLICT', '컬럼 기본값과 명명된 DEFAULT 표현식이 다릅니다.', column); defaultValue = expression || defaultValue; }
          if (defaultValue && !identity) { const expression = sqlExpression(defaultValue, table, column, 'defaultValue'); if (expression !== undefined) text += ` ${def && name(def) && effective(def, 'systemGeneratedName') !== true ? `CONSTRAINT ${identifier(name(def), def)} ` : ''}DEFAULT ${expression}`; }
        } else if (dialect === 'cubrid') {
          used(cp, 'useAutoIncrement', 'autoIncrementStartValue', 'autoIncrementIncrementValue', 'useShared', 'sharedValue', 'useDefault');
          const auto = effective(cp, 'useAutoIncrement') === true, shared = effective(cp, 'useShared') === true, useDefault = effective(cp, 'useDefault') === true;
          if (Number(auto) + Number(shared) + Number(useDefault) > 1) error('CUBRID_COLUMN_INITIALIZER_CONFLICT', 'AUTO_INCREMENT·SHARED·DEFAULT는 한 컬럼에 함께 쓸 수 없습니다.', column);
          if (auto) { identityCount++; const start = integer(cp!, 'autoIncrementStartValue', '1'), increment = integer(cp!, 'autoIncrementIncrementValue', '1'); if (increment && BigInt(increment) <= 0n) error('CUBRID_AUTO_INCREMENT_VALUE', 'CUBRID 증가값은 양수여야 합니다.', cp); const custom = start !== '1' || increment !== '1'; cubridCustomSeed ||= custom; text += cubridTableAuto !== undefined && !custom ? ' AUTO_INCREMENT' : ` AUTO_INCREMENT(${start}, ${increment})`; }
          else if (shared) text += ` SHARED ${literal(string(cp, 'sharedValue'))}`;
          else if (useDefault) text += ` DEFAULT ${literal(defaultValue)}`;
        } else if (defaultValue) { const expression = sqlExpression(defaultValue, table, column, 'defaultValue'); if (expression !== undefined) text += ` DEFAULT ${expression}`; }
        text += primaryIds.has(column.id) || inherited(column, 'notNull', 'suggestedNotNull') === 'TRUE' ? ' NOT NULL' : dialect === 'sqlserver' ? ' NULL' : '';
      }
      if (dialect === 'cubrid' && string(column, 'comment')) text += ` COMMENT ${literal(string(column, 'comment'))}`; else comment(table, column, 'COLUMN');
      body.push(text); statistics.columns++;
    }
    if (dialect === 'sqlserver' && identityCount > 1) error('MULTIPLE_IDENTITY_COLUMNS', 'SQL Server 테이블에는 IDENTITY 컬럼이 하나만 허용됩니다.', table);
    let clusteredCount = 0, implicitPrimaryCluster = false, standaloneCluster = false;
    for (const group of refs(table, 'columnGroups')) {
      const gp = physical(group), members = memberships.get(group.id) ?? [];
      if (group.class.name === 'ForeignKeyColumnGroup') continue;
      if (!members.length) { error('EMPTY_COLUMN_GROUP', '컬럼이 없는 키·인덱스를 출력하지 않았습니다.', group); continue; }
      const pk = group.class.name === 'PrimaryKeyColumnGroup', unique = group.class.name === 'AlternateKeyColumnGroup', constraint = ref(group, pk ? 'primaryKeyConstraint' : 'uniqueConstraint');
      if (pk || unique && constraint) {
        const prefix = constraintPrefix(constraint, group); let suffix = '', order = '';
        if (dialect === 'sqlserver') { used(gp, 'unique', 'disable', 'optimization'); order = clustered(gp); if (order === ' CLUSTERED') clusteredCount++; suffix = indexOptions(gp) + dataSpace(group, gp, 'dataSpace', table); if (field(gp, 'disable') === true) after.push(`ALTER INDEX ${identifier(name(constraint) || name(group), group)} ON ${tableName(table)} DISABLE;`); if (string(gp, 'optimization') && string(gp, 'optimization') !== 'NONE') omitted('SQLSERVER_TABLE_OPTIMIZATION_UNIMPLEMENTED', '인덱스 최적화 모드는 데이터 공간 정의와 추가 대조가 필요합니다.', gp, 'optimization'); }
        if (dialect === 'sqlserver' && pk && !order) implicitPrimaryCluster = true;
        body.push(`${prefix}${pk ? 'PRIMARY KEY' : 'UNIQUE'}${order} (${keyColumns(group, true)})${suffix}`); if (pk) statistics.primaryKeys++; else statistics.uniqueConstraints++;
        if (name(group) && name(constraint) && name(group) !== name(constraint)) omitted('CONSTRAINT_INDEX_NAME_DIFFERENCE', '제약 이름과 소유 인덱스 이름 차이를 별도 인덱스로 재생성하지 않았습니다.', group);
        if (constraint) comment(table, constraint, 'CONSTRAINT');
        if (string(group, 'comment')) { if (dialect === 'sqlserver') comment(table, group, 'INDEX'); else omitted('CONSTRAINT_INDEX_COMMENT_UNIMPLEMENTED', '제약 소유 인덱스 설명을 구현하지 않았습니다.', group); }
      } else if (['InversionEntryColumnGroup', 'AlternateKeyColumnGroup'].includes(group.class.name)) {
        let flags = unique ? 'UNIQUE ' : '', suffix = '';
        if (dialect === 'sqlserver') { used(gp, 'unique', 'includedColumns', 'disable'); if (effective(gp, 'unique') === true) flags = 'UNIQUE '; const cluster = clustered(gp); if (cluster === ' CLUSTERED') clusteredCount++; flags += cluster.trim() ? cluster.trim() + ' ' : ''; const include = refs(gp, 'includedColumns'); const keyIds = new Set(members.map(m => m.column.id)); if (new Set(include.map(c => c.id)).size !== include.length || include.some(c => ownerOfColumn.get(c.id)?.id !== table.id || keyIds.has(c.id))) error('INVALID_INCLUDED_COLUMNS', 'INCLUDE 컬럼은 같은 테이블에 속하고 키·다른 INCLUDE 컬럼과 중복되지 않아야 합니다.', group); if (include.length && cluster === ' CLUSTERED') omitted('CLUSTERED_INCLUDE_NOT_SUPPORTED', 'INCLUDE는 비클러스터 인덱스에만 적용할 수 있습니다.', group); else if (include.length) suffix += ` INCLUDE (${include.map(c => identifier(name(c), c)).join(', ')})`; suffix += indexOptions(gp) + dataSpace(group, gp, 'dataSpace', table); if (effective(gp, 'disable') === true) after.push(`ALTER INDEX ${identifier(name(group), group)} ON ${tableName(table)} DISABLE;`); }
        if (dialect === 'sqlserver' && flags.includes('CLUSTERED ') && !flags.includes('NONCLUSTERED ')) standaloneCluster = true;
        const statement = `CREATE ${flags}INDEX ${indexName(group, table)} ON ${tableName(table)} (${keyColumns(group, false)})${suffix}${dialect === 'cubrid' && string(group, 'comment') ? ` COMMENT ${literal(string(group, 'comment'))}` : ''};`;
        after.unshift(statement); statistics.indexes++; if (dialect !== 'cubrid') comment(table, group, 'INDEX');
      } else omitted('COLUMN_GROUP_KIND_UNIMPLEMENTED', '이 컬럼 그룹 종류는 SQL 변환을 구현하지 않았습니다.', group);
    }
    if (clusteredCount > 1) error('MULTIPLE_CLUSTERED_INDEXES', '한 SQL Server 테이블에 클러스터 인덱스가 여러 개 지정됐습니다.', table);
    if (implicitPrimaryCluster && standaloneCluster) error('IMPLICIT_PRIMARY_CLUSTER_CONFLICT', '기본 PRIMARY KEY가 먼저 클러스터 인덱스를 생성하므로 별도 CLUSTERED 인덱스와 충돌합니다. 기본키의 NONCLUSTERED 여부를 명시해야 합니다.', table);
    for (const check of refs(table, 'checkConstraints')) {
      const cp = physical(check);
      if (dialect === 'cubrid') { omitted('CUBRID_CHECK_ENFORCEMENT_UNVERIFIED', 'CUBRID의 CHECK 강제를 확인하지 못했습니다. 구버전은 구문을 읽고 무시하므로 제약을 생성하지 않았습니다.', check); continue; }
      const expression = sqlExpression(string(check, 'expression'), table, check, 'CHECK'); if (!expression?.trim()) { error('CHECK_EXPRESSION_MISSING', 'CHECK 표현식이 없습니다.', check); continue; }
      if (dialect === 'sqlserver') { used(cp, 'systemGeneratedName', 'useBindRule', 'enable', 'notForReplication'); if (effective(cp, 'useBindRule') === true) { omitted('SQLSERVER_BOUND_RULE_UNIMPLEMENTED', '이전 바인딩 규칙을 CHECK로 임의 변환하지 않았습니다.', check); continue; } after.push(`ALTER TABLE ${tableName(table)} ADD ${constraintPrefix(check)}CHECK${effective(cp, 'notForReplication') === true ? ' NOT FOR REPLICATION' : ''} (${expression});`); if (effective(cp, 'enable') === false && effective(cp, 'systemGeneratedName') === true) omitted('DISABLED_SYSTEM_NAMED_CONSTRAINT_UNIMPLEMENTED', '서버 자동 이름 제약을 이름으로 비활성화할 수 없습니다.', check); else if (effective(cp, 'enable') === false) after.push(`ALTER TABLE ${tableName(table)} NOCHECK CONSTRAINT ${identifier(name(check), check)};`); }
      else body.push(`${constraintPrefix(check)}CHECK (${expression})`);
      statistics.checks++; comment(table, check, 'CONSTRAINT');
    }
    let suffix = '';
    if (dialect === 'sqlserver') { suffix = dataSpace(table, p, 'dataSpace', table); used(p, 'optimization'); if (string(p, 'optimization') && string(p, 'optimization') !== 'NONE') omitted('SQLSERVER_TABLE_OPTIMIZATION_UNIMPLEMENTED', '테이블 최적화 모드를 구현하지 않았습니다.', p, 'optimization'); }
    if (dialect === 'db2') { used(p, 'tablespace', 'indexInTablespace'); for (const [key, sql] of [['tablespace', 'IN'], ['indexInTablespace', 'INDEX IN']]) { const space = ref(p, key); if (space) suffix += ` ${sql} ${identifier(name(space), space)}`; } }
    if (dialect === 'cubrid') { used(p, 'characterSet', 'collation', 'reuseOid', 'autoIncrement'); const charset = string(p, 'characterSet'), collation = string(p, 'collation'), reuse = field(p, 'reuseOid'); if (reuse === 'TRUE' || reuse === 'FALSE') suffix += reuse === 'TRUE' ? ' REUSE_OID' : ' DONT_REUSE_OID'; if (cubridTableAuto !== undefined) { if (identityCount !== 1 || cubridCustomSeed) error('CUBRID_TABLE_AUTO_INCREMENT_CONFLICT', '테이블 AUTO_INCREMENT는 기본 증가값을 쓰는 단일 자동 증가 컬럼과 함께 사용해야 합니다.', table); else suffix += ` AUTO_INCREMENT=${cubridTableAuto}`; } if (charset) suffix += ` CHARSET ${identifier(charset, p)}`; if (collation) suffix += ` COLLATE ${identifier(collation, p)}`; if (string(table, 'comment')) suffix += ` COMMENT=${literal(string(table, 'comment'))}`; }
    creates.push(`CREATE TABLE ${tableName(table)} (\n  ${body.join(',\n  ')}\n)${suffix};`); statistics.tables++; if (dialect !== 'cubrid') comment(table, table, 'TABLE');
    for (const group of refs(table, 'columnGroups').filter(g => g.class.name === 'ForeignKeyColumnGroup')) {
      const parentGroup = ref(group, 'parentColumnGroup'), parent = parentGroup && ownerOfGroup.get(parentGroup.id), constraint = ref(group, 'foreignKeyConstraint'), cp = physical(constraint), gp = physical(group), members = memberships.get(group.id) ?? [];
      const parentColumns = members.map(m => ref(m.membership, 'parentColumn'));
      if (!parent || !members.length || parentColumns.some(c => !c || ownerOfColumn.get(c.id)?.id !== parent.id)) { error('INCOMPLETE_FOREIGN_KEY', '외래키 부모·자식 컬럼 대응을 해석하지 못했습니다.', group); continue; }
      if (dialect === 'cubrid' && parentGroup?.class.name !== 'PrimaryKeyColumnGroup') omitted('CUBRID_NONPRIMARY_PARENT_KEY_UNVERIFIED', 'CUBRID 외래키의 비기본 부모키 참조를 검증하지 못했습니다.', group);
      if (dialect === 'db2' && parentGroup?.class.name === 'AlternateKeyColumnGroup' && !ref(parentGroup, 'uniqueConstraint')) omitted('DB2_FOREIGN_KEY_REQUIRES_CONSTRAINT', 'Db2 부모키에는 UNIQUE 제약이 필요합니다. 단독 유일 인덱스 참조를 확인하지 못했습니다.', group);
      if (!selectedIds.has(parent.id)) omitted('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY', '외래키 부모 테이블이 선택 범위 밖에 있습니다.', group);
      let actions = '';
      const keys = dialect === 'sqlserver' ? ['onDeleteReferentialAction', 'onUpdateReferentialAction'] : ['onDeleteRule', 'onUpdateRule']; used(cp, ...keys);
      for (const [i, key] of keys.entries()) { const value = string(cp, key).replaceAll('_', ' '); const allowed = dialect === 'sqlserver' ? ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'] : i === 1 ? dialect === 'db2' ? ['NO ACTION', 'RESTRICT'] : ['NO ACTION', 'RESTRICT', 'SET NULL'] : ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']; if (value && !allowed.includes(value)) error('INVALID_REFERENTIAL_ACTION', `${dialect}에서 지원하지 않는 참조 동작입니다.`, constraint ?? group); else if (value && value !== 'NO ACTION') actions += ` ON ${i ? 'UPDATE' : 'DELETE'} ${value}`; }
      if (dialect === 'sqlserver') used(cp, 'systemGeneratedName', 'enable', 'notForReplication');
      foreign.push(`ALTER TABLE ${tableName(table)} ADD ${constraintPrefix(constraint, group)}FOREIGN KEY (${members.map(m => identifier(name(m.column), m.column)).join(', ')}) REFERENCES ${tableName(parent)} (${parentColumns.map(c => identifier(name(c), c)).join(', ')})${actions}${dialect === 'sqlserver' && effective(cp, 'notForReplication') === true ? ' NOT FOR REPLICATION' : ''};`);
      if (dialect === 'sqlserver' && effective(cp, 'enable') === false && effective(cp, 'systemGeneratedName') === true) omitted('DISABLED_SYSTEM_NAMED_CONSTRAINT_UNIMPLEMENTED', '서버 자동 이름 제약을 이름으로 비활성화할 수 없습니다.', constraint ?? group); else if (dialect === 'sqlserver' && effective(cp, 'enable') === false) foreign.push(`ALTER TABLE ${tableName(table)} NOCHECK CONSTRAINT ${identifier(name(constraint) || name(group), constraint ?? group)};`);
      statistics.foreignKeys++; if (constraint) comment(table, constraint, 'CONSTRAINT');
      if (field(group, 'useIndexing') === true) { const suffix = dialect === 'sqlserver' ? clustered(gp) : ''; if (suffix === ' CLUSTERED') { if (clusteredCount || implicitPrimaryCluster) error('MULTIPLE_CLUSTERED_INDEXES', '외래키 보조 클러스터 인덱스가 기존 클러스터 키와 충돌합니다.', group); clusteredCount++; } after.push(`CREATE${suffix} INDEX ${indexName(group, table)} ON ${tableName(table)} (${keyColumns(group, false)});`); statistics.indexes++; }
    }
  }
  // Account for every reached DB-specific property, including initialized nested
  // objects. Unsupported fields are never silently erased by a generic quote pass.
  const scanned = new Set<number>();
  function scan(o: BinaryObject | undefined) { if (!o || scanned.has(o.id)) return; scanned.add(o.id); if (o.class.packageUri === namespace) physicalObjects.set(o.id, o); for (const f of o.features) if (definition(o, f.name)?.containment) refs(o, f.name).forEach(scan); }
  for (const o of physicalObjects.values()) scan(o);
  const metadata = new Set(['UUID', 'temporaryContents', 'extendedProperty', 'userDefiendProperty']);
  function neutralInitialization(o: BinaryObject, ancestors = new Set<number>()): boolean {
    if (ancestors.has(o.id)) return false;
    const next = new Set(ancestors); next.add(o.id);
    return o.features.every(f => {
      if (metadata.has(f.name) || f.value === undefined || f.value === null || f.value === '' || Array.isArray(f.value) && !f.value.length) return true;
      const defaultValue = schemaDefault(o, f.name); if (defaultValue !== undefined && String(f.value) === String(defaultValue)) return true;
      const children = refs(o, f.name);
      return !!definition(o, f.name)?.containment && children.length > 0 && children.every(child => neutralInitialization(child, next));
    });
  }
  for (const o of physicalObjects.values()) for (const f of o.features) {
    if (metadata.has(f.name) || handled.get(o.id)?.has(f.name) || f.value === undefined || f.value === null || f.value === '' || Array.isArray(f.value) && !f.value.length) continue;
    const defaultValue = schemaDefault(o, f.name); if (defaultValue !== undefined && String(f.value) === String(defaultValue)) continue;
    if (definition(o, f.name)?.containment && refs(o, f.name).length && refs(o, f.name).every(c => neutralInitialization(c))) continue;
    omitted('ENTERPRISE_PHYSICAL_PROPERTY_UNIMPLEMENTED', '이 DB 물리 옵션의 SQL 의미를 구현하지 않았습니다.', o, f.name);
  }
  for (const o of physicalObjects.values()) for (const key of ['extendedProperty', 'userDefiendProperty']) if (refs(o, key).length) omitted('CUSTOM_DATABASE_PROPERTY_UNINTERPRETED', 'DB 고유 사용자 확장 속성의 의미를 해석하지 않았습니다.', o, key);
  if (string(root, 'customDataTypeFile')) omitted('EXTERNAL_CUSTOM_TYPE_FILE_UNVERIFIED', '외부 자료형 정의를 읽지 않았습니다.', root, 'customDataTypeFile');
  if (!requested) for (const o of objects) if (o.class.packageUri === CORE && ['Sequence', 'View', 'Function', 'Procedure', 'Trigger'].includes(o.class.name)) omitted('DATABASE_OBJECT_UNIMPLEMENTED', '해당 DB 객체의 DDL을 구현하지 않았습니다.', o);
  return result([...before, ...creates, ...after, ...foreign, ...comments].join('\n\n') + (selected.length ? '\n' : ''));
}
