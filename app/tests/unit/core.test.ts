import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createColumn, createModel, createTable, type Dialect } from '../../src/core/model';
import { exportSql, importSql } from '../../src/formats/sql/ddl';
import { parseModel } from '../../src/formats/project/json';
import { validateModel } from '../../src/core/validation';
import { diffModels } from '../../src/core/diff';

const ddl = `
CREATE TABLE tenants (
  tenant_id INTEGER NOT NULL,
  code VARCHAR(30) NOT NULL,
  label VARCHAR(255) DEFAULT 'literal . ( text ); -- still text',
  PRIMARY KEY (tenant_id, code),
  CONSTRAINT uq_tenant_label UNIQUE (label)
);
CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  tenant_code VARCHAR(30) NOT NULL,
  amount DECIMAL(12, 2) DEFAULT 0,
  FOREIGN KEY (tenant_id, tenant_code) REFERENCES tenants (tenant_id, code) ON DELETE CASCADE
);
CREATE INDEX ix_entries_tenant ON entries (tenant_id, tenant_code);
`;

describe('SQL import/export', () => {
  for (const dialect of ['postgresql','mysql','sqlite'] as Dialect[]) {
    it(`${dialect}: retains composite keys, indexes, defaults and comments`, () => {
      const {model, warnings} = importSql(ddl, dialect);
      expect(warnings).toEqual([]);
      model.tables[0]!.comment = "Tenant's table\n한국어 설명";
      model.tables[0]!.columns[2]!.comment = 'Text . ( ) --;';
      expect(model.relationships[0]!.parentColumnIds).toHaveLength(2);
      const exported = exportSql(model);
      const {model: roundTrip} = importSql(exported, dialect);
      expect(roundTrip.tables[0]!.columns[2]!.defaultValue).toBe("'literal . ( text ); -- still text'");
      expect(roundTrip.tables[0]!.comment).toBe(model.tables[0]!.comment);
      expect(roundTrip.tables[0]!.columns[2]!.comment).toBe(model.tables[0]!.columns[2]!.comment);
      expect(diffModels(model, roundTrip)).toEqual([]);
    });
  }
  it('resolves later table definitions, ALTER constraints, schema and quoted identifiers', () => {
    const {model} = importSql(`CREATE TABLE "app"."child" ("parent id" BIGINT NOT NULL, "key" BIGINT PRIMARY KEY);
      CREATE TABLE "app"."parent" ("id" BIGINT PRIMARY KEY);
      ALTER TABLE "app"."child" ADD CONSTRAINT "parent fk" FOREIGN KEY ("parent id") REFERENCES "app"."parent" ("id") ON DELETE RESTRICT;
      COMMENT ON COLUMN "app"."child"."parent id" IS 'a''b';`, 'postgresql');
    expect(model.relationships[0]!.name).toBe('parent fk');
    expect(model.tables[0]!.columns[0]!.comment).toBe("a'b");
    expect(exportSql(model)).toContain('CREATE SCHEMA IF NOT EXISTS "app"');
  });
  it('folds only unquoted PostgreSQL names and retains cast defaults', () => {
    const {model} = importSql(`CREATE TABLE Foo (ID INT PRIMARY KEY, "MixedCase" TEXT DEFAULT 'A . ( B )'::text);`, 'postgresql');
    expect(model.tables[0]!.name).toBe('foo');
    expect(model.tables[0]!.columns.map(c => c.name)).toEqual(['id','MixedCase']);
    expect(model.tables[0]!.columns[1]!.defaultValue).toBe("'A . ( B )'::text");
  });
  it('infers unique child FK as a one-to-one relationship', () => {
    const {model} = importSql('CREATE TABLE p(id INT PRIMARY KEY); CREATE TABLE c(id INT PRIMARY KEY REFERENCES p);', 'sqlite');
    expect(model.relationships[0]!.cardinality).toBe('1:1');
    expect(model.relationships[0]!.identifying).toBe(true);
  });
  it('handles MySQL inline comments and unique key syntax', () => {
    const {model} = importSql("CREATE TABLE `t` (`id` INT PRIMARY KEY, `value` VARCHAR(20) COMMENT 'v', UNIQUE KEY `uq_value` (`value`)) COMMENT='table' ENGINE=InnoDB;", 'mysql');
    expect(model.tables[0]!.comment).toBe('table');
    expect(model.tables[0]!.indexes[0]!.name).toBe('uq_value');
    expect(model.tables[0]!.columns[1]!.comment).toBe('v');
  });
  it('warns about discarded statements and basic-key constraint names', () => {
    const result = importSql('CREATE TABLE t(id INT, CONSTRAINT pk_t PRIMARY KEY(id)); INSERT INTO t VALUES(1);', 'sqlite');
    expect(result.warnings.join('\n')).toContain('기본키 제약 이름');
    expect(result.warnings.join('\n')).toContain('실행하지 않고 제외');
  });
  for (const sql of [
    'CREATE TABLE t(id INT PRIMARY KEY, x INT CHECK(x > 0));',
    'CREATE TABLE t(id INT PRIMARY KEY, x INT GENERATED ALWAYS AS (id + 1));',
    'CREATE TABLE t(id INT PRIMARY KEY AUTO_INCREMENT);',
    'CREATE TABLE p(id INT PRIMARY KEY); CREATE TABLE c(id INT REFERENCES p(id) ON UPDATE CASCADE);',
    'CREATE TABLE t(id INT PRIMARY KEY); CREATE INDEX ix ON t(id DESC);',
    'CREATE TABLE t(id INT PRIMARY KEY); CREATE INDEX ix ON t(lower(id));',
    'CREATE TABLE t(id INT PRIMARY KEY, x INT DEFAULT 0 ON UPDATE CURRENT_TIMESTAMP);',
    "CREATE TABLE t(id INT PRIMARY KEY, x TEXT DEFAULT 'unclosed);",
  ]) it(`rejects unsupported or malformed structure: ${sql.slice(0, 60)}`, () => expect(() => importSql(sql, 'postgresql')).toThrow());
  it('rejects unresolved FKs, invalid constraints, and multiple SQL statements in type fields', () => {
    expect(() => importSql('CREATE TABLE t(id INT REFERENCES missing(id));', 'sqlite')).toThrow('정의가 없습니다');
    expect(() => importSql('CREATE TABLE p(id INT); CREATE TABLE c(id INT REFERENCES p(id));', 'sqlite')).toThrow('UNIQUE');
    const model = importSql('CREATE TABLE t(id INT PRIMARY KEY);', 'sqlite').model;
    model.tables[0]!.columns[0]!.type = 'INT; DROP TABLE t';
    expect(() => exportSql(model)).toThrow('여러 문장');
    model.tables[0]!.columns[0]!.type = 'INT, other TEXT';
    expect(() => exportSql(model)).toThrow('쉼표');
  });
});

describe('native SQLite execution', () => {
  const sqlite = spawnSync('sqlite3', ['--version']);
  it.skipIf(sqlite.status !== 0)('executes exported DDL and enforces composite FK, PK and unique index', () => {
    const model = importSql(ddl, 'sqlite').model;
    const sql = exportSql(model);
    const accepted = spawnSync('sqlite3', [':memory:'], {input: `PRAGMA foreign_keys=ON;\n${sql}
      INSERT INTO tenants(tenant_id, code, label) VALUES (1, 'A', 'one');
      INSERT INTO entries(id, tenant_id, tenant_code) VALUES(10, 1, 'A');
      PRAGMA foreign_key_list(entries);
      DELETE FROM tenants WHERE tenant_id=1 AND code='A';
      SELECT count(*) FROM entries;`, encoding: 'utf8'});
    expect(accepted.stderr).toBe(''); expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('CASCADE');
    expect(accepted.stdout.trim().endsWith('0')).toBe(true);
    const invalidFk = spawnSync('sqlite3', [':memory:'], {input: `PRAGMA foreign_keys=ON;\n${sql} INSERT INTO entries(id, tenant_id, tenant_code) VALUES(10, 99, 'missing');`, encoding:'utf8'});
    expect(invalidFk.status).not.toBe(0); expect(invalidFk.stderr).toContain('FOREIGN KEY constraint failed');
    const invalidUnique = spawnSync('sqlite3', [':memory:'], {input: `${sql} INSERT INTO tenants VALUES(1,'A','same'); INSERT INTO tenants VALUES(2,'B','same');`, encoding:'utf8'});
    expect(invalidUnique.status).not.toBe(0); expect(invalidUnique.stderr).toContain('UNIQUE constraint failed');
  });
});

describe('project documents and validation', () => {
  it('loads a valid model document and rejects runtime shape mismatches', () => {
    const model = importSql(ddl, 'sqlite').model;
    expect(parseModel(JSON.stringify(model))).toEqual(model);
    expect(() => parseModel(JSON.stringify({...model, version: 2}))).toThrow();
    expect(() => parseModel(JSON.stringify({...model, tables: [{...model.tables[0], columns: null}]}))).toThrow();
    model.tables[0]!.columns[0]!.nullable = true;
    expect(() => parseModel(JSON.stringify(model))).toThrow('기본키');
  });
  it('rejects broken relationship/index/subject references and duplicate IDs', () => {
    const model = importSql(ddl, 'sqlite').model;
    model.relationships[0]!.parentColumnIds = ['missing'];
    model.tables[0]!.subjectId = 'missing';
    model.tables[0]!.indexes[0]!.columnIds = ['missing'];
    model.tables[0]!.columns[1]!.id = model.tables[0]!.columns[0]!.id;
    const codes = validateModel(model).map(i => i.code);
    expect(codes).toContain('MISSING_SUBJECT'); expect(codes).toContain('DUPLICATE_ID'); expect(codes).toContain('MISSING_INDEX_COLUMN');
    expect(() => parseModel(JSON.stringify(model))).toThrow();
  });
  it('reports missing PK as a warning and invalid SET NULL as an error', () => {
    const model = createModel(), table = createTable('t'); table.columns = [createColumn('value')]; model.tables.push(table);
    expect(validateModel(model).some(i => i.code === 'NO_PRIMARY_KEY' && i.severity === 'warning')).toBe(true);
    const fkModel = importSql(ddl, 'sqlite').model;
    fkModel.relationships[0]!.onDelete = 'SET NULL';
    expect(validateModel(fkModel).some(i => i.code === 'SET_NULL_NOT_NULL' && i.severity === 'error')).toBe(true);
  });
});

describe('model comparison', () => {
  it('detects renames, destructive removals, type changes and indexes while ignoring positions', () => {
    const before = importSql(ddl, 'sqlite').model, after = structuredClone(before);
    after.tables[0]!.x = 999;
    expect(diffModels(before, after)).toEqual([]);
    after.tables[0]!.name = 'renamed'; after.tables[0]!.columns[0]!.type = 'BIGINT';
    after.tables[0]!.columns.pop(); after.tables[0]!.indexes = [];
    const result = diffModels(before, after).join('\n');
    expect(result).toContain('테이블 이름 변경'); expect(result).toContain('자료형 변경');
    expect(result).toContain('데이터 손실'); expect(result).toContain('인덱스 변경');
  });
});
