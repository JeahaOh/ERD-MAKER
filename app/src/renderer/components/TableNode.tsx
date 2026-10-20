import { memo, useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { KeyRound, Link2, Table2 } from 'lucide-react';
import type { Table } from '../../core/model';
export type EntityData = { table: Table; mode: string; fkIds: string[]; errorCount: number; compact?: boolean } & Record<string, unknown>;
export type EntityNode = Node<EntityData, 'entity'>;
export default memo(function TableNode({ data, selected, id }: NodeProps<EntityNode>) {
  const t = data.table;
  const update = useUpdateNodeInternals();
  useEffect(() => { update(id); }, [id, data.compact, t.columns.length, update]);
  return <article className={'entity-node ' + (selected ? 'selected ' : '') + (data.compact ? 'compact' : '')} style={{ '--entity-color': t.color } as React.CSSProperties} aria-label={`테이블 ${t.name}`}>
    <div className="entity-heading"><div className="entity-heading-icon"><Table2 size={16} /></div><div><strong>{data.mode === 'physical' ? t.name : t.logicalName || t.name}</strong>{data.mode === 'both' && <small>{t.schema ? t.schema + '.' : ''}{t.name}</small>}</div><span className="entity-count">{t.columns.length}</span>{data.errorCount > 0 && <span className="entity-error">!</span>}</div>
    {data.compact ? <><Handle type="target" position={Position.Left} id="compact-in" /><Handle type="source" position={Position.Right} id="compact-out" /><footer>{t.columns.length} 컬럼 · 확대하면 세부 구조 표시</footer></> : <><div className="entity-column-label"><span>COLUMN</span><span>TYPE</span></div>
    {t.columns.map(c => <div className={'entity-row ' + (c.primaryKey ? 'primary' : '')} key={c.id}>
      <Handle type="target" position={Position.Left} id={`in-${c.id}`} aria-label={`${t.name}.${c.name} 관계 대상`} />
      <span className="key-icon">{c.primaryKey ? <KeyRound size={12} /> : data.fkIds.includes(c.id) ? <Link2 size={12} /> : <span className={'null-dot ' + (!c.nullable ? 'required' : '')} />}</span>
      <span className="column-name" title={`${c.logicalName || c.name} · ${c.comment}`}>{data.mode === 'logical' ? c.logicalName || c.name : c.name}{data.mode === 'both' && c.logicalName && <small>{c.logicalName}</small>}</span>
      <code>{c.type}</code><span className="column-null">{!c.nullable || c.primaryKey ? '•' : ''}</span>
      <Handle type="source" position={Position.Right} id={`out-${c.id}`} aria-label={`${t.name}.${c.name} 관계 시작`} />
    </div>)}
    {!t.columns.length && <div className="entity-no-columns">속성에서 컬럼을 추가하세요</div>}
    <footer><span className="entity-dot" />{t.comment || t.logicalName || '테이블 설명 없음'}</footer></>}
  </article>;
});
