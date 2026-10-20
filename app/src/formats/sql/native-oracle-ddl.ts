import type { BinaryObject, BinaryValue } from '../exerd/binary';
import type { NativeExerdDocument } from '../exerd/native-document';
import { validateNativeDocument } from '../exerd/validation';
import type { NativeDdlResult } from './native-ddl';

export interface NativeOracleDdlOptions { dialect: 'oracle' | 'tibero'; tableUuids?: string[] }
const CORE = 'http://exerd.tomato.com/model';
const PRODUCTS = { oracle: { id: 'com.tomato.db.oracle_10g', uri: 'http://exerd.tomato.com/oracle10g' }, tibero: { id: 'com.tomato.db.tibero', uri: 'http://exerd.tomato.com/tibero/model' } };

/** Independent generators share graph traversal, not a claim of cross-DB compatibility. */
export function generateNativeOracleDdl(document: NativeExerdDocument, options: NativeOracleDdlOptions): NativeDdlResult {
  const result: NativeDdlResult = { sql: '', dialect: options.dialect, complete: false, executionVerified: false, diagnostics: [], unsupported: [], statistics: { tables: 0, columns: 0, primaryKeys: 0, foreignKeys: 0, uniqueConstraints: 0, indexes: 0, checks: 0, sequences: 0 } };
  const product = PRODUCTS[options.dialect], oracle = options.dialect === 'oracle', objects = document.graph.objects;
  const byId = new Map(objects.map(object => [object.id, object])), fields = new Map(objects.map(object => [object.id, new Map(object.features.map(feature => [feature.name, feature.value]))]));
  const value = (object: BinaryObject | undefined, name: string) => object && fields.get(object.id)?.get(name);
  const string = (object: BinaryObject | undefined, name: string) => typeof value(object, name) === 'string' ? value(object, name) as string : '';
  const id = (object?: BinaryObject) => object ? string(object, 'UUID') || `binary:${object.id}` : undefined;
  const refs = (object: BinaryObject | undefined, name: string): BinaryObject[] => {
    const item = value(object, name), items = Array.isArray(item) ? item : [item];
    return (items as BinaryValue[]).flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && 'ref' in item && byId.has(item.ref) ? [byId.get(item.ref)!] : []);
  };
  const ref = (object: BinaryObject | undefined, name: string) => refs(object, name)[0];
  const core = (name: string) => objects.filter(object => object.class.packageUri === CORE && object.class.name === name);
  const name = (object: BinaryObject | undefined) => string(object, 'physicalName') || string(object, 'name');
  const error = (code: string, message: string, object?: BinaryObject) => result.diagnostics.push({ code, severity: 'error', message, uuid: id(object) });
  const warning = (code: string, message: string, object?: BinaryObject) => result.diagnostics.push({ code, severity: 'warning', message, uuid: id(object) });
  const omitted = (code: string, message: string, object?: BinaryObject, feature?: string) => {
    if (!result.unsupported.some(item => item.code === code && item.uuid === id(object) && item.feature === feature)) result.unsupported.push({ code, message, uuid: id(object), ...(feature ? { feature } : {}) });
  };
  const root = core('Document')[0];
  if (!product || string(root, 'productId') !== product.id) { omitted('CROSS_DATABASE_TYPE_CONVERSION_UNVERIFIED', '원본 DB 제품과 요청 방언이 다릅니다. 자료형·기본값·물리 옵션을 다른 DB로 추정 변환하지 않습니다.', root); return result; }
  result.diagnostics.push(...validateNativeDocument(document));
  const handled = new Map<number, Set<string>>(), physicalRoots = new Set<number>();
  const used = (object: BinaryObject | undefined, ...names: string[]) => { if (object) { const set = handled.get(object.id) ?? new Set(); names.forEach(name => set.add(name)); handled.set(object.id, set); } };
  const physical = (object: BinaryObject | undefined) => {
    const properties = ref(object, 'physicalProperties');
    if (properties) physicalRoots.add(properties.id);
    if (properties && properties.class.packageUri !== product.uri) { omitted('FOREIGN_DATABASE_PHYSICAL_PROPERTIES', '다른 DB의 물리 속성이 연결되어 있어 변환하지 않았습니다.', properties); return undefined; }
    return properties;
  };
  const q = (text: string, object?: BinaryObject) => {
    if (!text || /[\u0000-\u001f]/u.test(text)) { error('INVALID_SQL_IDENTIFIER', '물리 식별자가 비어 있거나 제어 문자를 포함합니다.', object); return '"<invalid>"'; }
    if (new TextEncoder().encode(text).length > (oracle ? 30 : 128)) omitted('IDENTIFIER_VERSION_OR_CHARSET_REQUIRES_REVIEW', '원본 DB 세대의 식별자 길이 또는 문자셋 한도를 확인해야 합니다.', object);
    return `"${text.replaceAll('"', '""')}"`;
  };
  const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
  function fragment(text: string, object: BinaryObject, feature: string): string | undefined {
    let quote = '', alternative = '';
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (alternative) { if (text.startsWith(alternative + "'", index)) { index++; alternative = ''; } continue; }
      if (quote) { if (char === quote) { if (text[index + 1] === quote) index++; else quote = ''; } continue; }
      if ((char === 'q' || char === 'Q') && text[index + 1] === "'") {
        if (!oracle) omitted('TIBERO_ALTERNATIVE_QUOTING_UNVERIFIED', 'Tibero 대체 인용 구문의 서버 버전 호환성을 검증하지 않았습니다.', object, feature);
        const opening = text[index + 2]; if (!opening || /\s/u.test(opening)) { error('INVALID_SQL_FRAGMENT', '대체 인용 문자열 구분자가 올바르지 않습니다.', object); return undefined; }
        alternative = ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string, string>)[opening] ?? opening; index += 2; continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === ';' || char === '\0' || text.startsWith('--', index) || text.startsWith('/*', index)) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 독립 문장 또는 지원하지 않는 주석이 있어 해당 구문을 생략했습니다.`, object); return undefined; }
    }
    if (quote || alternative) { error('INVALID_SQL_FRAGMENT', `${feature}의 인용 문자열이 닫히지 않았습니다.`, object); return undefined; }
    return text;
  }
  function integer(object: BinaryObject | undefined, feature: string, minimum: number, maximum?: number): string | undefined {
    const raw = value(object, feature); if (raw === undefined || raw === null) return undefined;
    const text = String(raw);
    if (!/^-?\d+$/.test(text) || BigInt(text) < BigInt(minimum) || maximum !== undefined && BigInt(text) > BigInt(maximum)) { error('INVALID_PHYSICAL_INTEGER', `${feature} 수치가 지원 범위를 벗어났습니다.`, object); return undefined; }
    return text;
  }
  function toggle(object: BinaryObject | undefined, feature: string, on: string, off: string): string[] {
    used(object, feature); const raw = value(object, feature); return typeof raw === 'boolean' ? [raw ? on : off] : [];
  }
  function oracleTableToggle(object: BinaryObject | undefined, feature: string, on: string, off: string, fallback = false): string[] {
    if (!object) return [];
    used(object, feature);
    const raw = value(object, feature), enabled = typeof raw === 'boolean' ? raw : fallback;
    // Preserve getter defaults instead of inheriting target tablespace settings.
    return [enabled ? on : off];
  }
  function storage(object: BinaryObject | undefined, isIndex = false): string[] {
    if (!object) return [];
    const output: string[] = [];
    const mappings = oracle ? [['freeSpacePercent', 'PCTFREE', 0, 99], ['usedSpacePercent', 'PCTUSED', 0, 99], ['initialTransations', 'INITRANS', 1, 255]] as const : [['freeSpacePercent', 'PCTFREE', 0, 99], ['initialTransactions', 'INITRANS', 1, 255]] as const;
    for (const [feature, keyword, minimum, maximum] of mappings) {
      if (isIndex && feature === 'usedSpacePercent') continue;
      used(object, feature); const number = integer(object, feature, minimum, maximum); if (number !== undefined) output.push(`${keyword} ${number}`);
    }
    if (oracle && !isIndex && typeof value(object, 'freeSpacePercent') === 'number' && typeof value(object, 'usedSpacePercent') === 'number' && Number(value(object, 'freeSpacePercent')) + Number(value(object, 'usedSpacePercent')) > 100) error('INVALID_BLOCK_SPACE_PERCENT', 'PCTFREE와 PCTUSED 합은 100을 초과할 수 없습니다.', object);
    if (!oracle) {
      used(object, 'tablespaceName'); if (string(object, 'tablespaceName')) output.push(`TABLESPACE ${q(string(object, 'tablespaceName'), object)}`);
      output.push(...toggle(object, 'logging', 'LOGGING', 'NOLOGGING'));
    }
    used(object, 'storage'); const detail = ref(object, 'storage'), settings: string[] = [];
    if (detail) {
      const pairs = oracle ? [['initialExtentSize', 'INITIAL', 1], ['nextExtentSize', 'NEXT', 1], ['minExtents', 'MINEXTENTS', 1], ['maxExtents', 'MAXEXTENTS', 1], ['percentIncrease', 'PCTINCREASE', 0], ['freeLists', 'FREELISTS', 1], ['freeListGroups', 'FREELIST GROUPS', 1]] as const : [['maxExtents', 'MAXEXTENTS', 1]] as const;
      const maxKind = typeof value(detail, 'maxExtentsType') === 'string' ? string(detail, 'maxExtentsType') : 'UNLIMITED';
      for (const [feature, keyword, minimum] of pairs) { used(detail, feature); const number = integer(detail, feature, minimum); if (number !== undefined && (oracle || maxKind !== 'UNLIMITED')) settings.push(`${keyword} ${number}`); }
      if (!oracle) { used(detail, 'maxExtentsType'); if (maxKind === 'UNLIMITED') settings.push('MAXEXTENTS UNLIMITED'); else if (maxKind !== 'SIZE') omitted('UNKNOWN_MAX_EXTENTS_KIND', 'Tibero 최대 extent 형식을 해석하지 못했습니다.', detail); }
      used(detail, 'bufferPool'); const pool = string(detail, 'bufferPool');
      if (pool && ['DEFAULT', 'KEEP', 'RECYCLE'].includes(pool)) settings.push(`BUFFER_POOL ${pool}`); else if (pool) error('INVALID_BUFFER_POOL', '지원하지 않는 버퍼 풀 값입니다.', detail);
      if (settings.length) output.push(`STORAGE (${settings.join(' ')})`);
    }
    return output;
  }
  const database = ref(root, 'databaseModel'), schemas = refs(database, 'schema'), tables = schemas.flatMap(schema => refs(schema, 'tables'));
  const schemaOf = new Map<number, BinaryObject>(), tableOfGroup = new Map<number, BinaryObject>();
  for (const schema of schemas) for (const table of refs(schema, 'tables')) schemaOf.set(table.id, schema);
  for (const table of tables) for (const group of refs(table, 'columnGroups')) tableOfGroup.set(group.id, table);
  const qualified = (object: BinaryObject, schema?: BinaryObject) => `${schema && name(schema) ? q(name(schema), schema) + '.' : ''}${q(name(object), object)}`;
  const tableName = (table: BinaryObject) => qualified(table, schemaOf.get(table.id));
  const requested = options.tableUuids === undefined ? undefined : new Set(options.tableUuids), selected = tables.filter(table => !requested || requested.has(id(table)!));
  if (requested) for (const key of requested) if (!tables.some(table => id(table) === key)) result.diagnostics.push({ code: 'UNKNOWN_TABLE_SELECTION', severity: 'error', message: '선택한 테이블이 원본 모델에 없습니다.', uuid: key });
  const selectedIds = new Set(selected.map(table => table.id)), selectedSchemas = requested ? schemas.filter(schema => selected.some(table => schemaOf.get(table.id) === schema)) : schemas;
  const parents = new Map<number, BinaryObject>();
  for (const domain of core('Domain')) for (const child of refs(domain, 'domain')) parents.set(child.id, domain);
  function inherited(column: BinaryObject, own: string, suggested: string): string {
    const local = value(column, own); if (typeof local === 'string' && (own !== 'notNull' || local !== '')) return local;
    let domain: BinaryObject | undefined = ref(column, 'domain'); const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) { seen.add(domain.id); const field = value(domain, suggested); if (typeof field === 'string' && (suggested !== 'suggestedNotNull' || field !== '')) return field; domain = parents.get(domain.id); }
    return '';
  }
  interface Member { column: BinaryObject; membership: BinaryObject; order: number; sequence: number }
  const members = new Map<number, Member[]>(); let sequence = 0;
  for (const table of tables) for (const column of refs(table, 'columns')) for (const entry of refs(column, 'memberships')) {
    const membership = ref(entry, 'value'), group = ref(membership, 'group') ?? ref(entry, 'key'); if (!membership || !group) continue;
    const list = members.get(group.id) ?? [], raw = value(membership, 'entryIndex'); list.push({ column, membership, order: typeof raw === 'number' ? raw : -1, sequence: sequence++ }); members.set(group.id, list);
  }
  for (const [key, list] of members) if (byId.get(key)?.class.name !== 'PrimaryKeyColumnGroup') list.sort((a, b) => a.order - b.order || a.sequence - b.sequence);
  const primary = new Set(core('PrimaryKeyColumnGroup').flatMap(group => (members.get(group.id) ?? []).map(member => member.column.id)));
  const statements: string[] = [], indexes: string[] = [], constraints: string[] = [], foreign: string[] = [], comments: string[] = [];
  let quotedExpressions = 0;
  function expressionColumns(expression: string, table: BinaryObject): string {
    const names = new Map(refs(table, 'columns').map(column => [name(column).toUpperCase(), column]));
    const keywords = new Set('AND OR NOT NULL IS IN LIKE BETWEEN CASE WHEN THEN ELSE END AS DATE TIMESTAMP INTERVAL CURRENT_DATE CURRENT_TIMESTAMP SYSDATE SYSTIMESTAMP TRUE FALSE'.split(' '));
    let output = '', changed = false;
    for (let index = 0; index < expression.length;) {
      const remaining = expression.slice(index), alternative = /^(?:[nN])?[qQ]'([\[({<]|[^\s'])/u.exec(remaining);
      if (alternative) { const endChar = ({ '[': ']', '{': '}', '(': ')', '<': '>' } as Record<string,string>)[alternative[1]] ?? alternative[1], end = expression.indexOf(endChar + "'", index + alternative[0].length); if (end >= 0) { output += expression.slice(index, end + 2); index = end + 2; continue; } }
      if (expression[index] === "'" || expression[index] === '"') {
        const quote = expression[index], start = index++;
        while (index < expression.length) if (expression[index++] === quote) { if (expression[index] === quote) index++; else break; }
        output += expression.slice(start, index); continue;
      }
      const token = /^[\p{L}_][\p{L}\p{N}_$#]*/u.exec(remaining)?.[0];
      if (!token) { output += expression[index++]; continue; }
      const column = names.get(token.toUpperCase()), after = expression.slice(index + token.length).trimStart(), before = expression.slice(0, index).trimEnd();
      if (column && !keywords.has(token.toUpperCase()) && !after.startsWith('(') && !after.startsWith('.') && !before.endsWith('.') && !(index && /[\p{L}\p{N}_$#]/u.test(expression[index - 1]))) { output += q(name(column), column); changed = true; } else output += token;
      index += token.length;
    }
    if (changed) quotedExpressions++;
    return output;
  }
  function state(constraint: BinaryObject | undefined, index = ''): string {
    const properties = physical(constraint); if (!properties) return oracle ? index : '';
    if (!oracle) return ''; // Tibero.status is not Oracle.enabled; explicit status is reported below.
    used(properties, 'enabled', 'validated', 'deferrable', 'deferred', 'generated');
    const deferrable = value(properties, 'deferrable') === true, deferred = value(properties, 'deferred') === true;
    if (deferred && !deferrable) error('INVALID_DEFERRED_CONSTRAINT', 'INITIALLY DEFERRED에는 DEFERRABLE이 필요합니다.', constraint);
    return `${deferrable ? ` DEFERRABLE INITIALLY ${deferred ? 'DEFERRED' : 'IMMEDIATE'}` : ' NOT DEFERRABLE'}${value(properties, 'enabled') === false ? '' : index} ${value(properties, 'enabled') === false ? 'DISABLE' : 'ENABLE'} ${value(properties, 'validated') === false ? 'NOVALIDATE' : 'VALIDATE'}`;
  }
  const prefix = (constraint: BinaryObject | undefined, group?: BinaryObject) => name(constraint) || name(group) ? `CONSTRAINT ${q(name(constraint) || name(group), constraint ?? group)} ` : '';
  function indexSql(table: BinaryObject, group: BinaryObject, unique: boolean): string | undefined {
    const list = members.get(group.id) ?? [], properties = physical(group); if (!list.length) { error('EMPTY_COLUMN_GROUP', '컬럼 없는 키·인덱스를 생성하지 않습니다.', group); return; }
    const clauses: string[] = [], names = list.map(member => `${q(name(member.column), member.column)} ${string(member.membership, 'sortType') === 'DESC' ? 'DESC' : 'ASC'}`);
    let bitmap = false, reverse = false;
    if (oracle && properties) {
      used(properties, 'tablespaceName', 'storageAttributes', 'logging', 'compression', 'compressColumns', 'indexType', 'uniqueness', 'parallel', 'sorted', 'online', 'computeStatistics', 'monitoring', 'generated', 'indexLogicalType', 'indexedObjectType');
      const kind = string(properties, 'indexType'), uniqueness = typeof value(properties, 'uniqueness') === 'string' ? string(properties, 'uniqueness') : 'UNIQUE'; reverse = kind === 'NORMAL/REV'; bitmap = uniqueness === 'BITMAP';
      if (kind && !['NORMAL', 'NORMAL/REV'].includes(kind)) omitted('ORACLE_INDEX_KIND_NOT_IMPLEMENTED', '이 Oracle 인덱스 종류는 별도 구문이 필요합니다.', properties, 'indexType');
      unique = uniqueness === 'UNIQUE';
      if (!['UNIQUE', 'NONUNIQUE', 'BITMAP'].includes(uniqueness)) error('INVALID_INDEX_UNIQUENESS', '인덱스 고유성 값을 해석하지 못했습니다.', properties);
      clauses.push(...storage(ref(properties, 'storageAttributes'), true));
      if (string(properties, 'tablespaceName')) clauses.push(`TABLESPACE ${q(string(properties, 'tablespaceName'), properties)}`);
      clauses.push(value(properties, 'logging') === true ? 'LOGGING' : 'NOLOGGING');
      if (value(properties, 'compression') === true) {
        if (bitmap || unique && list.length < 2) error('INVALID_INDEX_PREFIX_COMPRESSION', 'BITMAP 또는 단일 컬럼 UNIQUE 인덱스에 접두 압축을 사용할 수 없습니다.', group);
        else { const count = integer(properties, 'compressColumns', 1, list.length - (unique ? 1 : 0)); clauses.push(`COMPRESS${count ? ` ${count}` : ''}`); }
      } else if (value(properties, 'compression') === false) clauses.push('NOCOMPRESS');
      if (value(properties, 'sorted') === false) clauses.push('NOSORT');
      if (value(properties, 'online') === true) clauses.push('ONLINE');
      if (value(properties, 'computeStatistics') === true) clauses.push('COMPUTE STATISTICS');
      const parallel = ref(properties, 'parallel'); if (parallel) { used(parallel, 'useParallel', 'degree'); if (value(parallel, 'useParallel') === true) { const degree = integer(parallel, 'degree', 1); clauses.push(`PARALLEL${degree ? ` ${degree}` : ''}`); } else if (value(parallel, 'useParallel') === false) clauses.push('NOPARALLEL'); }
      if (value(properties, 'monitoring') === true) omitted('INDEX_MONITORING_NOT_IMPLEMENTED', '인덱스 모니터링 설정은 별도 ALTER INDEX가 필요합니다.', properties, 'monitoring');
    } else if (properties) {
      used(properties, 'unusable', 'indexAttribute'); const attribute = ref(properties, 'indexAttribute');
      used(attribute, 'reverse', 'online', 'segmentAttribute'); reverse = value(attribute, 'reverse') === true;
      clauses.push(...storage(ref(attribute, 'segmentAttribute'), true)); if (value(attribute, 'online') === true) clauses.push('ONLINE'); if (value(properties, 'unusable') === true) clauses.push('UNUSABLE');
    }
    if (bitmap && unique || reverse && (bitmap || clauses.includes('NOSORT') || list.some(member => string(member.membership, 'sortType') === 'DESC'))) { error('INCOMPATIBLE_INDEX_OPTIONS', 'BITMAP·UNIQUE·REVERSE·DESC·NOSORT 조합을 함께 사용할 수 없습니다.', group); return; }
    if (reverse) clauses.push('REVERSE');
    return `CREATE ${bitmap ? 'BITMAP ' : unique ? 'UNIQUE ' : ''}INDEX ${qualified(group, schemaOf.get(table.id))} ON ${tableName(table)} (${names.join(', ')})${clauses.length ? ' ' + clauses.join(' ') : ''};`;
  }
  for (const table of selected) {
    const properties = physical(table), columns: string[] = [], clauses: string[] = [];
    for (const column of refs(table, 'columns')) {
      physical(column);
      for (const entry of refs(column, 'memberships')) physical(ref(entry, 'value'));
      const type = fragment(inherited(column, 'dataType', 'suggestedDataType'), column, 'dataType');
      if (!type?.trim()) { error('COLUMN_TYPE_MISSING', '물리 자료형이 없어 해당 컬럼을 출력하지 않았습니다.', column); continue; }
      const defaultValue = inherited(column, 'defaultValue', 'suggestedDefaultValue'), defaultSql = defaultValue ? fragment(defaultValue, column, 'defaultValue') : '';
      columns.push(`${q(name(column), column)} ${type}${defaultSql ? ` DEFAULT ${defaultSql}` : ''}${primary.has(column.id) || inherited(column, 'notNull', 'suggestedNotNull') === 'TRUE' ? ' NOT NULL' : ' NULL'}`); result.statistics.columns++;
      if (string(column, 'comment')) comments.push(`COMMENT ON COLUMN ${tableName(table)}.${q(name(column), column)} IS ${literal(string(column, 'comment'))};`);
    }
    if (!columns.length) { error('TABLE_WITHOUT_COLUMNS', '컬럼이 없는 테이블을 생성하지 않았습니다.', table); continue; }
    used(properties, 'tablespaceName');
    if (oracle) {
      used(properties, 'storageAttributes', 'parallel'); clauses.push(...storage(ref(properties, 'storageAttributes')));
      if (string(properties, 'tablespaceName')) clauses.push(`TABLESPACE ${q(string(properties, 'tablespaceName'), properties)}`);
      clauses.push(...oracleTableToggle(properties, 'logging', 'LOGGING', 'NOLOGGING', true), ...oracleTableToggle(properties, 'compression', 'COMPRESS', 'NOCOMPRESS'), ...oracleTableToggle(properties, 'cache', 'CACHE', 'NOCACHE'), ...oracleTableToggle(properties, 'rowDependencies', 'ROWDEPENDENCIES', 'NOROWDEPENDENCIES'), ...oracleTableToggle(properties, 'rowMovement', 'ENABLE ROW MOVEMENT', 'DISABLE ROW MOVEMENT'));
      const parallel = ref(properties, 'parallel'); if (parallel) { used(parallel, 'useParallel', 'degree'); if (value(parallel, 'useParallel') === true) { const degree = integer(parallel, 'degree', 1); clauses.push(`PARALLEL${degree ? ` ${degree}` : ''}`); } else if (value(parallel, 'useParallel') === false) clauses.push('NOPARALLEL'); }
    } else { used(properties, 'segmentAttribute'); clauses.push(...storage(ref(properties, 'segmentAttribute')), ...toggle(properties, 'compress', 'COMPRESS', 'NOCOMPRESS')); }
    const tablespace = string(properties, 'tablespaceName'), segmentTablespace = !oracle ? string(ref(properties, 'segmentAttribute'), 'tablespaceName') : '';
    if (tablespace && segmentTablespace && tablespace !== segmentTablespace) error('CONFLICTING_TABLESPACE_PROPERTIES', '테이블과 segment에 서로 다른 테이블스페이스가 설정되어 있습니다.', table);
    if (!oracle && tablespace && !segmentTablespace) clauses.push(`TABLESPACE ${q(tablespace, properties)}`);
    statements.push(`CREATE TABLE ${tableName(table)} (\n  ${columns.join(',\n  ')}\n)${clauses.length ? ' ' + clauses.join(' ') : ''};`); result.statistics.tables++;
    if (string(table, 'comment')) comments.push(`COMMENT ON TABLE ${tableName(table)} IS ${literal(string(table, 'comment'))};`);
    for (const group of refs(table, 'columnGroups')) {
      const list = members.get(group.id) ?? [], primaryKey = group.class.name === 'PrimaryKeyColumnGroup', alternate = group.class.name === 'AlternateKeyColumnGroup', constraint = ref(group, primaryKey ? 'primaryKeyConstraint' : alternate ? 'uniqueConstraint' : 'foreignKeyConstraint');
      physical(group); if (constraint) physical(constraint);
      if (!list.length) { error('EMPTY_COLUMN_GROUP', '컬럼 없는 키·인덱스를 생성하지 않습니다.', group); continue; }
      if (primaryKey || alternate && constraint) {
        if (!constraint) { omitted('KEY_CONSTRAINT_MISSING', '키 그룹에 실제 제약 객체가 없어 제약을 추정 생성하지 않았습니다.', group); continue; }
        const cp = physical(constraint); let index = '';
        if (oracle) {
          used(cp, 'indexOwner', 'indexName');
          if (string(cp, 'indexName') && string(cp, 'indexName') !== name(group) || string(cp, 'indexOwner') && string(cp, 'indexOwner') !== name(schemaOf.get(table.id))) omitted('CONSTRAINT_INDEX_REFERENCE_MISMATCH', '제약의 지정 인덱스와 모델 인덱스 이름·소유주가 다릅니다.', constraint);
          const gp = physical(group);
          if (value(cp, 'deferrable') === true && gp && (value(gp, 'uniqueness') === undefined || value(gp, 'uniqueness') === null || string(gp, 'uniqueness') === 'UNIQUE')) error('DEFERRABLE_UNIQUE_INDEX_CONFLICT', '지연 가능한 키에 UNIQUE 인덱스가 지정되어 있습니다. NONUNIQUE 인덱스가 필요합니다.', group);
          if (list.some(member => string(member.membership, 'sortType') === 'DESC')) omitted('DESC_CONSTRAINT_INDEX_NOT_IMPLEMENTED', 'DESC 함수 기반 인덱스를 제약 인덱스로 사용하는 경우를 구현하지 않았습니다.', group);
          else { const sql = indexSql(table, group, value(cp, 'deferrable') !== true); if (sql) { indexes.push(sql); result.statistics.indexes++; index = ` USING INDEX ${qualified(group, schemaOf.get(table.id))}`; } }
        } else {
          const gp = physical(group), meaningfulOptions = gp?.features.some(feature => !['UUID','temporaryContents','userDefiendProperty','extendedProperty'].includes(feature.name) && feature.value !== null && feature.value !== '' && !(Array.isArray(feature.value) && !feature.value.length));
          if (name(group) !== name(constraint) || meaningfulOptions || list.some(member => string(member.membership, 'sortType') === 'DESC')) {
            omitted('TIBERO_CONSTRAINT_INDEX_BINDING_NOT_IMPLEMENTED', 'Tibero 키 제약과 별도 인덱스의 이름·정렬·물리 옵션 연결을 구현하지 않았습니다.', group);
          }
        }
        constraints.push(`ALTER TABLE ${tableName(table)} ADD ${prefix(constraint, group)}${primaryKey ? 'PRIMARY KEY' : 'UNIQUE'} (${list.map(member => q(name(member.column), member.column)).join(', ')})${state(constraint, index)};`);
        if (primaryKey) result.statistics.primaryKeys++; else result.statistics.uniqueConstraints++;
      } else if (group.class.name === 'InversionEntryColumnGroup' || alternate || group.class.name === 'ForeignKeyColumnGroup' && value(group, 'useIndexing') === true) {
        const sql = indexSql(table, group, alternate); if (sql) { indexes.push(sql); result.statistics.indexes++; }
      } else if (group.class.name !== 'ForeignKeyColumnGroup') omitted('COLUMN_GROUP_KIND_NOT_IMPLEMENTED', '이 컬럼 그룹의 SQL 의미를 구현하지 않았습니다.', group);
    }
    for (const check of refs(table, 'checkConstraints')) {
      const expression = fragment(string(check, 'expression'), check, 'CHECK');
      if (!expression?.trim()) { error('CHECK_EXPRESSION_MISSING', 'CHECK 조건식이 없어 해당 제약을 출력하지 않았습니다.', check); continue; }
      constraints.push(`ALTER TABLE ${tableName(table)} ADD ${prefix(check)}CHECK (${expressionColumns(expression, table)})${state(check)};`); result.statistics.checks++;
    }
    for (const group of refs(table, 'columnGroups').filter(group => group.class.name === 'ForeignKeyColumnGroup')) {
      const parentGroup = ref(group, 'parentColumnGroup'), parent = parentGroup && tableOfGroup.get(parentGroup.id), list = members.get(group.id) ?? [], parentColumns = list.map(member => ref(member.membership, 'parentColumn'));
      if (!parent || !list.length || parentColumns.some(column => !column || !refs(parent, 'columns').some(candidate => candidate.id === column.id))) { error('INCOMPLETE_FOREIGN_KEY', '외래키 양 끝의 테이블·컬럼 대응을 해석하지 못했습니다.', group); continue; }
      if (!selectedIds.has(parent.id)) omitted('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY', '선택 범위 밖 부모 테이블·키가 대상 DB에 있어야 합니다.', group);
      const constraint = ref(group, 'foreignKeyConstraint'), cp = physical(constraint), actionField = oracle ? 'deleteRule' : 'onDeleteRule'; used(cp, actionField);
      if (!constraint) { omitted('FOREIGN_KEY_CONSTRAINT_MISSING', '관계 그룹에 실제 외래키 제약 객체가 없어 제약을 추정 생성하지 않았습니다.', group); continue; }
      if (oracle && value(cp, 'enabled') !== false) {
        const parentConstraint = ref(parentGroup, parentGroup?.class.name === 'PrimaryKeyColumnGroup' ? 'primaryKeyConstraint' : 'uniqueConstraint'), parentProperties = physical(parentConstraint);
        if (value(parentProperties, 'enabled') === false) error('FOREIGN_KEY_PARENT_CONSTRAINT_DISABLED', '활성 외래키가 비활성 부모키를 참조하고 있어 실행 전 제약 상태를 조정해야 합니다.', constraint);
      }
      const action = cp && !oracle && (value(cp, actionField) === undefined || value(cp, actionField) === null) ? 'CASCADE' : string(cp, actionField), actions = ['CASCADE', 'SET NULL'].includes(action) ? ` ON DELETE ${action}` : '';
      if (action && action !== 'NO ACTION' && !actions) error('INVALID_REFERENTIAL_ACTION', '대상 DB가 지원하는 삭제 참조 동작을 해석하지 못했습니다.', constraint);
      // Oracle reference* fields describe the reverse-engineered target; graph references remain authoritative.
      if (oracle && cp) for (const [feature, actual] of [['referenceOwner', name(schemaOf.get(parent.id))], ['referenceTable', name(parent)]] as const) {
        used(cp, feature); if (string(cp, feature) && string(cp, feature) !== actual) omitted('FOREIGN_KEY_PHYSICAL_TARGET_MISMATCH', '외래키 물리 속성과 실제 그래프 대상이 다릅니다.', constraint, feature);
      }
      if (oracle && cp) for (const [feature, actual] of [['referenceConstraintName', name(ref(parentGroup, parentGroup?.class.name === 'PrimaryKeyColumnGroup' ? 'primaryKeyConstraint' : 'uniqueConstraint'))], ['referenceConstraintType', parentGroup?.class.name === 'PrimaryKeyColumnGroup' ? 'P' : 'U']] as const) {
        used(cp, feature); if (string(cp, feature) && string(cp, feature) !== actual) omitted('FOREIGN_KEY_PHYSICAL_TARGET_MISMATCH', '외래키 물리 속성과 실제 그래프 부모 제약이 다릅니다.', constraint, feature);
      }
      foreign.push(`ALTER TABLE ${tableName(table)} ADD ${prefix(constraint, group)}FOREIGN KEY (${list.map(member => q(name(member.column), member.column)).join(', ')}) REFERENCES ${tableName(parent)} (${parentColumns.map(column => q(name(column), column)).join(', ')})${actions}${state(constraint)};`); result.statistics.foreignKeys++;
    }
  }
  // Oracle schemas are existing users; CREATE SCHEMA is not PostgreSQL's namespace creation.
  for (const schema of selectedSchemas) {
    const properties = physical(schema);
    if (!oracle) continue;
    used(properties, 'sequenceGroup'); const group = ref(properties, 'sequenceGroup'); used(group, 'sequences');
    for (const sequence of refs(group, 'sequences')) {
      used(sequence, 'physicalName', 'logicalName', 'name', 'oppositeModeName', 'derivedName', 'derivedPhysicalName', 'derivedLogicalName', 'derivedOppositeModeName', 'comment', 'start', 'minValue', 'maxValue', 'increment', 'cache', 'cycle', 'order');
      const clauses: string[] = [];
      for (const [feature, keyword] of [['start', 'START WITH'], ['increment', 'INCREMENT BY'], ['minValue', 'MINVALUE'], ['maxValue', 'MAXVALUE'], ['cache', 'CACHE']] as const) {
        const raw = value(sequence, feature); if (raw === undefined || raw === null || raw === '') continue;
        const text = String(raw);
        if (!/^-?\d+$/.test(text) || feature === 'increment' && BigInt(text) === 0n || feature === 'cache' && (BigInt(text) < 0n || BigInt(text) === 1n)) { error('INVALID_SEQUENCE_INTEGER', '시퀀스 수치·증분·캐시 값을 해석하지 못했습니다.', sequence); continue; }
        clauses.push(feature === 'cache' && BigInt(text) === 0n ? 'NOCACHE' : `${keyword} ${text}`);
      }
      clauses.push(...toggle(sequence, 'cycle', 'CYCLE', 'NOCYCLE'), ...toggle(sequence, 'order', 'ORDER', 'NOORDER'));
      statements.unshift(`CREATE SEQUENCE ${qualified(sequence, schema)}${clauses.length ? ' ' + clauses.join(' ') : ''};`); result.statistics.sequences++;
    }
  }
  if (selected.length) physical(database);
  const metadata = new Set(['UUID', 'temporaryContents', 'userDefiendProperty', 'extendedProperty']);
  const relevant = new Set<number>();
  function scan(object: BinaryObject | undefined) { if (!object || relevant.has(object.id)) return; relevant.add(object.id); for (const feature of object.features) if (!metadata.has(feature.name)) for (const child of refs(object, feature.name)) if (child.class.packageUri === product.uri) scan(child); }
  for (const key of physicalRoots) scan(byId.get(key));
  for (const key of relevant) {
    const object = byId.get(key)!;
    for (const feature of object.features) {
      if (metadata.has(feature.name) || handled.get(key)?.has(feature.name) || feature.value === null || feature.value === '' || Array.isArray(feature.value) && !feature.value.length) continue;
      const children = refs(object, feature.name);
      if (children.length && children.every(child => child.features.every(item => metadata.has(item.name) || item.value === null || item.value === '' || Array.isArray(item.value) && !item.value.length))) continue;
      omitted(object.class.packageUri === product.uri ? 'PHYSICAL_PROPERTY_NOT_IMPLEMENTED' : 'FOREIGN_DATABASE_PHYSICAL_PROPERTIES', '저장된 물리 속성의 SQL 의미를 구현하지 않았습니다.', object, feature.name);
    }
  }
  if (options.tableUuids === undefined) for (const kind of ['View', 'Function', 'Procedure', 'Trigger']) for (const object of core(kind)) omitted('DATABASE_OBJECT_NOT_IMPLEMENTED', `${kind} 객체 DDL은 구현하지 않았습니다.`, object);
  if (string(root, 'customDataTypeFile')) omitted('EXTERNAL_CUSTOM_TYPE_FILE_UNVERIFIED', '외부 자료형 파일의 해석 결과를 검증하지 않았습니다.', root, 'customDataTypeFile');
  if (quotedExpressions) warning('EXPRESSION_COLUMN_IDENTIFIERS_QUOTED', `${quotedExpressions}개 CHECK 표현식의 모델 컬럼명을 출력 식별자와 맞춰 인용했습니다. 원본 표현식은 변경하지 않았습니다.`);
  result.sql = [...statements, ...indexes, ...constraints, ...foreign, ...comments].join('\n\n') + (statements.length ? '\n' : '');
  result.complete = !result.unsupported.length && !result.diagnostics.some(item => item.severity === 'error');
  return result;
}
