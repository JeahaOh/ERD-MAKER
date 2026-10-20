import { useState } from 'react';
import { GitBranch, Layers, Plus, Trash2, ArrowUp, ArrowDown, Settings2 } from 'lucide-react';
import type { NativeCommand } from '../../formats/exerd/mutations';
import type { NativeColumnView, NativeDocumentView, NativeTableView } from '../../formats/exerd/view';
import { Modal } from './ui';

export type RunNativeCommand = (command: NativeCommand) => Promise<boolean>;
interface ToolsProps { view: NativeDocumentView; selectedTable?: NativeTableView; diagramUuid: string; busy: boolean; run: RunNativeCommand }
type Tool = 'column' | 'relationship' | 'domain' | 'diagram' | 'delete';

export function NativeTools({ view, selectedTable, diagramUuid, busy, run }: ToolsProps) {
  const [tool, setTool] = useState<Tool | ''>('');
  const [name, setName] = useState(''), [dataType, setDataType] = useState('BIGINT');
  const [parent, setParent] = useState(''), [child, setChild] = useState('');
  const [parentColumns, setParentColumns] = useState<string[]>([]), [childColumns, setChildColumns] = useState<string[]>([]);
  const [nullable, setNullable] = useState(true), [identifying, setIdentifying] = useState(false), [cascade, setCascade] = useState(false);
  const [cloneDiagram, setCloneDiagram] = useState(false), [inheritDomain, setInheritDomain] = useState('');
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [area, setArea] = useState('');
  const parentTable = view.allTables.find(t => t.uuid === parent), childTable = view.allTables.find(t => t.uuid === child);
  const open = (next: Tool) => {
    setTool(next); setCascade(false); setNullable(true); setIdentifying(false); setCloneDiagram(false); setInheritDomain('');
    setName(next === 'column' ? `column_${(selectedTable?.columns.length || 0) + 1}` : next === 'relationship' ? `fk_${view.allRelationships.length + 1}` : next === 'domain' ? `domain_${view.domains.length + 1}` : next === 'diagram' ? `다이어그램 ${view.diagrams.length + 1}` : '');
    const p = selectedTable || view.allTables[0], c = view.allTables.find(t => t.uuid !== p?.uuid) || p;
    setParent(p?.uuid || ''); setChild(c?.uuid || ''); setParentColumns(p?.columns.filter(c => c.primaryKey).map(c => c.uuid) || []); setChildColumns([]);
    setSelectedTables(view.tables.map(t => t.uuid));
    setArea(view.diagrams.find(d => d.uuid === diagramUuid)?.businessAreaUuid || view.businessAreas[0]?.uuid || '');
  };
  const titles = { column: '컬럼 추가', relationship: '관계 만들기', domain: '도메인 추가', diagram: '다이어그램 추가', delete: '테이블 삭제' };
  const toggle = (values: string[], uuid: string) => values.includes(uuid) ? values.filter(x => x !== uuid) : [...values, uuid];
  async function submit() {
    let command: NativeCommand;
    if (tool === 'column' && selectedTable) command = { type: 'addColumn', tableUuid: selectedTable.uuid, name, dataType, nullable };
    else if (tool === 'relationship') command = { type: 'addRelationship', name, parentTableUuid: parent, childTableUuid: child, parentColumnUuids: parentColumns, childColumnUuids: childColumns, identifying };
    else if (tool === 'domain') command = { type: 'addDomain', name, dataType, nullable, parentDomainUuid: inheritDomain || undefined };
    else if (tool === 'diagram') {
      const current = view.diagrams.find(d => d.uuid === diagramUuid) || view.diagrams[0];
      if (!current) return;
      command = cloneDiagram ? { type: 'duplicateDiagram', diagramUuid: current.uuid, name } : { type: 'addDiagram', businessAreaUuid: area, name, tableUuids: selectedTables };
    } else if (tool === 'delete' && selectedTable) command = { type: 'removeTable', tableUuid: selectedTable.uuid, cascade };
    else return;
    if (await run(command)) setTool('');
  }
  return <>
    <button className="tool" disabled={busy || !selectedTable} onClick={() => open('column')}><Plus size={14} />컬럼</button>
    <button className="tool" disabled={busy || !view.allTables.length} onClick={() => open('relationship')}><GitBranch size={14} />관계</button>
    <button className="tool" aria-label="도메인 추가" disabled={busy} onClick={() => open('domain')}><Settings2 size={14} />도메인</button>
    <button className="tool" disabled={busy || !view.diagrams.length} onClick={() => open('diagram')}><Layers size={14} />다이어그램</button>
    <button className="icon-button" aria-label="선택 테이블 삭제" disabled={busy || !selectedTable} onClick={() => open('delete')}><Trash2 size={14} /></button>
    {tool && <Modal title={titles[tool]} close={() => setTool('')} wide={tool === 'relationship'} subtitle={tool === 'relationship' ? '부모 키의 컬럼과 자식 컬럼을 같은 순서로 선택하세요.' : undefined}>
      <form onSubmit={e => { e.preventDefault(); void submit(); }}>
        <div className="modal-body structure-form">
          {tool !== 'delete' && <label className="field"><span>이름</span><input aria-label={`${titles[tool]} 이름`} value={name} onChange={e => setName(e.target.value)} autoFocus /></label>}
          {(tool === 'column' || tool === 'domain') && <><label className="field"><span>자료형</span><input aria-label={`${titles[tool]} 자료형`} value={dataType} onChange={e => setDataType(e.target.value)} required /></label><label className="check-field"><input type="checkbox" checked={nullable} onChange={e => setNullable(e.target.checked)} />NULL 허용</label></>}
          {tool === 'domain' && <label className="field"><span>상위 도메인</span><select aria-label="상위 도메인" value={inheritDomain} onChange={e => setInheritDomain(e.target.value)}><option value="">최상위</option>{view.domains.map(d => <option key={d.uuid} value={d.uuid}>{d.name}</option>)}</select></label>}
          {tool === 'relationship' && <><div className="relationship-columns">
            <div><label className="field"><span>부모 테이블</span><select aria-label="부모 테이블" value={parent} onChange={e => { setParent(e.target.value); setParentColumns(view.allTables.find(t => t.uuid === e.target.value)?.columns.filter(c => c.primaryKey).map(c => c.uuid) || []); }}>{view.allTables.map(t => <option key={t.uuid} value={t.uuid}>{t.schemaName}.{t.name}</option>)}</select></label><span className="help-text">선택 순서가 키 순서로 저장됩니다.</span>{parentTable?.columns.map(c => <label className="check-field" key={c.uuid}><input type="checkbox" checked={parentColumns.includes(c.uuid)} onChange={() => setParentColumns(toggle(parentColumns, c.uuid))} /><code>{c.name}</code><small>{c.type}{c.primaryKey ? ' · PK' : ''}{parentColumns.includes(c.uuid) ? ` · ${parentColumns.indexOf(c.uuid) + 1}` : ''}</small></label>)}</div>
            <div><label className="field"><span>자식 테이블</span><select aria-label="자식 테이블" value={child} onChange={e => { setChild(e.target.value); setChildColumns([]); }}>{view.allTables.map(t => <option key={t.uuid} value={t.uuid}>{t.schemaName}.{t.name}</option>)}</select></label><span className="help-text">부모 컬럼과 대응하는 컬럼을 선택하세요.</span>{childTable?.columns.map(c => <label className="check-field" key={c.uuid}><input type="checkbox" checked={childColumns.includes(c.uuid)} onChange={() => setChildColumns(toggle(childColumns, c.uuid))} /><code>{c.name}</code><small>{c.type}{childColumns.includes(c.uuid) ? ` · ${childColumns.indexOf(c.uuid) + 1}` : ''}</small></label>)}</div>
          </div><label className="check-field"><input type="checkbox" checked={identifying} onChange={e => setIdentifying(e.target.checked)} />식별 관계 (자식 기본키에 포함)</label></>}
          {tool === 'diagram' && <><label className="field"><span>업무영역</span><select aria-label="다이어그램 업무영역" disabled={cloneDiagram} value={area} onChange={e => setArea(e.target.value)}>{view.businessAreas.map(a => <option key={a.uuid} value={a.uuid}>{a.name}</option>)}</select></label><label className="check-field"><input type="checkbox" checked={cloneDiagram} onChange={e => setCloneDiagram(e.target.checked)} />현재 다이어그램의 배치·노트 복제</label>{!cloneDiagram && <div className="table-picker">{view.allTables.map(t => <label className="check-field" key={t.uuid}><input type="checkbox" checked={selectedTables.includes(t.uuid)} onChange={() => setSelectedTables(toggle(selectedTables, t.uuid))} />{t.logicalName || t.name}<small>{t.name}</small></label>)}</div>}</>}
          {tool === 'delete' && <><p><strong>{selectedTable?.name}</strong> 테이블과 그 컬럼을 삭제합니다.</p><label className="check-field"><input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} />이 테이블을 참조하는 관계와 종속 항목도 함께 삭제</label><p className="help-text">삭제 후 실행 취소로 복원할 수 있습니다.</p></>}
        </div>
        <footer className="modal-actions"><button type="button" className="secondary-button" onClick={() => setTool('')}>취소</button><button className={tool === 'delete' ? 'danger-button' : 'primary-button'} disabled={busy || tool !== 'delete' && !name.trim() || tool === 'relationship' && (!parentColumns.length || parentColumns.length !== childColumns.length)} type="submit">{tool === 'delete' ? '테이블 삭제' : '적용'}</button></footer>
      </form>
    </Modal>}
  </>;
}

export function ColumnStructureEditor({ table, column, view, busy, run, edit }: { table: NativeTableView; column: NativeColumnView; view: NativeDocumentView; busy: boolean; run: RunNativeCommand; edit: (uuid: string, name: string, value: string | null) => void }) {
  const [removing, setRemoving] = useState(false), [cascade, setCascade] = useState(false);
  const index = table.columns.findIndex(c => c.uuid === column.uuid);
  const move = (delta: number) => { const ids = table.columns.map(c => c.uuid); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; void run({ type: 'reorderColumns', tableUuid: table.uuid, columnUuids: ids }); };
  return <div className="column-structure">
    <div className="check-row"><label className="check-field"><input aria-label="기본키" type="checkbox" checked={column.primaryKey} disabled={busy} onChange={e => void run({ type: 'setPrimaryKey', tableUuid: table.uuid, columnUuids: table.columns.filter(c => c.uuid === column.uuid ? e.target.checked : c.primaryKey).map(c => c.uuid) })} />기본키</label><label className="check-field"><input aria-label="NULL 허용" type="checkbox" checked={column.nullable} disabled={busy || column.primaryKey} onChange={e => edit(column.uuid, 'notNull', e.target.checked ? 'FALSE' : 'TRUE')} />NULL 허용</label></div>
    <label className="field"><span>도메인</span><select aria-label="컬럼 도메인" value={column.domainUuid || ''} disabled={busy} onChange={e => void run({ type: 'setColumnDomain', columnUuid: column.uuid, domainUuid: e.target.value || null, inherit: !!e.target.value })}><option value="">연결 없음</option>{view.domains.map(d => <option value={d.uuid} key={d.uuid}>{d.name} · {d.suggestedDataType}</option>)}</select></label>
    {column.domainUuid && <button className="secondary-button" disabled={busy} onClick={() => void run({ type: 'setColumnDomain', columnUuid: column.uuid, domainUuid: column.domainUuid!, inherit: true })}>도메인 기본값 적용</button>}
    <div className="column-actions"><button className="secondary-button" aria-label="컬럼 위로" disabled={busy || index === 0} onClick={() => move(-1)}><ArrowUp size={13} /></button><button className="secondary-button" aria-label="컬럼 아래로" disabled={busy || index === table.columns.length - 1} onClick={() => move(1)}><ArrowDown size={13} /></button><button className="danger-link" disabled={busy} onClick={() => { setRemoving(true); setCascade(false); }}><Trash2 size={13} />컬럼 삭제</button></div>
    {removing && <Modal title="컬럼 삭제" close={() => setRemoving(false)}><div className="modal-body"><p><strong>{column.name}</strong> 컬럼을 삭제합니다.</p><label className="check-field"><input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} />참조하는 관계·키 항목도 함께 삭제</label></div><footer className="modal-actions"><button className="secondary-button" onClick={() => setRemoving(false)}>취소</button><button className="danger-button" disabled={busy} onClick={async () => { if (await run({ type: 'removeColumn', columnUuid: column.uuid, cascade })) setRemoving(false); }}>삭제</button></footer></Modal>}
  </div>;
}
