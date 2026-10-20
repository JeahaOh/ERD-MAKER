import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { deleteRecovery, listRecoveries, type RecoveryInfo } from '../browser/recovery';
import { Modal } from './ui';

export function RecoveryDialog({ items, activeId, busy, restore, changed, notify, close }: {
  items: RecoveryInfo[]; activeId: string; busy: boolean;
  restore: (id: string) => Promise<void>; changed: (items: RecoveryInfo[]) => void;
  notify: (message: string, error?: boolean) => void; close: () => void;
}) {
  const [deleting, setDeleting] = useState(''), [confirm, setConfirm] = useState('');
  async function remove(id: string) {
    if (confirm !== id) { setConfirm(id); return; }
    setDeleting(id);
    try { await deleteRecovery(id); changed(await listRecoveries()); setConfirm(''); notify('선택한 로컬 복구본을 삭제했습니다.'); }
    catch { notify('복구본을 삭제하지 못했습니다.', true); }
    finally { setDeleting(''); }
  }
  return <Modal title="로컬 작업 복구" subtitle="작업할 복구본을 선택하세요. 복구 후의 편집은 별도 복구본으로 보관합니다." close={close} wide>
    <div className="modal-body recovery-list">
      <p className="help-text">이 브라우저에 저장한 복구본 {items.length}개입니다. 파일로 보관하려면 복구한 뒤 파일 저장을 사용하세요.</p>
      {!items.length && <p className="help-text">남아 있는 로컬 복구본이 없습니다.</p>}
      {items.map(item => <article className="recovery-entry" key={item.id}>
        <div><strong>{item.filename}</strong><small><time dateTime={new Date(item.savedAt).toISOString()}>{new Date(item.savedAt).toLocaleString('ko-KR')}</time> · {item.size < 1024 * 1024 ? `${(item.size / 1024).toFixed(1)} KiB` : `${(item.size / 1024 / 1024).toFixed(2)} MiB`}{item.id === activeId ? ' · 현재 작업' : ''}</small></div>
        <button className="secondary-button" aria-label={`복구: ${item.filename}`} disabled={busy || !!deleting} onClick={() => void restore(item.id)}><RotateCcw size={14} />복구</button>
        <button className="recovery-delete" aria-label={`${confirm === item.id ? '삭제 확인' : '복구본 삭제'}: ${item.filename}`} disabled={busy || !!deleting || item.id === activeId} onClick={() => void remove(item.id)}><Trash2 size={14} />{confirm === item.id ? '삭제 확인' : '삭제'}</button>
        {confirm === item.id && <button className="secondary-button" onClick={() => setConfirm('')}>취소</button>}
      </article>)}
    </div><footer className="modal-actions"><button className="primary-button" onClick={close}>닫기</button></footer>
  </Modal>;
}
