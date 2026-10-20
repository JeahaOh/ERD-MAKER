import type { NativeDocumentView } from '../../formats/exerd/view';
import type { RunNativeCommand } from './NativeTools';
import { Field } from './ui';
export interface MetadataSelection { kind: 'domain' | 'schema' | 'area'; uuid: string }
export function MetadataInspector({ selection, view, run, edit, editArea, busy }: { selection: MetadataSelection; view: NativeDocumentView; run: RunNativeCommand; edit: (uuid: string, name: string, value: string | null) => void; editArea: (uuid: string, value: string) => void; busy: boolean }) {
  if (selection.kind === 'domain') {
    const domain = view.domains.find(d => d.uuid === selection.uuid); if (!domain) return null;
    const columns = view.allTables.flatMap(t => t.columns).filter(c => c.domainUuid === domain.uuid);
    const parent = view.domains.find(d => d.uuid === domain.parentUuid);
    return <div className="inspector-content" key={domain.uuid}><div className="section-label"><strong>도메인 속성</strong></div><Field label="도메인 이름" value={domain.name} onChange={value => edit(domain.uuid, 'physicalName', value)} />{parent && <p className="help-text">상위 도메인: {parent.name}</p>}
      <label className="check-field"><input aria-label="도메인 자료형 상속" type="checkbox" disabled={busy} checked={domain.localDataType === undefined} onChange={e => edit(domain.uuid, 'suggestedDataType', e.target.checked ? null : domain.suggestedDataType)} />상위 도메인의 자료형 사용</label>{domain.localDataType === undefined ? <p className="help-text">적용 자료형: {domain.suggestedDataType || '미지정'}</p> : <Field label="도메인 자료형" value={domain.localDataType} onChange={value => edit(domain.uuid, 'suggestedDataType', value)} />}
      <label className="check-field"><input aria-label="도메인 기본값 상속" type="checkbox" disabled={busy} checked={domain.localDefaultValue === undefined} onChange={e => edit(domain.uuid, 'suggestedDefaultValue', e.target.checked ? null : domain.suggestedDefaultValue)} />상위 도메인의 기본값 사용</label>{domain.localDefaultValue === undefined ? <p className="help-text">적용 기본값: {domain.suggestedDefaultValue || '없음'}</p> : <Field label="도메인 기본값" value={domain.localDefaultValue} onChange={value => edit(domain.uuid, 'suggestedDefaultValue', value)} />}
      <label className="field"><span>NULL 정책</span><select aria-label="도메인 NULL 정책" disabled={busy} value={domain.localNotNull || ''} onChange={e => edit(domain.uuid, 'suggestedNotNull', e.target.value)}><option value="">상위에서 상속</option><option value="TRUE">NOT NULL</option><option value="FALSE">NULL 허용</option></select></label><Field label="도메인 설명" value={domain.comment} multiline onChange={value => edit(domain.uuid, 'comment', value)} /><p className="help-text">직접 연결된 컬럼 {columns.length}개. 자료형·기본값을 컬럼에서 별도로 지정한 경우 그 값을 유지합니다.</p>
    </div>;
  }
  if (selection.kind === 'schema') {
    const schema = view.schemas.find(s => s.uuid === selection.uuid); if (!schema) return null;
    return <div className="inspector-content" key={schema.uuid}><div className="section-label"><strong>스키마 속성</strong></div><Field label="스키마 물리명" value={schema.name} onChange={name => void run({ type: 'renameSchema', schemaUuid: schema.uuid, name })} /><Field label="스키마 논리명" value={schema.logicalName} onChange={value => edit(schema.uuid, 'logicalName', value)} /><p className="help-text">이 스키마의 테이블 {view.allTables.filter(t => t.schemaUuid === schema.uuid).length}개</p></div>;
  }
  const area = view.businessAreas.find(a => a.uuid === selection.uuid); if (!area) return null;
  return <div className="inspector-content" key={area.uuid}><div className="section-label"><strong>업무영역 속성</strong></div><Field label="업무영역 이름" value={area.name} onChange={value => editArea(area.uuid, value)} /><p className="help-text">이 업무영역의 다이어그램 {view.diagrams.filter(d => d.businessAreaUuid === area.uuid).length}개</p></div>;
}
