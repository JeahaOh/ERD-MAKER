import type { BinaryObject, BinaryValue } from '../exerd/binary';
import type { NativeExerdDocument } from '../exerd/native-document';
import { validateNativeDocument } from '../exerd/validation';
import { generateNativeMysqlDdl } from './native-mysql-ddl';
import { generateNativeOracleDdl } from './native-oracle-ddl';
import { generateNativeEnterpriseDdl } from './native-enterprise-ddl';

export type NativeDialect = 'postgresql' | 'mysql' | 'mariadb' | 'oracle' | 'sqlserver' | 'db2' | 'tibero' | 'cubrid';
export interface NativeDdlOptions { dialect?: NativeDialect; tableUuids?: string[] }
export interface NativeDdlDiagnostic { code: string; severity: 'error' | 'warning'; message: string; uuid?: string }
export interface NativeDdlUnsupported { code: string; message: string; uuid?: string; feature?: string }
export interface NativeDdlResult {
  sql: string; dialect?: NativeDialect; complete: boolean; executionVerified: false;
  diagnostics: NativeDdlDiagnostic[]; unsupported: NativeDdlUnsupported[];
  statistics: { tables: number; columns: number; primaryKeys: number; foreignKeys: number; uniqueConstraints: number; indexes: number; checks: number; sequences: number };
}
const CORE = 'http://exerd.tomato.com/model', PG = 'http://exerd.tomato.com/postgresql/model';
const DIALECTS: Record<string, NativeDialect> = {
  'com.tomato.db.postgresql': 'postgresql', 'com.tomato.db.mysql': 'mysql', 'com.tomato.db.mariadb': 'mariadb',
  'com.tomato.db.oracle_10g': 'oracle', 'com.tomato.db.sqlserver': 'sqlserver', 'com.tomato.db.sqlserver_2005': 'sqlserver', 'com.tomato.db.db2': 'db2',
  'com.tomato.db.tibero': 'tibero', 'com.tomato.db.cubrid': 'cubrid', 'com.tomato.db.cubrid10': 'cubrid',
};

/** Native graph is authoritative. This generates text only and never connects to a DB.
 * complete means no known omitted semantics/errors in this requested export, not
 * database acceptance. Unsupported dialects return no guessed PostgreSQL SQL.
 */
export function generateNativeDdl(document: NativeExerdDocument, options: NativeDdlOptions = {}): NativeDdlResult {
  const diagnostics: NativeDdlDiagnostic[] = [], unsupported: NativeDdlUnsupported[] = [];
  const statistics = { tables: 0, columns: 0, primaryKeys: 0, foreignKeys: 0, uniqueConstraints: 0, indexes: 0, checks: 0, sequences: 0 };
  const objects = document.graph.objects, byId = new Map(objects.map(object => [object.id, object]));
  const values = new Map(objects.map(object => [object.id, new Map(object.features.map(feature => [feature.name, feature.value]))]));
  const field = (object: BinaryObject | undefined, key: string) => object && values.get(object.id)?.get(key);
  const string = (object: BinaryObject | undefined, key: string) => { const value = field(object, key); return typeof value === 'string' ? value : ''; };
  const uuid = (object: BinaryObject | undefined) => object ? string(object, 'UUID') || `binary:${object.id}` : undefined;
  const refs = (object: BinaryObject | undefined, key: string): BinaryObject[] => {
    const value = field(object, key), entries = Array.isArray(value) ? value : [value];
    return (entries as BinaryValue[]).map(value => value && typeof value === 'object' && !Array.isArray(value) && 'ref' in value ? byId.get(value.ref) : undefined).filter((object): object is BinaryObject => !!object);
  };
  const ref = (object: BinaryObject | undefined, key: string): BinaryObject | undefined => refs(object, key)[0];
  const type = (name: string) => objects.filter(object => object.class.packageUri === CORE && object.class.name === name);
  const root = type('Document')[0], sourceDialect = DIALECTS[string(root, 'productId')];
  const dialect = options.dialect ?? sourceDialect;
  const result = (sql = ''): NativeDdlResult => ({ sql, dialect, complete: !unsupported.length && !diagnostics.some(d => d.severity === 'error'), executionVerified: false, diagnostics, unsupported, statistics });
  const error = (code: string, message: string, object?: BinaryObject) => diagnostics.push({ code, severity: 'error', message, uuid: uuid(object) });
  const omitted = (code: string, message: string, object?: BinaryObject, feature?: string) => {
    const key = `${code}\0${uuid(object)}\0${feature}`;
    if (unsupported.some(item => `${item.code}\0${item.uuid}\0${item.feature}` === key)) return;
    unsupported.push({ code, message, uuid: uuid(object), ...(feature ? { feature } : {}) });
  };
  if (!dialect) { error('UNKNOWN_DATABASE_PRODUCT', '원본 DB 제품을 판별하지 못했습니다. 대상 방언을 명시하고 변환 차이를 검토해야 합니다.', root); return result(); }
  if (sourceDialect !== dialect) { omitted('CROSS_DATABASE_TYPE_CONVERSION_UNVERIFIED', 'DB 간 타입·기본값·물리 속성 변환이 구현되지 않아 SQL을 생성하지 않습니다.', root); return result(); }
  if (dialect === 'mysql' || dialect === 'mariadb') return generateNativeMysqlDdl(document, { ...options, dialect });
  if (dialect === 'oracle' || dialect === 'tibero') return generateNativeOracleDdl(document, { ...options, dialect });
  if (dialect === 'sqlserver' || dialect === 'db2' || dialect === 'cubrid') return generateNativeEnterpriseDdl(document, { ...options, dialect });
  for (const diagnostic of validateNativeDocument(document)) diagnostics.push(diagnostic);

  function identifier(name: string, object?: BinaryObject): string {
    if (!name || name.includes('\0')) { error('INVALID_SQL_IDENTIFIER', '물리 식별자가 비어 있거나 SQL에 사용할 수 없는 문자가 있습니다.', object); return '"<invalid>"'; }
    if (new TextEncoder().encode(name).length > 63) omitted('IDENTIFIER_LENGTH_REQUIRES_DATABASE_CONFIGURATION', '기본 PostgreSQL 식별자 길이 한도를 초과합니다. 서버 빌드 설정과 잘림·충돌 여부를 확인해야 합니다.', object);
    return `"${name.replaceAll('"', '""')}"`;
  }
  function qualifiedIdentifier(name: string, object?: BinaryObject): string {
    // Database metadata may store a qualified identifier, not an SQL expression.
    const parts = name.match(/"(?:[^"]|"")*"|[^."]+/g);
    if (!parts || parts.join('.') !== name) { error('INVALID_QUALIFIED_IDENTIFIER', 'DB 고유 식별자의 구분·인용 형식을 해석하지 못했습니다.', object); return '"<invalid>"'; }
    return parts.map(part => identifier(part.startsWith('"') ? part.slice(1, -1).replaceAll('""', '"') : part, object)).join('.');
  }
  const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function fragment(value: string, object: BinaryObject, feature: string): string | undefined {
    // Preserve expression text, but prevent a single metadata field from injecting
    // extra statements or swallowing the remainder of a generated statement.
    let quote = '', dollar = '', escapeString = false;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (dollar) { if (value.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
      if (quote) {
        if (ch === quote) { if (value[i + 1] === quote) i++; else quote = ''; }
        else if (ch === '\\' && quote === "'" && escapeString) i++;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; escapeString = ch === "'" && i > 0 && /[eE]/.test(value[i - 1]) && (i === 1 || !/[A-Za-z0-9_$]/.test(value[i - 2])); continue; }
      if (ch === '$') { const match = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(value.slice(i)); if (match) { dollar = match[0]; i += dollar.length - 1; continue; } }
      if (ch === ';' || ch === '\0' || value.startsWith('--', i) || value.startsWith('/*', i)) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 독립 SQL 문장 또는 지원하지 않는 주석이 포함돼 해당 구문을 생략했습니다.`, object); return undefined; }
    }
    if (quote || dollar) { error('INVALID_SQL_FRAGMENT', `${feature}의 인용 문자열이 닫히지 않았습니다.`, object); return undefined; }
    return value;
  }
  const database = ref(root, 'databaseModel');
  const schemas = refs(database, 'schema').filter(object => object.class.packageUri === CORE && object.class.name === 'Schema');
  const tables = [...new Map(schemas.flatMap(schema => refs(schema, 'tables')).filter(object => object.class.packageUri === CORE && object.class.name === 'Table').map(table => [table.id, table])).values()];
  const schemaOfTable = new Map<number, BinaryObject>(), tableOfGroup = new Map<number, BinaryObject>();
  for (const schema of schemas) for (const table of refs(schema, 'tables')) schemaOfTable.set(table.id, schema);
  for (const table of tables) for (const group of refs(table, 'columnGroups')) tableOfGroup.set(group.id, table);
  const physicalName = (object: BinaryObject | undefined) => string(object, 'physicalName') || string(object, 'name');
  const keyword = new Set('AND OR NOT NULL TRUE FALSE IS IN LIKE ILIKE SIMILAR TO BETWEEN CASE WHEN THEN ELSE END AS DISTINCT FROM COLLATE ANY ALL SOME ARRAY ROW CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP LOCALTIME LOCALTIMESTAMP INTERVAL'.split(' '));
  let rewrittenExpressions = 0;
  function expressionIdentifiers(expression: string, table: BinaryObject, owner: BinaryObject): string {
    const columnNames = new Map<string, string[]>();
    for (const column of refs(table, 'columns')) { const name = physicalName(column), key = name.toLowerCase(); columnNames.set(key, [...columnNames.get(key) ?? [], name]); }
    let output = '', changed = false, lastWord = '';
    for (let i = 0; i < expression.length;) {
      const ch = expression[i];
      if (ch === "'" || ch === '"') {
        const start = i++, escape = ch === "'" && /[eE]/.test(expression[start - 1] ?? '') && (start < 2 || !/[A-Za-z0-9_$]/.test(expression[start - 2]));
        while (i < expression.length) {
          if (escape && expression[i] === '\\') { i += 2; continue; }
          if (expression[i++] === ch) { if (expression[i] === ch) i++; else break; }
        }
        output += expression.slice(start, i); lastWord = ''; continue;
      }
      if (ch === '$') {
        const delimiter = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(expression.slice(i))?.[0];
        if (delimiter) { const end = expression.indexOf(delimiter, i + delimiter.length); if (end >= 0) { output += expression.slice(i, end + delimiter.length); i = end + delimiter.length; continue; } }
      }
      const token = /^[\p{L}_][\p{L}\p{N}_$]*/u.exec(expression.slice(i))?.[0];
      if (!token) { output += ch; i++; continue; }
      const before = expression.slice(0, i).trimEnd(), after = expression.slice(i + token.length).trimStart();
      const candidates = columnNames.get(token.toLowerCase());
      const isFunction = after.startsWith('('), isQualifier = after.startsWith('.'), isType = before.endsWith('::') || lastWord === 'AS' || lastWord === 'COLLATE';
      const isStringPrefix = /^[eEbBxXnN]$/.test(token) && after.startsWith("'");
      const partOfWord = i > 0 && /[\p{L}\p{N}_$]/u.test(expression[i - 1]);
      if (candidates && !keyword.has(token.toUpperCase()) && !isFunction && !isQualifier && !isType && !isStringPrefix && !partOfWord) {
        if (candidates.length !== 1) { omitted('AMBIGUOUS_EXPRESSION_COLUMN', '표현식의 인용되지 않은 컬럼명을 대소문자 규칙만으로 확정할 수 없습니다.', owner); output += token; }
        else { output += identifier(candidates[0], owner); changed = true; }
      } else output += token;
      lastWord = token.toUpperCase(); i += token.length;
    }
    if (changed) rewrittenExpressions++;
    return output;
  }
  const tableName = (table: BinaryObject) => {
    const schema = schemaOfTable.get(table.id), prefix = physicalName(schema);
    return `${prefix ? identifier(prefix, schema) + '.' : ''}${identifier(physicalName(table), table)}`;
  };
  const requested = options.tableUuids === undefined ? undefined : new Set(options.tableUuids);
  const selectedTables = tables.filter(table => !requested || requested.has(uuid(table)!));
  if (requested) for (const requestedUuid of requested) if (!tables.some(table => uuid(table) === requestedUuid)) diagnostics.push({ code: 'UNKNOWN_TABLE_SELECTION', severity: 'error', message: '내보낼 테이블 식별자를 찾지 못했습니다.', uuid: requestedUuid });
  const selected = new Set(selectedTables.map(table => table.id));
  const domainParent = new Map<number, BinaryObject>();
  for (const domain of type('Domain')) for (const child of refs(domain, 'domain')) domainParent.set(child.id, domain);
  function domainValue(domain: BinaryObject | undefined, name: string): string {
    const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) {
      seen.add(domain.id); const value = field(domain, name);
      if (typeof value === 'string' && (name !== 'suggestedNotNull' || value !== '')) return value;
      domain = domainParent.get(domain.id);
    }
    return '';
  }
  const inherited = (column: BinaryObject, own: string, suggested: string) => {
    const value = field(column, own);
    return typeof value === 'string' && (own !== 'notNull' || value !== '') ? value : domainValue(ref(column, 'domain'), suggested);
  };
  interface Member { column: BinaryObject; membership: BinaryObject; index: number; sequence: number }
  const memberships = new Map<number, Member[]>(); let sequence = 0;
  for (const table of tables) for (const column of refs(table, 'columns')) for (const entry of refs(column, 'memberships')) {
    const membership = ref(entry, 'value'), group = ref(membership, 'group') ?? ref(entry, 'key'); if (!membership || !group) continue;
    const raw = field(membership, 'entryIndex'), index = typeof raw === 'number' ? raw : -1;
    const list = memberships.get(group.id) ?? []; list.push({ column, membership, index, sequence: sequence++ }); memberships.set(group.id, list);
  }
  // The original IndexUtil's PK overload retains Table.columns order. Other
  // groups sort entryIndex and keep table order for equal indices.
  for (const [groupId, list] of memberships) if (byId.get(groupId)?.class.name !== 'PrimaryKeyColumnGroup') list.sort((a, b) => a.index - b.index || a.sequence - b.sequence);
  const primaryColumns = new Set<number>();
  for (const group of type('PrimaryKeyColumnGroup')) for (const member of memberships.get(group.id) ?? []) primaryColumns.add(member.column.id);
  const handled = new Map<number, Set<string>>();
  const used = (object: BinaryObject | undefined, ...names: string[]) => { if (!object) return; const set = handled.get(object.id) ?? new Set(); for (const name of names) set.add(name); handled.set(object.id, set); };
  const physical = (object: BinaryObject | undefined): BinaryObject | undefined => {
    const value = ref(object, 'physicalProperties');
    if (value && value.class.packageUri !== PG) omitted('FOREIGN_DATABASE_PHYSICAL_PROPERTIES', 'PostgreSQL 이외의 물리 속성을 변환하지 않았습니다.', value);
    return value?.class.packageUri === PG ? value : undefined;
  };
  function constraintOptions(constraint: BinaryObject | undefined): string {
    const properties = physical(constraint); used(properties, 'deferrable', 'deferred');
    if (field(properties, 'deferred') === true && field(properties, 'deferrable') !== true) error('INVALID_DEFERRED_CONSTRAINT', 'INITIALLY DEFERRED 제약은 DEFERRABLE이어야 합니다.', constraint);
    return field(properties, 'deferrable') === true ? ` DEFERRABLE${field(properties, 'deferred') === true ? ' INITIALLY DEFERRED' : ' INITIALLY IMMEDIATE'}` : '';
  }
  const constraintPrefix = (constraint: BinaryObject | undefined, group?: BinaryObject) => {
    const name = physicalName(constraint) || physicalName(group); return name ? `CONSTRAINT ${identifier(name, constraint ?? group)} ` : '';
  };
  function indexParts(group: BinaryObject, forConstraint = false): string[] {
    return (memberships.get(group.id) ?? []).map(member => {
      const properties = physical(member.membership), columnName = identifier(physicalName(member.column), member.column);
      if (forConstraint) {
        if (string(member.membership, 'sortType') === 'DESC' || properties?.features.some(f => f.name !== 'UUID')) omitted('CONSTRAINT_INDEX_OPTIONS_NOT_IMPLEMENTED', '키 제약에 지정된 인덱스별 정렬·물리 옵션은 별도 인덱스 구현이 필요합니다.', group);
        return columnName;
      }
      used(properties, 'collation', 'opclass', 'nulls');
      const collation = string(properties, 'collation'), opclass = string(properties, 'opclass');
      return columnName + (collation ? ` COLLATE ${qualifiedIdentifier(collation, properties)}` : '') + (opclass ? ` ${qualifiedIdentifier(opclass, properties)}` : '') + (string(member.membership, 'sortType') === 'DESC' ? ' DESC' : ' ASC') + (field(properties, 'nulls') === true ? ' NULLS FIRST' : ' NULLS LAST');
    });
  }
  const createStatements: string[] = [], postStatements: string[] = [], foreignStatements: string[] = [], comments: string[] = [];
  const selectedSchemas = schemas.filter(schema => !requested || refs(schema, 'tables').some(table => selected.has(table.id)));
  if (selectedSchemas.length) createStatements.push('SET standard_conforming_strings = on;');
  for (const schema of selectedSchemas) if (physicalName(schema)) createStatements.push(`CREATE SCHEMA IF NOT EXISTS ${identifier(physicalName(schema), schema)};`);
  for (const schema of selectedSchemas) {
    const properties = physical(schema), group = ref(properties, 'sequenceGroup'); used(properties, 'sequenceGroup'); used(group, 'sequences');
    for (const sequence of refs(group, 'sequences')) {
      let dataType = '', persistence = '', ownership = '';
      const extension = refs(sequence, 'extendedProperty').filter(entry => string(entry, 'key') === 'erd-maker.postgresql.sequence.v1');
      if (extension.length > 1) omitted('DUPLICATE_SEQUENCE_EXTENSION', '시퀀스 확장 메타데이터가 중복돼 해석하지 않았습니다.', sequence);
      if (extension.length === 1) {
        try {
          const metadata: unknown = JSON.parse(string(extension[0], 'value'));
          if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error();
          const info = metadata as Record<string, unknown>;
          for (const key of Object.keys(info)) if (!['dataType', 'persistence', 'ownedBy'].includes(key)) omitted('UNKNOWN_SEQUENCE_EXTENSION_FIELD', '알 수 없는 시퀀스 확장 필드를 변환하지 않았습니다.', sequence, key);
          if (typeof info.dataType === 'string' && ['smallint', 'integer', 'bigint'].includes(info.dataType)) dataType = ` AS ${info.dataType}`;
          else omitted('INVALID_SEQUENCE_TYPE_EXTENSION', '시퀀스 자료형 확장을 해석하지 못했습니다.', sequence);
          if (info.persistence === 'u') persistence = 'UNLOGGED ';
          else if (info.persistence !== 'p') omitted('SEQUENCE_PERSISTENCE_NOT_IMPLEMENTED', '시퀀스 영속성 확장을 해석하지 못했습니다.', sequence);
          if (info.ownedBy !== undefined) {
            const owned = info.ownedBy;
            if (!owned || typeof owned !== 'object' || Array.isArray(owned)) throw new Error();
            const owner = owned as Record<string, unknown>;
            const table = tables.find(table => uuid(table) === owner.tableUuid), column = table && refs(table, 'columns').find(column => uuid(column) === owner.columnUuid);
            if (!table || !column || !['a', 'i'].includes(String(owner.dependencyType))) omitted('SEQUENCE_OWNERSHIP_UNRESOLVED', '시퀀스 소유 테이블·컬럼·의존 종류를 해석하지 못했습니다.', sequence);
            else if (owner.dependencyType === 'i') omitted('IDENTITY_SEQUENCE_OWNERSHIP_NOT_IMPLEMENTED', 'IDENTITY 내부 소유권을 일반 OWNED BY로 바꾸지 않았습니다.', sequence);
            else if (!selected.has(table.id)) omitted('SEQUENCE_OWNER_OUTSIDE_SELECTION', '시퀀스 소유 컬럼이 선택 범위 밖에 있어 OWNED BY를 생성하지 않았습니다.', sequence);
            else ownership = `${tableName(table)}.${identifier(physicalName(column), column)}`;
            for (const key of Object.keys(owner)) if (!['tableUuid', 'columnUuid', 'dependencyType'].includes(key)) omitted('UNKNOWN_SEQUENCE_OWNERSHIP_FIELD', '알 수 없는 시퀀스 소유권 확장 필드입니다.', sequence, key);
          }
        } catch { omitted('INVALID_SEQUENCE_EXTENSION', '시퀀스 확장 JSON을 해석하지 못했습니다.', sequence); }
      }
      used(sequence, 'name', 'oppositeModeName', 'logicalName', 'physicalName', 'derivedName', 'derivedLogicalName', 'derivedPhysicalName', 'derivedOppositeModeName', 'comment', 'increment', 'start', 'minValue', 'maxValue', 'cache', 'cycle');
      const name = `${identifier(physicalName(schema), schema)}.${identifier(physicalName(sequence), sequence)}`;
      const clauses: string[] = [];
      for (const [key, sql] of [['increment', 'INCREMENT BY'], ['start', 'START WITH'], ['minValue', 'MINVALUE'], ['maxValue', 'MAXVALUE'], ['cache', 'CACHE']] as const) {
        const value = field(sequence, key); if (value === undefined || value === null || value === '') continue;
        if (!/^[+-]?\d+$/.test(String(value))) { error('INVALID_SEQUENCE_VALUE', '시퀀스의 정수 옵션을 해석하지 못했습니다.', sequence); continue; }
        clauses.push(`${sql} ${value}`);
      }
      if (field(sequence, 'cycle') === true) clauses.push('CYCLE');
      createStatements.push(`CREATE ${persistence}SEQUENCE ${name}${dataType}${clauses.length ? ' ' + clauses.join(' ') : ''};`); statistics.sequences++;
      if (ownership) postStatements.push(`ALTER SEQUENCE ${name} OWNED BY ${ownership};`);
      if (string(sequence, 'comment')) comments.push(`COMMENT ON SEQUENCE ${name} IS ${sqlString(string(sequence, 'comment'))};`);
    }
  }
  const vacuumNames: Record<string, string> = { autovacuumEnabled: 'autovacuum_enabled', autovacuumVacuumThreshold: 'autovacuum_vacuum_threshold', autovacuumVacuumScaleFactor: 'autovacuum_vacuum_scale_factor', autovacuumVacuumCostDelay: 'autovacuum_vacuum_cost_delay', autovacuumVacuumCostLimit: 'autovacuum_vacuum_cost_limit', autovacuumFreezeMaxAge: 'autovacuum_freeze_max_age', autovacuumFreezeMinAge: 'autovacuum_freeze_min_age', autovacuumFreezeTableAge: 'autovacuum_freeze_table_age', autovacuumAnalyzeThreshold: 'autovacuum_analyze_threshold', autovacuumAnalyzeScaleFactor: 'autovacuum_analyze_scale_factor' };
  for (const table of selectedTables) {
    const tablePhysical = physical(table), bodies: string[] = [];
    used(tablePhysical, 'fillfactor', 'tablespace', 'unlogged', 'tableVacuum', 'toastVacuum', 'oids');
    if (field(tablePhysical, 'oids') === true) omitted('LEGACY_TABLE_OIDS', 'OID 테이블 옵션은 현재 PostgreSQL에서 지원되지 않아 내보내지 않았습니다.', tablePhysical, 'oids');
    for (const column of refs(table, 'columns')) {
      const dataType = fragment(inherited(column, 'dataType', 'suggestedDataType'), column, 'dataType');
      if (!dataType?.trim()) { error('COLUMN_TYPE_MISSING', 'DDL에 필요한 물리 자료형이 없습니다.', column); continue; }
      const defaultValue = inherited(column, 'defaultValue', 'suggestedDefaultValue'), defaultSql = defaultValue ? fragment(defaultValue, column, 'defaultValue') : '';
      const nullable = !primaryColumns.has(column.id) && inherited(column, 'notNull', 'suggestedNotNull') !== 'TRUE';
      const columnPhysical = physical(column), collation = string(columnPhysical, 'collation'); used(columnPhysical, 'collation');
      bodies.push(`${identifier(physicalName(column), column)} ${dataType}${collation ? ` COLLATE ${qualifiedIdentifier(collation, columnPhysical)}` : ''}${defaultSql ? ` DEFAULT ${defaultSql}` : ''}${nullable ? '' : ' NOT NULL'}`);
      if (string(column, 'comment')) comments.push(`COMMENT ON COLUMN ${tableName(table)}.${identifier(physicalName(column), column)} IS ${sqlString(string(column, 'comment'))};`);
      statistics.columns++;
    }
    for (const group of refs(table, 'columnGroups')) {
      const members = memberships.get(group.id) ?? [], properties = physical(group);
      if (!members.length) { error('EMPTY_COLUMN_GROUP', '컬럼이 없는 키·인덱스 구문을 생성하지 않았습니다.', group); continue; }
      if (group.class.name === 'PrimaryKeyColumnGroup' || group.class.name === 'AlternateKeyColumnGroup') {
        const key = group.class.name === 'PrimaryKeyColumnGroup' ? 'primaryKeyConstraint' : 'uniqueConstraint', constraint = ref(group, key);
        if (constraint || key === 'primaryKeyConstraint') {
          if (physicalName(constraint) && physicalName(group) && physicalName(constraint) !== physicalName(group)) omitted('CONSTRAINT_INDEX_NAME_DIFFERENCE', '제약 이름과 인덱스 이름이 다릅니다. PostgreSQL의 제약 소유 인덱스 명명 규칙과 대조해야 합니다.', group);
          bodies.push(`${constraintPrefix(constraint, group)}${key === 'primaryKeyConstraint' ? 'PRIMARY KEY' : 'UNIQUE'} (${indexParts(group, true).join(', ')})${constraintOptions(constraint)}`);
          if (key === 'primaryKeyConstraint') statistics.primaryKeys++; else statistics.uniqueConstraints++;
          // PostgreSQL materializes these constraint indexes itself. Nondefault
          // index physical options require an explicit independently handled path.
          continue;
        }
      }
      if (['InversionEntryColumnGroup', 'AlternateKeyColumnGroup'].includes(group.class.name) || group.class.name === 'ForeignKeyColumnGroup' && field(group, 'useIndexing') === true) {
        used(properties, 'methodKind', 'fillfactor', 'tablespace', 'condition');
        const method = string(properties, 'methodKind').toLowerCase();
        if (method && !['btree', 'hash', 'gist', 'spgist', 'gin', 'brin'].includes(method)) { error('INVALID_INDEX_METHOD', '인덱스 접근 방식을 해석하지 못했습니다.', group); continue; }
        const condition = string(properties, 'condition'), rawPredicate = condition ? fragment(condition, group, 'condition') : '';
        const predicate = rawPredicate ? expressionIdentifiers(rawPredicate, table, group) : '';
        const fillfactor = field(properties, 'fillfactor'), tablespace = string(properties, 'tablespace');
        const storage = typeof fillfactor === 'number' && fillfactor > 0 ? ` WITH (fillfactor = ${fillfactor})` : '';
        postStatements.push(`CREATE ${group.class.name === 'AlternateKeyColumnGroup' ? 'UNIQUE ' : ''}INDEX ${identifier(physicalName(group), group)} ON ${tableName(table)}${method ? ` USING ${method}` : ''} (${indexParts(group).join(', ')})${storage}${tablespace ? ` TABLESPACE ${identifier(tablespace, properties)}` : ''}${predicate ? ` WHERE ${predicate}` : ''};`);
        statistics.indexes++;
      } else if (group.class.name !== 'ForeignKeyColumnGroup' && !['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup'].includes(group.class.name)) omitted('COLUMN_GROUP_KIND_NOT_IMPLEMENTED', '이 컬럼 그룹 종류의 SQL 의미를 구현하지 않았습니다.', group);
    }
    const tableOptions: string[] = [];
    const fillfactor = field(tablePhysical, 'fillfactor'); if (typeof fillfactor === 'number' && fillfactor > 0) tableOptions.push(`fillfactor = ${fillfactor}`);
    for (const [key, prefix] of [['tableVacuum', ''], ['toastVacuum', 'toast.']] as const) {
      const vacuum = ref(tablePhysical, key);
      for (const feature of vacuum?.features ?? []) {
        const name = vacuumNames[feature.name]; if (!name) continue;
        used(vacuum, feature.name);
        if (typeof feature.value === 'boolean') tableOptions.push(`${prefix}${name} = ${feature.value}`);
        else if (/^(?:\d+)(?:\.\d+)?$/.test(String(feature.value))) tableOptions.push(`${prefix}${name} = ${feature.value}`);
        else if (String(feature.value) !== '-1') error('INVALID_TABLE_STORAGE_OPTION', '테이블의 저장 옵션 수치를 해석하지 못했습니다.', vacuum);
      }
    }
    const tablespace = string(tablePhysical, 'tablespace');
    createStatements.push(`CREATE ${field(tablePhysical, 'unlogged') === true ? 'UNLOGGED ' : ''}TABLE ${tableName(table)} (\n  ${bodies.join(',\n  ')}\n)${tableOptions.length ? ` WITH (${tableOptions.join(', ')})` : ''}${tablespace ? ` TABLESPACE ${identifier(tablespace, tablePhysical)}` : ''};`); statistics.tables++;
    if (string(table, 'comment')) comments.push(`COMMENT ON TABLE ${tableName(table)} IS ${sqlString(string(table, 'comment'))};`);
    for (const check of refs(table, 'checkConstraints')) {
      const rawExpression = fragment(string(check, 'expression'), check, 'CHECK expression'); if (!rawExpression?.trim()) { error('CHECK_EXPRESSION_MISSING', 'CHECK 제약의 표현식이 없습니다.', check); continue; }
      const expression = expressionIdentifiers(rawExpression, table, check);
      const properties = physical(check); used(properties, 'noInherit', 'validated');
      postStatements.push(`ALTER TABLE ${tableName(table)} ADD ${constraintPrefix(check)}CHECK (${expression})${field(properties, 'noInherit') === true ? ' NO INHERIT' : ''}${field(properties, 'validated') === true ? ' NOT VALID' : ''};`); statistics.checks++;
    }
    for (const group of refs(table, 'columnGroups').filter(group => group.class.name === 'ForeignKeyColumnGroup')) {
      const parentGroup = ref(group, 'parentColumnGroup'), parent = parentGroup && tableOfGroup.get(parentGroup.id);
      const members = memberships.get(group.id) ?? [], parentColumns = members.map(member => ref(member.membership, 'parentColumn'));
      if (!parent || !members.length || parentColumns.some(column => !column)) { error('INCOMPLETE_FOREIGN_KEY', '외래키의 테이블·컬럼 대응을 해석하지 못해 구문을 생성하지 않았습니다.', group); continue; }
      if (!selected.has(parent.id)) omitted('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY', '선택 범위 밖 부모 테이블이 필요합니다. 대상 DB에 부모키가 존재하는지 확인해야 합니다.', group);
      const constraint = ref(group, 'foreignKeyConstraint'), properties = physical(constraint); used(properties, 'onDeleteRule', 'onUpdateRule', 'match', 'validated');
      let actions = '';
      for (const [key, sql] of [['onDeleteRule', 'DELETE'], ['onUpdateRule', 'UPDATE']] as const) {
        const action = string(properties, key).replaceAll('_', ' ').toUpperCase();
        if (action && !['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'].includes(action)) error('INVALID_REFERENTIAL_ACTION', '외래키 참조 동작을 해석하지 못했습니다.', constraint);
        else if (action && action !== 'NO ACTION') actions += ` ON ${sql} ${action}`;
      }
      const match = string(properties, 'match').toUpperCase();
      if (match && !['SIMPLE', 'FULL', 'PARTIAL'].includes(match)) error('INVALID_FOREIGN_KEY_MATCH', 'FK MATCH 형식을 해석하지 못했습니다.', constraint);
      if (match === 'PARTIAL') omitted('MATCH_PARTIAL_NOT_SUPPORTED_BY_POSTGRESQL', 'PostgreSQL이 구현하지 않은 MATCH PARTIAL은 내보내지 않았습니다.', constraint);
      foreignStatements.push(`ALTER TABLE ${tableName(table)} ADD ${constraintPrefix(constraint, group)}FOREIGN KEY (${members.map(member => identifier(physicalName(member.column), member.column)).join(', ')}) REFERENCES ${tableName(parent)} (${parentColumns.map(column => identifier(physicalName(column), column)).join(', ')})${match && match !== 'PARTIAL' ? ` MATCH ${match}` : ''}${actions}${constraintOptions(constraint)}${field(properties, 'validated') === true ? ' NOT VALID' : ''};`); statistics.foreignKeys++;
    }
  }
  // Report every persisted, unhandled DB-specific property. Empty initialized
  // containers/UUID-only property objects do not imply omitted SQL options.
  const relevant = new Set<number>();
  const scan = (object: BinaryObject | undefined) => {
    if (!object || relevant.has(object.id)) return; relevant.add(object.id);
    for (const feature of object.features) if (feature.name !== 'temporaryContents') for (const child of refs(object, feature.name)) if (child.class.packageUri === PG) scan(child);
  };
  for (const table of selectedTables) {
    scan(physical(table));
    for (const object of [...refs(table, 'columns'), ...refs(table, 'columnGroups'), ...refs(table, 'checkConstraints')]) {
      scan(physical(object));
      for (const key of ['primaryKeyConstraint', 'uniqueConstraint', 'foreignKeyConstraint']) scan(physical(ref(object, key)));
      for (const entry of refs(object, 'memberships')) scan(physical(ref(entry, 'value')));
    }
  }
  for (const schema of selectedSchemas) scan(physical(schema));
  if (selectedTables.length) scan(physical(database));
  if (string(root, 'customDataTypeFile')) omitted('EXTERNAL_CUSTOM_TYPE_FILE_UNVERIFIED', '외부 사용자 정의 타입 파일의 해석 결과를 검증하지 않았습니다.', root, 'customDataTypeFile');
  const metadata = new Set(['UUID', 'temporaryContents', 'userDefiendProperty', 'extendedProperty']);
  for (const id of relevant) {
    const object = byId.get(id)!;
    for (const feature of object.features) {
      if (metadata.has(feature.name) || handled.get(id)?.has(feature.name) || feature.value === null || feature.value === '' || Array.isArray(feature.value) && !feature.value.length) continue;
      // Structural references to empty initialized groups are not SQL settings.
      const children = refs(object, feature.name);
      if (children.length && children.every(child => child.features.every(f => metadata.has(f.name) || Array.isArray(f.value) && !f.value.length))) continue;
      omitted('PHYSICAL_PROPERTY_NOT_IMPLEMENTED', '해당 DB 물리 옵션의 SQL 변환을 구현하지 않았습니다.', object, feature.name);
    }
  }
  if (options.tableUuids === undefined) for (const name of ['View', 'Function', 'Procedure', 'Trigger']) for (const object of type(name)) omitted('DATABASE_OBJECT_NOT_IMPLEMENTED', `${name} 객체의 DDL 생성은 아직 구현하지 않았습니다.`, object);
  if (rewrittenExpressions) diagnostics.push({ code: 'EXPRESSION_COLUMN_IDENTIFIERS_QUOTED', severity: 'warning', message: `${rewrittenExpressions}개 표현식의 인용되지 않은 모델 컬럼명을 출력 식별자와 일치하도록 인용했습니다. 원본 모델의 표현식은 변경하지 않았습니다.` });
  return result([...createStatements, ...postStatements, ...foreignStatements, ...comments].join('\n\n') + (selectedSchemas.length ? '\n' : ''));
}
