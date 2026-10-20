import type { BinaryObject, BinaryValue } from '../exerd/binary';
import type { NativeExerdDocument } from '../exerd/native-document';
import type { NativeDdlResult, NativeDdlDiagnostic, NativeDdlUnsupported } from './native-ddl';
import { validateNativeDocument } from '../exerd/validation';

export interface NativeMysqlDdlOptions { dialect: 'mysql' | 'mariadb'; tableUuids?: string[] }
const CORE = 'http://exerd.tomato.com/model';
/** Pure, native-product-specific DDL. Does not connect to a database or translate another product. */
export function generateNativeMysqlDdl(document: NativeExerdDocument, options: NativeMysqlDdlOptions): NativeDdlResult {
  const { dialect } = options, namespace = `http://exerd.tomato.com/${dialect}/model`;
  const diagnostics: NativeDdlDiagnostic[] = [], unsupported: NativeDdlUnsupported[] = [];
  const statistics = { tables: 0, columns: 0, primaryKeys: 0, foreignKeys: 0, uniqueConstraints: 0, indexes: 0, checks: 0, sequences: 0 };
  const objects = document.graph.objects, byId = new Map(objects.map(o => [o.id, o]));
  const field = (o: BinaryObject | undefined, name: string) => o?.features.find(f => f.name === name)?.value;
  const text = (o: BinaryObject | undefined, name: string) => { const v = field(o, name); return typeof v === 'string' ? v : ''; };
  const uuid = (o?: BinaryObject) => o ? text(o, 'UUID') || `binary:${o.id}` : undefined;
  const refs = (o: BinaryObject | undefined, name: string) => {
    const v = field(o, name); return (Array.isArray(v) ? v : [v]).flatMap(v => v && typeof v === 'object' && 'ref' in v && byId.has(v.ref) ? [byId.get(v.ref)!] : []);
  };
  const ref = (o: BinaryObject | undefined, name: string): BinaryObject | undefined => refs(o, name)[0];
  const all = (name: string) => objects.filter(o => o.class.packageUri === CORE && o.class.name === name);
  const name = (o?: BinaryObject) => text(o, 'physicalName') || text(o, 'name');
  const result = (sql = ''): NativeDdlResult => ({ sql, dialect, complete: !unsupported.length && !diagnostics.some(d => d.severity === 'error'), executionVerified: false, diagnostics, unsupported, statistics });
  const error = (code: string, message: string, o?: BinaryObject) => diagnostics.push({ code, severity: 'error', message, uuid: uuid(o) });
  const omitted = (code: string, message: string, o?: BinaryObject, feature?: string) => {
    if (!unsupported.some(u => u.code === code && u.uuid === uuid(o) && u.feature === feature)) unsupported.push({ code, message, uuid: uuid(o), ...(feature ? { feature } : {}) });
  };
  const root = all('Document')[0];
  if (text(root, 'productId') !== `com.tomato.db.${dialect}`) { omitted('CROSS_DATABASE_TYPE_CONVERSION_UNVERIFIED', '원본 제품과 다른 DB의 타입·기본값·물리 속성을 변환하지 않았습니다.', root); return result(); }
  diagnostics.push(...validateNativeDocument(document));
  function identifier(value: string, o?: BinaryObject) {
    if (!value || value.endsWith(' ') || /[\0\r\n]/.test(value) || [...value].length > 64 || [...value].some(c => c.codePointAt(0)! > 0xffff)) error('INVALID_SQL_IDENTIFIER', '물리 식별자는 비어 있지 않고 64자 이내여야 하며 NUL·줄바꿈을 포함할 수 없습니다.', o);
    return '`' + value.replaceAll('`', '``') + '`';
  }
  // The script selects standard MySQL quoting (backslash escapes enabled) and restores it afterwards.
  const literal = (value: string) => "'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''").replaceAll('\0', '\\0').replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\u001a', '\\Z') + "'";
  function fragment(value: string, o: BinaryObject, feature: string): string | undefined {
    if (value.includes('\0')) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 NUL 문자가 포함돼 생략했습니다.`, o); return; }
    let quote = '', depth = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (quote) { if (ch === '\\' && quote !== '`') i++; else if (ch === quote) { if (value[i + 1] === quote) i++; else quote = ''; } continue; }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === ',' && depth === 0) { error('INVALID_SQL_FRAGMENT', `${feature}에 최상위 쉼표가 있습니다.`, o); return; }
      if (ch === ';' || ch === '\0' || ch === '#' || value.startsWith('--', i) || value.startsWith('/*', i)) { error('UNSAFE_SQL_FRAGMENT', `${feature}에 추가 문장 또는 주석이 포함돼 구문을 생략했습니다.`, o); return; }
      if (ch === '(') depth++; else if (ch === ')' && --depth < 0) { error('INVALID_SQL_FRAGMENT', `${feature} 괄호가 맞지 않습니다.`, o); return; }
    }
    if (quote || depth) { error('INVALID_SQL_FRAGMENT', `${feature} 인용 또는 괄호가 닫히지 않았습니다.`, o); return; }
    return value;
  }
  const word = (value: string, o: BinaryObject, feature: string) => { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || value.length > 64) { error('INVALID_SQL_OPTION', `${feature} 값을 SQL 토큰으로 해석하지 못했습니다.`, o); return ''; } return value; };
  const integer = (value: BinaryValue | undefined, o: BinaryObject, feature: string) => { const s = String(value ?? ''); if (!/^\d+$/.test(s)) { error('INVALID_NUMERIC_OPTION', `${feature}은 음수가 아닌 정수여야 합니다.`, o); return ''; } return s; };
  const handled = new Map<number, Set<string>>(), relevant = new Map<number, BinaryObject>(), visitedOwners = new Map<number, BinaryObject>();
  const used = (o: BinaryObject | undefined, ...names: string[]) => { if (!o) return; const set = handled.get(o.id) ?? new Set(); names.forEach(n => set.add(n)); handled.set(o.id, set); };
  function physical(o: BinaryObject | undefined) {
    if (o) visitedOwners.set(o.id, o);
    const p = ref(o, 'physicalProperties');
    if (p && p.class.packageUri !== namespace) { omitted('FOREIGN_DATABASE_PHYSICAL_PROPERTIES', '해당 DB와 다른 물리 속성을 해석하지 않았습니다.', p); return; }
    if (p) relevant.set(p.id, p); return p;
  }
  const database = ref(root, 'databaseModel'), schemas = refs(database, 'schema');
  const tables = schemas.flatMap(s => refs(s, 'tables')).filter(t => t.class.packageUri === CORE && t.class.name === 'Table');
  const schemaOf = new Map(schemas.flatMap(s => refs(s, 'tables').map(t => [t.id, s] as const)));
  const tableOfGroup = new Map(tables.flatMap(t => refs(t, 'columnGroups').map(g => [g.id, t] as const)));
  const requested = options.tableUuids === undefined ? undefined : new Set(options.tableUuids);
  if (requested) for (const id of requested) if (!tables.some(t => uuid(t) === id)) diagnostics.push({ code: 'UNKNOWN_TABLE_SELECTION', severity: 'error', message: '선택한 테이블이 없습니다.', uuid: id });
  const selected = tables.filter(t => !requested || requested.has(uuid(t)!)), selectedIds = new Set(selected.map(t => t.id));
  const selectedSchemas = schemas.filter(s => refs(s, 'tables').some(t => selectedIds.has(t.id)));
  if (!selected.length) return result();
  const tableName = (t: BinaryObject) => (name(schemaOf.get(t.id)) ? identifier(name(schemaOf.get(t.id)), schemaOf.get(t.id)) + '.' : '') + identifier(name(t), t);
  interface Member { column: BinaryObject; membership: BinaryObject; index: number; sequence: number }
  const members = new Map<number, Member[]>(); let sequence = 0;
  for (const table of tables) for (const column of refs(table, 'columns')) for (const entry of refs(column, 'memberships')) {
    const membership = ref(entry, 'value'), group = ref(membership, 'group') ?? ref(entry, 'key'); if (!membership || !group) continue;
    const list = members.get(group.id) ?? []; list.push({ column, membership, index: typeof field(membership, 'entryIndex') === 'number' ? field(membership, 'entryIndex') as number : -1, sequence: sequence++ }); members.set(group.id, list);
  }
  // Original PK overload follows physical columns; AK/index/FK overloads sort membership indices stably.
  for (const [id, list] of members) if (byId.get(id)?.class.name !== 'PrimaryKeyColumnGroup') list.sort((a, b) => a.index - b.index || a.sequence - b.sequence);
  const domainParent = new Map<number, BinaryObject>();
  for (const domain of all('Domain')) for (const child of refs(domain, 'domain')) domainParent.set(child.id, domain);
  function inherited(column: BinaryObject, own: string, suggested: string) {
    const ownValue = field(column, own); if (typeof ownValue === 'string' && (own !== 'notNull' || ownValue !== '')) return ownValue;
    let domain = ref(column, 'domain'); const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) { seen.add(domain.id); physical(domain); const v = field(domain, suggested); if (typeof v === 'string' && (own !== 'notNull' || v !== '')) return v; domain = domainParent.get(domain.id); }
    return '';
  }
  function columnType(column: BinaryObject) {
    const raw = inherited(column, 'dataType', 'suggestedDataType'); if (!raw.trim()) { error('COLUMN_TYPE_MISSING', '컬럼 타입이 없습니다.', column); return; }
    if (!fragment(raw, column, 'dataType')) return;
    const numeric = /^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|DEC|NUMERIC|FIXED|FLOAT|DOUBLE(?:\s+PRECISION)?|REAL|BIT|BOOL|BOOLEAN|SERIAL)(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?(?:\s+(?:UNSIGNED|SIGNED|ZEROFILL))*$/i;
    const temporal = /^(?:DATE|DATETIME|TIMESTAMP|TIME|YEAR)(?:\s*\(\s*\d+\s*\))?$/i;
    const strings = /^(?:NATIONAL\s+)?(?:CHAR|VARCHAR|NCHAR|NVARCHAR|BINARY|VARBINARY|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)(?:\s*\(\s*\d+\s*\))?(?:\s+(?:BINARY|ASCII|UNICODE|CHARACTER\s+SET\s+[A-Za-z][\w]*|CHARSET\s+[A-Za-z][\w]*|COLLATE\s+[A-Za-z][\w]*))*$/i;
    const enumeration = /^(?:ENUM|SET)\s*\(\s*'(?:[^'\\]|\\.|'')*'(?:\s*,\s*'(?:[^'\\]|\\.|'')*')*\s*\)(?:\s+(?:CHARACTER\s+SET\s+[A-Za-z][\w]*|COLLATE\s+[A-Za-z][\w]*))*$/is;
    if (![numeric, temporal, strings, enumeration, /^(?:JSON|GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)$/i].some(r => r.test(raw.trim())) && !(dialect === 'mariadb' && /^(?:UUID|INET4|INET6)$/i.test(raw.trim()))) { omitted('COLUMN_TYPE_NOT_IMPLEMENTED', '컬럼 타입을 이 DB의 독립 타입 구문으로 검증하지 못했습니다.', column, 'dataType'); return; }
    return raw;
  }
  function defaultExpression(column: BinaryObject, raw: string) {
    const checked = fragment(raw, column, 'defaultValue'); if (checked === undefined) return; const value = checked.trim();
    const single = /^(?:_[A-Za-z][\w]*\s*)?'(?:[^'\\]|\\.|'')*'$/s, quoted = /^"(?:[^"\\]|\\.|"")*"$/s;
    const simple = /^(?:NULL|TRUE|FALSE|CURRENT_TIMESTAMP(?:\(\d*\))?|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|0x[\da-f]+|[bBxX]'[\da-f]+')$/i;
    if (!single.test(value) && !quoted.test(value) && !simple.test(value) && !(value.startsWith('(') && value.endsWith(')')) && !(dialect === 'mariadb' && /^[A-Za-z_][\w]*\([\s\S]*\)$/.test(value))) { omitted('DEFAULT_EXPRESSION_NOT_IMPLEMENTED', '기본값은 리터럴·CURRENT_TIMESTAMP 또는 괄호 표현식이어야 합니다.', column, 'defaultValue'); return; }
    const words = value.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/gs, ' ');
    if (/\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b/i.test(words)) { omitted('DEFAULT_SUBQUERY_NOT_IMPLEMENTED', '기본값의 하위 질의·문장을 해석하지 않았습니다.', column, 'defaultValue'); return; }
    return checked;
  }
  const indexType = (group: BinaryObject) => { const p = physical(group); used(p, 'indexType'); return text(p, 'indexType').toUpperCase(); };
  const parts = (group: BinaryObject, kind: string) => (members.get(group.id) ?? []).map(m => {
    physical(m.membership);
    const rawType = inherited(m.column, 'dataType', 'suggestedDataType');
    if (/^(?:TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)\b/i.test(rawType) && kind !== 'FULLTEXT') omitted('INDEX_PREFIX_LENGTH_NOT_IMPLEMENTED', 'TEXT·BLOB의 일반 인덱스에 필요한 prefix 길이를 모델에서 해석하지 못했습니다.', group);
    if (kind === 'FULLTEXT' && !/^(?:CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)\b/i.test(rawType)) error('FULLTEXT_REQUIRES_TEXT_COLUMNS', 'FULLTEXT는 문자 컬럼을 사용해야 합니다.', group);
    if (kind === 'SPATIAL') { if (!/^(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)$/i.test(rawType.trim())) error('SPATIAL_REQUIRES_GEOMETRY', 'SPATIAL 인덱스는 공간 타입을 사용해야 합니다.', group); if (inherited(m.column, 'notNull', 'suggestedNotNull') !== 'TRUE') error('SPATIAL_REQUIRES_NOT_NULL', 'SPATIAL 인덱스 컬럼은 NOT NULL이어야 합니다.', group); }
    const sort = field(m.membership, 'sortType') == null ? 'ASC' : text(m.membership, 'sortType');
    if (sort && !['ASC', 'DESC'].includes(sort)) error('INVALID_INDEX_SORT', '인덱스 정렬 방향을 해석하지 못했습니다.', m.membership);
    if (['FULLTEXT', 'SPATIAL', 'HASH'].includes(kind) && sort === 'DESC') omitted('INDEX_SORT_NOT_SUPPORTED', '해당 인덱스 방식은 DESC 정렬을 보존하지 못합니다.', group);
    return identifier(name(m.column), m.column) + (!['FULLTEXT', 'SPATIAL', 'HASH'].includes(kind) ? (sort ? ' ' + sort : '') : '');
  });
  const statements: string[] = [], foreign: string[] = [];
  statements.push("SET @erd_maker_previous_sql_mode = @@SESSION.sql_mode;", "SET SESSION sql_mode = CONCAT_WS(',', NULLIF(TRIM(BOTH ',' FROM REPLACE(REPLACE(CONCAT(',', @erd_maker_previous_sql_mode, ','), ',ANSI_QUOTES,', ','), ',NO_BACKSLASH_ESCAPES,', ',')), ''), 'STRICT_TRANS_TABLES', 'NO_ENGINE_SUBSTITUTION');");
  for (const schema of selectedSchemas) {
    const p = physical(schema); used(p, 'characterSet', 'collation'); let suffix = '';
    for (const [key, sql] of [['characterSet', 'DEFAULT CHARACTER SET'], ['collation', 'COLLATE']] as const) if (text(p, key)) suffix += ` ${sql} ${word(text(p, key), p!, key)}`;
    if (text(schema, 'comment')) { if (dialect === 'mariadb') suffix += ' COMMENT ' + literal(text(schema, 'comment')); else omitted('SCHEMA_COMMENT_NOT_IMPLEMENTED', 'MySQL에는 모델 스키마 주석을 보존할 CREATE DATABASE COMMENT 구문이 없습니다.', schema, 'comment'); }
    if (name(schema)) statements.push(`CREATE DATABASE IF NOT EXISTS ${identifier(name(schema), schema)}${suffix};`);
  }
  const primaryColumns = new Set<number>();
  for (const table of selected) for (const group of refs(table, 'columnGroups').filter(g => g.class.name === 'PrimaryKeyColumnGroup')) for (const m of members.get(group.id) ?? []) primaryColumns.add(m.column.id);
  for (const table of selected) {
    const p = physical(table), engine = dialect === 'mysql' ? text(p, 'engine') : '', groups = refs(table, 'columnGroups');
    const bodies: string[] = [], autoColumns: BinaryObject[] = [];
    for (const column of refs(table, 'columns')) {
      const cp = physical(column); used(cp, 'autoIncrement'); const auto = field(cp, 'autoIncrement') === true;
      const dataType = columnType(column); if (!dataType) continue;
      let line = identifier(name(column), column) + ' ' + dataType;
      const notNull = inherited(column, 'notNull', 'suggestedNotNull');
      if (notNull && !['TRUE', 'FALSE'].includes(notNull)) error('INVALID_NULLABILITY', 'NULL 허용 속성을 해석하지 못했습니다.', column);
      if (auto) autoColumns.push(column);
      line += primaryColumns.has(column.id) || auto || notNull === 'TRUE' ? ' NOT NULL' : ' NULL';
      const rawDefault = inherited(column, 'defaultValue', 'suggestedDefaultValue');
      if (rawDefault) { if (auto) error('AUTO_INCREMENT_DEFAULT', 'AUTO_INCREMENT 컬럼에는 기본값을 지정할 수 없습니다.', column); if (/^NULL$/i.test(rawDefault.trim()) && (primaryColumns.has(column.id) || auto || notNull === 'TRUE')) error('NULL_DEFAULT_ON_NOT_NULL', 'NOT NULL 컬럼에 DEFAULT NULL이 지정됐습니다.', column); const expr = defaultExpression(column, rawDefault); if (expr !== undefined) { const needsParentheses = dialect === 'mysql' && /^(?:JSON|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB)\b/i.test(dataType) && !/^NULL$/i.test(expr.trim()) && !(expr.trim().startsWith('(') && expr.trim().endsWith(')')); line += ' DEFAULT ' + (needsParentheses ? `(${expr})` : expr); } }
      if (auto) { if (!/^(?:TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT)\b/i.test(dataType)) error('AUTO_INCREMENT_REQUIRES_INTEGER', 'AUTO_INCREMENT는 정수 컬럼이어야 합니다.', column); line += ' AUTO_INCREMENT'; }
      if ([...text(column, 'comment')].length > 1024) error('COLUMN_COMMENT_TOO_LONG', '컬럼 주석은 1024자를 초과할 수 없습니다.', column);
      if (text(column, 'comment')) line += ' COMMENT ' + literal(text(column, 'comment'));
      bodies.push(line); statistics.columns++;
    }
    if (!bodies.length) error('TABLE_WITHOUT_COLUMNS', 'DDL에 포함할 유효한 컬럼이 없습니다.', table);
    const startOption = field(p, dialect === 'mysql' ? 'autoIncrement' : 'startValue');
    if (startOption !== undefined && startOption !== null && String(startOption) !== '0' && !autoColumns.length) error('AUTO_INCREMENT_START_WITHOUT_COLUMN', '시작값을 적용할 AUTO_INCREMENT 컬럼이 없습니다.', table);
    if (autoColumns.length > 1) error('MULTIPLE_AUTO_INCREMENT_COLUMNS', '테이블에는 AUTO_INCREMENT 컬럼이 하나만 허용됩니다.', table);
    for (const col of autoColumns) if (!groups.some(g => ['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup', 'InversionEntryColumnGroup'].includes(g.class.name) && (members.get(g.id) ?? [])[0]?.column.id === col.id)) error('AUTO_INCREMENT_REQUIRES_LEADING_INDEX', 'AUTO_INCREMENT 컬럼은 인덱스의 첫 컬럼이어야 합니다.', col);
    for (const group of groups.filter(g => ['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup', 'InversionEntryColumnGroup'].includes(g.class.name))) {
      const primary = group.class.name === 'PrimaryKeyColumnGroup', unique = group.class.name === 'AlternateKeyColumnGroup';
      const constraint = ref(group, primary ? 'primaryKeyConstraint' : 'uniqueConstraint'); if (constraint) { physical(constraint); if (text(constraint, 'comment')) omitted('CONSTRAINT_COMMENT_NOT_IMPLEMENTED', '제약 객체의 별도 주석은 SQL로 보존하지 못했습니다.', constraint, 'comment'); }
      const kind = indexType(group), columns = parts(group, kind); if (!columns.length) { error('EMPTY_COLUMN_GROUP', '키·인덱스 멤버가 없습니다.', group); continue; }
      if (kind && !['BTREE', 'HASH', 'FULLTEXT', 'SPATIAL'].includes(kind)) { error('INVALID_INDEX_TYPE', '인덱스 방식을 해석하지 못했습니다.', group); continue; }
      if ((primary || unique) && ['FULLTEXT', 'SPATIAL'].includes(kind)) omitted('INVALID_CONSTRAINT_INDEX_TYPE', 'PK·UK에 FULLTEXT/SPATIAL을 사용할 수 없습니다.', group);
      if (kind === 'HASH' && engine.toUpperCase() !== 'MEMORY') omitted('HASH_INDEX_ENGINE_UNVERIFIED', 'HASH 인덱스는 명시한 MEMORY 엔진만 지원합니다.', group);
      if (unique && name(constraint) && name(group) && name(constraint) !== name(group)) omitted('UNIQUE_INDEX_CONSTRAINT_NAME_CONFLICT', '이 DB에서 UNIQUE 제약과 기반 인덱스의 서로 다른 이름을 동시에 보존하지 못했습니다.', group);
      const prefix = primary ? (name(constraint) ? `CONSTRAINT ${identifier(name(constraint), constraint)} ` : '') + 'PRIMARY KEY' : unique ? `CONSTRAINT ${identifier(name(constraint) || name(group), constraint ?? group)} UNIQUE KEY ${identifier(name(constraint) || name(group), group)}` : `${kind === 'FULLTEXT' || kind === 'SPATIAL' ? kind + ' ' : ''}KEY ${identifier(name(group), group)}`;
      let line = prefix + (['BTREE', 'HASH'].includes(kind) ? ' USING ' + kind : '') + ` (${columns.join(', ')})`;
      const gp = physical(group); if (dialect === 'mysql') used(gp, 'keyBlockSize', 'parser');
      if (dialect === 'mysql' && field(gp, 'keyBlockSize') !== undefined) { if (engine.toUpperCase() !== 'MYISAM') omitted('ENGINE_SPECIFIC_OPTION_UNVERIFIED', '인덱스 KEY_BLOCK_SIZE는 MyISAM 이외의 엔진에서 효과를 검증하지 못했습니다.', gp, 'keyBlockSize'); line += ' KEY_BLOCK_SIZE=' + integer(field(gp, 'keyBlockSize'), gp!, 'keyBlockSize'); }
      if (dialect === 'mysql' && text(gp, 'parser')) { if (kind !== 'FULLTEXT') omitted('PARSER_REQUIRES_FULLTEXT', 'WITH PARSER는 FULLTEXT에만 적용할 수 있습니다.', group); else line += ' WITH PARSER ' + identifier(text(gp, 'parser'), gp); }
      if (text(group, 'comment')) line += ' COMMENT ' + literal(text(group, 'comment'));
      bodies.push(line); if (primary) statistics.primaryKeys++; else if (unique) statistics.uniqueConstraints++; else statistics.indexes++;
    }
    for (const check of refs(table, 'checkConstraints')) {
      physical(check); if (text(check, 'comment')) omitted('CONSTRAINT_COMMENT_NOT_IMPLEMENTED', 'CHECK 객체의 별도 주석은 SQL로 보존하지 못했습니다.', check, 'comment'); const expression = fragment(text(check, 'expression'), check, 'CHECK expression');
      if (!expression?.trim()) { error('CHECK_EXPRESSION_MISSING', 'CHECK 표현식이 없습니다.', check); continue; }
      // AUTO_INCREMENT references are forbidden by MySQL; use the lexer to ignore string literals.
      if (dialect === 'mysql') {
        const tokens = expression.replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"/gs, ' ').match(/`(?:[^`]|``)*`|[\p{L}_][\p{L}\p{N}_$]*/gu) ?? [];
        if (autoColumns.some(c => tokens.some(t => t.replace(/^`|`$/g, '').replaceAll('``', '`').toLowerCase() === name(c).toLowerCase()))) error('CHECK_REFERENCES_AUTO_INCREMENT', 'MySQL CHECK는 AUTO_INCREMENT 컬럼을 참조할 수 없습니다.', check);
      }
      bodies.push((name(check) ? `CONSTRAINT ${identifier(name(check), check)} ` : '') + `CHECK (${expression})`); statistics.checks++;
    }
    let tableOptions = '';
    const known = dialect === 'mysql' ? ['engine', 'characterSet', 'collation', 'autoIncrement', 'checksum', 'delayKeyWrite', 'packKeys', 'insertMethod', 'keyBlockSize', 'maxRows', 'minRows', 'avgRowLength', 'rowFormat'] : ['characterSet', 'collation', 'startValue']; used(p, ...known);
    for (const [key, allowedEngines] of [['checksum', ['MYISAM']], ['delayKeyWrite', ['MYISAM']], ['packKeys', ['MYISAM']], ['insertMethod', ['MRG_MYISAM']], ['maxRows', ['MYISAM', 'MEMORY']], ['minRows', ['MYISAM']], ['avgRowLength', ['MYISAM']]] as const) if (known.includes(key) && field(p, key) !== undefined && field(p, key) !== null && field(p, key) !== '' && !allowedEngines.some(e => e === engine.toUpperCase())) omitted('ENGINE_SPECIFIC_OPTION_UNVERIFIED', `${key}은 명시한 엔진에서 효과를 보존하는지 검증하지 못했습니다.`, p, key);
    if (engine) tableOptions += ' ENGINE=' + word(engine, p!, 'engine');
    for (const [key, sql] of [['characterSet', 'DEFAULT CHARACTER SET'], ['collation', 'COLLATE']] as const) if (text(p, key)) tableOptions += ` ${sql}=${word(text(p, key), p!, key)}`;
    for (const [key, sql] of [['autoIncrement', 'AUTO_INCREMENT'], ['startValue', 'AUTO_INCREMENT'], ['keyBlockSize', 'KEY_BLOCK_SIZE'], ['maxRows', 'MAX_ROWS'], ['minRows', 'MIN_ROWS'], ['avgRowLength', 'AVG_ROW_LENGTH']] as const) if (known.includes(key) && field(p, key) !== undefined && field(p, key) !== null && !(key === 'startValue' && String(field(p, key)) === '0')) tableOptions += ` ${sql}=${integer(field(p, key), p!, key)}`;
    for (const [key, sql, allowed] of [['checksum', 'CHECKSUM', ['0', '1']], ['delayKeyWrite', 'DELAY_KEY_WRITE', ['0', '1']], ['packKeys', 'PACK_KEYS', ['0', '1', 'DEFAULT']], ['insertMethod', 'INSERT_METHOD', ['NO', 'FIRST', 'LAST']], ['rowFormat', 'ROW_FORMAT', ['DEFAULT', 'DYNAMIC', 'FIXED', 'COMPRESSED', 'REDUNDANT', 'COMPACT']]] as const) {
      const v = known.includes(key) ? text(p, key) : ''; if (v) { if (!allowed.some(x => x === v)) error('INVALID_TABLE_OPTION', `${key} 값을 해석하지 못했습니다.`, p); else tableOptions += ` ${sql}=${v}`; }
    }
    if ([...text(table, 'comment')].length > 2048) error('TABLE_COMMENT_TOO_LONG', '테이블 주석은 2048자를 초과할 수 없습니다.', table);
    if (text(table, 'comment')) tableOptions += ' COMMENT=' + literal(text(table, 'comment'));
    statements.push(`CREATE TABLE ${tableName(table)} (\n  ${bodies.join(',\n  ')}\n)${tableOptions};`); statistics.tables++;
    for (const group of groups.filter(g => g.class.name === 'ForeignKeyColumnGroup')) {
      physical(group);
      if (field(group, 'useIndexing') !== undefined) omitted('SEPARATE_FOREIGN_KEY_INDEX_NOT_IMPLEMENTED', 'FK 그룹의 명시적 useIndexing 정책을 별도 인덱스 DDL로 해석하지 못했습니다.', group, 'useIndexing');
      const constraint = ref(group, 'foreignKeyConstraint'), fp = physical(constraint); used(fp, 'onDeleteRule', 'onUpdateRule', 'match');
      if (text(constraint, 'comment') || text(group, 'comment')) omitted('CONSTRAINT_COMMENT_NOT_IMPLEMENTED', 'FK 객체의 별도 주석은 SQL로 보존하지 못했습니다.', constraint ?? group, 'comment');
      const parentGroup = ref(group, 'parentColumnGroup'), parent = parentGroup && tableOfGroup.get(parentGroup.id), mapping = members.get(group.id) ?? [];
      if (parentGroup && !['PrimaryKeyColumnGroup', 'AlternateKeyColumnGroup'].includes(parentGroup.class.name)) omitted('NON_UNIQUE_FOREIGN_KEY_PARENT', 'PK·UK 이외 부모 키의 FK 지원을 검증하지 않았습니다.', group);
      if (!parent || !mapping.length || mapping.some(m => !ref(m.membership, 'parentColumn'))) { error('INCOMPLETE_FOREIGN_KEY', 'FK 테이블·컬럼 대응이 없습니다.', group); continue; }
      const parentMembers = members.get(parentGroup!.id) ?? [];
      const ordered = parentMembers.map(pm => mapping.find(m => ref(m.membership, 'parentColumn')?.id === pm.column.id));
      if (ordered.length !== mapping.length || ordered.some(m => !m) || new Set(mapping.map(m => m.column.id)).size !== mapping.length || new Set(mapping.map(m => ref(m.membership, 'parentColumn')!.id)).size !== mapping.length) { error('FOREIGN_KEY_PARENT_ORDER_MISMATCH', '부모 키 전체와 FK 컬럼 대응이 일치하지 않습니다.', group); continue; }
      if (!selectedIds.has(parent.id)) omitted('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY', '선택하지 않은 부모 테이블이 필요합니다.', group);
      for (const t of [table, parent]) { const e = text(physical(t), 'engine'); if (e && e.toUpperCase() !== 'INNODB') omitted('FOREIGN_KEY_ENGINE_NOT_SUPPORTED', 'InnoDB 이외의 명시한 엔진에서 FK 의미를 검증하지 않았습니다.', t); }
      let suffix = '';
      for (const [key, sql] of [['onDeleteRule', 'DELETE'], ['onUpdateRule', 'UPDATE']] as const) {
        const v = text(fp, key); if (!v) continue;
        if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(v)) { omitted('REFERENTIAL_ACTION_NOT_SUPPORTED', '이 DB에서 적용하지 못하는 FK 동작입니다.', constraint, key); continue; }
        if (v === 'SET NULL' && mapping.some(m => primaryColumns.has(m.column.id) || inherited(m.column, 'notNull', 'suggestedNotNull') === 'TRUE')) error('SET_NULL_REQUIRES_NULLABLE_COLUMNS', 'SET NULL 대상 FK 컬럼이 NOT NULL입니다.', constraint);
        suffix += ` ON ${sql} ${v}`;
      }
      if (text(fp, 'match')) omitted('FOREIGN_KEY_MATCH_NOT_ENFORCED', 'MySQL의 MATCH는 강제되지 않고 FK 동작까지 무시시킬 수 있어 출력하지 않았습니다.', constraint, 'match');
      foreign.push(`ALTER TABLE ${tableName(table)} ADD ${(name(constraint) || name(group)) ? `CONSTRAINT ${identifier(name(constraint) || name(group), constraint ?? group)} ` : ''}FOREIGN KEY (${ordered.map(m => identifier(name(m!.column), m!.column)).join(', ')}) REFERENCES ${tableName(parent)} (${parentMembers.map(m => identifier(name(m.column), m.column)).join(', ')})${suffix};`); statistics.foreignKeys++;
    }
  }
  if (selected.length) physical(database);
  const walk = (p: BinaryObject) => { if (p.class.packageUri !== namespace) return; if (!relevant.has(p.id)) relevant.set(p.id, p); for (const f of p.features) if (f.name !== 'temporaryContents') for (const child of refs(p, f.name)) if (child.class.packageUri === namespace && !relevant.has(child.id)) walk(child); };
  [...relevant.values()].forEach(walk);
  for (const p of relevant.values()) for (const f of p.features) if (!['UUID', 'temporaryContents'].includes(f.name) && !handled.get(p.id)?.has(f.name) && f.value !== null && f.value !== '' && !(Array.isArray(f.value) && !f.value.length)) omitted('PHYSICAL_PROPERTY_NOT_IMPLEMENTED', '저장된 물리 옵션을 DDL로 변환하지 않았습니다.', p, f.name);
  for (const owner of [root, database, ...visitedOwners.values(), ...selectedSchemas, ...selected, ...selected.flatMap(t => [...refs(t, 'columns'), ...refs(t, 'columnGroups'), ...refs(t, 'checkConstraints')])]) {
    for (const key of ['extendedProperty', 'userDefiendProperty']) if (refs(owner, key).length) omitted('CUSTOM_MODEL_PROPERTY_NOT_IMPLEMENTED', '사용자 정의 확장 속성의 SQL 의미를 검증하지 않았습니다.', owner, key);
  }
  if (text(root, 'customDataTypeFile')) omitted('EXTERNAL_CUSTOM_TYPE_FILE_UNVERIFIED', '외부 타입 정의 파일을 해석하지 않았습니다.', root, 'customDataTypeFile');
  if (!requested) for (const kind of ['View', 'Function', 'Procedure', 'Trigger']) for (const object of all(kind)) omitted('DATABASE_OBJECT_NOT_IMPLEMENTED', `${kind} DDL을 구현하지 않았습니다.`, object);
  statements.push(...foreign, 'SET SESSION sql_mode = @erd_maker_previous_sql_mode;');
  return result(statements.join('\n\n') + '\n');
}
