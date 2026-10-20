import { createNativeDocument, appendNativeTable, rebuildNativeDocument, nativeGraph } from '../../src/formats/exerd/create';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import type { BinaryObject, BinaryReference } from '../../src/formats/exerd/binary';
import type { NativeExerdDocument } from '../../src/formats/exerd/native-document';
export const fixtureField = (o: BinaryObject, key: string) => o.features.find(f => f.name === key)?.value;
export const fixtureUuid = (o: BinaryObject) => fixtureField(o, 'UUID') as string;
export function mysqlFixture(dialect: 'mysql' | 'mariadb'): NativeExerdDocument {
  let d = createNativeDocument('Native DDL test', { database: { productId: dialect === 'mysql' ? 'com.tomato.db.mysql' : 'com.tomato.db.mariadb' } });
  const named = (type: string, name: string) => d.graph.objects.find(o => o.class.name === type && fixtureField(o, 'physicalName') === name)!;
  const table = (name: string) => named('Table', name);
  const columns = (t: BinaryObject) => (fixtureField(t, 'columns') as BinaryReference[]).map(r => d.graph.objects[r.ref]);
  const run = (command: Parameters<typeof mutateNativeDocument>[1]) => { d = mutateNativeDocument(d, command); };
  const schema = d.graph.objects.find(o => o.class.name === 'Schema')!;
  run({ type: 'renameSchema', schemaUuid: fixtureUuid(schema), name: dialect === 'mysql' ? 'mysql_verify' : 'maria_verify' });
  for (const [name, dataType, defaultValue, nullable] of [['code', 'VARCHAR(12)', "'A'", false], ['amount', 'DECIMAL(12,3)', '12.345', false]] as const) run({ type: 'addColumn', tableUuid: fixtureUuid(table('new_table')), name, dataType, defaultValue, nullable });
  run({ type: 'setPrimaryKey', tableUuid: fixtureUuid(table('new_table')), columnUuids: columns(table('new_table')).slice(0, 2).map(fixtureUuid) });
  run({ type: 'addColumnGroup', tableUuid: fixtureUuid(table('new_table')), kind: 'unique', name: 'uq_parent_code', columnUuids: [fixtureUuid(columns(table('new_table'))[1])] });
  run({ type: 'addCheckConstraint', tableUuid: fixtureUuid(table('new_table')), name: 'ck_positive_amount', expression: "`amount` >= 0 AND `code` <> ''" });
  d = appendNativeTable(d, { name: 'child' });
  for (const [name, dataType, defaultValue, nullable] of [['parent_id', 'INTEGER', undefined, true], ['parent_code', 'VARCHAR(12)', undefined, true], ['ratio', 'DECIMAL(8,2)', '0.25', false], ['status', "ENUM('NEW','PAID')", "'NEW'", false], ['created_at', 'TIMESTAMP(6)', 'CURRENT_TIMESTAMP(6)', false], ['binary_code', 'VARBINARY(8)', '0x4142', true], ['label', 'VARCHAR(80)', "'O''Reilly \\\\ path'", true]] as const) run({ type: 'addColumn', tableUuid: fixtureUuid(table('child')), name, dataType, defaultValue, nullable });
  run({ type: 'addRelationship', name: 'fk_child_parent', parentTableUuid: fixtureUuid(table('new_table')), childTableUuid: fixtureUuid(table('child')), parentColumnUuids: columns(table('new_table')).slice(0, 2).map(fixtureUuid), childColumnUuids: columns(table('child')).slice(1, 3).map(fixtureUuid) });
  run({ type: 'addColumnGroup', tableUuid: fixtureUuid(table('child')), kind: 'index', name: 'ix_child_code', columnUuids: [fixtureUuid(columns(table('child'))[2]), fixtureUuid(columns(table('child'))[1])], sortTypes: ['DESC', 'ASC'] });
  const physical = (o: BinaryObject) => d.graph.objects[(fixtureField(o, 'physicalProperties') as BinaryReference).ref];
  const set = nativeGraph.set;
  const currentSchema = d.graph.objects.find(o => o.class.name === 'Schema')!;
  set(physical(currentSchema), 'characterSet', 'utf8mb4'); set(physical(currentSchema), 'collation', 'utf8mb4_bin');
  for (const t of [table('new_table'), table('child')]) { const p = physical(t); set(p, 'characterSet', 'utf8mb4'); set(p, 'collation', 'utf8mb4_bin'); if (dialect === 'mysql') { set(p, 'engine', 'InnoDB'); set(p, 'rowFormat', 'DYNAMIC'); } }
  set(physical(table('new_table')), dialect === 'mysql' ? 'autoIncrement' : 'startValue', '100');
  set(physical(columns(table('new_table'))[0]), 'autoIncrement', true);
  set(table('new_table'), 'comment', "부모 O'Reilly \\ folder\n둘째 줄");
  set(columns(table('new_table'))[1], 'comment', '업무 코드');
  const fk = d.graph.objects.find(o => o.class.name === 'ForeignKeyConstraint')!;
  set(physical(fk), 'onDeleteRule', 'SET NULL'); set(physical(fk), 'onUpdateRule', 'CASCADE');
  const index = named('InversionEntryColumnGroup', 'ix_child_code'); set(physical(index), 'indexType', 'BTREE'); set(index, 'comment', '코드 역순');
  return rebuildNativeDocument(d.graph, d.container);
}
