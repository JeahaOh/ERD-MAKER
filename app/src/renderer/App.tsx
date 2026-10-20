import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, applyNodeChanges, type NodeChange, type ReactFlowInstance } from '@xyflow/react';
import { Database, FolderOpen, Save, Plus, Search, Table2, Layers, ArrowRight, Undo2, Redo2, PanelRightClose, PanelRightOpen, Maximize2, FilePlus2, LoaderCircle, Check, AlertCircle, ChevronDown, KeyRound, X, MousePointer2, ShieldCheck, Download, LayoutGrid, BookOpen } from 'lucide-react';
import TableNode, { type EntityNode } from './components/TableNode';
import { Field, Modal } from './components/ui';
import { download } from './browser/exports';
import { listRecoveries, readRecovery, writeRecovery, type RecoveryInfo } from './browser/recovery';
import { RecoveryDialog } from './components/RecoveryDialog';
import type { EngineRequest, CatalogReview, ModelArtifact } from './engine.worker';
import type { projectNativeDocument } from '../formats/exerd/view';
import { NativeTools, ColumnStructureEditor, type RunNativeCommand } from './components/NativeTools';
import type { NativeDiagnostic } from '../formats/exerd/validation';
import type { NativeDdlResult } from '../formats/sql/native-ddl';
import { DdlDialog, type GenerateDdl } from './components/DdlDialog';
import NoteNode, { type NoteNodeType } from './components/NoteNode';
import { NativeAdvancedTools, TableConstraintEditor } from './components/NativeAdvancedTools';
import { ComparisonDialog, type CompareModel } from './components/ComparisonDialog';
import type { NativeComparison } from '../formats/exerd/compare';
import { diagramPng } from './browser/diagram-image';
import { NATIVE_DATABASE_PRODUCTS, type NativeDatabaseProductId } from '../formats/exerd/database-products';
import { MetadataInspector, type MetadataSelection } from './components/MetadataInspector';
import { RelationshipInspector } from './components/RelationshipInspector';
const TermDictionaryDialog = lazy(() => import('./components/TermDictionaryDialog').then(module => ({ default: module.TermDictionaryDialog })));


type Projection = ReturnType<typeof projectNativeDocument>;
type Request = EngineRequest extends infer T ? T extends EngineRequest ? Omit<T, 'id'> : never : never;
type EngineResponse = { view?: Projection; diagnostics?: NativeDiagnostic[]; ddl?: NativeDdlResult; comparison?: NativeComparison; catalogReview?: CatalogReview; artifact?: ModelArtifact; id: number; error?: string; diagramUuid?: string; canUndo?: boolean; canRedo?: boolean; backup?: Uint8Array; saved?: Uint8Array };
type StudioNode = EntityNode | NoteNodeType;
const nodeTypes = { entity: TableNode, note: NoteNode };
const cardinality = (value: string) => ({ EXACTLY_ONE: '1', ZERO_OR_ONE: '0..1', ZERO_OR_MORE: '0..N', ONE_OR_MORE: '1..N' })[value] || value;

function Studio() {
  const worker = useRef<Worker | null>(null), sequence = useRef(0), input = useRef<HTMLInputElement>(null);
  const catalogInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<Projection | null>(null), [diagram, setDiagram] = useState('');
  const [diagnostics, setDiagnostics] = useState<NativeDiagnostic[]>([]);
  const [busy, setBusy] = useState(''), [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [filename, setFilename] = useState('새 모델.exerd'), [canUndo, setCanUndo] = useState(false), [canRedo, setCanRedo] = useState(false);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(''), [columnId, setColumnId] = useState('');
  const [mode, setMode] = useState<'both' | 'physical' | 'logical'>('both'), [showInspector, setShowInspector] = useState(true), [modal, setModal] = useState('');
  const [nodes, setNodes] = useState<StudioNode[]>([]), [instance, setInstance] = useState<ReactFlowInstance<StudioNode> | null>(null);
  const [noteId, setNoteId] = useState('');
  const [relationshipId, setRelationshipId] = useState('');
  const [tableSchema, setTableSchema] = useState('');
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>('TB');
  const [compact, setCompact] = useState(false);
  const [catalogReview, setCatalogReview] = useState<CatalogReview>(), [catalogName, setCatalogName] = useState(''), [acceptPartial, setAcceptPartial] = useState(false);
  const [newName, setNewName] = useState('새 데이터 모델'), [recovered, setRecovered] = useState(false);
  const [newDatabase, setNewDatabase] = useState<NativeDatabaseProductId>('com.tomato.db.postgresql');
  const [explorer, setExplorer] = useState<'tables' | 'domains' | 'schemas' | 'areas'>('tables');
  const [metadataSelection, setMetadataSelection] = useState<MetadataSelection>();
  const filenameRef = useRef(filename); filenameRef.current = filename;
  const recoveryId = useRef(crypto.randomUUID()), recoveryQueue = useRef(Promise.resolve()), recoveryRevision = useRef(0);
  const [recoveries, setRecoveries] = useState<RecoveryInfo[]>([]);
  const callbacks = useRef(new Map<number, (reply: EngineResponse) => void>());
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.error ? 10000 : 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    let active = true;
    const engine = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }); worker.current = engine;
    engine.onmessage = (event: MessageEvent<EngineResponse>) => {
      const reply = event.data; setBusy('');
      callbacks.current.get(reply.id)?.(reply); callbacks.current.delete(reply.id);
      if (reply.error) notify(reply.error, true);
      else if (reply.view) {
        setView(reply.view); setDiagnostics(reply.diagnostics || []); setDiagram(reply.diagramUuid || ''); setCanUndo(!!reply.canUndo); setCanRedo(!!reply.canRedo);
        if (reply.backup) {
          const bytes = reply.backup, name = filenameRef.current, id = recoveryId.current, revision = ++recoveryRevision.current;
          setRecovered(false);
          // Serialize writes in reply order. Each opened/created model and each
          // tab has its own slot; restoring forks instead of overwriting it.
          recoveryQueue.current = recoveryQueue.current.then(() => writeRecovery(bytes, name, id)).then(() => {
            if (active && revision === recoveryRevision.current) setRecovered(true);
          }).catch(() => { if (active && revision === recoveryRevision.current) { setRecovered(false); notify('이 기기에 복구본을 저장하지 못했습니다. 파일로 저장해 주세요.', true); } });
        }
      }
    };
    engine.onerror = () => { setBusy(''); notify('파일 처리 중 오류가 발생했습니다. 원본 파일은 변경되지 않았습니다.', true); };
    return () => { active = false; engine.terminate(); worker.current = null; };
  }, [notify]);
  const send = useCallback((request: Request, label = '', complete?: (reply: EngineResponse) => void) => {
    if (!worker.current) return;
    const id = ++sequence.current; if (complete) callbacks.current.set(id, complete);
    setBusy(label); worker.current.postMessage({ ...request, id });
  }, []);
  const save = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    send({ action: 'save' }, '저장 파일 생성 중', reply => {
    if (reply.saved) { download(Uint8Array.from(reply.saved).buffer, filenameRef.current.replace(/\.exerd$/i, '') + '.exerd', 'application/octet-stream'); notify('모델 파일을 저장했습니다.'); }
    });
  }, [send, notify]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || busy) return;
      if (event.key.toLowerCase() === 's' && view) { event.preventDefault(); save(); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('input[aria-label="테이블 검색"]')?.focus(); }
      const typing = event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable);
      if (!typing && event.key.toLowerCase() === 'z') { event.preventDefault(); send({ action: event.shiftKey ? 'redo' : 'undo' }, '변경 복원 중'); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [busy, view, save, send]);
  const table = view?.allTables.find(t => t.uuid === selected);
  const column = table?.columns.find(c => c.uuid === columnId);
  const selectedNote = view?.allNotes.find(note => note.uuid === noteId);
  const selectedRelationship = view?.allRelationships.find(relation => relation.uuid === relationshipId);
  const selectRelationship = useCallback((uuid: string) => { setRelationshipId(uuid); setSelected(''); setColumnId(''); setNoteId(''); setMetadataSelection(undefined); setShowInspector(true); }, []);
  const edit = useCallback((uuid: string, name: string, value: string | null) => {
    send({ action: 'edit', edits: [{ uuid, name, value }] }, '변경 사항 적용 중');
  }, [send]);
  const runCommand: RunNativeCommand = useCallback(command => new Promise(resolve => {
    send({ action: 'command', command }, '모델 구조 변경 중', reply => {
      if (!reply.error && command.type === 'addNote') {
        const note = reply.view?.notes.at(-1);
        if (note) { setRelationshipId(''); setSelected(''); setColumnId(''); setMetadataSelection(undefined); setNoteId(note.uuid); setShowInspector(true); setTimeout(() => instance?.setCenter(note.x + (note.width || 240) / 2, note.y + (note.height || 120) / 2, { zoom: 1, duration: 200 }), 90); }
      }
      resolve(!reply.error);
    });
  }), [send, instance]);
  const generateDdl: GenerateDdl = useCallback(options => new Promise(resolve => {
    send({ action: 'ddl', options }, 'SQL 생성 중', reply => resolve(reply.ddl));
  }), [send]);
  const compareModel: CompareModel = useCallback(bytes => new Promise(resolve => {
    send({ action: 'compare', bytes }, '모델 비교 중', reply => resolve(reply.comparison));
  }), [send]);
  const exportModel = (format: 'svg' | 'png' | 'html' | 'csv') => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    send({ action: 'export', format: format === 'png' ? 'svg' : format }, '내보내기 파일 생성 중', async reply => {
      const artifact = reply.artifact; if (!artifact) return;
      const base = filenameRef.current.replace(/\.exerd$/i, '');
      try {
        if (format === 'png') {
          const result = await diagramPng(artifact.content, artifact.width!, artifact.height!);
          download(Uint8Array.from(result.bytes).buffer, base + '.png', 'image/png');
          notify(result.scaled ? `큰 다이어그램을 ${result.width} × ${result.height}px로 축소해 저장했습니다. 벡터 원본은 SVG로 저장하세요.` : 'PNG 이미지를 저장했습니다.');
        } else { download(artifact.content, base + '.' + artifact.extension, artifact.mime); notify(artifact.warnings[0] || '내보내기 파일을 저장했습니다.'); }
      } catch (error) { notify(error instanceof Error ? error.message : '내보내기에 실패했습니다.', true); }
    });
  };
  const diagramTableUuids = useMemo(() => view?.tables.map(t => t.uuid) || [], [view]);
  useEffect(() => {
    if (!view) { setNodes([]); return; }
    const fkIds = view.allRelationships.flatMap(r => r.childColumnUuids);
    const next: EntityNode[] = view.tables.map(t => ({
      id: t.placementUuid || t.uuid, type: 'entity', position: { x: t.x, y: t.y }, selected: t.uuid === selected,
      data: { mode, fkIds, errorCount: 0, compact, table: { id: t.uuid, name: t.name, logicalName: t.logicalName, schema: t.schemaName, comment: t.comment, color: t.uuid === selected ? 'var(--color-teal)' : 'var(--color-slate)', x: t.x, y: t.y, subjectId: '', indexes: [], columns: t.columns.map(c => ({ id: c.uuid, name: c.name, logicalName: c.logicalName, type: c.type, nullable: c.nullable, primaryKey: c.primaryKey, unique: false, defaultValue: c.defaultValue, comment: c.comment })) } },
    }));
    const notes: NoteNodeType[] = view.notes.map(note => ({ id: note.uuid, type: 'note', position: { x: note.x, y: note.y }, selected: note.uuid === noteId, style: { width: note.width || 240, height: note.height || 120 }, data: { text: note.text, onResize: (width, height) => void runCommand({ type: 'editNote', noteUuid: note.uuid, width, height }) } }));
    setNodes([...next, ...notes]);
  }, [view, selected, mode, noteId, runCommand, compact]);
  const edges = useMemo(() => (view?.relationships || []).filter(r => r.parentColumnUuids[0] && r.childColumnUuids[0]).map(r => ({
    ariaRole: 'button' as const, ariaLabel: `관계 ${r.name} · ${view?.allTables.find(t => t.uuid === r.childTableUuid)?.schemaName}.${view?.allTables.find(t => t.uuid === r.childTableUuid)?.name}`,
    domAttributes: { onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); selectRelationship(r.uuid); } else if (event.key === 'Escape') { event.preventDefault(); setRelationshipId(''); } } },
    id: r.uuid, selected: r.uuid === relationshipId, source: view?.tables.find(t => t.uuid === r.parentTableUuid)?.placementUuid || r.parentTableUuid, target: view?.tables.find(t => t.uuid === r.childTableUuid)?.placementUuid || r.childTableUuid,
    sourceHandle: compact ? 'compact-out' : `out-${r.parentColumnUuids[0]}`, targetHandle: compact ? 'compact-in' : `in-${r.childColumnUuids[0]}`,
    type: 'smoothstep', style: { stroke: r.uuid === relationshipId ? 'var(--color-teal)' : 'var(--color-ice)', strokeWidth: r.uuid === relationshipId ? 2 : 1.3, strokeDasharray: r.identifying ? undefined : '5 4' },
    label: `${cardinality(r.parentCardinality)} : ${cardinality(r.childCardinality)}`, labelStyle: { fill: 'var(--color-muted)', fontSize: 10 },
  })), [view, compact, relationshipId, selectRelationship]);
  const fit = useCallback(() => instance?.fitView({ padding: 0.18, duration: 220, maxZoom: 1 }), [instance]);
  const autoLayout = () => {
    const dimensionsByPlacement: Record<string, { width: number; height: number }> = {}, dimensionsByNote: Record<string, { width: number; height: number }> = {};
    for (const node of nodes) {
      if (compact && node.type === 'entity') continue;
      if (!node.measured?.width || !node.measured.height) continue;
      (node.type === 'note' ? dimensionsByNote : dimensionsByPlacement)[node.id] = { width: node.measured.width, height: node.measured.height };
    }
    send({ action: 'layout', options: { direction: layoutDirection, dimensionsByPlacement, dimensionsByNote } }, '다이어그램 자동 배치 중', reply => { if (!reply.error) { setTimeout(fit, 100); notify('자동 배치를 적용했습니다.'); } });
  };
  useEffect(() => { const timer = setTimeout(fit, 80); return () => clearTimeout(timer); }, [diagram, instance, fit]);
  const filtered = useMemo(() => (view?.allTables || []).filter(t => `${t.name} ${t.logicalName} ${t.schemaName}`.toLowerCase().includes(query.toLowerCase())), [query, view]);
  const metadataItems = useMemo(() => {
    const items = explorer === 'domains' ? view?.domains.map(d => ({ uuid: d.uuid, name: d.name, detail: d.suggestedDataType, kind: 'domain' as const })) : explorer === 'schemas' ? view?.schemas.map(s => ({ uuid: s.uuid, name: s.name, detail: `${view.allTables.filter(t => t.schemaUuid === s.uuid).length} 테이블`, kind: 'schema' as const })) : view?.businessAreas.map(a => ({ uuid: a.uuid, name: a.name, detail: `${view.diagrams.filter(d => d.businessAreaUuid === a.uuid).length} 다이어그램`, kind: 'area' as const }));
    return (items || []).filter(item => (item.name + ' ' + item.detail).toLowerCase().includes(query.toLowerCase()));
  }, [view, explorer, query]);
  const resetNavigation = useCallback(() => {
    setRelationshipId(''); setSelected(''); setColumnId(''); setNoteId(''); setMetadataSelection(undefined); setExplorer('tables'); setQuery(''); setTableSchema('');
  }, []);
  function createModel() {
    const name = newName.trim(); if (!name) return;
    send({ action: 'new', name, productId: newDatabase }, '모델 생성 중', reply => {
      if (reply.view) { recoveryId.current = crypto.randomUUID(); filenameRef.current = `${name}.exerd`; setFilename(filenameRef.current); resetNavigation(); }
      setModal('');
    });
  }
  async function openFile(file: File) {
    if (file.size > 128 * 1024 * 1024) { notify('128 MiB 이하의 파일을 선택해 주세요.', true); return; }
    try { send({ action: 'open', bytes: new Uint8Array(await file.arrayBuffer()) }, '모델과 다이어그램을 읽는 중', reply => { if (reply.view) { recoveryId.current = crypto.randomUUID(); filenameRef.current = file.name; setFilename(file.name); setRecovered(false); resetNavigation(); } }); }
    catch { notify('선택한 파일을 읽지 못했습니다.', true); }
  }
  async function restoreSnapshot(id: string) {
    try {
      const backup = await readRecovery(id); if (!backup) { notify('선택한 복구본이 없습니다. 다른 창에서 삭제했을 수 있습니다.', true); return; }
      send({ action: 'open', bytes: backup.bytes }, '로컬 작업 복구 중', reply => { if (reply.view) { recoveryId.current = crypto.randomUUID(); filenameRef.current = backup.filename; setFilename(backup.filename); resetNavigation(); setModal(''); } });
    } catch { notify('로컬 복구본을 읽지 못했습니다.', true); }
  }
  async function restore() {
    try {
      const snapshots = await listRecoveries();
      if (!snapshots.length) { notify('이 기기에 저장된 복구본이 없습니다.'); return; }
      if (snapshots.length === 1) { await restoreSnapshot(snapshots[0].id); return; }
      setRecoveries(snapshots); setModal('recovery');
    } catch { notify('로컬 복구 목록을 읽지 못했습니다.', true); }
  }
  async function inspectCatalog(file: File) {
    if (file.size > 128 * 1024 * 1024) { notify('128 MiB 이하의 파일을 선택해 주세요.', true); return; }
    send({ action: 'inspect-catalog', bytes: new Uint8Array(await file.arrayBuffer()) }, '데이터베이스 카탈로그 확인 중', reply => {
      if (reply.catalogReview) { setCatalogReview(reply.catalogReview); setCatalogName(file.name.replace(/\.json$/i, '') + '.exerd'); setAcceptPartial(false); setModal('catalog'); }
    });
  }
  const select = (uuid: string) => {
    setRelationshipId(''); setSelected(uuid); setNoteId(''); setColumnId(''); setMetadataSelection(undefined); setShowInspector(true);
    const node = nodes.find(n => n.type === 'entity' && n.data.table.id === uuid);
    if (node && instance) instance.setCenter(node.position.x + 150, node.position.y + 100, { zoom: 0.9, duration: 250 });
    else if (view) {
      const area = view.diagrams.find(d => d.tableUuids.includes(uuid));
      if (area) send({ action: 'diagram', uuid: area.uuid }, '다이어그램 전환 중');
      else send({ action: 'diagram', uuid: '' }, '전체 모델 표시 중');
    }
  };
  return <div className="studio" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (!busy && file) void (/\.json$/i.test(file.name) ? inspectCatalog(file) : openFile(file)); }}>
    <input hidden ref={input} type="file" accept=".exerd" aria-label="eXERD 모델 파일" onChange={e => { const file = e.target.files?.[0]; if (file) void openFile(file); e.target.value = ''; }} />
    <input hidden ref={catalogInput} type="file" accept=".json,application/json" aria-label="PostgreSQL 카탈로그 파일" onChange={e => { const file = e.target.files?.[0]; if (file) void inspectCatalog(file); e.target.value = ''; }} />
    <header className="app-header"><div className="brand"><span className="brand-mark"><Database size={21} /></span><strong>ERD<span>Maker</span></strong></div><div className="header-divider" /><div className="breadcrumb">워크스페이스 <span>/</span> <strong>{view?.name || '데이터 모델링'}</strong>{view && <span className="engine-badge">{NATIVE_DATABASE_PRODUCTS.find(db => db.productId === view.productId)?.name || view.productId.replace('com.tomato.db.', '')}</span>}</div><div className="header-actions"><span className="save-state"><span className={'status-dot ' + (busy ? 'working' : '')} />{busy || (recovered ? '로컬 복구본 저장됨' : '내 기기에서 작업')}</span><button className="header-button" disabled={!!busy} onClick={() => input.current?.click()}><FolderOpen size={15} />열기</button><button className="header-primary" disabled={!view || !!busy} onPointerDown={e => e.preventDefault()} onClick={save}><Save size={15} />파일 저장</button></div></header>
    <div className="workspace-body"><nav className="activity-rail"><button title="용어사전" aria-label="용어사전 열기" onClick={() => setModal('terms')}><BookOpen size={20}/></button><button className="active" title="모델 탐색기"><Layers size={21} /></button><button title="새 모델" onClick={() => setModal('new')}><FilePlus2 size={21} /></button><button title="PostgreSQL 카탈로그 가져오기" disabled={!!busy} onClick={() => catalogInput.current?.click()}><Database size={21} /></button><span /><button title="로컬 작업 복구" onClick={restore}><ShieldCheck size={20} /></button></nav>
    <aside className="explorer"><div className="panel-heading"><span>모델 탐색기</span><button className="icon-button" aria-label="새 모델 만들기" disabled={!!busy} onClick={() => setModal('new')}><Plus size={16} /></button></div><div className="model-card"><span className="model-icon"><Database size={19} /></span><div><strong>{view?.name || '새로운 설계의 시작'}</strong><small>{view ? `${view.allTables.length} entities · ${view.allRelationships.length} relations` : '로컬 데이터 모델'}</small></div></div><div className="explorer-tabs">{([['tables', '테이블'], ['domains', '도메인'], ['schemas', '스키마'], ['areas', '업무영역']] as const).map(([key, label]) => <button key={key} className={explorer === key ? 'active' : ''} onClick={() => { setExplorer(key); setQuery(''); }}>{label}</button>)}</div><div className="explorer-search"><Search size={14} /><input aria-label="테이블 검색" placeholder="테이블 이름으로 검색" value={query} onChange={e => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div><div className="explorer-section"><span>{({ tables: 'ENTITIES', domains: 'DOMAINS', schemas: 'SCHEMAS', areas: 'AREAS' })[explorer]}</span><span>{explorer === 'tables' ? filtered.length : metadataItems.length}</span></div><div className="entity-tree">{explorer === 'tables' ? <>{filtered.map(t => <button key={t.uuid} className={selected === t.uuid ? 'active' : ''} onClick={() => select(t.uuid)}><Table2 size={14} /><div><strong>{t.logicalName || t.name}</strong><small>{t.name}</small></div><span>{t.columns.length}</span></button>)}{view && !filtered.length && <p className="help-text">검색 결과가 없습니다.</p>}</> : metadataItems.map(item => <button key={item.uuid} className={metadataSelection?.uuid === item.uuid ? 'active' : ''} onClick={() => { setRelationshipId(''); setMetadataSelection({ kind: item.kind, uuid: item.uuid }); setSelected(''); setNoteId(''); setColumnId(''); setShowInspector(true); }}><Layers size={14} /><div><strong>{item.name}</strong><small>{item.detail}</small></div></button>)}</div><div className="explorer-footer"><ShieldCheck size={14} /><span>모델 파일은 이 기기에서 처리됩니다</span></div></aside>
    <main className="canvas-area"><div className="diagram-bar"><div className="diagram-title"><LayoutGrid size={15} /><select aria-label="다이어그램 선택" value={diagram} disabled={!view || !!busy} onChange={e => { setSelected(''); send({ action: 'diagram', uuid: e.target.value }, '다이어그램 전환 중'); }}><option value="">전체 모델</option>{view?.diagrams.map(d => <option key={d.uuid} value={d.uuid}>{d.businessAreaName} / {d.name}</option>)}</select><ChevronDown size={12} /></div><span className="diagram-count">{view?.diagrams.length || 0} diagrams</span><button className="icon-button" aria-label="속성 패널 전환" onClick={() => setShowInspector(v => !v)}>{showInspector ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button></div>
      <div className="canvas-toolbar"><div className="tool-group"><button className="tool active" title="선택"><MousePointer2 size={15} /></button><button className="tool" disabled={!view || !!busy} onClick={() => send({ action: 'add-table', name: `new_table_${(view?.allTables.length || 0) + 1}`, x: 120, y: 120, schemaUuid: view?.schemas.some(s => s.uuid === tableSchema) ? tableSchema : undefined }, '테이블 생성 중')}><Plus size={15} />테이블 추가</button>{view && <select className="compact-select" aria-label="새 테이블 스키마" value={view.schemas.some(s => s.uuid === tableSchema) ? tableSchema : ''} disabled={!!busy} onChange={e => setTableSchema(e.target.value)}><option value="">현재 스키마</option>{view.schemas.map(s => <option key={s.uuid} value={s.uuid}>{s.name}</option>)}</select>}{view && <><NativeTools view={view} selectedTable={table} diagramUuid={diagram} busy={!!busy} run={runCommand} /><NativeAdvancedTools view={view} diagramUuid={diagram} busy={!!busy} run={runCommand} /></>}</div><div className="tool-group"><button className="icon-button" title="실행 취소" aria-label="실행 취소" disabled={!canUndo || !!busy} onClick={() => send({ action: 'undo' }, '변경 복원 중')}><Undo2 size={16} /></button><button className="icon-button" title="다시 실행" aria-label="다시 실행" disabled={!canRedo || !!busy} onClick={() => send({ action: 'redo' }, '변경 복원 중')}><Redo2 size={16} /></button></div><div className="toolbar-spacer" /><details className="model-menu"><summary><Download size={14} />내보내기</summary><div><button disabled={!diagram || !!busy} onClick={() => exportModel('svg')}>다이어그램 SVG</button><button disabled={!diagram || !!busy} onClick={() => exportModel('png')}>다이어그램 PNG</button><button disabled={!view || !!busy} onClick={() => exportModel('html')}>정의서 HTML</button><button disabled={!view || !!busy} onClick={() => exportModel('csv')}>정의서 CSV</button></div></details><button className="tool" disabled={!view || !!busy} onClick={() => setModal('compare')}><Layers size={14} />비교</button><button className="tool" disabled={!diagram || !!busy} onClick={autoLayout}><LayoutGrid size={14} />자동 배치</button><select className="compact-select" aria-label="자동 배치 방향" value={layoutDirection} onChange={e => setLayoutDirection(e.target.value as 'TB' | 'LR')}><option value="TB">위에서 아래</option><option value="LR">왼쪽에서 오른쪽</option></select><button className="tool" disabled={!view || !!busy} onClick={() => setModal('sql')}><Download size={14} />SQL</button><button className="tool" disabled={!view || !!busy} onClick={() => setModal('validation')}><ShieldCheck size={14} />검사 {diagnostics.length || ''}</button><div className="view-switch">{[['both', '논리 + 물리'], ['logical', '논리'], ['physical', '물리']].map(([value, label]) => <button className={mode === value ? 'active' : ''} key={value} onClick={() => setMode(value as typeof mode)}>{label}</button>)}</div><button className="icon-button" aria-label="전체 화면에 맞추기" onClick={fit}><Maximize2 size={15} /></button></div>
      <div className="flow-host">{view ? <ReactFlow<StudioNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setInstance} onMove={(_, viewport) => setCompact(current => viewport.zoom < (current ? 0.3 : 0.25))} onNodesChange={(changes: NodeChange<StudioNode>[]) => setNodes(current => applyNodeChanges(changes, current))} onNodeClick={(_, node) => { setRelationshipId(''); setSelected(node.type === 'entity' ? node.data.table.id : ''); setNoteId(node.type === 'note' ? node.id : ''); setMetadataSelection(undefined); setColumnId(''); setShowInspector(true); }} onEdgeClick={(_, edge) => selectRelationship(edge.id)} onPaneClick={() => { setRelationshipId(''); setSelected(''); setNoteId(''); setColumnId(''); setMetadataSelection(undefined); }} onNodeDragStop={(_, node) => { if (node.type === 'note') { void runCommand({ type: 'editNote', noteUuid: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) }); return; } const t = view.tables.find(t => (t.placementUuid || t.uuid) === node.id); if (t?.placementUuid) { const location = `Point(${Math.trunc(node.position.x)}, ${Math.trunc(node.position.y)})`; edit(t.placementUuid, 'location', location); } }} nodesDraggable={!busy && !!diagram} nodesConnectable={false} deleteKeyCode={null} minZoom={0.005} maxZoom={1.8} fitView onlyRenderVisibleElements><Background gap={20} size={1} color="var(--color-silver)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={node => node.selected ? '#00A19B' : '#D4DCE0'} maskColor="color-mix(in srgb, var(--color-paper) 70%, transparent)" /></ReactFlow> : <div className="welcome"><div className="welcome-symbol"><Database size={39} /></div><span className="eyebrow">YOUR SCHEMA, YOUR WORKSPACE</span><h1>데이터의 구조를 설계하세요.</h1><p>eXERD 모델을 열어 설계를 이어가거나,<br />새로운 데이터 모델을 만들어 보세요.</p><div><button className="primary-button" onClick={() => input.current?.click()}><FolderOpen size={17} />eXERD 파일 열기<ArrowRight size={16} /></button><button className="secondary-button" onClick={() => setModal('new')}><Plus size={16} />새 모델</button></div><button className="restore-link" onClick={restore}>이 기기의 이전 작업 복구</button><small>파일을 이 화면에 끌어다 놓아도 열 수 있습니다.</small></div>}{busy && <div className="busy-indicator"><LoaderCircle size={16} className="spin" />{busy}</div>}</div>
    </main>
    {showInspector && <aside className="inspector"><div className="panel-heading"><span><Table2 size={15} />속성</span>{table && <small>{table.columns.length} columns</small>}</div>{metadataSelection && view ? <MetadataInspector selection={metadataSelection} view={view} busy={!!busy} run={runCommand} edit={edit} editArea={(uuid, value) => send({ action: 'edit', edits: [{ uuid, name: 'physicalName', value }, { uuid, name: 'logicalName', value }] }, '업무영역 변경 중')} /> : selectedRelationship && view ? <RelationshipInspector key={selectedRelationship.uuid} relation={selectedRelationship} view={view} busy={!!busy} run={runCommand} edit={edit} /> : table ? <><div className="inspector-title"><span /><div><h3>{table.logicalName || table.name}</h3><code>{table.name}</code></div></div><div className="inspector-content"><Field label="테이블 물리명" value={table.name} onChange={value => edit(table.uuid, 'physicalName', value)} /><Field label="테이블 논리명" value={table.logicalName} onChange={value => edit(table.uuid, 'logicalName', value)} /><Field label="테이블 설명" value={table.comment} multiline onChange={value => edit(table.uuid, 'comment', value)} /><div className="section-label"><span>컬럼</span><span>{table.columns.length}</span></div><div className="column-list">{table.columns.map(c => <button className={'column-select ' + (columnId === c.uuid ? 'active' : '')} key={c.uuid} onClick={() => setColumnId(columnId === c.uuid ? '' : c.uuid)}><span className={c.primaryKey ? 'teal' : 'muted'}>{c.primaryKey ? <KeyRound size={12} /> : '·'}</span><div><strong>{c.name}</strong><small>{c.logicalName}</small></div><code>{c.type}</code></button>)}</div>{column && <div className="column-editor" key={column.uuid}><div className="section-label"><strong>컬럼 편집</strong><button className="icon-button" aria-label="컬럼 편집 닫기" onClick={() => setColumnId('')}><X size={13} /></button></div><ColumnStructureEditor table={table} column={column} view={view!} busy={!!busy} run={runCommand} edit={edit} /><Field label="컬럼 물리명" value={column.name} onChange={value => edit(column.uuid, 'physicalName', value)} /><Field label="컬럼 논리명" value={column.logicalName} onChange={value => edit(column.uuid, 'logicalName', value)} /><Field label="자료형" value={column.type} onChange={value => edit(column.uuid, 'dataType', value)} /><Field label="기본값" value={column.defaultValue} onChange={value => edit(column.uuid, 'defaultValue', value)} /><Field label="컬럼 설명" value={column.comment} multiline onChange={value => edit(column.uuid, 'comment', value)} />{column.domainUuid && <p className="help-text">도메인 연결 컬럼입니다. 자료형을 직접 지정하면 컬럼별 재정의가 저장됩니다.</p>}</div>}<TableConstraintEditor table={table} busy={!!busy} run={runCommand} edit={edit} inspectRelationship={selectRelationship} /></div></> : selectedNote ? <div className="inspector-content"><div className="section-label"><strong>메모 편집</strong></div><Field label="메모 내용" value={selectedNote.text} multiline onChange={value => void runCommand({ type: 'editNote', noteUuid: selectedNote.uuid, text: value })} /><p className="help-text">테두리 핸들로 크기를 조절하고 드래그하여 이동하세요.</p><button className="danger-link" disabled={!!busy} onClick={() => void runCommand({ type: 'removeNote', noteUuid: selectedNote.uuid })}><X size={13} />메모 삭제</button></div> : <div className="empty"><Table2 size={32} /><strong>설계의 세부 사항을 확인하세요</strong><p>테이블을 선택하면 이름·컬럼·설명을<br />확인하고 편집할 수 있습니다.</p><div className="shortcut-list"><span>파일 저장</span><kbd>⌘ / Ctrl S</kbd><span>실행 취소</span><kbd>⌘ / Ctrl Z</kbd><span>화면 이동</span><span>드래그</span></div></div>}</aside>}
    </div><footer className="statusbar"><span><span className="status-dot" />로컬 워크스페이스</span>{view && <><span>{view.allTables.length} 테이블</span><span>{view.allTables.reduce((n, t) => n + t.columns.length, 0)} 컬럼</span><span>{view.allRelationships.length} 관계</span><span>{view.domains.length} 도메인</span></>}<div /><span>{filename}</span><span>ERD Maker 0.1</span></footer>
    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={16} /> : <Check size={16} />}{toast.message}<button aria-label="알림 닫기" onClick={() => setToast(null)}><X size={14} /></button></div>}
    {modal === 'new' && <Modal title="새 데이터 모델" subtitle="모델 이름을 입력하세요. 언제든 변경할 수 있습니다." close={() => setModal('')}><div className="modal-body"><label className="field"><span>모델 이름</span><input aria-label="새 모델 이름" value={newName} onChange={e => setNewName(e.target.value)} autoFocus /></label><label className="field"><span>데이터베이스</span><select aria-label="새 모델 데이터베이스" value={newDatabase} onChange={e => setNewDatabase(e.target.value as NativeDatabaseProductId)}>{NATIVE_DATABASE_PRODUCTS.map(db => <option key={db.productId} value={db.productId}>{db.name}</option>)}</select></label>{view && <p className="help-text">현재 작업을 보관하려면 먼저 파일로 저장하세요.</p>}</div><footer className="modal-actions"><button className="secondary-button" onClick={() => setModal('')}>취소</button><button className="primary-button" disabled={!newName.trim() || !!busy} onClick={createModel}>모델 만들기</button></footer></Modal>}
    {modal === 'terms' && <Suspense fallback={<div className="busy-indicator" role="status">용어사전 여는 중...</div>}><TermDictionaryDialog view={view} busy={!!busy} run={runCommand} close={() => setModal('')}/></Suspense>}
    {modal === 'recovery' && <RecoveryDialog items={recoveries} activeId={recoveryId.current} busy={!!busy} restore={restoreSnapshot} changed={setRecoveries} notify={notify} close={() => setModal('')} />}
    {modal === 'compare' && view && <ComparisonDialog compare={compareModel} close={() => setModal('')} select={uuid => { const table = view.allTables.find(t => t.uuid === uuid || t.columns.some(c => c.uuid === uuid)); if (table) select(table.uuid); }} />}
    {modal === 'sql' && view && <DdlDialog generate={generateDdl} close={() => setModal('')} filename={filename} diagramTableUuids={diagramTableUuids} />}
    {modal === 'catalog' && catalogReview && <Modal title="PostgreSQL 카탈로그 가져오기" subtitle="DB 구조 조회 결과를 독립 모델로 가져옵니다." close={() => setModal('')} wide><div className="modal-body diagnostic-list"><p>{catalogName}</p>{catalogReview.statistics && <p className="validation-summary">{catalogReview.statistics.tables} 테이블 · {catalogReview.statistics.columns} 컬럼 · {catalogReview.statistics.relationships} 외래키</p>}{catalogReview.diagnostics.map((d, i) => <p key={i} className={d.severity === 'error' ? 'export-warning' : 'help-text'}>{d.message}</p>)}{catalogReview.unsupported.map((d, i) => <div className="diagnostic" key={i}><span>미지원</span><div><strong>{d.message}</strong><small>{d.path}</small></div></div>)}{!catalogReview.complete && <label className="check-field"><input type="checkbox" checked={acceptPartial} onChange={e => setAcceptPartial(e.target.checked)} />위 미지원 항목을 확인했으며 지원되는 구조만 가져옵니다.</label>}{view && <p className="help-text">현재 작업을 보관하려면 먼저 파일로 저장하세요.</p>}</div><footer className="modal-actions"><button className="secondary-button" onClick={() => setModal('')}>취소</button><button className="primary-button" disabled={!!busy || !catalogReview.canImport || !catalogReview.complete && !acceptPartial} onClick={() => send({ action: 'commit-catalog' }, '데이터베이스 모델 생성 중', reply => { if (reply.view) { recoveryId.current = crypto.randomUUID(); filenameRef.current = catalogName; setFilename(catalogName); resetNavigation(); setModal(''); } })}>모델로 가져오기</button></footer></Modal>}
    {modal === 'validation' && <Modal title="모델 검사" subtitle="현재 모델의 이름·키·관계·도메인·배치 참조를 검사합니다." close={() => setModal('')} wide><div className="modal-body diagnostic-list"><p className="validation-summary">오류 {diagnostics.filter(d => d.severity === 'error').length}건 · 경고 {diagnostics.filter(d => d.severity === 'warning').length}건</p>{!diagnostics.length && <p className="help-text">현재 지원하는 검사에서 문제가 발견되지 않았습니다.</p>}{diagnostics.map((d, index) => <button key={index} className={'diagnostic ' + d.severity} onClick={() => { const target = view?.allTables.find(t => t.uuid === d.uuid || t.columns.some(c => c.uuid === d.uuid)); if (target) { select(target.uuid); setColumnId(target.columns.find(c => c.uuid === d.uuid)?.uuid || ''); setModal(''); } }}><span>{d.severity === 'error' ? '오류' : '경고'}</span><div><strong>{d.message}</strong><small>{d.code}</small></div></button>)}</div><footer className="modal-actions"><button className="primary-button" onClick={() => setModal('')}>확인</button></footer></Modal>}
  </div>;
}
export default function App() { return <ReactFlowProvider><Studio /></ReactFlowProvider>; }
