import type { Issue, Model } from './model';

/** Validate model semantics. JSON shape validation lives in parseModel(). */
export function validateModel(model: Model): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, tableId?: string, columnId?: string) => issues.push({ severity: 'error', code, message, tableId, columnId });
  const warning = (code: string, message: string, tableId?: string, columnId?: string) => issues.push({ severity: 'warning', code, message, tableId, columnId });
  const ids = new Set<string>();
  const register = (id: string, label: string) => {
    if (!id.trim()) error('EMPTY_ID', `${label}: ID가 비어 있습니다.`);
    else if (ids.has(id)) error('DUPLICATE_ID', `${label}: 중복 ID ${id}`);
    ids.add(id);
  };
  register(model.id, '모델');
  if (!['postgresql', 'mysql', 'sqlite'].includes(model.dialect)) error('INVALID_DIALECT', '지원하지 않는 DB 방언입니다.');
  const names = new Set<string>();
  const globalIndexNames = new Set<string>();
  const subjects = new Set(model.subjects.map(s => s.id));
  for (const subject of model.subjects) register(subject.id, '주제 영역');
  for (const term of model.terms) {
    register(term.id, '용어');
    if (!term.physicalName.trim()) warning('EMPTY_TERM_NAME', '물리명이 없는 용어가 있습니다.');
  }
  for (const table of model.tables) {
    register(table.id, '테이블');
    if (!table.name.trim()) error('EMPTY_TABLE_NAME', '테이블 물리명이 비어 있습니다.', table.id);
    if ([table.name, table.schema].some(name => name.includes('\0'))) error('INVALID_IDENTIFIER', '식별자에 NUL 문자를 사용할 수 없습니다.', table.id);
    const key = model.dialect === 'sqlite' ? `${table.schema}\0${table.name}`.toLowerCase() : `${table.schema}\0${table.name}`;
    if (names.has(key)) error('DUPLICATE_TABLE', `중복 테이블: ${table.schema ? table.schema + '.' : ''}${table.name}`, table.id);
    names.add(key);
    if (!Number.isFinite(table.x) || !Number.isFinite(table.y)) error('INVALID_POSITION', '테이블 좌표는 유한한 숫자여야 합니다.', table.id);
    if (table.subjectId && !subjects.has(table.subjectId)) error('MISSING_SUBJECT', '존재하지 않는 주제 영역을 참조합니다.', table.id);
    if (!table.columns.length) error('EMPTY_TABLE', `${table.name}: 컬럼이 없습니다.`, table.id);
    if (!table.columns.some(c => c.primaryKey)) warning('NO_PRIMARY_KEY', `${table.name}: 기본키가 없습니다.`, table.id);
    const columnNames = new Set<string>();
    for (const column of table.columns) {
      register(column.id, '컬럼');
      if (!column.name.trim()) error('EMPTY_COLUMN_NAME', '컬럼 물리명이 비어 있습니다.', table.id, column.id);
      if (column.name.includes('\0')) error('INVALID_IDENTIFIER', '컬럼명에 NUL 문자를 사용할 수 없습니다.', table.id, column.id);
      const columnKey = model.dialect === 'postgresql' ? column.name : column.name.toLowerCase();
      if (columnNames.has(columnKey)) error('DUPLICATE_COLUMN', `${table.name}: 중복 컬럼 ${column.name}`, table.id, column.id);
      columnNames.add(columnKey);
      if (!column.type.trim()) error('EMPTY_COLUMN_TYPE', `${column.name}: 자료형이 비어 있습니다.`, table.id, column.id);
      if (column.primaryKey && column.nullable) error('NULLABLE_PRIMARY_KEY', `${column.name}: 기본키는 NULL을 허용할 수 없습니다.`, table.id, column.id);
    }
    const indexNames = new Set<string>();
    const columnIds = new Set(table.columns.map(c => c.id));
    for (const index of table.indexes) {
      register(index.id, '인덱스');
      if (!index.name.trim()) error('EMPTY_INDEX_NAME', '인덱스 이름이 비어 있습니다.', table.id);
      if (indexNames.has(index.name)) error('DUPLICATE_INDEX', `${table.name}: 중복 인덱스 ${index.name}`, table.id);
      indexNames.add(index.name);
      if (index.name.includes('\0')) error('INVALID_IDENTIFIER', '인덱스명에 NUL 문자를 사용할 수 없습니다.', table.id);
      if (model.dialect !== 'mysql') {
        const key = model.dialect === 'sqlite' ? `${table.schema}\0${index.name}`.toLowerCase() : `${table.schema}\0${index.name}`;
        if (globalIndexNames.has(key)) error('DUPLICATE_SCHEMA_INDEX', `같은 스키마에 중복 인덱스 ${index.name}이 있습니다.`, table.id);
        globalIndexNames.add(key);
      }
      if (!index.columnIds.length) error('EMPTY_INDEX', `${index.name}: 인덱스 컬럼이 없습니다.`, table.id);
      if (new Set(index.columnIds).size !== index.columnIds.length) error('DUPLICATE_INDEX_COLUMN', `${index.name}: 인덱스 컬럼이 중복됩니다.`, table.id);
      if (index.columnIds.some(id => !columnIds.has(id))) error('MISSING_INDEX_COLUMN', `${index.name}: 존재하지 않는 컬럼을 참조합니다.`, table.id);
    }
  }
  const tables = new Map(model.tables.map(t => [t.id, t]));
  const relationNames = new Set<string>();
  for (const relation of model.relationships) {
    register(relation.id, '관계');
    if (relation.name.includes('\0')) error('INVALID_IDENTIFIER', '제약 이름에 NUL 문자를 사용할 수 없습니다.');
    const parent = tables.get(relation.parentTableId), child = tables.get(relation.childTableId);
    if (!parent || !child) { error('MISSING_RELATION_TABLE', `${relation.name}: 관계의 테이블이 존재하지 않습니다.`); continue; }
    const relationName = `${child.id}\0${relation.name}`;
    if (relation.name && relationNames.has(relationName)) error('DUPLICATE_RELATION_NAME', `${child.name}: 중복 제약 이름 ${relation.name}`, child.id);
    relationNames.add(relationName);
    if (!relation.parentColumnIds.length || relation.parentColumnIds.length !== relation.childColumnIds.length) {
      error('RELATION_COLUMN_COUNT', `${relation.name}: 부모·자식 컬럼 개수가 같고 1개 이상이어야 합니다.`, child.id); continue;
    }
    if (new Set(relation.parentColumnIds).size !== relation.parentColumnIds.length || new Set(relation.childColumnIds).size !== relation.childColumnIds.length) error('DUPLICATE_RELATION_COLUMN', `${relation.name}: 관계 컬럼이 중복됩니다.`, child.id);
    const parentColumns = relation.parentColumnIds.map(id => parent.columns.find(c => c.id === id));
    const childColumns = relation.childColumnIds.map(id => child.columns.find(c => c.id === id));
    if (parentColumns.some(c => !c) || childColumns.some(c => !c)) { error('MISSING_RELATION_COLUMN', `${relation.name}: 존재하지 않는 컬럼을 참조합니다.`, child.id); continue; }
    const equalIds = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
    const parentUnique = equalIds(relation.parentColumnIds, parent.columns.filter(c => c.primaryKey).map(c => c.id))
      || (relation.parentColumnIds.length === 1 && parentColumns[0]!.unique)
      || parent.indexes.some(i => i.unique && equalIds(i.columnIds, relation.parentColumnIds));
    if (!parentUnique) error('FK_TARGET_NOT_UNIQUE', `${relation.name}: 참조 대상은 기본키 또는 UNIQUE 키여야 합니다.`, child.id);
    if (relation.onDelete === 'SET NULL' && childColumns.some(c => !c!.nullable)) error('SET_NULL_NOT_NULL', `${relation.name}: SET NULL 대상 컬럼은 NULL을 허용해야 합니다.`, child.id);
    if (relation.identifying && childColumns.some(c => !c!.primaryKey)) warning('IDENTIFYING_NON_PK', `${relation.name}: 식별 관계의 자식 컬럼이 기본키에 포함되지 않습니다.`, child.id);
    if (relation.cardinality === '1:1') {
      const uniqueChild = equalIds(relation.childColumnIds, child.columns.filter(c => c.primaryKey).map(c => c.id))
        || (relation.childColumnIds.length === 1 && childColumns[0]!.unique)
        || child.indexes.some(i => i.unique && equalIds(i.columnIds, relation.childColumnIds));
      if (!uniqueChild) error('ONE_TO_ONE_NOT_UNIQUE', `${relation.name}: 1:1 관계의 자식 키에 UNIQUE가 필요합니다.`, child.id);
    }
    parentColumns.forEach((c, i) => {
      if (c!.type.toUpperCase().replace(/\s/g, '') !== childColumns[i]!.type.toUpperCase().replace(/\s/g, '')) warning('FK_TYPE_MISMATCH', `${relation.name}: ${c!.name}과 ${childColumns[i]!.name}의 자료형이 다릅니다.`, child.id);
    });
  }
  return issues;
}
