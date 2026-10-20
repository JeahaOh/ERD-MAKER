import { useEffect, useState } from 'react';
import { GitBranch, Trash2 } from 'lucide-react';
import type { NativeDocumentView, NativeRelationshipView } from '../../formats/exerd/view';
import type { NativeCardinality, NativeCommand } from '../../formats/exerd/mutations';
import type { RunNativeCommand } from './NativeTools';
import { Field, Modal } from './ui';
import { ForeignKeyOptionsEditor } from './ForeignKeyOptionsEditor';

const cardinalities = [
  ['EXACTLY_ONE', '1 · 정확히 하나'], ['ZERO_OR_ONE', '0..1 · 없거나 하나'],
  ['ZERO_OR_MORE', '0..N · 없거나 여러 개'], ['ONE_OR_MORE', '1..N · 하나 이상'],
] as const;
export function RelationshipInspector({ relation, view, busy, run, edit }: {
  relation: NativeRelationshipView; view: NativeDocumentView; busy: boolean; run: RunNativeCommand;
  edit: (uuid: string, name: string, value: string | null) => void;
}) {
  const keys = view.allTables.flatMap(table => table.groups.filter(g => (g.kind === 'primary' || g.kind === 'unique') && g.columnUuids.length).map(group => ({ table, group })));
  const [parentKey, setParentKey] = useState(relation.parentKeyUuid || ''), [mapping, setMapping] = useState<string[]>([]);
  const [parentCardinality, setParentCardinality] = useState(relation.parentCardinality), [childCardinality, setChildCardinality] = useState(relation.childCardinality), [identifying, setIdentifying] = useState(relation.identifying);
  const [removing, setRemoving] = useState(false), [cascade, setCascade] = useState(false);
  const key = keys.find(k => k.group.uuid === parentKey), child = view.allTables.find(t => t.uuid === relation.childTableUuid);
  const parentSignature = relation.parentColumnUuids.join('\0'), childSignature = relation.childColumnUuids.join('\0');
  useEffect(() => {
    const current = keys.find(k => k.group.uuid === relation.parentKeyUuid);
    setParentKey(relation.parentKeyUuid || '');
    setMapping((current?.group.columnUuids || relation.parentColumnUuids).map(id => relation.childColumnUuids[relation.parentColumnUuids.indexOf(id)] || ''));
    setParentCardinality(relation.parentCardinality); setChildCardinality(relation.childCardinality); setIdentifying(relation.identifying);
  }, [relation.uuid, relation.parentKeyUuid, parentSignature, childSignature, relation.parentCardinality, relation.childCardinality, relation.identifying]);
  const originalMapping = key?.group.columnUuids.map(id => relation.childColumnUuids[relation.parentColumnUuids.indexOf(id)] || '') || [];
  const mappingChanged = parentKey !== relation.parentKeyUuid || mapping.some((id, i) => id !== originalMapping[i]) || mapping.length !== originalMapping.length;
  const duplicateMapping = new Set(mapping.filter(Boolean)).size !== mapping.filter(Boolean).length;
  const dirty = mappingChanged || parentCardinality !== relation.parentCardinality || childCardinality !== relation.childCardinality || identifying !== relation.identifying;
  const valid = !!key && mapping.length === key.group.columnUuids.length && mapping.every(id => child?.columns.some(c => c.uuid === id)) && !duplicateMapping && [parentCardinality, childCardinality].every(value => cardinalities.some(([id]) => id === value));
  async function apply() {
    const command: NativeCommand = { type: 'editRelationship', foreignKeyUuid: relation.uuid,
      ...(mappingChanged ? { parentKeyUuid: parentKey, childColumnUuids: mapping } : {}),
      ...(parentCardinality !== relation.parentCardinality ? { parentCardinality: parentCardinality as NativeCardinality } : {}),
      ...(childCardinality !== relation.childCardinality ? { childCardinality: childCardinality as NativeCardinality } : {}),
      ...(identifying !== relation.identifying ? { identifying } : {}) };
    await run(command);
  }
  function chooseKey(id: string) {
    const next = keys.find(k => k.group.uuid === id);
    setMapping((next?.group.columnUuids || []).map(column => { const i = key?.group.columnUuids.indexOf(column) ?? -1; return i < 0 ? '' : mapping[i] || ''; })); setParentKey(id);
  }
  return <><div className="inspector-title"><GitBranch size={20} /><div><h3>관계 속성</h3><code>{relation.name}</code></div></div><div className="inspector-content relationship-inspector">
    <Field label="관계 그룹 이름" value={relation.name} onChange={value => edit(relation.uuid, 'physicalName', value)} />
    {relation.constraintUuid && <Field label="외래키 제약 이름" value={relation.constraintName || ''} onChange={value => edit(relation.constraintUuid!, 'physicalName', value)} />}
    <form onSubmit={e => { e.preventDefault(); void apply(); }}>
      <label className="field"><span>부모 테이블 · 키</span><select aria-label="관계 부모 키" value={parentKey} disabled={busy} onChange={e => chooseKey(e.target.value)}><option value="" disabled>부모 키 선택</option>{parentKey && !key && <option value={parentKey}>원본 부모 키를 확인할 수 없습니다</option>}{keys.map(k => <option key={k.group.uuid} value={k.group.uuid}>{k.table.schemaName}.{k.table.name} · {k.group.kind === 'primary' ? 'PK' : 'UK'} · {k.group.constraintName || k.group.name}</option>)}</select></label>
      <p className="help-text">자식 테이블: {child ? `${child.schemaName}.${child.name}` : '확인할 수 없음'}</p>
      {key?.group.columnUuids.map((id, index) => { const column = key.table.columns.find(c => c.uuid === id); return <label className="field" key={id}><span>{column?.name || id} → 자식 컬럼</span><select aria-label={`대응 컬럼: ${column?.name || id}`} value={mapping[index] || ''} disabled={busy} onChange={e => setMapping(current => current.map((v, i) => i === index ? e.target.value : v))}><option value="">컬럼 선택</option>{child?.columns.map(c => <option key={c.uuid} value={c.uuid}>{c.name} · {c.type}</option>)}</select></label>; })}
      {duplicateMapping && <p className="export-warning">각 부모 컬럼에는 서로 다른 자식 컬럼을 지정하세요.</p>}
      {(['parent', 'child'] as const).map(side => { const value = side === 'parent' ? parentCardinality : childCardinality; return <label className="field" key={side}><span>{side === 'parent' ? '부모' : '자식'} 카디널리티</span><select aria-label={`${side === 'parent' ? '부모' : '자식'} 카디널리티`} value={value} disabled={busy} onChange={e => (side === 'parent' ? setParentCardinality : setChildCardinality)(e.target.value)}>{!cardinalities.some(([id]) => id === value) && <option value={value}>{value} · 원본 값</option>}{cardinalities.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>; })}
      <label className="check-field"><input aria-label="관계 식별 여부" type="checkbox" checked={identifying} disabled={busy} onChange={e => setIdentifying(e.target.checked)} />식별 관계</label>
      <p className="help-text">식별 관계는 대응 컬럼을 자식 기본키에 포함합니다. 해제해도 기존 기본키는 유지합니다. 카디널리티 표기 변경은 UNIQUE·NULL 제약을 자동 변경하지 않습니다.</p>
      <button className="primary-button" type="submit" disabled={busy || !dirty || !valid}>관계 변경 적용</button>
    </form>
    <p className="help-text">현재 참조 동작 · 삭제 {relation.onDelete} · 갱신 {relation.onUpdate}</p>
    <ForeignKeyOptionsEditor relation={relation} busy={busy} run={run}/>
    <button className="danger-link" disabled={busy} onClick={() => { setCascade(false); setRemoving(true); }}><Trash2 size={13} />관계 삭제</button>
    {removing && <Modal title="관계 삭제" close={() => setRemoving(false)}><div className="modal-body"><p>{relation.constraintName || relation.name} 외래키를 삭제합니다.</p><label className="check-field"><input type="checkbox" checked={cascade} onChange={e => setCascade(e.target.checked)} />종속 메모 등도 함께 삭제</label></div><footer className="modal-actions"><button className="secondary-button" onClick={() => setRemoving(false)}>취소</button><button className="danger-button" disabled={busy} onClick={async () => { if (await run({ type: 'removeRelationship', foreignKeyUuid: relation.uuid, cascade })) setRemoving(false); }}>삭제</button></footer></Modal>}
  </div></>;
}
