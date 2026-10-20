export type Dialect = 'postgresql' | 'mysql' | 'sqlite';
export interface Column {
  id: string; name: string; logicalName: string; type: string;
  nullable: boolean; primaryKey: boolean; unique: boolean;
  defaultValue: string; comment: string;
}
export interface Table {
  id: string; name: string; logicalName: string; schema: string; comment: string;
  color: string; x: number; y: number; columns: Column[]; subjectId: string;
  indexes: { id: string; name: string; columnIds: string[]; unique: boolean }[];
}
export interface Relationship {
  id: string; name: string; parentTableId: string; childTableId: string;
  parentColumnIds: string[]; childColumnIds: string[];
  identifying: boolean; cardinality: '1:1' | '1:N';
  onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL' | 'RESTRICT';
}
export interface Subject { id: string; name: string; color: string }
export interface Term { id: string; logicalName: string; physicalName: string; type: string; description: string }
export interface Model {
  format: 'erd-maker'; version: 1; id: string; name: string; dialect: Dialect;
  tables: Table[]; relationships: Relationship[]; subjects: Subject[]; terms: Term[];
}
export interface Issue { severity: 'error' | 'warning'; code: string; message: string; tableId?: string; columnId?: string }
export const newId = () => crypto.randomUUID();
export function createColumn(name = 'id'): Column {
  return { id: newId(), name, logicalName: '', type: name === 'id' ? 'BIGINT' : 'VARCHAR(255)', nullable: name !== 'id', primaryKey: name === 'id', unique: false, defaultValue: '', comment: '' };
}
export function createTable(name = 'new_table', x = 100, y = 100): Table {
  return { id: newId(), name, logicalName: '', schema: '', comment: '', color: '#0f9f8f', x, y, columns: [createColumn()], indexes: [], subjectId: '' };
}
export function createModel(name = '새 데이터 모델'): Model {
  return { format: 'erd-maker', version: 1, id: newId(), name, dialect: 'postgresql', tables: [], relationships: [], subjects: [], terms: [] };
}
