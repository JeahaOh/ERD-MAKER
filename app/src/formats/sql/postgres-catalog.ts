import catalogSql from '../../../scripts/database/postgres-catalog.sql?raw';
import generated from '../exerd/schema.generated.json' with { type: 'json' };
import { rebuildNativeDocument, nativeGraph } from '../exerd/create';
import type { BinaryGraph, BinaryObject, BinaryRegistry, BinaryValue } from '../exerd/binary';
import type { NativeExerdDocument } from '../exerd/native-document';
import { validateNativeDocument } from '../exerd/validation';

export const POSTGRES_CATALOG_SQL = catalogSql;
export interface CatalogDiagnostic { code: string; severity: 'error' | 'warning'; message: string; path?: string }
export interface CatalogUnsupported { code: string; message: string; path: string; value?: unknown }
export interface PostgresCatalogImportResult { document: NativeExerdDocument | null; diagnostics: CatalogDiagnostic[]; unsupported: CatalogUnsupported[]; complete: boolean }
type Row = Record<string, unknown>;
const CORE = 'http://exerd.tomato.com/model', PG = 'http://exerd.tomato.com/postgresql/model';
const registry = generated as BinaryRegistry;
const definitions = new Map(registry.packages.flatMap(p => p.classes.map(c => [`${p.namespaceURI}:${c.name}`, c.features] as const)));
const text = (r: Row, key: string) => typeof r[key] === 'string' ? r[key] as string : '';
const list = (r: Row, key: string): unknown[] => Array.isArray(r[key]) ? r[key] as unknown[] : [];
const numbers = (r: Row, key: string) => list(r, key) as number[];
const equal = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
const { reference: ref, set, push } = nativeGraph;

/** Imports metadata only. No DB connection, credentials, network, or user rows.
 * One graph is built in memory and serialized exactly once, including large models.
 * complete concerns represented metadata, not executability or reconstruction of
 * logical names, layout, grants, ownership, or other information absent from SQL.
 */
export function importPostgresCatalog(input: unknown): PostgresCatalogImportResult {
  const diagnostics: CatalogDiagnostic[] = [], unsupported: CatalogUnsupported[] = [];
  let document: NativeExerdDocument | null = null;
  const result = (): PostgresCatalogImportResult => ({ document, diagnostics, unsupported, complete: !!document && !unsupported.length && !diagnostics.some(d => d.severity === 'error') });
  const error = (code: string, message: string, path?: string) => diagnostics.push({ code, severity: 'error', message, ...(path ? { path } : {}) });
  const omitted = (code: string, message: string, path: string, value?: unknown) => unsupported.push({ code, message, path, ...(value !== undefined ? { value } : {}) });
  if (!input || typeof input !== 'object' || Array.isArray(input)) { error('INVALID_CATALOG', '카탈로그 JSON 객체가 필요합니다.'); return result(); }
  const catalog = input as Row;
  if (catalog.format !== 'erd-maker.postgresql-catalog' || catalog.version !== 1) { error('INVALID_CATALOG_VERSION', '지원하는 PostgreSQL 카탈로그 format/version이 아닙니다.'); return result(); }
  for (const key of ['schemas', 'tables', 'columns', 'constraints', 'indexes', 'unsupportedObjects']) if (!Array.isArray(catalog[key])) error('INVALID_CATALOG_ARRAY', `${key} 배열이 필요합니다.`, key);
  if (typeof catalog.database !== 'string' || !catalog.database) error('INVALID_DATABASE_NAME', 'database 이름이 필요합니다.');
  if (!Number.isInteger(catalog.serverVersionNum) || (catalog.serverVersionNum as number) < 150000 || (catalog.serverVersionNum as number) >= 180000) omitted('SERVER_VERSION_UNVERIFIED', '카탈로그 SQL의 지원 범위는 PostgreSQL 15–17입니다.', 'serverVersionNum', catalog.serverVersionNum);
  const knownRoot = new Set(['format', 'version', 'serverVersionNum', 'serverVersion', 'database', 'schemas', 'tables', 'columns', 'constraints', 'indexes', 'sequences', 'unsupportedObjects']);
  for (const key of Object.keys(catalog)) if (!knownRoot.has(key)) omitted('UNKNOWN_CATALOG_FIELD', '알 수 없는 카탈로그 필드를 변환하지 않았습니다.', key, catalog[key]);
  if (diagnostics.length) return result();
  const rows = (key: string): Row[] => list(catalog, key).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { error('INVALID_CATALOG_ROW', '카탈로그 행은 객체여야 합니다.', `${key}[${index}]`); return []; }
    return [value as Row];
  });
  if (catalog.sequences !== undefined && !Array.isArray(catalog.sequences)) { error('INVALID_CATALOG_ARRAY', 'sequences는 배열이어야 합니다.', 'sequences'); return result(); }
  const sequences = catalog.sequences === undefined ? [] : rows('sequences');
  const schemas = rows('schemas'), tables = rows('tables'), columns = rows('columns'), constraints = rows('constraints'), indexes = rows('indexes');
  const allowed: Record<string, string> = {
    schemas: 'oid name comment',
    sequences: 'oid schemaOid name dataType persistence start minValue maxValue increment cache cycle comment ownedBy',
    tables: 'oid schemaOid name kind persistence comment partition partitionKey parents rowSecurity forceRowSecurity replicaIdentity options tablespace',
    columns: 'tableOid number name dataType typeOid typeSchema typeName typeKind notNull defaultExpression comment identity generated collation inherited local storage typeStorage compression options fdwOptions statisticsTarget',
    constraints: 'oid tableOid name type columns referencedTableOid referencedColumns indexOid deferrable deferred validated deleteAction updateAction match deleteSetColumns noInherit inherited local parentOid expression definition comment',
    indexes: 'oid tableOid name method unique primary exclusion constraintOid valid ready live clustered replicaIdentity nullsNotDistinct predicate options tablespace comment definition keys includedColumns',
  };
  function inspectFields(items: Row[], kind: string) {
    const known = new Set(allowed[kind].split(' '));
    items.forEach((row, i) => {
      for (const key of Object.keys(row)) if (!known.has(key)) omitted('UNKNOWN_CATALOG_FIELD', '알 수 없는 카탈로그 필드를 변환하지 않았습니다.', `${kind}[${i}].${key}`, row[key]);
      for (const key of ['comment', 'defaultExpression', 'expression', 'predicate', 'collation']) if (key in row && row[key] !== null && typeof row[key] !== 'string') error('INVALID_CATALOG_TEXT', `${key}는 문자열 또는 null이어야 합니다.`, `${kind}[${i}].${key}`);
    });
  }
  inspectFields(sequences, 'sequences'); inspectFields(schemas, 'schemas'); inspectFields(tables, 'tables'); inspectFields(columns, 'columns'); inspectFields(constraints, 'constraints'); inspectFields(indexes, 'indexes');
  for (const [i, row] of tables.entries()) for (const key of ['partition', 'rowSecurity', 'forceRowSecurity']) if (typeof row[key] !== 'boolean') error('INVALID_TABLE_FLAG', `${key}는 boolean이어야 합니다.`, `tables[${i}].${key}`);
  for (const [i, row] of columns.entries()) {
    if (typeof row.local !== 'boolean' || !Number.isInteger(row.inherited) || (row.statisticsTarget !== null && !Number.isInteger(row.statisticsTarget))) error('INVALID_COLUMN_PHYSICAL_METADATA', '컬럼 소유·상속·통계 메타데이터 형식이 잘못됐습니다.', `columns[${i}]`);
    for (const key of ['identity', 'generated', 'storage', 'typeStorage', 'compression', 'typeSchema']) if (typeof row[key] !== 'string') error('INVALID_COLUMN_PHYSICAL_METADATA', `${key} 문자열이 필요합니다.`, `columns[${i}].${key}`);
  }
  for (const [i, row] of indexes.entries()) {
    for (const key of ['unique', 'primary', 'exclusion', 'valid', 'ready', 'live', 'clustered', 'replicaIdentity', 'nullsNotDistinct']) if (typeof row[key] !== 'boolean') error('INVALID_INDEX_FLAG', `${key}는 boolean이어야 합니다.`, `indexes[${i}].${key}`);
    if (!Array.isArray(row.keys) || !Array.isArray(row.includedColumns)) error('INVALID_INDEX_KEYS', '인덱스 키 및 포함 컬럼 배열이 필요합니다.', `indexes[${i}]`);
    for (const [j, item] of list(row, 'keys').entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { error('INVALID_INDEX_KEY', '인덱스 키 객체가 필요합니다.', `indexes[${i}].keys[${j}]`); continue; }
      const key = item as Row;
      if (key.number !== j + 1 || typeof key.descending !== 'boolean' || typeof key.nullsFirst !== 'boolean') error('INVALID_INDEX_KEY', '인덱스 키의 연속 순번·정렬 값이 필요합니다.', `indexes[${i}].keys[${j}]`);
      for (const name of Object.keys(key)) if (!['number', 'attributeNumber', 'definition', 'descending', 'nullsFirst', 'opclass', 'collation'].includes(name)) omitted('UNKNOWN_CATALOG_FIELD', '알 수 없는 인덱스 키 필드입니다.', `indexes[${i}].keys[${j}].${name}`, key[name]);
    }
  }
  const indexRows = new Map<string, Row>(), schemaRows = new Map<string, Row>(), tableRows = new Map<string, Row>();
  function indexByOid(items: Row[], map: Map<string, Row>, path: string) {
    for (const [i, item] of items.entries()) {
      if (!/^[1-9]\d*$/.test(text(item, 'oid')) || !text(item, 'name')) error('INVALID_OBJECT_IDENTITY', '양의 OID 문자열과 이름이 필요합니다.', `${path}[${i}]`);
      else if (map.has(text(item, 'oid'))) error('DUPLICATE_OBJECT_OID', '동일 종류에 중복 OID가 있습니다.', `${path}[${i}]`);
      else map.set(text(item, 'oid'), item);
    }
  }
  indexByOid(sequences, new Map(), 'sequences'); indexByOid(schemas, schemaRows, 'schemas'); indexByOid(tables, tableRows, 'tables'); indexByOid(indexes, indexRows, 'indexes'); indexByOid(constraints, new Map(), 'constraints');
  const columnRows = new Map<string, Row[]>();
  const columnIds = new Set<string>();
  for (const [i, column] of columns.entries()) {
    const path = `columns[${i}]`, tableOid = text(column, 'tableOid'), number = column.number;
    if (!tableRows.has(tableOid)) error('COLUMN_TABLE_NOT_FOUND', '컬럼의 테이블 OID가 없습니다.', path);
    if (!Number.isInteger(number) || (number as number) <= 0 || !text(column, 'name') || !text(column, 'dataType') || typeof column.notNull !== 'boolean') error('INVALID_COLUMN', '컬럼 번호·이름·정확한 자료형·notNull 값이 필요합니다.', path);
    const id = `${tableOid}:${number}`; if (columnIds.has(id)) error('DUPLICATE_COLUMN_NUMBER', '테이블 안의 컬럼 번호가 중복됩니다.', path); columnIds.add(id);
    columnRows.set(tableOid, [...columnRows.get(tableOid) ?? [], column]);
  }
  for (const [i, table] of tables.entries()) if (!schemaRows.has(text(table, 'schemaOid'))) error('TABLE_SCHEMA_NOT_FOUND', '테이블의 스키마 OID가 없습니다.', `tables[${i}]`);
  function checkColumns(row: Row, tableKey: string, columnsKey: string, path: string) {
    const tableOid = text(row, tableKey);
    if (!tableRows.has(tableOid)) error('CONSTRAINT_TABLE_NOT_FOUND', '제약·인덱스가 참조하는 테이블이 없습니다.', path);
    if (!Array.isArray(row[columnsKey]) || numbers(row, columnsKey).some(n => !Number.isInteger(n) || !columnIds.has(`${tableOid}:${n}`))) error('COLUMN_REFERENCE_NOT_FOUND', '제약·인덱스 컬럼 번호를 해석하지 못했습니다.', path);
    if (new Set(numbers(row, columnsKey)).size !== numbers(row, columnsKey).length) error('DUPLICATE_KEY_COLUMN', '제약 컬럼 번호가 중복됩니다.', path);
  }
  for (const [i, constraint] of constraints.entries()) {
    const path = `constraints[${i}]`; checkColumns(constraint, 'tableOid', 'columns', path);
    for (const key of ['deferrable', 'deferred', 'validated', 'noInherit']) if (typeof constraint[key] !== 'boolean') error('INVALID_CONSTRAINT_FLAG', `${key}는 boolean이어야 합니다.`, path);
    if (constraint.deferred === true && constraint.deferrable !== true) error('INVALID_DEFERRED_CONSTRAINT', 'INITIALLY DEFERRED 제약은 DEFERRABLE이어야 합니다.', path);
    if (constraint.type === 'f') { checkColumns(constraint, 'referencedTableOid', 'referencedColumns', path); if (numbers(constraint, 'columns').length !== numbers(constraint, 'referencedColumns').length) error('FOREIGN_KEY_ARITY', '외래키 양쪽의 컬럼 수가 다릅니다.', path); }
  }
  if (diagnostics.length) return result();
  const graph: BinaryGraph = { version: 0, roots: [0], objects: [], packages: [CORE, PG].map(namespaceURI => ({ namespaceURI, uri: { base: namespaceURI, fragment: '/' } })), consumedBytes: 0 };
  function object(name: string, fields: Record<string, BinaryValue> = {}, pg = false): BinaryObject {
    const namespace = pg ? PG : CORE, defs = definitions.get(`${namespace}:${name}`);
    if (!defs) throw new Error(`모델 클래스가 없습니다: ${name}`);
    const o: BinaryObject = { id: graph.objects.length, class: { packageUri: namespace, name }, features: [] };
    graph.objects.push(o);
    if (defs.some(f => f.name === 'UUID')) fields = { UUID: `${name}_${crypto.randomUUID().replaceAll('-', '')}`, ...fields };
    for (const [key, value] of Object.entries(fields)) { const d = defs.find(d => d.name === key); if (!d) throw new Error(`모델 속성이 없습니다: ${name}.${key}`); o.features.push({ id: d.id, name: key, kind: d.kind, value }); }
    o.features.sort((a, b) => a.id - b.id); return o;
  }
  const named = (row: Row): Record<string, BinaryValue> => ({ physicalName: text(row, 'name'), logicalName: text(row, 'name'), ...(typeof row.comment === 'string' ? { comment: row.comment } : {}) });
  const props = (owner: BinaryObject, name: string, fields: Record<string, BinaryValue>) => { const value = object(name, fields, true); set(owner, 'physicalProperties', ref(value)); return value; };
  const doc = object('Document', { version: '3.3.56.20260820-1610', modelVersion: '3.0.0.20190111-1604', productId: 'com.tomato.db.postgresql', databaseVersion: `PostgreSQL ${text(catalog, 'serverVersion')}`, modelType: 'INTEGRATE' });
  const db = object('DatabaseModel', { logicalName: text(catalog, 'database'), physicalName: text(catalog, 'database') });
  const area = object('BusinessArea', { logicalName: '역공학', physicalName: 'Imported' }), diagram = object('Diagram', { logicalName: text(catalog, 'database'), physicalName: 'Imported' });
  const config = object('Configuration'), domains = object('DomainDefinition', { productId: 'com.tomato.db.postgresql', version: '3.0.0.20190111-1604' }), manager = object('RelationManager');
  set(config, 'domainDefinition', ref(domains)); set(doc, 'configuration', ref(config)); set(doc, 'databaseModel', ref(db)); set(doc, 'businessAreas', [ref(area)]); set(doc, 'activeBusinessArea', ref(area)); set(doc, 'openedDiagrams', [ref(diagram)]); set(doc, 'relationManager', ref(manager)); set(doc, 'sharedIcons', ref(object('SharedIcons'))); set(area, 'diagrams', [ref(diagram)]);
  set(diagram, 'viewSettings', ref(object('ViewSettings', { cellsToShow: ['name', 'dataType', 'nullable'], showColumnHeader: true, showAltTableName: true, columnFilter: 'all' })));
  set(diagram, 'printSettings', ref(object('PrintSettings', { marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10, paperKind: 'A4', paperOrientation: 'landscape', header: '${DIAGRAM}', footter: '${PAGENUM}' })));
  const schemaObjects = new Map<string, BinaryObject>(), tableObjects = new Map<string, BinaryObject>(), columnObjects = new Map<string, BinaryObject>();
  const sequenceGroups = new Map<string, BinaryObject>();
  for (const row of schemas) {
    const schema = object('Schema', named(row)), oid = text(row, 'oid'); schemaObjects.set(oid, schema); push(db, 'schema', schema);
    // Original Forward folders dereference both containers even when empty.
    // This is a newly imported schema, not a repair of an existing document.
    const sequenceGroup = object('SequenceGroup', {}, true);
    props(schema, 'SchemaProperties', { sequenceGroup: ref(sequenceGroup), userDatatypeGroup: ref(object('UserDatatypeGroup', {}, true)) });
    sequenceGroups.set(oid, sequenceGroup);
  }
  if (schemaObjects.size) set(doc, 'activeSchema', ref(schemaObjects.values().next().value!));
  function options(row: Row, owner: BinaryObject, propertyName: string, path: string, base: Record<string, BinaryValue> = {}) {
    for (const raw of list(row, 'options')) {
      if (typeof raw === 'string' && /^fillfactor=\d+$/.test(raw)) base.fillfactor = Number(raw.slice(11));
      else omitted('STORAGE_OPTION_NOT_REPRESENTED', '저장 옵션을 모델로 변환하지 않았습니다.', `${path}.options`, raw);
    }
    if (text(row, 'tablespace')) base.tablespace = text(row, 'tablespace');
    return Object.keys(base).length ? props(owner, propertyName, base) : undefined;
  }
  for (const [i, row] of tables.entries()) {
    const path = `tables[${i}]`, oid = text(row, 'oid'), table = object('Table', named(row)); tableObjects.set(oid, table);
    push(schemaObjects.get(text(row, 'schemaOid'))!, 'tables', table); push(area, 'tables', table);
    push(diagram, 'diagramEntry', object('TableDiagram', { table: ref(table), location: `Point(${80 + i % 8 * 300}, ${80 + Math.floor(i / 8) * 360})` }));
    const p: Record<string, BinaryValue> = {}; if (row.persistence === 'u') p.unlogged = true;
    options(row, table, 'TableProperties', path, p);
    if (row.kind !== 'r' || row.partition === true || list(row, 'parents').length || row.partitionKey) omitted('TABLE_KIND_NOT_REPRESENTED', '파티션·상속·외부 테이블 구조는 일반 테이블로만 표시했습니다.', path, row);
    if (!['p', 'u'].includes(text(row, 'persistence'))) omitted('TABLE_PERSISTENCE_NOT_REPRESENTED', '테이블 영속성 값을 변환하지 않았습니다.', `${path}.persistence`, row.persistence);
    if (row.rowSecurity === true || row.forceRowSecurity === true || row.replicaIdentity !== 'd') omitted('TABLE_SECURITY_OR_REPLICATION_NOT_REPRESENTED', '행 보안·복제 식별 옵션은 변환하지 않았습니다.', path, { rowSecurity: row.rowSecurity, forceRowSecurity: row.forceRowSecurity, replicaIdentity: row.replicaIdentity });
    for (const column of (columnRows.get(oid) ?? []).sort((a, b) => Number(a.number) - Number(b.number))) {
      const cp = `${path}.columns[${column.number}]`;
      const fields: Record<string, BinaryValue> = { ...named(column), dataType: text(column, 'dataType'), notNull: column.notNull === true ? 'TRUE' : 'FALSE' };
      if (text(column, 'generated')) omitted('GENERATED_COLUMN_NOT_REPRESENTED', '생성 컬럼 표현식을 DEFAULT로 바꾸지 않았습니다.', cp, column);
      else if (typeof column.defaultExpression === 'string') fields.defaultValue = column.defaultExpression;
      if (text(column, 'identity')) omitted('IDENTITY_COLUMN_NOT_REPRESENTED', 'IDENTITY 방식·시퀀스 옵션을 변환하지 않았습니다.', cp, column.identity);
      const col = object('Column', fields); columnObjects.set(`${oid}:${column.number}`, col); push(table, 'columns', col);
      if (text(column, 'collation')) { const value = text(column, 'collation'); if (['C', 'POSIX', 'default'].includes(value)) props(col, 'ColumnProperties', { collation: value }); else omitted('COLUMN_COLLATION_NOT_REPRESENTED', '원본 모델 열거형에 없는 정렬 규칙입니다.', `${cp}.collation`, value); }
      if (Number(column.inherited) > 0 || column.local === false || column.storage !== column.typeStorage || text(column, 'compression') || list(column, 'options').length || list(column, 'fdwOptions').length || (column.statisticsTarget !== null && Number(column.statisticsTarget) !== -1)) omitted('COLUMN_PHYSICAL_OPTIONS_NOT_REPRESENTED', '컬럼 상속·저장·압축·통계 옵션을 변환하지 않았습니다.', cp, column);
      if (column.typeSchema !== 'pg_catalog') omitted('USER_DEFINED_TYPE_DEPENDENCY', '사용자 자료형 정의가 별도로 필요합니다. 자료형 문구는 보존했습니다.', cp, column.dataType);
    }
  }
  for (const [i, row] of sequences.entries()) {
    const path = `sequences[${i}]`, schema = schemaObjects.get(text(row, 'schemaOid'));
    if (!schema) { error('SEQUENCE_SCHEMA_NOT_FOUND', '시퀀스 소유 스키마를 찾지 못했습니다.', path); continue; }
    if (!['smallint', 'integer', 'bigint'].includes(text(row, 'dataType')) || typeof row.cycle !== 'boolean') { error('INVALID_SEQUENCE_METADATA', '시퀀스 자료형·cycle 값이 잘못됐습니다.', path); continue; }
    const fields: Record<string, BinaryValue> = { ...named(row), cycle: row.cycle };
    let valid = true;
    for (const key of ['start', 'minValue', 'maxValue', 'increment', 'cache']) {
      const value = text(row, key);
      if (!/^-?\d+$/.test(value)) { error('INVALID_SEQUENCE_INTEGER', '정밀도 손실 없는 시퀀스 정수 문자열이 필요합니다.', `${path}.${key}`); valid = false; }
      else fields[key] = value;
    }
    if (!valid) continue;
    if (BigInt(text(row, 'increment')) === 0n || BigInt(text(row, 'cache')) <= 0n || BigInt(text(row, 'minValue')) >= BigInt(text(row, 'maxValue')) || BigInt(text(row, 'start')) < BigInt(text(row, 'minValue')) || BigInt(text(row, 'start')) > BigInt(text(row, 'maxValue'))) { error('INVALID_SEQUENCE_RANGE', '시퀀스 범위·시작·증가·캐시 값이 잘못됐습니다.', path); continue; }
    const group = sequenceGroups.get(text(row, 'schemaOid'))!;
    const sequence = object('Sequence', fields, true); push(group, 'sequences', sequence);
    const metadata: Record<string, unknown> = { dataType: row.dataType, persistence: row.persistence };
    if (!['p', 'u'].includes(text(row, 'persistence'))) omitted('SEQUENCE_PERSISTENCE_NOT_REPRESENTED', '임시 시퀀스 영속성을 변환하지 않았습니다.', path, row.persistence);
    if (row.ownedBy !== null && row.ownedBy !== undefined) {
      const owner = row.ownedBy;
      if (!owner || typeof owner !== 'object' || Array.isArray(owner)) { error('INVALID_SEQUENCE_OWNERSHIP', '시퀀스 소유 컬럼 객체가 잘못됐습니다.', path); continue; }
      const value = owner as Row, table = tableObjects.get(text(value, 'tableOid')), column = columnObjects.get(`${text(value, 'tableOid')}:${value.columnNumber}`);
      if (!table || !column || !['a', 'i'].includes(text(value, 'dependencyType'))) { error('SEQUENCE_OWNER_NOT_FOUND', '시퀀스 소유 컬럼 또는 의존 종류를 해석하지 못했습니다.', path); continue; }
      metadata.ownedBy = { tableUuid: nativeGraph.uuid(table), columnUuid: nativeGraph.uuid(column), dependencyType: value.dependencyType };
      if (value.dependencyType === 'i') omitted('IDENTITY_SEQUENCE_OWNERSHIP_NOT_REPRESENTED', 'IDENTITY 내부 시퀀스 소유권은 일반 OWNED BY로 대체하지 않습니다.', path, owner);
    }
    push(sequence, 'extendedProperty', object('PropertyEntry', { key: 'erd-maker.postgresql.sequence.v1', value: JSON.stringify(metadata) }));
  }
  type Key = { group: BinaryObject; columns: number[]; tableOid: string };
  const keys = new Map<string, Key>();
  function members(group: BinaryObject, tableOid: string, nums: number[], kind: string, index?: Row) {
    nums.forEach((number, position) => {
      const key = list(index ?? {}, 'keys')[position] as Row | undefined;
      const m = object(kind, { group: ref(group), entryIndex: position, sortType: key?.descending === true ? 'DESC' : 'ASC' });
      if (key && !index?.constraintOid) {
        const mp: Record<string, BinaryValue> = { nulls: key.nullsFirst === true };
        for (const name of ['opclass', 'collation']) if (text(key, name)) omitted('INDEX_KEY_OPTION_NOT_REPRESENTED', '자유 정렬 규칙·연산자 클래스는 원본 열거형과 일치 여부를 검토해야 합니다.', `indexes[${text(index!, 'oid')}].keys[${position}].${name}`, key[name]);
        props(m, 'IndexableMembershipProperties', mp);
      }
      push(columnObjects.get(`${tableOid}:${number}`)!, 'memberships', object('MembershipEntry', { key: ref(group), value: ref(m) }));
    });
  }
  function inspectIndex(index: Row, path: string): boolean {
    const rawKeys = list(index, 'keys'); let supported = true;
    if (!rawKeys.length || rawKeys.some(k => !k || typeof k !== 'object' || !Number.isInteger((k as Row).attributeNumber) || Number((k as Row).attributeNumber) <= 0 || !columnObjects.has(`${text(index, 'tableOid')}:${(k as Row).attributeNumber}`))) { omitted('EXPRESSION_OR_INVALID_INDEX_NOT_REPRESENTED', '표현식 또는 해석할 수 없는 인덱스를 변환하지 않았습니다.', path, index); supported = false; }
    if (!['btree', 'hash', 'gist', 'spgist', 'gin'].includes(text(index, 'method'))) { omitted('INDEX_METHOD_NOT_REPRESENTED', '원본 모델에 없는 인덱스 접근 방식입니다.', path, index.method); supported = false; }
    if (text(index, 'method') !== 'btree') omitted('NON_BTREE_KEY_OPTIONS_UNVERIFIED', '비 B-tree 인덱스의 키 표현식·연산자 의미는 별도 검증이 필요합니다.', path, index.method);
    if (index.exclusion === true) { omitted('EXCLUSION_NOT_REPRESENTED', '배제 제약을 변환하지 않았습니다.', path, index); supported = false; }
    if (list(index, 'includedColumns').length || index.nullsNotDistinct === true || index.clustered === true || index.replicaIdentity === true || index.valid !== true || index.ready !== true || index.live !== true) omitted('INDEX_OPTIONS_NOT_REPRESENTED', 'INCLUDE·NULLS NOT DISTINCT·클러스터·복제·유효 상태를 변환하지 않았습니다.', path, index);
    return supported;
  }
  for (const [i, row] of constraints.entries()) {
    const inheritancePath = `constraints[${i}]`;
    if (row.parentOid || Number(row.inherited) > 0 || row.local === false) omitted('INHERITED_CONSTRAINT_NOT_REPRESENTED', '상속·파티션 제약 소유 관계를 변환하지 않았습니다.', inheritancePath, row);
    if (!['p', 'u', 'c'].includes(text(row, 'type'))) continue;
    const path = `constraints[${i}]`, oid = text(row, 'tableOid'), table = tableObjects.get(oid)!;
    if (row.type === 'c') { const check = object('CheckConstraint', { ...named(row), expression: text(row, 'expression') }); props(check, 'CheckConstraintProperties', { noInherit: row.noInherit === true, validated: row.validated === false }); push(table, 'checkConstraints', check); continue; }
    const index = indexRows.get(text(row, 'indexOid')); if (!index || !inspectIndex(index, path)) { error('CONSTRAINT_INDEX_NOT_FOUND', '키 제약의 지원 가능한 소유 인덱스가 없습니다.', path); continue; }
    const nums = numbers(row, 'columns'); if (!nums.length) { error('EMPTY_KEY', '키 제약에 컬럼이 없습니다.', path); continue; }
    if (text(index, 'tableOid') !== oid || text(index, 'constraintOid') !== text(row, 'oid') || !equal(list(index, 'keys').map(k => Number((k as Row).attributeNumber)), nums)) { error('CONSTRAINT_INDEX_MISMATCH', '키 제약과 소유 인덱스의 테이블·OID·컬럼 순서가 일치하지 않습니다.', path); continue; }
    const primary = row.type === 'p', group = object(primary ? 'PrimaryKeyColumnGroup' : 'AlternateKeyColumnGroup', named(index));
    const constraint = object(primary ? 'PrimaryKeyConstraint' : 'UniqueConstraint', named(row));
    props(constraint, primary ? 'PrimaryKeyConstraintProperties' : 'UniqueConstraintProperties', { deferrable: row.deferrable === true, deferred: row.deferred === true });
    set(group, primary ? 'primaryKeyConstraint' : 'uniqueConstraint', ref(constraint)); push(table, 'columnGroups', group);
    // Original PK getter follows physical column order; expose any differing key order.
    const physicalOrder = (columnRows.get(oid) ?? []).map(c => Number(c.number)).filter(n => nums.includes(n));
    if (primary && !equal(nums, physicalOrder)) omitted('PRIMARY_KEY_ORDER_NOT_REPRESENTABLE', '원본 기본키는 테이블 컬럼 순서를 사용합니다. DB의 별도 키 순서를 완전히 표현하지 못합니다.', path, nums);
    members(group, oid, nums, primary ? 'PrimaryKeyMembership' : 'AlternateKeyMembership', index);
    options(index, group, 'IndexProperties', path, text(index, 'method') === 'btree' ? {} : { methodKind: text(index, 'method').toUpperCase() });
    if (list(index, 'keys').some(k => { const key = k as Row; return key.descending === true || key.nullsFirst === true || key.opclass || key.collation; })) omitted('CONSTRAINT_INDEX_KEY_OPTIONS_NOT_REPRESENTED', '키 제약의 비기본 정렬·연산자·정렬 규칙을 변환하지 않았습니다.', path, index.keys);
    if (text(index, 'predicate')) omitted('CONSTRAINT_INDEX_PREDICATE_NOT_REPRESENTED', '키 제약 인덱스 조건식을 변환하지 않았습니다.', path, index.predicate);
    keys.set(text(index, 'oid'), { group, columns: nums, tableOid: oid });
    if (row.validated !== true) omitted('KEY_VALIDATION_STATE_NOT_REPRESENTED', '키 제약 검증 상태를 변환하지 않았습니다.', path, row.validated);
  }
  for (const [i, row] of indexes.entries()) {
    if (row.constraintOid) { if (!constraints.some(c => text(c, 'oid') === text(row, 'constraintOid') && ['p', 'u', 'x'].includes(text(c, 'type')) && text(c, 'tableOid') === text(row, 'tableOid'))) error('INDEX_CONSTRAINT_NOT_FOUND', '인덱스의 소유 제약을 찾지 못했습니다.', `indexes[${i}]`); continue; }
    const path = `indexes[${i}]`; if (!inspectIndex(row, path)) continue;
    const oid = text(row, 'tableOid'), table = tableObjects.get(oid); if (!table) { error('INDEX_TABLE_NOT_FOUND', '인덱스의 테이블이 없습니다.', path); continue; }
    const unique = row.unique === true, group = object(unique ? 'AlternateKeyColumnGroup' : 'InversionEntryColumnGroup', named(row)); push(table, 'columnGroups', group);
    const nums = list(row, 'keys').map(k => Number((k as Row).attributeNumber)); members(group, oid, nums, unique ? 'AlternateKeyMembership' : 'InversionEntryMembership', row);
    const p: Record<string, BinaryValue> = { methodKind: text(row, 'method').toUpperCase() }; if (text(row, 'predicate')) p.condition = text(row, 'predicate'); options(row, group, 'IndexProperties', path, p);
    if (unique) keys.set(text(row, 'oid'), { group, columns: nums, tableOid: oid });
  }
  const actions: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET_NULL', d: 'SET_DEFAULT' };
  for (const [i, row] of constraints.entries()) {
    const path = `constraints[${i}]`; if (['p', 'u', 'c'].includes(text(row, 'type'))) continue;
    if (row.type !== 'f') { omitted('CONSTRAINT_TYPE_NOT_REPRESENTED', '알 수 없는 제약 종류를 변환하지 않았습니다.', path, row); continue; }
    const parent = keys.get(text(row, 'indexOid')), parentNums = numbers(row, 'referencedColumns'), nums = numbers(row, 'columns'), oid = text(row, 'tableOid');
    if (!parent || parent.tableOid !== text(row, 'referencedTableOid') || !equal([...parent.columns].sort((a, b) => a - b), [...parentNums].sort((a, b) => a - b))) { omitted('FOREIGN_KEY_PARENT_NOT_REPRESENTED', '같은 컬럼 집합의 부모키를 찾지 못해 외래키를 변환하지 않았습니다.', path, row); continue; }
    if (!actions[text(row, 'deleteAction')] || !actions[text(row, 'updateAction')] || !['s', 'f', 'p'].includes(text(row, 'match'))) { error('INVALID_FOREIGN_KEY_OPTION', '외래키 동작 또는 MATCH 값이 알려진 카탈로그 값이 아닙니다.', path); continue; }
    const group = object('ForeignKeyColumnGroup', { ...named(row), parentColumnGroup: ref(parent.group), useIndexing: false });
    const constraint = object('ForeignKeyConstraint', named(row)); set(group, 'foreignKeyConstraint', ref(constraint)); push(tableObjects.get(oid)!, 'columnGroups', group);
    props(constraint, 'ForeignKeyConstraintProperties', { onDeleteRule: actions[text(row, 'deleteAction')], onUpdateRule: actions[text(row, 'updateAction')], deferrable: row.deferrable === true, deferred: row.deferred === true, validated: row.validated === false, match: ({ s: 'SIMPLE', f: 'FULL', p: 'PARTIAL' } as Record<string, string>)[text(row, 'match')] });
    nums.forEach((number, index) => { const membership = object('ColumnReference', { group: ref(group), entryIndex: index, parentColumn: ref(columnObjects.get(`${parent.tableOid}:${parentNums[index]}`)!) }); push(columnObjects.get(`${oid}:${number}`)!, 'memberships', object('MembershipEntry', { key: ref(group), value: ref(membership) })); });
    const relation = object('Relation', { foreignKeyColumnGroup: ref(group), identifying: false, parentCardinalityType: nums.every(n => columnRows.get(oid)!.find(c => c.number === n)?.notNull === true) ? 'EXACTLY_ONE' : 'ZERO_OR_ONE', childCardinalityType: 'ZERO_OR_MORE' });
    push(manager, 'relation', object('RelationEntry', { key: ref(group), value: ref(relation) }));
    if (list(row, 'deleteSetColumns').length) omitted('FOREIGN_KEY_DELETE_COLUMN_SUBSET_NOT_REPRESENTED', 'ON DELETE SET NULL/DEFAULT 대상 컬럼 부분 집합을 변환하지 않았습니다.', path, row.deleteSetColumns);
  }
  for (const [i, value] of list(catalog, 'unsupportedObjects').entries()) omitted('DATABASE_OBJECT_NOT_REPRESENTED', '현재 역공학 범위 밖 DB 객체입니다.', `unsupportedObjects[${i}]`, value);
  if (diagnostics.some(d => d.severity === 'error')) return result();
  try { document = rebuildNativeDocument(graph); for (const d of validateNativeDocument(document)) diagnostics.push(d); }
  catch (e) { error('NATIVE_MODEL_BUILD_FAILED', e instanceof Error ? e.message : String(e)); }
  return result();
}
