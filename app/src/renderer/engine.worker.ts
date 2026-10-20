import schema from '../formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../formats/exerd/binary';
import { openNativeDocument, editNativeAttributes, saveNativeDocument, type NativeExerdDocument } from '../formats/exerd/native-document';
import { createNativeDocument, appendNativeTable } from '../formats/exerd/create';
import { projectNativeDocument } from '../formats/exerd/view';
import type { AttributeEdit } from '../formats/exerd/xml';
import { mutateNativeDocument, type NativeCommand } from '../formats/exerd/mutations';
import { validateNativeDocument, type NativeDiagnostic } from '../formats/exerd/validation';
import { generateNativeDdl, type NativeDdlOptions } from '../formats/sql/native-ddl';
import { planNativeLayout, type NativeLayoutOptions } from '../formats/exerd/layout';
import { compareNativeDocuments } from '../formats/exerd/compare';
import { importPostgresCatalog, type PostgresCatalogImportResult, type CatalogDiagnostic, type CatalogUnsupported } from '../formats/sql/postgres-catalog';
import { diagramSvg } from '../formats/export/diagram-svg';
import { exportDefinitionHtml, exportDefinitionCsv } from '../formats/export/definition-report';
import type { NativeDatabaseProductId } from '../formats/exerd/database-products';

export interface CatalogReview { complete: boolean; canImport: boolean; diagnostics: CatalogDiagnostic[]; unsupported: CatalogUnsupported[]; statistics?: { tables: number; columns: number; relationships: number; schemas: number } }
export interface ModelArtifact { content: string; mime: string; extension: string; warnings: string[]; width?: number; height?: number }

export type EngineRequest = { id: number } & (
  | { action: 'open'; bytes: Uint8Array }
  | { action: 'new'; name: string; productId?: NativeDatabaseProductId }
  | { action: 'edit'; edits: AttributeEdit[] }
  | { action: 'diagram'; uuid: string }
  | { action: 'add-table'; name: string; x: number; y: number; schemaUuid?: string }
  | { action: 'command'; command: NativeCommand }
  | { action: 'ddl'; options: NativeDdlOptions }
  | { action: 'layout'; options: NativeLayoutOptions }
  | { action: 'compare'; bytes: Uint8Array }
  | { action: 'inspect-catalog'; bytes: Uint8Array }
  | { action: 'commit-catalog' }
  | { action: 'export'; format: 'svg' | 'html' | 'csv' }
  | { action: 'undo' | 'redo' | 'save' }
);
let document: NativeExerdDocument | undefined;
let selectedDiagram = '';
const registry = schema as BinaryRegistry;
const diagnosticCache = new WeakMap<NativeExerdDocument, NativeDiagnostic[]>();
let history: Uint8Array[] = [], future: Uint8Array[] = [];
let failedEdit = false;
let pendingCatalog: PostgresCatalogImportResult | undefined;
function view() {
  if (!document) throw new Error('먼저 모델을 열거나 만들어 주세요.');
  const all = projectNativeDocument(document);
  if (selectedDiagram && !all.diagrams.some(d => d.uuid === selectedDiagram)) selectedDiagram = '';
  return projectNativeDocument(document, selectedDiagram || undefined);
}
function remember() {
  if (!document) throw new Error('편집할 모델이 없습니다.');
  history.push(saveNativeDocument(document)); if (history.length > 20) history.shift(); future = [];
}
self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  try {
    if (request.action === 'inspect-catalog') {
      pendingCatalog = importPostgresCatalog(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.bytes)));
      const projection = pendingCatalog.document ? projectNativeDocument(pendingCatalog.document) : undefined;
      const review: CatalogReview = { complete: pendingCatalog.complete, canImport: !!projection && !pendingCatalog.diagnostics.some(d => d.severity === 'error'), diagnostics: pendingCatalog.diagnostics, unsupported: pendingCatalog.unsupported, statistics: projection ? { tables: projection.allTables.length, columns: projection.allTables.reduce((n, t) => n + t.columns.length, 0), relationships: projection.allRelationships.length, schemas: projection.schemas.length } : undefined };
      self.postMessage({ id: request.id, catalogReview: review }); return;
    } else if (request.action === 'commit-catalog') {
      if (!pendingCatalog?.document || pendingCatalog.diagnostics.some(d => d.severity === 'error')) throw new Error('가져올 수 있는 카탈로그가 없습니다.');
      document = pendingCatalog.document; pendingCatalog = undefined; selectedDiagram = projectNativeDocument(document).diagrams[0]?.uuid || '';
      history = []; future = []; failedEdit = false;
    } else if (request.action === 'open') {
      const opened = openNativeDocument(request.bytes, registry);
      document = opened; selectedDiagram = projectNativeDocument(opened).diagrams[0]?.uuid || '';
      history = []; future = [];
      pendingCatalog = undefined;
      failedEdit = false;
    } else if (request.action === 'new') {
      document = createNativeDocument(request.name, request.productId ? { database: { productId: request.productId } } : undefined); selectedDiagram = projectNativeDocument(document).diagrams[0]?.uuid || '';
      history = []; future = [];
      pendingCatalog = undefined;
      failedEdit = false;
    } else if (!document) throw new Error('먼저 모델을 열거나 만들어 주세요.');
    else if (request.action === 'export') {
      let artifact: ModelArtifact;
      if (request.format === 'svg') {
        if (!selectedDiagram) throw new Error('이미지로 내보낼 다이어그램을 선택해 주세요.');
        const result = diagramSvg(document, selectedDiagram);
        artifact = { content: result.svg, mime: 'image/svg+xml;charset=utf-8', extension: 'svg', warnings: result.warnings, width: result.width, height: result.height };
      } else if (request.format === 'html') artifact = { content: exportDefinitionHtml(document), mime: 'text/html;charset=utf-8', extension: 'html', warnings: [] };
      else artifact = { content: exportDefinitionCsv(document), mime: 'text/csv;charset=utf-8', extension: 'csv', warnings: [] };
      self.postMessage({ id: request.id, artifact }); return;
    } else if (request.action === 'compare') {
      const other = openNativeDocument(request.bytes, registry);
      self.postMessage({ id: request.id, comparison: compareNativeDocuments(document, other) }); return;
    } else if (request.action === 'ddl') {
      self.postMessage({ id: request.id, ddl: generateNativeDdl(document, request.options) }); return;
    } else if (request.action === 'save') {
      if (failedEdit) throw new Error('적용되지 않은 편집이 있습니다. 오류 값을 수정한 후 저장해 주세요.');
      const bytes = saveNativeDocument(document); self.postMessage({ id: request.id, saved: bytes }, { transfer: [bytes.buffer as ArrayBuffer] }); return;
    } else if (request.action === 'edit') {
      const changed = editNativeAttributes(document, registry, request.edits);
      remember(); document = changed;
      failedEdit = false;
    } else if (request.action === 'diagram') selectedDiagram = request.uuid;
    else if (request.action === 'layout') {
      if (!selectedDiagram) throw new Error('자동 배치할 다이어그램을 선택해 주세요.');
      const edits = planNativeLayout(document, selectedDiagram, request.options);
      if (edits.length) { const changed = editNativeAttributes(document, registry, edits); remember(); document = changed; }
      failedEdit = false;
    }
    else if (request.action === 'command') {
      const changed = mutateNativeDocument(document, request.command);
      remember(); document = changed;
      failedEdit = false;
    }
    else if (request.action === 'add-table') {
      const changed = appendNativeTable(document, { name: request.name, logicalName: '새 테이블', x: request.x, y: request.y, schemaUuid: request.schemaUuid, diagramUuid: selectedDiagram || undefined });
      remember(); document = changed;
      failedEdit = false;
    } else if (request.action === 'undo' && history.length) {
      const previous = history.at(-1)!;
      const restored = openNativeDocument(previous, registry);
      future.push(saveNativeDocument(document)); history.pop(); document = restored; failedEdit = false;
    } else if (request.action === 'redo' && future.length) {
      const next = future.at(-1)!;
      const restored = openNativeDocument(next, registry);
      history.push(saveNativeDocument(document)); future.pop(); document = restored; failedEdit = false;
    }
    const projection = view();
    let diagnostics = diagnosticCache.get(document!);
    if (!diagnostics) { diagnostics = validateNativeDocument(document!); diagnosticCache.set(document!, diagnostics); }
    const backup = request.action === 'diagram' ? undefined : saveNativeDocument(document!);
    const response = { id: request.id, view: projection, diagnostics, diagramUuid: selectedDiagram, canUndo: history.length > 0, canRedo: future.length > 0, backup };
    self.postMessage(response, backup ? { transfer: [backup.buffer as ArrayBuffer] } : {});
  } catch (error) { if (request.action === 'edit' || request.action === 'command') failedEdit = true; self.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }); }
};
