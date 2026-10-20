import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
export type NoteNodeType = Node<{ text: string; onResize: (width: number, height: number) => void } & Record<string, unknown>, 'note'>;
export default memo(function NoteNode({ data, selected }: NodeProps<NoteNodeType>) {
  return <article className={'note-node ' + (selected ? 'selected' : '')} aria-label="다이어그램 메모">
    <NodeResizer color="var(--color-teal)" isVisible={selected} minWidth={120} minHeight={60} onResizeEnd={(_, size) => data.onResize(Math.round(size.width), Math.round(size.height))} />
    <div className="note-fold" /><div className="note-text">{data.text || '메모'}</div>
  </article>;
});
