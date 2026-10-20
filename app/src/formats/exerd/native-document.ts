import { readBinary, writeBinary, type BinaryGraph, type BinaryObject, type BinaryRegistry } from './binary';
import { readContainer, writeContainer, type ExerdContainer } from './container';
import { indexXml, patchXmlAttributes, type AttributeEdit, type XmlIndex } from './xml';
import { parseNativeScalar } from './scalar';
import { auditRepresentations } from './consistency';

export interface NativeExerdDocument { container: ExerdContainer; graph: BinaryGraph; xml: XmlIndex; byUuid: Map<string, BinaryObject> }
const documentRegistries = new WeakMap<NativeExerdDocument, BinaryRegistry>();
function objectIndex(graph: BinaryGraph): Map<string, BinaryObject> {
  const result = new Map<string, BinaryObject>();
  for (const object of graph.objects) {
    const uuid = object.features.find(f => f.name === 'UUID')?.value;
    if (typeof uuid !== 'string') continue;
    if (result.has(uuid)) throw new Error(`바이너리 모델 중복 UUID: ${uuid}`);
    result.set(uuid, object);
  }
  return result;
}
export function openNativeDocument(bytes: Uint8Array, registry: BinaryRegistry): NativeExerdDocument {
  const container = readContainer(bytes);
  if (container.header.version.join('.') !== '3.0.0' || container.header.qualifier !== '20190111-1604') throw new Error('호환성이 확인되지 않은 eXERD 모델 형식 버전입니다. 원본 파일은 변경되지 않았습니다.');
  const graph = readBinary(container.binary, registry), xml = indexXml(container.xml);
  const byUuid = objectIndex(graph);
  for (const uuid of xml.byUuid.keys()) if (!byUuid.has(uuid)) throw new Error(`XML UUID가 바이너리 모델에 없습니다: ${uuid}`);
  const document = { container, graph, xml, byUuid };
  const mismatches = auditRepresentations(document, registry);
  if (mismatches.length) throw new Error(`XML과 바이너리 모델의 저장 속성이 ${mismatches.length}곳에서 일치하지 않습니다. 원본 파일은 변경되지 않았습니다.`);
  documentRegistries.set(document, registry);
  return document;
}
/** Immutable attribute transaction: edits both serialized representations together. */
export function editNativeAttributes(document: NativeExerdDocument, registry: BinaryRegistry, edits: AttributeEdit[]): NativeExerdDocument {
  const graph = structuredClone(document.graph), byUuid = objectIndex(graph);
  const normalized: AttributeEdit[] = [];
  const requested = [...edits];
  // Original NameOwner setters make manually entered names explicit. Group and
  // constraint names are separate objects; never overwrite a custom related name.
  for (const edit of edits) {
    if (edit.name !== 'physicalName' && edit.name !== 'logicalName') continue;
    const object = byUuid.get(edit.uuid); if (!object) continue;
    const flag = edit.name === 'physicalName' ? 'derivedPhysicalName' : 'derivedLogicalName';
    const definition = registry.packages.find(p => p.namespaceURI === object.class.packageUri)?.classes.find(c => c.name === object.class.name)?.features.find(f => f.name === flag);
    if (definition?.kind === 'BOOLEAN' && !edits.some(e => e.uuid === edit.uuid && e.name === flag)) requested.push({ uuid: edit.uuid, name: flag, value: 'false' });
  }
  for (const edit of requested) {
    if (edit.name === 'UUID') throw new Error('UUID 변경은 지원되는 구조 명령을 사용해야 합니다.');
    const object = byUuid.get(edit.uuid); if (!object) throw new Error(`모델 객체를 찾지 못했습니다: ${edit.uuid}`);
    const definition = registry.packages.find(p => p.namespaceURI === object.class.packageUri)?.classes.find(c => c.name === object.class.name)?.features.find(f => f.name === edit.name);
    if (!definition) throw new Error(`메타모델에 없는 속성: ${object.class.name}.${edit.name}`);
    if (definition.transient || definition.derived) throw new Error('파생·임시 속성은 직접 변경할 수 없습니다.');
    if (definition.many || !['STRING', 'DATA', 'BOOLEAN', 'CHAR', 'LONG', 'BYTE', 'SHORT', 'INT', 'FLOAT', 'DOUBLE'].includes(definition.kind)) throw new Error('참조·목록·구조 속성은 별도의 구조 편집 명령이 필요합니다.');
    const existing = object.features.find(f => f.name === edit.name);
    if (edit.value === null) object.features = object.features.filter(f => f.name !== edit.name);
    else {
      const value = parseNativeScalar(definition, object.class, edit.value, registry);
      if (existing) existing.value = value;
      else object.features.push({ id: definition.id, name: definition.name, kind: definition.kind, value });
      normalized.push({ ...edit, value: String(value) });
    }
    if (edit.value === null) normalized.push(edit);
  }
  const xml = patchXmlAttributes(document.container.xml, normalized);
  const binary = writeBinary(graph);
  const container = { ...document.container, xml, binary };
  // Re-read the writer output rather than treating a successful encode as validation.
  return openNativeDocument(writeContainer(container), registry);
}
export function saveNativeDocument(document: NativeExerdDocument): Uint8Array {
  const registry = documentRegistries.get(document);
  if (!registry) throw new Error('검증된 모델 열기 또는 구조 편집 명령을 먼저 사용해 주세요.');
  if (auditRepresentations(document, registry).length) throw new Error('XML과 바이너리 모델의 저장 속성이 일치하지 않아 저장을 중단했습니다.');
  return writeContainer({ ...document.container, binary: writeBinary(document.graph) });
}
