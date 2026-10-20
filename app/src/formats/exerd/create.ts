import generated from './schema.generated.json' with { type: 'json' };
import { writeBinary, type BinaryGraph, type BinaryObject, type BinaryRegistry, type BinaryValue, type BinaryReference } from './binary';
import { defaultEntryMetadata, writeContainer, type ExerdContainer } from './container';
import { openNativeDocument, type NativeExerdDocument } from './native-document';
import { encodeAttribute } from './xml';

const registry = generated as BinaryRegistry;
const namespace = 'http://exerd.tomato.com/model';
import { NATIVE_DATABASE_PRODUCTS, type CreateNativeOptions } from './database-products';
export { NATIVE_DATABASE_PRODUCTS, type NativeDatabaseProductId, type CreateNativeOptions } from './database-products';
function databaseProduct(graph: BinaryGraph) {
  const productId = field(graph.objects.find(o => o.class.packageUri === namespace && o.class.name === 'Document')!, 'productId');
  const product = NATIVE_DATABASE_PRODUCTS.find(p => p.productId === productId);
  if (!product) throw new Error(`신규 객체 생성을 지원하지 않는 DB 제품입니다: ${String(productId)}`);
  return product;
}
const physicalClasses: Record<string, string> = {
  DatabaseModel: 'DatabaseProperties', Schema: 'SchemaProperties', Table: 'TableProperties', Column: 'ColumnProperties',
  PrimaryKeyColumnGroup: 'IndexProperties', AlternateKeyColumnGroup: 'IndexProperties', InversionEntryColumnGroup: 'IndexProperties',
  PrimaryKeyConstraint: 'PrimaryKeyConstraintProperties', ForeignKeyConstraint: 'ForeignKeyConstraintProperties',
  UniqueConstraint: 'UniqueConstraintProperties', CheckConstraint: 'CheckConstraintProperties',
};
const definitions = (o: BinaryObject) => registry.packages.find(p => p.namespaceURI === o.class.packageUri)?.classes.find(c => c.name === o.class.name)?.features;
const field = (o: BinaryObject | undefined, name: string) => o?.features.find(f => f.name === name)?.value;
const uuid = (o: BinaryObject) => field(o, 'UUID') as string | undefined;
const reference = (o: BinaryObject): BinaryReference => ({ ref: o.id });
function set(o: BinaryObject, name: string, value: BinaryValue) {
  const def = definitions(o)?.find(f => f.name === name);
  if (!def) throw new Error(`신규 모델 메타데이터에 없는 속성: ${o.class.name}.${name}`);
  const old = o.features.find(f => f.name === name);
  if (old) old.value = value; else o.features.push({ id: def.id, name, kind: def.kind, value });
  o.features.sort((a, b) => a.id - b.id);
}
function object(graph: BinaryGraph, name: string, fields: Record<string, BinaryValue> = {}, packageUri = namespace, initializePhysical = true): BinaryObject {
  const o: BinaryObject = { id: (graph.objects.at(-1)?.id ?? -1) + 1, class: { packageUri, name }, features: [] };
  if (!definitions(o)) throw new Error(`신규 객체 schema가 없습니다: ${packageUri}#${name}`);
  graph.objects.push(o);
  if (definitions(o)?.some(f => f.name === 'UUID')) set(o, 'UUID', `${name}_${crypto.randomUUID().replaceAll('-', '')}`);
  for (const [key, value] of Object.entries(fields)) set(o, key, value);
  if (initializePhysical && packageUri === namespace && physicalClasses[name] && !Object.hasOwn(fields, 'physicalProperties')) {
    const product = databaseProduct(graph), propertyClass = physicalClasses[name];
    // Not every DB defines every extension (DB2 has no ColumnProperties, for example).
    if (registry.packages.find(p => p.namespaceURI === product.namespace)?.classes.some(c => c.name === propertyClass)) {
      if (!graph.packages.some(p => p.namespaceURI === product.namespace)) graph.packages.push({ namespaceURI: product.namespace, uri: { base: product.namespace, fragment: '/' } });
      // Original Oracle IndexProperties defaults to UNIQUE even for an ordinary
      // index. Mark newly requested nonunique indexes explicitly so the original
      // DDL generator does not silently omit them. Existing objects stay intact.
      const physicalFields: Record<string, BinaryValue> = {};
      if (product.productId === 'com.tomato.db.oracle_10g' && name === 'InversionEntryColumnGroup') physicalFields.uniqueness = 'NONUNIQUE';
      // Tibero's original unset enum defaults to CASCADE. A newly created
      // relationship starts with explicit NONE; imported unset values retain
      // their original CASCADE semantics.
      if (product.productId === 'com.tomato.db.tibero' && name === 'ForeignKeyConstraint') physicalFields.onDeleteRule = '';
      const properties = object(graph, propertyClass, physicalFields, product.namespace, false);
      // Original Oracle and PostgreSQL Forward folders dereference these groups directly.
      // Empty folders are required even when the new schema contains no sequences/types.
      if (name === 'Schema' && ['com.tomato.db.oracle_10g', 'com.tomato.db.postgresql'].includes(product.productId)) set(properties, 'sequenceGroup', reference(object(graph, 'SequenceGroup', {}, product.namespace, false)));
      if (name === 'Schema' && product.productId === 'com.tomato.db.postgresql') set(properties, 'userDatatypeGroup', reference(object(graph, 'UserDatatypeGroup', {}, product.namespace, false)));
      // Original SQL Server Forward reads index options without a null guard.
      if (product.productId === 'com.tomato.db.sqlserver_2005' && propertyClass === 'IndexProperties') set(properties, 'relationalIndexOption', reference(object(graph, 'RelationalIndexOption', {}, product.namespace, false)));
      // CUBRID Forward expects a partition and algorithm, even for algorithm NONE.
      // Leaving the enum unset uses its observed first literal NONE (empty string).
      if (['com.tomato.db.cubrid', 'com.tomato.db.cubrid10'].includes(product.productId) && name === 'Table') {
        const partition = object(graph, 'Partition', {}, product.namespace, false);
        set(partition, 'partitionAlgorithm', reference(object(graph, 'PartitionAlgorithm', {}, product.namespace, false)));
        set(properties, 'partition', reference(partition));
      }
      set(o, 'physicalProperties', reference(properties));
    }
  }
  return o;
}
function push(o: BinaryObject, name: string, value: BinaryObject) {
  const list = field(o, name);
  if (list !== undefined && !Array.isArray(list)) throw new Error(`${o.class.name}.${name}은 목록이 아닙니다.`);
  set(o, name, [...(list as BinaryValue[] | undefined ?? []), reference(value)]);
}
function viewSettings(graph: BinaryGraph) {
  return object(graph, 'ViewSettings', { cellsToShow: ['name', 'dataType', 'nullable'], showColumnHeader: true, showAltTableName: true, columnFilter: 'all' });
}

/** Serializes schema-defined containment and references; never embeds a vendor model. */
function graphXml(graph: BinaryGraph): Uint8Array {
  const byId = new Map(graph.objects.map(o => [o.id, o]));
  const packages = [...new Set(graph.objects.map(o => o.class.packageUri))];
  const prefixes = new Map(packages.map((uri, i) => [uri, uri === namespace ? 'e' : `p${i}`]));
  const paths = new Map<number, string>();
  const refs = (value: BinaryValue): BinaryReference[] => (Array.isArray(value) ? value : [value]).filter(v => v !== null && typeof v === 'object' && 'ref' in v) as BinaryReference[];
  function visit(o: BinaryObject, path: string) {
    if (paths.has(o.id)) throw new Error('XML 포함 관계가 순환하거나 객체 소유자가 중복됩니다.');
    paths.set(o.id, path);
    for (const f of o.features) {
      const def = definitions(o)?.find(d => d.name === f.name);
      if (!def) throw new Error(`XML 직렬화 schema 누락: ${o.class.name}.${f.name}`);
      if (def.transient || def.derived) continue;
      if (def.containment) refs(f.value).forEach((ref, index) => {
        const child = byId.get(ref.ref); if (!child) throw new Error(`XML 참조 누락: ${ref.ref}`);
        visit(child, `${path}/@${f.name}${def.many ? '.' + index : ''}`);
      });
    }
  }
  const root = byId.get(graph.roots[0]!); if (!root || graph.roots.length !== 1) throw new Error('문서는 단일 root 객체가 필요합니다.');
  visit(root, '/');
  const refText = (ref: BinaryReference) => { const o = byId.get(ref.ref); if (!o) throw new Error(`XML 참조 누락: ${ref.ref}`); const result = uuid(o) ?? paths.get(o.id); if (!result) throw new Error('포함되지 않은 외부 참조는 구조 편집을 지원하지 않습니다.'); return result; };
  function element(o: BinaryObject, tag: string, rootElement = false): string {
    if (o.proxy) throw new Error('외부 proxy 객체의 신규 XML 쓰기는 지원하지 않습니다.');
    const attrs: string[] = [], children: string[] = [];
    if (rootElement) {
      attrs.push('xmi:version="2.0"', 'xmlns:xmi="http://www.omg.org/XMI"', 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"', ...packages.map(uri => `xmlns:${prefixes.get(uri)}="${encodeAttribute(uri)}"`));
    } else attrs.push(`xsi:type="${prefixes.get(o.class.packageUri)}:${o.class.name}"`);
    for (const f of o.features) {
      const def = definitions(o)!.find(d => d.name === f.name)!;
      if (def.transient || def.derived) continue;
      if (f.kind === 'FEATURE_MAP') throw new Error('FeatureMap XML 구조 쓰기는 지원하지 않습니다.');
      if (def.containment) {
        for (const ref of refs(f.value)) children.push(element(byId.get(ref.ref)!, f.name));
      } else if (f.kind === 'DATA_LIST') {
        if (!Array.isArray(f.value)) throw new Error(`XML 데이터 목록이 아닙니다: ${o.class.name}.${f.name}`);
        for (const item of f.value) children.push(item === null ? `<${f.name} xsi:nil="true"/>` : `<${f.name}>${encodeAttribute(String(item))}</${f.name}>`);
      } else if (f.value !== null) {
        const value = f.kind.startsWith('EOBJECT') ? refs(f.value).map(refText).join(' ') : Array.isArray(f.value) ? f.value.map(String).join(' ') : String(f.value);
        attrs.push(`${f.name}="${encodeAttribute(value)}"`);
      }
    }
    return children.length ? `<${tag} ${attrs.join(' ')}>\n${children.join('\n')}\n</${tag}>` : `<${tag} ${attrs.join(' ')}/>`;
  }
  return new TextEncoder().encode(`<?xml version="1.1" encoding="UTF-8"?>\n${element(root, `${prefixes.get(root.class.packageUri)}:${root.class.name}`, true)}\n`);
}
export function rebuildNativeDocument(graph: BinaryGraph, container?: ExerdContainer): NativeExerdDocument {
  const result: ExerdContainer = { ...(container ?? { header: { version: [3, 0, 0], qualifier: '20190111-1604' }, metadata: { xml: defaultEntryMetadata(), binary: defaultEntryMetadata() } }), xml: graphXml(graph), binary: writeBinary(graph) };
  return openNativeDocument(writeContainer(result), registry);
}

export interface NewNativeTableOptions { name: string; logicalName?: string; x?: number; y?: number; diagramUuid?: string; schemaUuid?: string }
function addTable(graph: BinaryGraph, options: NewNativeTableOptions) {
  if (!options.name.trim()) throw new Error('테이블 물리명이 필요합니다.');
  const x = options.x ?? 100, y = options.y ?? 100;
  if (![x, y].every(n => Number.isFinite(n) && n >= -2147483648 && n <= 2147483647)) throw new Error('좌표는 32비트 정수 범위 내 유한한 수치여야 합니다.');
  const root = graph.objects.find(o => o.class.name === 'Document')!;
  const opened = field(root, 'openedDiagrams') as BinaryReference[] | undefined;
  const diagram = options.diagramUuid
    ? graph.objects.find(o => uuid(o) === options.diagramUuid && o.class.name === 'Diagram')
    : graph.objects.find(o => o.id === opened?.[0]?.ref && o.class.name === 'Diagram') ?? graph.objects.find(o => o.class.name === 'Diagram');
  if (!diagram) throw new Error('테이블을 추가할 다이어그램이 없습니다.');
  const activeSchema = field(root, 'activeSchema') as BinaryReference | undefined;
  const schema = options.schemaUuid ? graph.objects.find(o => uuid(o) === options.schemaUuid) : activeSchema ? graph.objects.find(o => o.id === activeSchema.ref) : graph.objects.find(o => o.class.name === 'Schema');
  if (!schema || schema.class.name !== 'Schema') throw new Error('테이블을 추가할 스키마가 없습니다.');
  const businessArea = graph.objects.find(o => o.class.name === 'BusinessArea' && (field(o, 'diagrams') as BinaryReference[] | undefined)?.some(ref => ref.ref === diagram.id));
  if (!businessArea) throw new Error('다이어그램의 업무영역을 찾지 못했습니다.');
  if ((field(schema, 'tables') as BinaryReference[] | undefined)?.some(ref => { const table = graph.objects.find(o => o.id === ref.ref); return table && field(table, 'physicalName') === options.name.trim(); })) throw new Error('스키마에 같은 물리명의 테이블이 있습니다.');
  const table = object(graph, 'Table', { logicalName: options.logicalName ?? options.name.trim(), physicalName: options.name.trim() });
  const column = object(graph, 'Column', { logicalName: '식별자', physicalName: 'id', dataType: databaseProduct(graph).defaultType, notNull: 'TRUE' });
  const pk = object(graph, 'PrimaryKeyColumnGroup', { logicalName: `${options.logicalName ?? options.name}_기본키`, physicalName: `pk_${options.name.trim()}` });
  set(pk, 'primaryKeyConstraint', reference(object(graph, 'PrimaryKeyConstraint', { physicalName: `pk_${options.name.trim()}`, logicalName: `${options.logicalName ?? options.name}_기본키` })));
  const membership = object(graph, 'PrimaryKeyMembership', { group: reference(pk), entryIndex: 0, sortType: 'ASC' });
  const entry = object(graph, 'MembershipEntry', { key: reference(pk), value: reference(membership) });
  set(column, 'memberships', [reference(entry)]); set(table, 'columns', [reference(column)]); set(table, 'columnGroups', [reference(pk)]);
  const placement = object(graph, 'TableDiagram', { location: `Point(${Math.trunc(x)}, ${Math.trunc(y)})`, table: reference(table) });
  push(schema, 'tables', table); push(businessArea, 'tables', table); push(diagram, 'diagramEntry', placement);
}

/** A new document built from public protocol facts, with fresh identity for every object. */
export function createNativeDocument(name = '새 모델', options?: CreateNativeOptions): NativeExerdDocument {
  const productId = options?.database.productId ?? 'com.tomato.db.postgresql';
  const product = NATIVE_DATABASE_PRODUCTS.find(p => p.productId === productId);
  if (!product) throw new Error(`신규 모델을 지원하지 않는 DB 제품입니다: ${String(productId)}`);
  const databaseVersion = options?.database.databaseVersion;
  if (databaseVersion !== undefined && (typeof databaseVersion !== 'string' || !databaseVersion.trim())) throw new Error('DB 버전은 비어 있지 않은 문자열이어야 합니다.');
  if (!name.trim()) throw new Error('모델 이름이 필요합니다.');
  const graph: BinaryGraph = { version: 0, roots: [0], objects: [], packages: [{ namespaceURI: namespace, uri: { base: namespace, fragment: '/' } }], consumedBytes: 0 };
  const doc = object(graph, 'Document', { version: '3.3.56.20260820-1610', modelVersion: '3.0.0.20190111-1604', productId, ...(databaseVersion === undefined ? {} : { databaseVersion }), modelType: 'INTEGRATE' });
  const database = object(graph, 'DatabaseModel', { logicalName: name.trim(), physicalName: name.trim() });
  const schema = object(graph, 'Schema', { logicalName: product.defaultSchema, physicalName: product.defaultSchema });
  const area = object(graph, 'BusinessArea', { logicalName: '기본 업무영역', physicalName: 'Main' });
  const diagram = object(graph, 'Diagram', { logicalName: name.trim(), physicalName: 'Main' });
  const config = object(graph, 'Configuration');
  const domains = object(graph, 'DomainDefinition', { productId, version: '3.0.0.20190111-1604' });
  set(config, 'domainDefinition', reference(domains)); set(diagram, 'viewSettings', reference(viewSettings(graph)));
  set(diagram, 'printSettings', reference(object(graph, 'PrintSettings', { marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10, paperKind: 'A4', paperOrientation: 'landscape', header: '${DIAGRAM}', footter: '${PAGENUM}' })));
  set(doc, 'relationManager', reference(object(graph, 'RelationManager'))); set(doc, 'sharedIcons', reference(object(graph, 'SharedIcons')));
  set(doc, 'databaseModel', reference(database)); set(database, 'schema', [reference(schema)]);
  set(doc, 'businessAreas', [reference(area)]); set(area, 'diagrams', [reference(diagram)]);
  set(doc, 'activeBusinessArea', reference(area)); set(doc, 'activeSchema', reference(schema)); set(doc, 'openedDiagrams', [reference(diagram)]); set(doc, 'configuration', reference(config));
  addTable(graph, { name: 'new_table', logicalName: '새 테이블' });
  return rebuildNativeDocument(graph);
}
/** Returns a new document, updating both native representations in one transaction. */
export function appendNativeTable(document: NativeExerdDocument, options: NewNativeTableOptions): NativeExerdDocument {
  const graph = structuredClone(document.graph); addTable(graph, options); return rebuildNativeDocument(graph, document.container);
}

/** Internal graph helpers shared by immutable native structural commands. */
export const nativeGraph = { definitions, field, uuid, reference, set, object, push, viewSettings };
