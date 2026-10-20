import type { Model, Table } from './model';

const tableName = (t: Table) => t.schema ? `${t.schema}.${t.name}` : t.name;
/** A reviewable change list, never executable migration SQL. Stable IDs detect renames. */
export function diffModels(before: Model, after: Model): string[] {
  const result: string[] = [];
  if (before.dialect !== after.dialect) result.push(`DB 변경: ${before.dialect} → ${after.dialect}`);
  const oldTables = new Map(before.tables.map(t => [t.id, t]));
  const structuralTables = new Map(before.tables.map(t => [tableName(t), t]));
  const matched = new Set<string>();
  for (const next of after.tables) {
    const prev = oldTables.get(next.id) ?? structuralTables.get(tableName(next));
    if (!prev || matched.has(prev.id)) { result.push(`테이블 추가: ${tableName(next)}`); continue; }
    matched.add(prev.id);
    if (tableName(prev) !== tableName(next)) result.push(`테이블 이름 변경: ${tableName(prev)} → ${tableName(next)}`);
    if (prev.comment !== next.comment) result.push(`테이블 설명 변경: ${tableName(next)}`);
    if (prev.logicalName !== next.logicalName) result.push(`테이블 논리명 변경: ${tableName(next)}`);
    const matchedCols = new Set<string>();
    for (const nc of next.columns) {
      const pc = prev.columns.find(c => c.id === nc.id) ?? prev.columns.find(c => c.name === nc.name);
      if (!pc || matchedCols.has(pc.id)) { result.push(`컬럼 추가: ${tableName(next)}.${nc.name}`); continue; }
      matchedCols.add(pc.id);
      if (pc.name !== nc.name) result.push(`컬럼 이름 변경: ${tableName(next)}.${pc.name} → ${nc.name}`);
      for (const [key, label] of [['type','자료형'], ['nullable','NULL 허용'], ['primaryKey','기본키'], ['unique','UNIQUE'], ['defaultValue','기본값'], ['comment','설명'], ['logicalName','논리명']] as const) {
        if (pc[key] !== nc[key]) result.push(`컬럼 ${label} 변경: ${tableName(next)}.${nc.name} (${String(pc[key])} → ${String(nc[key])})`);
      }
    }
    for (const pc of prev.columns) if (!matchedCols.has(pc.id)) result.push(`컬럼 삭제: ${tableName(prev)}.${pc.name} [데이터 손실 검토 필요]`);
    const signature = (t: Table) => t.indexes.map(i => ({ name: i.name, unique: i.unique, columns: i.columnIds.map(id => t.columns.find(c => c.id === id)?.name ?? id) })).sort((a,b) => a.name.localeCompare(b.name));
    if (JSON.stringify(signature(prev)) !== JSON.stringify(signature(next))) result.push(`인덱스 변경: ${tableName(next)}`);
  }
  for (const prev of before.tables) if (!matched.has(prev.id)) result.push(`테이블 삭제: ${tableName(prev)} [데이터 손실 검토 필요]`);
  const relationships = (model: Model) => model.relationships.map(r => {
    const parent = model.tables.find(t => t.id === r.parentTableId), child = model.tables.find(t => t.id === r.childTableId);
    return { name: r.name, parent: parent ? tableName(parent) : r.parentTableId, child: child ? tableName(child) : r.childTableId,
      parentColumns: r.parentColumnIds.map(id => parent?.columns.find(c => c.id === id)?.name ?? id), childColumns: r.childColumnIds.map(id => child?.columns.find(c => c.id === id)?.name ?? id), onDelete: r.onDelete, identifying: r.identifying, cardinality: r.cardinality };
  }).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (JSON.stringify(relationships(before)) !== JSON.stringify(relationships(after))) result.push('관계 변경: 외래키·참조 컬럼·삭제 규칙을 검토하세요.');
  // Positions, colors, and selection do not change database structure.
  return result;
}
