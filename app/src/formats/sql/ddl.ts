import { createColumn, createModel, createTable, newId } from '../../core/model';
import type { Dialect, Model, Relationship, Table } from '../../core/model';
import { validateModel } from '../../core/validation';

interface Token { text: string; kind: 'word' | 'identifier' | 'string' | 'symbol'; value: string }
const upper = (t?: Token) => t?.kind === 'word' ? t.value.toUpperCase() : '';

/** Tokenizer, deliberately independent of the DOM, Node, and database drivers. */
function tokenize(sql: string, dialect: Dialect = 'postgresql'): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) {
      if (sql.startsWith('/*!', i)) throw new Error('MySQL 실행형 주석(/*! ... */)은 지원하지 않습니다.');
      let nesting = 1; i += 2;
      while (i < sql.length && nesting) {
        if (sql.startsWith('/*', i)) { nesting++; i += 2; }
        else if (sql.startsWith('*/', i)) { nesting--; i += 2; }
        else i++;
      }
      if (nesting) throw new Error('닫히지 않은 SQL 주석입니다.');
      continue;
    }
    if (ch === '$') {
      const delimiter = sql.slice(i).match(/^\$[a-zA-Z_0-9]*\$/)?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) throw new Error('닫히지 않은 dollar-quoted 문자열입니다.');
        const text = sql.slice(i, end + delimiter.length);
        tokens.push({ text, value: text.slice(delimiter.length, -delimiter.length), kind: 'string' });
        i = end + delimiter.length; continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch, start = i++;
      let value = '', closed = false;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) { value += close; i += 2; }
          else { i++; closed = true; break; }
        } else if (sql[i] === '\\' && ch === "'" && dialect === 'mysql') {
          // Backslash string semantics depend on server modes; guessing can corrupt defaults.
          throw new Error('역슬래시 이스케이프 문자열은 SQL 모드에 따라 의미가 달라 지원하지 않습니다. 작은따옴표를 두 번 사용하세요.');
        } else value += sql[i++]!;
      }
      if (!closed) throw new Error('닫히지 않은 SQL 문자열 또는 식별자입니다.');
      tokens.push({ text: sql.slice(start, i), value, kind: ch === "'" ? 'string' : 'identifier' }); continue;
    }
    const number = sql.slice(i).match(/^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)(?![\p{L}\p{N}_$])/u)?.[0];
    if (number) { tokens.push({text: number, value: number, kind: 'word'}); i += number.length; continue; }
    const word = sql.slice(i).match(/^[\p{L}\p{N}_$]+/u)?.[0];
    if (word) {
      if ((/^[eEnNbBxX]$/.test(word) && sql[i + word.length] === "'") || /^[uU]&'/.test(sql.slice(i))) throw new Error('접두사 문자열 리터럴은 현재 지원하지 않습니다. 표준 SQL 문자열을 사용하세요.');
      tokens.push({ text: word, value: word, kind: 'word' }); i += word.length; continue;
    }
    const operator = sql.slice(i).match(/^(::|>=|<=|<>|!=|==|<<|>>|\|\||&&|->>|->|#>>|#>|@>|<@|\?\||\?&)/)?.[0] ?? ch;
    tokens.push({ text: operator, value: operator, kind: 'symbol' }); i += operator.length;
  }
  return tokens;
}
const join = (tokens: Token[]) => tokens.reduce((result, token, i) => {
  const prev = tokens[i - 1];
  const compact = !prev || ['.', '::', ')', ',', ']'].includes(token.text) || ['.', '::', '(', '['].includes(prev.text) || token.text === '(';
  return result + (compact ? '' : ' ') + token.text;
}, '');
function splitTop(tokens: Token[], separator: string): Token[][] {
  const result: Token[][] = []; let part: Token[] = [], depth = 0;
  for (const t of tokens) {
    if (t.text === '(') depth++;
    if (t.text === ')') depth--;
    if (depth < 0) throw new Error('SQL 괄호의 짝이 맞지 않습니다.');
    if (t.text === separator && depth === 0) { if (part.length) result.push(part); part = []; }
    else part.push(t);
  }
  if (depth !== 0) throw new Error('SQL 괄호의 짝이 맞지 않습니다.');
  if (part.length) result.push(part);
  return result;
}
class Cursor {
  i = 0;
  constructor(readonly tokens: Token[], readonly dialect: Dialect = 'sqlite') {}
  get done() { return this.i >= this.tokens.length; }
  peek() { return this.tokens[this.i]; }
  take() { const t = this.tokens[this.i++]; if (!t) throw new Error('SQL이 예상보다 일찍 끝났습니다.'); return t; }
  match(value: string) { const t = this.peek(); if (upper(t) === value || (t?.kind === 'symbol' && t.text === value)) { this.i++; return true; } return false; }
  expect(value: string) { if (!this.match(value)) throw new Error(`SQL 구문 오류: ${value} 예상, 실제 ${this.peek()?.text ?? '끝'}`); }
  name() { const t = this.take(); if (t.kind !== 'word' && t.kind !== 'identifier') throw new Error(`식별자가 필요합니다: ${t.text}`); return t.kind === 'word' && this.dialect === 'postgresql' ? t.value.toLowerCase() : t.value; }
  qualified(): { schema: string; name: string } { const first = this.name(); return this.match('.') ? { schema: first, name: this.name() } : { schema: '', name: first }; }
  group(): Token[] {
    this.expect('('); const start = this.i; let depth = 1;
    while (!this.done) { const t = this.take(); if (t.text === '(') depth++; if (t.text === ')') depth--; if (!depth) return this.tokens.slice(start, this.i - 1); }
    throw new Error('닫히지 않은 SQL 괄호입니다.');
  }
  columns(): string[] {
    return splitTop(this.group(), ',').map(p => { const c = new Cursor(p, this.dialect), name = c.name(); if (!c.done) throw new Error(`표현식·정렬·인덱스 prefix는 지원하지 않습니다: ${join(p)}`); return name; });
  }
}
interface ForeignKey { child: Table; name: string; childNames: string[]; parent: {schema: string; name: string}; parentNames: string[]; onDelete: Relationship['onDelete'] }
const quote = (value: string, dialect: Dialect) => dialect === 'mysql' ? '`' + value.replace(/`/g, '``') + '`' : '"' + value.replace(/"/g, '""') + '"';
const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const tableSqlName = (table: Table, dialect: Dialect) => (table.schema ? quote(table.schema, dialect) + '.' : '') + quote(table.name, dialect);

function assertFragment(fragment: string, label: string, dialect: Dialect) {
  const tokens = tokenize(fragment, dialect);
  if (!tokens.length || tokens.some(t => t.text === ';') || /--|\/\*/.test(fragment.replace(/'(?:''|[^'])*'/g, "''"))) throw new Error(`${label}: 여러 문장 또는 SQL 주석을 포함할 수 없습니다.`);
  if (splitTop(tokens, ',').length > 1) throw new Error(`${label}: 최상위 쉼표를 포함할 수 없습니다.`);
}

/** Generate a complete schema script. It is never executed by this module. */
export function exportSql(model: Model): string {
  const errors = validateModel(model).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`SQL 생성 실패:\n${errors.map(e => e.message).join('\n')}`);
  const dialect = model.dialect, q = (s: string) => quote(s, dialect), lines: string[] = ['-- Generated by ERD Maker; review before applying.'];
  const tables = new Map(model.tables.map(t => [t.id, t]));
  const schemas = [...new Set(model.tables.map(t => t.schema).filter(Boolean))];
  if (dialect === 'postgresql') for (const schema of schemas) lines.push(`CREATE SCHEMA IF NOT EXISTS ${q(schema)};`);
  if (dialect === 'sqlite' && schemas.some(s => s !== 'main' && s !== 'temp')) throw new Error('SQLite는 main/temp 외 스키마에 ATTACH가 필요합니다. 별도로 연결하거나 스키마를 비워 주세요.');
  const foreignClause = (r: Relationship) => {
    const parent = tables.get(r.parentTableId)!, child = tables.get(r.childTableId)!;
    const names = (t: Table, ids: string[]) => ids.map(id => q(t.columns.find(c => c.id === id)!.name)).join(', ');
    // SQLite REFERENCES syntax forbids schema-qualified parent names.
    if (dialect === 'sqlite' && parent.schema !== child.schema) throw new Error('SQLite는 스키마 간 외래키를 지원하지 않습니다.');
    const parentName = dialect === 'sqlite' ? q(parent.name) : tableSqlName(parent, dialect);
    return `${r.name ? `CONSTRAINT ${q(r.name)} ` : ''}FOREIGN KEY (${names(child, r.childColumnIds)}) REFERENCES ${parentName} (${names(parent, r.parentColumnIds)}) ON DELETE ${r.onDelete}`;
  };
  for (const table of model.tables) {
    const body: string[] = [];
    if (dialect === 'mysql' && [table.comment, ...table.columns.map(c => c.comment)].some(s => s.includes('\\'))) throw new Error('MySQL 주석의 역슬래시는 SQL 모드에 따라 달라 안전하게 내보낼 수 없습니다.');
    if (dialect === 'sqlite') {
      // Comments remain source metadata because SQLite has no COMMENT ON facility.
      for (const [column, comment] of [['', table.comment], ...table.columns.map(c => [c.name, c.comment])]) {
        if (comment) lines.push(`-- ERD-MAKER-COMMENT ${JSON.stringify({schema: table.schema, table: table.name, column, comment})}`);
      }
    }
    for (const column of table.columns) {
      assertFragment(column.type, `${table.name}.${column.name} 자료형`, dialect);
      if (column.defaultValue) assertFragment(column.defaultValue, `${table.name}.${column.name} 기본값`, dialect);
      body.push(`${q(column.name)} ${column.type}${column.nullable ? '' : ' NOT NULL'}${column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''}${column.unique ? ' UNIQUE' : ''}${dialect === 'mysql' && column.comment ? ` COMMENT ${literal(column.comment)}` : ''}`);
    }
    const pk = table.columns.filter(c => c.primaryKey);
    if (pk.length) body.push(`PRIMARY KEY (${pk.map(c => q(c.name)).join(', ')})`);
    if (dialect === 'sqlite') for (const r of model.relationships.filter(r => r.childTableId === table.id)) body.push(foreignClause(r));
    lines.push(`CREATE TABLE ${tableSqlName(table, dialect)} (\n  ${body.join(',\n  ')}\n)${dialect === 'mysql' && table.comment ? ` COMMENT=${literal(table.comment)}` : ''};`);
    if (dialect === 'postgresql') {
      if (table.comment) lines.push(`COMMENT ON TABLE ${tableSqlName(table, dialect)} IS ${literal(table.comment)};`);
      for (const column of table.columns) if (column.comment) lines.push(`COMMENT ON COLUMN ${tableSqlName(table, dialect)}.${q(column.name)} IS ${literal(column.comment)};`);
    }
  }
  for (const table of model.tables) for (const index of table.indexes) {
    const indexName = (dialect === 'sqlite' && table.schema ? q(table.schema) + '.' : '') + q(index.name);
    const target = dialect === 'sqlite' ? q(table.name) : tableSqlName(table, dialect);
    lines.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${target} (${index.columnIds.map(id => q(table.columns.find(c => c.id === id)!.name)).join(', ')});`);
  }
  if (dialect !== 'sqlite') for (const r of model.relationships) lines.push(`ALTER TABLE ${tableSqlName(tables.get(r.childTableId)!, dialect)} ADD ${foreignClause(r)};`);
  return lines.join('\n\n') + '\n';
}

/** Import a conservative DDL subset. Unsupported structural clauses throw, other statements warn. */
export function importSql(sql: string, dialect: Dialect): { model: Model; warnings: string[] } {
  if (!['postgresql', 'mysql', 'sqlite'].includes(dialect)) throw new Error('지원하지 않는 SQL 방언입니다.');
  const model = createModel('가져온 SQL 모델'); model.dialect = dialect;
  const warnings: string[] = [], foreignKeys: ForeignKey[] = [];
  const primaryKeyOrder = new Map<string, string[]>();
  const indexes: { target: {schema: string; name: string}; name: string; columns: string[]; unique: boolean }[] = [];
  const comments: {schema: string; table: string; column: string; comment: string}[] = [];
  for (const line of sql.split(/\r?\n/)) {
    const m = line.match(/^\s*-- ERD-MAKER-COMMENT (.+)$/);
    if (m) {
      const v: unknown = JSON.parse(m[1]!);
      if (!v || typeof v !== 'object' || ['schema','table','column','comment'].some(k => typeof (v as Record<string, unknown>)[k] !== 'string')) throw new Error('ERD Maker 주석 메타데이터가 올바르지 않습니다.');
      comments.push(v as typeof comments[number]);
    }
  }
  const findTable = (ref: { schema: string; name: string }, fallbackSchema = ''): Table => {
    const schema = ref.schema || fallbackSchema;
    const equal = (a: string, b: string) => dialect === 'sqlite' ? a.toLowerCase() === b.toLowerCase() : a === b;
    const matches = model.tables.filter(t => equal(t.name, ref.name) && (schema ? equal(t.schema, schema) : true));
    if (matches.length !== 1) throw new Error(`테이블 ${schema ? schema + '.' : ''}${ref.name}: ${matches.length ? '스키마가 모호합니다.' : '정의가 없습니다.'}`);
    return matches[0]!;
  };
  const findColumnIds = (table: Table, names: string[]) => names.map(name => {
    const col = table.columns.find(c => dialect === 'postgresql' ? c.name === name : c.name.toLowerCase() === name.toLowerCase());
    if (!col) throw new Error(`${table.name}.${name}: 컬럼 정의가 없습니다.`);
    return col.id;
  });
  const addUnique = (table: Table, names: string[], name = '') => {
    const ids = findColumnIds(table, names);
    if (ids.length === 1 && !name) table.columns.find(c => c.id === ids[0])!.unique = true;
    else table.indexes.push({ id: newId(), name: name || `uq_${table.name}_${names.join('_')}`, columnIds: ids, unique: true });
  };
  const readForeign = (c: Cursor, child: Table, name: string, childNames?: string[]) => {
    if (!childNames) { c.expect('FOREIGN'); c.expect('KEY'); childNames = c.columns(); }
    c.expect('REFERENCES'); const parent = c.qualified();
    const parentNames = c.peek()?.text === '(' ? c.columns() : [];
    let onDelete: Relationship['onDelete'] = 'NO ACTION';
    const actions = new Set<string>();
    while (!c.done) {
      if (c.match('ON')) {
        const deletion = c.match('DELETE'); if (!deletion) c.expect('UPDATE');
        const actionKind = deletion ? 'DELETE' : 'UPDATE';
        if (actions.has(actionKind)) throw new Error(`외래키 ON ${actionKind}가 중복 정의되었습니다.`);
        actions.add(actionKind);
        const first = c.take().value.toUpperCase();
        const action = first === 'NO' ? (c.expect('ACTION'), 'NO ACTION') : first === 'SET' ? (c.expect('NULL'), 'SET NULL') : first;
        if (!['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'].includes(action)) throw new Error(`지원하지 않는 참조 동작: ${action}`);
        if (deletion) onDelete = action as Relationship['onDelete'];
        else if (action !== 'NO ACTION') throw new Error('ON UPDATE 동작은 현재 모델에서 보존할 수 없습니다.');
      } else throw new Error(`지원하지 않는 외래키 옵션: ${join(c.tokens.slice(c.i))}`);
    }
    foreignKeys.push({ child, name, childNames, parent, parentNames, onDelete });
  };
  const constraints = new Set(['PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'DEFAULT', 'COMMENT', 'REFERENCES', 'CHECK', 'CONSTRAINT', 'COLLATE', 'GENERATED', 'AUTO_INCREMENT', 'AUTOINCREMENT', 'IDENTITY', 'ON']);
  for (const statement of splitTop(tokenize(sql, dialect), ';')) {
    const c = new Cursor(statement, dialect);
    if (c.match('CREATE')) {
      if (c.match('SCHEMA')) { if (c.match('IF')) { c.expect('NOT'); c.expect('EXISTS'); } c.name(); if (!c.done) warnings.push(`스키마 옵션을 가져오지 않았습니다: ${join(statement)}`); continue; }
      if (c.match('TABLE')) {
        if (c.match('IF')) { c.expect('NOT'); c.expect('EXISTS'); }
        const ref = c.qualified();
        if (model.tables.some(t => t.schema === ref.schema && t.name === ref.name)) throw new Error(`테이블 중복 정의: ${ref.name}`);
        const table = createTable(ref.name, 80 + (model.tables.length % 4) * 320, 80 + Math.floor(model.tables.length / 4) * 320);
        table.schema = ref.schema; table.columns = []; model.tables.push(table);
        const parts = splitTop(c.group(), ',');
        const pending: Token[][] = [];
        for (const part of parts) {
          const p = new Cursor(part, dialect);
          if (['CONSTRAINT', 'PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK', 'KEY', 'INDEX'].includes(upper(p.peek()))) { pending.push(part); continue; }
          const name = p.name(), column = createColumn(name); column.primaryKey = false; column.nullable = true;
          const start = p.i; let depth = 0;
          while (!p.done) {
            const t = p.peek()!;
            if (!depth && constraints.has(upper(t))) break;
            if (t.text === '(') depth++; if (t.text === ')') depth--;
            p.i++;
          }
          column.type = join(part.slice(start, p.i));
          if (!column.type) throw new Error(`${table.name}.${name}: 자료형이 없습니다.`);
          const typeTokens = part.slice(start, p.i);
          if (typeTokens.some(t => ['AS', 'STORED', 'VIRTUAL'].includes(upper(t)))) throw new Error('생성 컬럼은 현재 지원하지 않습니다.');
          const attributes = new Set<string>();
          while (!p.done) {
            const attribute = upper(p.peek());
            if (['DEFAULT', 'COMMENT', 'UNIQUE', 'PRIMARY', 'REFERENCES'].includes(attribute)) {
              if (attributes.has(attribute)) throw new Error(`${table.name}.${name}: ${attribute}가 중복 정의되었습니다.`);
              attributes.add(attribute);
            }
            if (p.match('PRIMARY')) {
              p.expect('KEY');
              if (primaryKeyOrder.has(table.id)) throw new Error(`${table.name}: 기본키가 여러 번 정의되었습니다.`);
              column.primaryKey = true; column.nullable = false; primaryKeyOrder.set(table.id, [name]);
            }
            else if (p.match('NOT')) { p.expect('NULL'); column.nullable = false; }
            else if (p.match('NULL')) column.nullable = true;
            else if (p.match('UNIQUE')) { p.match('KEY'); column.unique = true; }
            else if (p.match('DEFAULT')) {
              const begin = p.i; let nesting = 0;
              while (!p.done) {
                const t = p.peek()!;
                if (!nesting && p.i > begin && constraints.has(upper(t))) break;
                if (t.text === '(') nesting++; if (t.text === ')') nesting--;
                p.i++;
              }
              if (begin === p.i) throw new Error('DEFAULT 표현식이 비어 있습니다.');
              column.defaultValue = join(part.slice(begin, p.i));
            } else if (p.match('COMMENT')) { const value = p.take(); if (value.kind !== 'string') throw new Error('COMMENT에는 문자열이 필요합니다.'); column.comment = value.value; }
            else if (upper(p.peek()) === 'REFERENCES') { readForeign(p, table, '', [name]); }
            else throw new Error(`${table.name}.${name}: 지원하지 않는 컬럼 옵션 ${join(part.slice(p.i))}`);
          }
          table.columns.push(column);
        }
        for (const part of pending) {
          const p = new Cursor(part, dialect); let name = '';
          if (p.match('CONSTRAINT')) name = p.name();
          if (p.match('PRIMARY')) {
            p.expect('KEY'); const names = p.columns();
            if (table.columns.some(col => col.primaryKey)) throw new Error(`${table.name}: 기본키가 여러 번 정의되었습니다.`);
            const ids = findColumnIds(table, names);
            primaryKeyOrder.set(table.id, names);
            table.columns.forEach(col => { if (ids.includes(col.id)) { col.primaryKey = true; col.nullable = false; } });
            if (name) warnings.push(`${table.name}: 기본키 제약 이름 ${name}은 보존되지 않습니다.`);
            if (names.join('\0') !== table.columns.filter(col => col.primaryKey).map(col => col.name).join('\0')) warnings.push(`${table.name}: 복합 기본키 순서는 모델의 컬럼 순서로 정규화됩니다.`);
          } else if (p.match('UNIQUE')) {
            p.match('KEY') || p.match('INDEX');
            if (p.peek()?.text !== '(') name = p.name();
            addUnique(table, p.columns(), name);
          } else if (upper(p.peek()) === 'FOREIGN') readForeign(p, table, name);
          else if (p.match('KEY') || p.match('INDEX')) {
            const indexName = p.peek()?.text === '(' ? `ix_${table.name}_${table.indexes.length + 1}` : p.name();
            table.indexes.push({ id: newId(), name: indexName, columnIds: findColumnIds(table, p.columns()), unique: false });
          } else throw new Error(`${table.name}: 지원하지 않는 테이블 제약 ${join(part)}`);
          if (!p.done) throw new Error(`${table.name}: 지원하지 않는 제약 옵션 ${join(part.slice(p.i))}`);
        }
        while (!c.done) {
          if (c.match('COMMENT')) { c.match('='); const token = c.take(); if (token.kind !== 'string') throw new Error('테이블 COMMENT에는 문자열이 필요합니다.'); table.comment = token.value; }
          else { warnings.push(`테이블 ${table.name}의 저장소 옵션을 가져오지 않았습니다: ${join(statement.slice(c.i))}`); break; }
        }
        continue;
      }
      const unique = c.match('UNIQUE');
      if (c.match('INDEX')) {
        if (c.match('IF')) { c.expect('NOT'); c.expect('EXISTS'); }
        const index = c.qualified(); c.expect('ON'); const target = c.qualified();
        if (dialect === 'sqlite' && index.schema && !target.schema) target.schema = index.schema;
        const columns = c.columns();
        if (!c.done) throw new Error(`조건부·표현식·정렬 인덱스는 지원하지 않습니다: ${join(statement)}`);
        indexes.push({ target, name: index.name, columns, unique }); continue;
      }
      warnings.push(`지원하지 않는 문장을 가져오지 않았습니다: ${join(statement).slice(0, 160)}`); continue;
    }
    if (c.match('ALTER')) {
      c.expect('TABLE'); const table = findTable(c.qualified()); c.expect('ADD');
      let name = ''; if (c.match('CONSTRAINT')) name = c.name();
      if (upper(c.peek()) === 'FOREIGN') readForeign(c, table, name);
      else if (c.match('UNIQUE')) { addUnique(table, c.columns(), name); if (!c.done) throw new Error('지원하지 않는 ALTER TABLE UNIQUE 옵션입니다.'); }
      else throw new Error(`지원하지 않는 ALTER TABLE 변경: ${join(statement)}`);
      continue;
    }
    if (c.match('COMMENT')) {
      c.expect('ON'); const column = c.match('COLUMN'); if (!column) c.expect('TABLE');
      const first = c.name(); let schema = '', table = first, columnName = '';
      if (column) { c.expect('.'); const second = c.name(); if (c.match('.')) { schema = first; table = second; columnName = c.name(); } else columnName = second; }
      else if (c.match('.')) { schema = first; table = c.name(); }
      c.expect('IS'); const value = c.take();
      if (value.kind !== 'string' && upper(value) !== 'NULL') throw new Error('COMMENT IS에는 문자열 또는 NULL이 필요합니다.');
      if (!c.done) throw new Error('COMMENT 뒤에 지원하지 않는 옵션이 있습니다.');
      comments.push({schema, table, column: columnName, comment: upper(value) === 'NULL' ? '' : value.value}); continue;
    }
    warnings.push(`실행하지 않고 제외한 SQL 문장: ${join(statement).slice(0, 160)}`);
  }
  for (const index of indexes) {
    const table = findTable(index.target);
    table.indexes.push({ id: newId(), name: index.name, columnIds: findColumnIds(table, index.columns), unique: index.unique });
  }
  for (const fk of foreignKeys) {
    const parent = findTable(fk.parent, fk.child.schema);
    const parentNames = fk.parentNames.length ? fk.parentNames : primaryKeyOrder.get(parent.id) ?? parent.columns.filter(c => c.primaryKey).map(c => c.name);
    const parentColumnIds = findColumnIds(parent, parentNames), childColumnIds = findColumnIds(fk.child, fk.childNames);
    const uniqueChild = (childColumnIds.length === 1 && fk.child.columns.find(col => col.id === childColumnIds[0])!.unique)
      || fk.child.indexes.some(index => index.unique && index.columnIds.length === childColumnIds.length && childColumnIds.every(id => index.columnIds.includes(id)))
      || (fk.child.columns.filter(col => col.primaryKey).length === childColumnIds.length && childColumnIds.every(id => fk.child.columns.find(col => col.id === id)!.primaryKey));
    model.relationships.push({ id: newId(), name: fk.name, parentTableId: parent.id, childTableId: fk.child.id, parentColumnIds, childColumnIds,
      identifying: childColumnIds.every(id => fk.child.columns.find(col => col.id === id)!.primaryKey), cardinality: uniqueChild ? '1:1' : '1:N', onDelete: fk.onDelete });
  }
  for (const comment of comments) {
    const table = findTable({schema: comment.schema, name: comment.table});
    if (comment.column) { const col = table.columns.find(c => c.name === comment.column); if (!col) throw new Error(`COMMENT 대상 컬럼이 없습니다: ${comment.table}.${comment.column}`); col.comment = comment.comment; }
    else table.comment = comment.comment;
  }
  if (!model.tables.length) throw new Error('가져올 수 있는 CREATE TABLE 문장이 없습니다.');
  const issues = validateModel(model), errors = issues.filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`SQL 모델 검증 실패:\n${errors.map(e => e.message).join('\n')}`);
  warnings.push(...issues.filter(i => i.severity === 'warning').map(i => i.message));
  return { model, warnings };
}
