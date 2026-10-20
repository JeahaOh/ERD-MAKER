import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Field({ label, value, onChange, multiline, placeholder, ...props }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; list?: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const common = { value: draft, placeholder, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value), onBlur: () => { if (draft !== value) onChange(draft); }, 'aria-label': label };
  return <label className="field"><span>{label}</span>{multiline ? <textarea {...common} rows={3} /> : <input {...props} {...common} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}</label>;
}
export function Modal({ title, subtitle, children, close, wide = false }: { title: string; subtitle?: string; children: ReactNode; close: () => void; wide?: boolean }) {
  useEffect(() => { const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [close]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><section className={'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="닫기" onClick={close}><X size={19} /></button></header>{children}</section></div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
