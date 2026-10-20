import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, KeyRound, Plus, Trash2, Table2, Link2, X } from 'lucide-react';
import { createColumn, newId, type Table, type Model, type Column, type Relationship } from '../../core/model';
import { Empty, Field } from './ui';
const types = ['BIGINT', 'INTEGER', 'SMALLINT', 'VARCHAR(100)', 'VARCHAR(255)', 'TEXT', 'BOOLEAN', 'DECIMAL(12,2)', 'TIMESTAMP', 'DATE', 'UUID', 'JSONB', 'BLOB'];
export default function Inspector({ model, table, relationship, updateTable, updateRelationship, removeTable, removeRelationship, duplicate, close }: {
  model: Model; table?: Table; relationship?: Relationship; updateTable: (t: Table) => void; updateRelationship: (r: Relationship) => void;
  removeTable: () => void; removeRelationship: () => void; duplicate: () => void; close: () => void;
}) {
  const [tab, setTab] = useState('columns'); const [columnId, setColumnId] = useState('');
  const column = table?.columns.find(c => c.id === columnId);
  const updateColumn = (id: string, patch: Partial<Column>) => table && updateTable({ ...table, columns: table.columns.map(c => c.id === id ? { ...c, ...patch } : c) });
  if (relationship) {
    const p = model.tables.find(t => t.id === relationship.parentTableId), c = model.tables.find(t => t.id === relationship.childTableId);
    return <aside className="inspector"><div className="panel-heading"><span><Link2 size={16} />관계 속성</span><button className="icon-button" onClick={close} aria-label="속성 닫기"><X size={16} /></button></div><div className="inspector-content">
      <Field label="제약조건 이름" value={relationship.name} onChange={name => updateRelationship({ ...relationship, name })} />
      <div className="relation-summary"><strong>{p?.name}</strong><span>1 → {relationship.cardinality === '1:1' ? '1' : 'N'}</span><strong>{c?.name}</strong></div>
      {relationship.parentColumnIds.map((id, i) => <p className="mapping-row" key={id}>{p?.columns.find(col => col.id === id)?.name} <span>→</span> {c?.columns.find(col => col.id === relationship.childColumnIds[i])?.name}</p>)}
      <label className="field"><span>카디널리티</span><select value={relationship.cardinality} onChange={e => updateRelationship({ ...relationship, cardinality: e.target.value as Relationship['cardinality'] })}><option>1:N</option><option>1:1</option></select></label>
      <label className="check-line"><input type="checkbox" checked={relationship.identifying} onChange={e => updateRelationship({ ...relationship, identifying: e.target.checked })} />식별 관계</label>
      <p className="help-text">식별 관계는 자식 외래키가 기본키에 포함되는 관계입니다. 모델 검사에서 키 구성을 확인합니다.</p>
      <label className="field"><span>부모 삭제 시</span><select value={relationship.onDelete} onChange={e => updateRelationship({ ...relationship, onDelete: e.target.value as Relationship['onDelete'] })}>{['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'].map(v => <option key={v}>{v}</option>)}</select></label>
      <button className="danger-button" onClick={removeRelationship}><Trash2 size={14} />관계 삭제</button>
    </div></aside>;
  }
  if (!table) return <aside className="inspector"><div className="panel-heading"><span><Table2 size={16} />속성</span></div><Empty><Table2 size={32} /><strong>모델을 살펴보세요</strong><p>테이블이나 관계선을 선택하면<br />여기에서 속성을 편집할 수 있습니다.</p><div className="shortcut-list"><span>저장</span><kbd>⌘ / Ctrl S</kbd><span>실행 취소</span><kbd>⌘ / Ctrl Z</kbd><span>관계 생성</span><span>컬럼의 점 연결</span></div></Empty><div className="local-info"><span className="status-dot" />로컬 작업 공간<p>모델은 이 기기의 브라우저에 자동 저장됩니다. 파일 저장으로 별도 백업할 수 있습니다.</p></div></aside>;
  return <aside className="inspector"><div className="panel-heading"><span><Table2 size={16} />테이블 속성</span><div><button className="icon-button" title="테이블 복제" aria-label="테이블 복제" onClick={duplicate}><Copy size={14} /></button><button className="icon-button" aria-label="속성 닫기" onClick={close}><X size={16} /></button></div></div>
    <div className="inspector-title"><span style={{ background: table.color }} /><div><h3>{table.logicalName || table.name}</h3><code>{table.name}</code></div></div>
    <div className="tabs">{[['columns', '컬럼', table.columns.length], ['table', '일반', ''], ['indexes', '인덱스', table.indexes.length]].map(([id, label, count]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(String(id))}>{label}{count !== '' && <small>{count}</small>}</button>)}</div>
    <div className="inspector-content">
      {tab === 'table' && <>
        <Field label="물리명" value={table.name} onChange={name => updateTable({ ...table, name })} />
        <Field label="논리명" value={table.logicalName} onChange={logicalName => updateTable({ ...table, logicalName })} />
        <Field label="스키마" placeholder="기본 스키마" value={table.schema} onChange={schema => updateTable({ ...table, schema })} />
        <label className="field"><span>주제 영역</span><select value={table.subjectId} onChange={e => updateTable({ ...table, subjectId: e.target.value })}><option value="">미분류</option>{model.subjects.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
        <label className="field"><span>표시 색상</span><div className="color-options">{['#0f9f8f', '#6574d9', '#c18a32', '#cc7185', '#5388bf', '#77848c'].map(color => <button aria-label={`색상 ${color}`} key={color} className={table.color === color ? 'chosen' : ''} style={{ background: color }} onClick={() => updateTable({ ...table, color })} />)}</div></label>
        <Field label="설명" multiline value={table.comment} onChange={comment => updateTable({ ...table, comment })} />
        <button className="danger-button" onClick={removeTable}><Trash2 size={14} />테이블 삭제</button>
      </>}
      {tab === 'columns' && <>
        <div className="section-label"><span>{table.columns.length}개의 컬럼</span><button className="text-button" onClick={() => { const c = createColumn(`column_${table.columns.length + 1}`); updateTable({ ...table, columns: [...table.columns, c] }); setColumnId(c.id); }}><Plus size={14} />컬럼 추가</button></div>
        <div className="column-list">{table.columns.map((c, i) => <div className={'inspector-column ' + (columnId === c.id ? 'active' : '')} key={c.id}><button className="column-select" onClick={() => setColumnId(columnId === c.id ? '' : c.id)}><span className={c.primaryKey ? 'teal' : 'muted'}>{c.primaryKey ? <KeyRound size={13} /> : <span className="column-number">{i + 1}</span>}</span><div><strong>{c.name || '(이름 없음)'}</strong><small>{c.logicalName || c.type}</small></div><code>{c.type}</code></button></div>)}</div>
        {column ? <div className="column-editor" key={column.id}><div className="section-label"><strong>컬럼 편집</strong><div>{[-1, 1].map(direction => <button key={direction} className="icon-button" aria-label={direction < 0 ? '컬럼 위로' : '컬럼 아래로'} onClick={() => { const cols = [...table.columns]; const i = cols.findIndex(c => c.id === column.id); if (i + direction < 0 || i + direction >= cols.length) return; [cols[i], cols[i + direction]] = [cols[i + direction], cols[i]]; updateTable({ ...table, columns: cols }); }}>{direction < 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>)}</div></div>
          <Field label="컬럼 물리명" value={column.name} onChange={name => updateColumn(column.id, { name })} />
          <Field label="컬럼 논리명" value={column.logicalName} onChange={logicalName => updateColumn(column.id, { logicalName })} />
          <datalist id="data-types">{types.map(t => <option value={t} key={t} />)}</datalist><Field label="데이터 타입" list="data-types" value={column.type} onChange={type => updateColumn(column.id, { type })} />
          <div className="column-flags"><label><input type="checkbox" checked={column.primaryKey} onChange={e => updateColumn(column.id, { primaryKey: e.target.checked, nullable: e.target.checked ? false : column.nullable })} />PK</label><label><input type="checkbox" checked={!column.nullable} disabled={column.primaryKey} onChange={e => updateColumn(column.id, { nullable: !e.target.checked })} />NOT NULL</label><label><input type="checkbox" checked={column.unique} onChange={e => updateColumn(column.id, { unique: e.target.checked })} />UNIQUE</label></div>
          <Field label="기본값 (SQL 표현식)" placeholder="예: CURRENT_TIMESTAMP, 'active'" value={column.defaultValue} onChange={defaultValue => updateColumn(column.id, { defaultValue })} />
          <Field label="컬럼 설명" multiline value={column.comment} onChange={comment => updateColumn(column.id, { comment })} />
          <label className="field"><span>표준 용어 적용</span><select value="" onChange={e => { const term = model.terms.find(t => t.id === e.target.value); if (term) updateColumn(column.id, { name: term.physicalName, logicalName: term.logicalName, type: term.type, comment: term.description }); }}><option value="">용어 선택</option>{model.terms.map(t => <option value={t.id} key={t.id}>{t.logicalName} · {t.physicalName}</option>)}</select></label>
          <button className="danger-button" onClick={() => { if (model.relationships.some(r => r.parentColumnIds.includes(column.id) || r.childColumnIds.includes(column.id)) || table.indexes.some(i => i.columnIds.includes(column.id))) { alert('관계 또는 인덱스에 사용 중인 컬럼입니다. 먼저 해당 관계·인덱스를 수정하거나 삭제하세요.'); return; } updateTable({ ...table, columns: table.columns.filter(c => c.id !== column.id) }); setColumnId(''); }}><Trash2 size={13} />컬럼 삭제</button>
        </div> : <p className="help-text">컬럼을 선택해 이름·타입·키·기본값을 편집하세요.</p>}
      </>}
      {tab === 'indexes' && <><button className="secondary-button full-width" onClick={() => updateTable({ ...table, indexes: [...table.indexes, { id: newId(), name: `idx_${table.name}_${table.indexes.length + 1}`, columnIds: [], unique: false }] })}><Plus size={14} />인덱스 추가</button>{table.indexes.map(index => <div className="index-editor" key={index.id}><Field label="인덱스 이름" value={index.name} onChange={name => updateTable({ ...table, indexes: table.indexes.map(i => i.id === index.id ? { ...i, name } : i) })} /><label className="check-line"><input type="checkbox" checked={index.unique} onChange={e => updateTable({ ...table, indexes: table.indexes.map(i => i.id === index.id ? { ...i, unique: e.target.checked } : i) })} />고유 인덱스</label><p className="help-text">선택한 순서대로 복합 인덱스에 포함됩니다.</p>{table.columns.map(c => <label className="check-line" key={c.id}><input type="checkbox" checked={index.columnIds.includes(c.id)} onChange={e => updateTable({ ...table, indexes: table.indexes.map(i => i.id === index.id ? { ...i, columnIds: e.target.checked ? [...i.columnIds, c.id] : i.columnIds.filter(id => id !== c.id) } : i) })} /><span>{index.columnIds.includes(c.id) ? `${index.columnIds.indexOf(c.id) + 1}. ` : ''}{c.name}</span></label>)}<button className="danger-button" onClick={() => updateTable({ ...table, indexes: table.indexes.filter(i => i.id !== index.id) })}><Trash2 size={13} />인덱스 삭제</button></div>)}</>}
    </div>
  </aside>;
}
