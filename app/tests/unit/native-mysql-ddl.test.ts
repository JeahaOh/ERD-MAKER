import { describe, it, expect } from 'vitest';
import { generateNativeMysqlDdl } from '../../src/formats/sql/native-mysql-ddl';
import { createNativeDocument, nativeGraph } from '../../src/formats/exerd/create';
import { mysqlFixture, fixtureField as field, fixtureUuid as uuid } from '../helpers/native-mysql-fixture';
import type { BinaryObject, BinaryReference } from '../../src/formats/exerd/binary';
const physical = (doc: ReturnType<typeof mysqlFixture>, o: BinaryObject) => doc.graph.objects[(field(o, 'physicalProperties') as BinaryReference).ref];
const table = (doc: ReturnType<typeof mysqlFixture>, name: string) => doc.graph.objects.find(o => o.class.name === 'Table' && field(o, 'physicalName') === name)!;

describe.each(['mysql', 'mariadb'] as const)('native %s DDL', dialect => {
  it('renders identical SQL when the original writer omits default ASC membership values', () => {
    const doc = mysqlFixture(dialect), before = generateNativeMysqlDdl(doc, { dialect }).sql;
    for (const member of doc.graph.objects.filter(o => ['PrimaryKeyMembership','AlternateKeyMembership','InversionEntry','ColumnReference'].includes(o.class.name))) {
      if (field(member, 'sortType') === 'ASC') member.features = member.features.filter(f => f.name !== 'sortType');
    }
    expect(generateNativeMysqlDdl(doc, { dialect }).sql).toBe(before);
  });
  it('preserves native types, defaults, nullability, comments, key order, actions and physical options immutably', () => {
    const doc = mysqlFixture(dialect), before = structuredClone(doc.graph), r = generateNativeMysqlDdl(doc, { dialect });
    expect(r.complete).toBe(true); expect(r.unsupported).toEqual([]); expect(r.diagnostics).toEqual([]); expect(r.executionVerified).toBe(false);
    expect(r.sql).toContain('`amount` DECIMAL(12,3) NOT NULL DEFAULT 12.345');
    expect(r.sql).toContain("`status` ENUM('NEW','PAID') NOT NULL DEFAULT 'NEW'");
    expect(r.sql).toContain('`created_at` TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
    expect(r.sql).toContain('`binary_code` VARBINARY(8) NULL DEFAULT 0x4142');
    expect(r.sql).toContain('PRIMARY KEY (`id` ASC, `code` ASC)');
    expect(r.sql).toContain('UNIQUE KEY `uq_parent_code` (`code` ASC)');
    expect(r.sql).toContain('KEY `ix_child_code` USING BTREE (`parent_code` DESC, `parent_id` ASC)');
    expect(r.sql).toContain('FOREIGN KEY (`parent_id`, `parent_code`)');
    expect(r.sql).toContain('ON DELETE SET NULL ON UPDATE CASCADE');
    expect(r.sql).toContain('CHECK (`amount` >= 0 AND `code` <> \'\')');
    expect(r.sql).toContain('AUTO_INCREMENT=100'); expect(r.sql).toContain('DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_bin');
    expect(r.sql).toContain("COMMENT='부모 O''Reilly \\\\ folder\\n둘째 줄'");
    expect(r.statistics).toMatchObject({ tables: 2, columns: 11, primaryKeys: 2, uniqueConstraints: 1, indexes: 1, foreignKeys: 1, checks: 1 });
    expect(doc.graph).toEqual(before);
  });
  it('preserves physical PK order, stable indexed UK order and composite FK pair correspondence', () => {
    const doc = mysqlFixture(dialect), parent = table(doc, 'new_table');
    const pk = doc.graph.objects.find(o => o.class.name === 'PrimaryKeyColumnGroup' && (field(parent, 'columnGroups') as BinaryReference[]).some(r => r.ref === o.id))!;
    doc.graph.objects.filter(o => o.class.name === 'PrimaryKeyMembership' && (field(o, 'group') as BinaryReference)?.ref === pk.id).forEach((m, i) => nativeGraph.set(m, 'entryIndex', 1 - i));
    const fk = doc.graph.objects.filter(o => o.class.name === 'ColumnReference'); fk.forEach((m, i) => nativeGraph.set(m, 'entryIndex', 1 - i));
    const r = generateNativeMysqlDdl(doc, { dialect });
    expect(r.complete).toBe(true); expect(r.sql).toContain('PRIMARY KEY (`id` ASC, `code` ASC)');
    expect(r.sql).toMatch(/FOREIGN KEY \(`parent_id`, `parent_code`\) REFERENCES .*\(`id`, `code`\)/);
  });
  it('reports foreign products, selections and unknown stored options rather than omitting them silently', () => {
    expect(generateNativeMysqlDdl(createNativeDocument(), { dialect }).sql).toBe('');
    const doc = mysqlFixture(dialect); const p = physical(doc, table(doc, 'child'));
    p.features.push({ id: 999, name: 'futureStorageOption', kind: 'STRING', value: 'KEEP_ME' });
    const r = generateNativeMysqlDdl(doc, { dialect }); expect(r.complete).toBe(false); expect(r.unsupported).toContainEqual(expect.objectContaining({ feature: 'futureStorageOption' }));
    const selected = generateNativeMysqlDdl(mysqlFixture(dialect), { dialect, tableUuids: [uuid(table(doc, 'child'))] });
    // Fixture UUIDs differ, so the selection must fail instead of exporting another table.
    expect(selected.diagnostics.map(d => d.code)).toContain('UNKNOWN_TABLE_SELECTION');
    expect(generateNativeMysqlDdl(doc, { dialect, tableUuids: [] }).sql).toBe('');
    const external = generateNativeMysqlDdl(doc, { dialect, tableUuids: [uuid(table(doc, 'child'))] });
    expect(external.unsupported.map(u => u.code)).toContain('FOREIGN_KEY_EXTERNAL_SELECTION_DEPENDENCY');
  });
  it('rejects statement injection, unterminated literals and unsafe defaults without type conversion', () => {
    for (const value of ['0; DROP TABLE child', "'open", '(1), evil INTEGER']) {
      const doc = mysqlFixture(dialect), column = doc.graph.objects.find(o => o.class.name === 'Column' && field(o, 'physicalName') === 'ratio')!;
      nativeGraph.set(column, 'defaultValue', value); const r = generateNativeMysqlDdl(doc, { dialect });
      expect(r.complete).toBe(false); expect(r.diagnostics.some(d => d.severity === 'error')).toBe(true); expect(r.sql).not.toContain('DROP TABLE');
    }
    const doc = mysqlFixture(dialect), column = doc.graph.objects.find(o => o.class.name === 'Column' && field(o, 'physicalName') === 'ratio')!;
    nativeGraph.set(column, 'dataType', 'BYTEA'); const r = generateNativeMysqlDdl(doc, { dialect }); expect(r.unsupported.map(u => u.code)).toContain('COLUMN_TYPE_NOT_IMPLEMENTED');
  });
  it('inherits domain defaults but honors explicit empty overrides and reports invalid AUTO_INCREMENT/FK settings', () => {
    const doc = mysqlFixture(dialect), column = doc.graph.objects.find(o => o.class.name === 'Column' && field(o, 'physicalName') === 'ratio')!;
    const domain = nativeGraph.object(doc.graph, 'Domain', { name: 'money', suggestedDataType: 'DECIMAL(8,2)', suggestedDefaultValue: '9.25', suggestedNotNull: 'TRUE' });
    nativeGraph.set(column, 'domain', { ref: domain.id }); column.features = column.features.filter(f => f.name !== 'defaultValue');
    expect(generateNativeMysqlDdl(doc, { dialect }).sql).toContain('DEFAULT 9.25'); nativeGraph.set(column, 'defaultValue', '');
    expect(generateNativeMysqlDdl(doc, { dialect }).sql).not.toContain('DEFAULT 9.25');
    nativeGraph.set(physical(doc, column), 'autoIncrement', true);
    const r = generateNativeMysqlDdl(doc, { dialect }); expect(r.diagnostics.map(d => d.code)).toContain('AUTO_INCREMENT_REQUIRES_INTEGER'); expect(r.diagnostics.map(d => d.code)).toContain('AUTO_INCREMENT_REQUIRES_LEADING_INDEX');
  });
});
it('does not emit MySQL MATCH or SET DEFAULT as though the engine enforced them', () => {
  const doc = mysqlFixture('mysql'), fk = doc.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!, p = physical(doc, fk);
  nativeGraph.set(p, 'match', 'MATCH FULL'); nativeGraph.set(p, 'onDeleteRule', 'SET DEFAULT');
  const r = generateNativeMysqlDdl(doc, { dialect: 'mysql' });
  expect(r.complete).toBe(false); expect(r.unsupported.map(u => u.code)).toContain('FOREIGN_KEY_MATCH_NOT_ENFORCED'); expect(r.unsupported.map(u => u.code)).toContain('REFERENTIAL_ACTION_NOT_SUPPORTED'); expect(r.sql).not.toContain('MATCH FULL'); expect(r.sql).not.toContain('SET DEFAULT');
});
it('reports engine-dependent options, unsupported persisted structures, and auto-increment CHECK references', () => {
  const doc = mysqlFixture('mysql'), p = physical(doc, table(doc, 'new_table'));
  nativeGraph.set(p, 'checksum', '1');
  const check = doc.graph.objects.find(o => o.class.name === 'CheckConstraint')!;
  nativeGraph.set(check, 'expression', '`id` > 0');
  const r = generateNativeMysqlDdl(doc, { dialect: 'mysql' });
  expect(r.unsupported).toContainEqual(expect.objectContaining({ code: 'ENGINE_SPECIFIC_OPTION_UNVERIFIED', feature: 'checksum' }));
  expect(r.diagnostics.map(d => d.code)).toContain('CHECK_REFERENCES_AUTO_INCREMENT');
});
it('does not import MySQL-only engine properties into MariaDB, or erase mismatching constraint names', () => {
  const doc = mysqlFixture('mariadb'), p = physical(doc, table(doc, 'child'));
  p.features.push({ id: 999, name: 'engine', kind: 'STRING', value: 'MyISAM' });
  const uk = doc.graph.objects.find(o => o.class.name === 'UniqueConstraint')!;
  nativeGraph.set(uk, 'physicalName', 'different_constraint');
  const r = generateNativeMysqlDdl(doc, { dialect: 'mariadb' });
  expect(r.sql).not.toContain('ENGINE=MyISAM');
  expect(r.unsupported).toContainEqual(expect.objectContaining({ feature: 'engine' }));
  expect(r.unsupported.map(u => u.code)).toContain('UNIQUE_INDEX_CONSTRAINT_NAME_CONFLICT');
});
it('uses required MySQL expression-default parentheses for JSON/TEXT and validates spatial index columns', () => {
  const doc = mysqlFixture('mysql'), label = doc.graph.objects.find(o => o.class.name === 'Column' && field(o, 'physicalName') === 'label')!;
  nativeGraph.set(label, 'dataType', 'JSON'); nativeGraph.set(label, 'defaultValue', "'{\"ok\":true}'");
  const r = generateNativeMysqlDdl(doc, { dialect: 'mysql' }); expect(r.complete).toBe(true); expect(r.sql).toContain("`label` JSON NULL DEFAULT ('{\"ok\":true}')");
  const index = doc.graph.objects.find(o => o.class.name === 'InversionEntryColumnGroup')!;
  nativeGraph.set(physical(doc, index), 'indexType', 'SPATIAL');
  const bad = generateNativeMysqlDdl(doc, { dialect: 'mysql' }); expect(bad.diagnostics.map(d => d.code)).toContain('SPATIAL_REQUIRES_GEOMETRY'); expect(bad.diagnostics.map(d => d.code)).toContain('SPATIAL_REQUIRES_NOT_NULL');
});
