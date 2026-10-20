/** Independent, browser-compatible codec for the observed eXERD BinaryIO stream.
 * Class and feature names are in-band; feature value types require a registry.
 * No Java runtime or vendor implementation is included in this module.
 */
export type BinaryKind = 'BOOLEAN' | 'BYTE' | 'CHAR' | 'DOUBLE' | 'FLOAT' | 'INT' | 'LONG' | 'SHORT' | 'STRING' | 'DATA' | 'DATA_LIST' | 'FEATURE_MAP' | `EOBJECT${string}`;
export interface BinaryFeatureDefinition { name: string; id: number; kind: BinaryKind; [key: string]: unknown }
export interface BinaryClassDefinition { name: string; features: BinaryFeatureDefinition[]; [key: string]: unknown }
export interface BinaryRegistry { packages: Array<{ namespaceURI: string; classes: BinaryClassDefinition[]; [key: string]: unknown }> }
export interface BinaryClass { packageUri: string; name: string }
export interface BinaryUri { base: string; fragment: string | null }
export interface BinaryReference { ref: number }
export interface BinaryMapEntry { class: BinaryClass; feature: BinaryFeatureDefinition; value: BinaryValue }
export type BinaryValue = null | string | number | boolean | bigint | BinaryReference | BinaryValue[] | BinaryMapEntry[];
export interface BinaryFeature { id: number; name: string; kind: BinaryKind; value: BinaryValue }
export interface BinaryObject { id: number; class: BinaryClass; features: BinaryFeature[]; proxy?: BinaryUri }
export interface BinaryPackage { namespaceURI: string; uri: BinaryUri | null }
export interface BinaryGraph { version: number; roots: Array<number | null>; objects: BinaryObject[]; packages: BinaryPackage[]; consumedBytes: number }
export class BinaryCodecError extends Error {
  constructor(message: string, public readonly offset?: number) { super(`${message}${offset === undefined ? '' : ` (byte ${offset})`}`); this.name = 'BinaryCodecError'; }
}
const signature = [137, 101, 109, 102, 10, 13, 26, 10];
const referenceKinds = new Set(['EOBJECT', 'EOBJECT_CONTAINER', 'EOBJECT_CONTAINER_PROXY_RESOLVING', 'EOBJECT_PROXY_RESOLVING', 'EOBJECT_LIST', 'EOBJECT_LIST_PROXY_RESOLVING', 'EOBJECT_CONTAINMENT', 'EOBJECT_CONTAINMENT_PROXY_RESOLVING', 'EOBJECT_CONTAINMENT_LIST', 'EOBJECT_CONTAINMENT_LIST_PROXY_RESOLVING']);
const listKind = (kind: string) => kind.startsWith('EOBJECT') && kind.includes('LIST');
const refKind = (kind: string) => referenceKinds.has(kind);

/** Primitives are public for interoperability tests independent of graph traversal. */
export class BinaryReader {
  offset = 0;
  private readonly view: DataView;
  constructor(public readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  private need(n: number) { if (this.offset + n > this.bytes.length) throw new BinaryCodecError('Unexpected end of binary stream', this.offset); }
  byte() { this.need(1); return this.bytes[this.offset++]; }
  signedByte() { const b = this.byte(); return b > 127 ? b - 256 : b; }
  compressedInt() { const first = this.byte(); const width = first >>> 6; let n = first & 63; for (let i = 0; i < width; i++) n = n * 256 + this.byte(); return n - 1; }
  int() { this.need(4); const n = this.view.getInt32(this.offset); this.offset += 4; return n; }
  short() { this.need(2); const n = this.view.getInt16(this.offset); this.offset += 2; return n; }
  char() { this.need(2); const n = this.view.getUint16(this.offset); this.offset += 2; return n; }
  long() { this.need(8); const n = this.view.getBigInt64(this.offset); this.offset += 8; return n; }
  float() { this.need(4); const n = this.view.getFloat32(this.offset); this.offset += 4; return n; }
  double() { this.need(8); const n = this.view.getFloat64(this.offset); this.offset += 8; return n; }
  count() { const n = this.compressedInt(); if (n < 0 || n > this.bytes.length - this.offset) throw new BinaryCodecError(`Invalid collection length ${n}`, this.offset); return n; }
  string(): string | null {
    const n = this.compressedInt(); if (n === -1) return null;
    if (n < 0 || n > this.bytes.length - this.offset) throw new BinaryCodecError(`Invalid string length ${n}`, this.offset);
    const chunks: string[] = []; let chars: number[] = [];
    let wide = false;
    for (let i = 0; i < n; i++) {
      let code: number;
      if (wide) code = this.char();
      else { code = this.byte(); if (code === 0) { wide = true; code = this.char(); } else if (code >= 128) code += 65280; }
      chars.push(code);
      if (chars.length === 4096) { chunks.push(String.fromCharCode(...chars)); chars = []; }
    }
    chunks.push(String.fromCharCode(...chars)); return chunks.join('');
  }
}
export class BinaryWriter {
  private data: number[] = [];
  byte(n: number) { this.data.push(n & 255); }
  compressedInt(n: number) {
    if (!Number.isInteger(n) || n < -1 || n > 1073741822) throw new BinaryCodecError(`Compressed integer out of range: ${n}`);
    n++; const width = n < 64 ? 0 : n < 16384 ? 1 : n < 4194304 ? 2 : 3;
    this.byte((width << 6) | Math.floor(n / 256 ** width)); for (let i = width - 1; i >= 0; i--) this.byte(Math.floor(n / 256 ** i));
  }
  private number(n: number | bigint, size: number, setter: 'setInt16' | 'setInt32' | 'setFloat32' | 'setFloat64' | 'setBigInt64') {
    const bytes = new Uint8Array(size); const view = new DataView(bytes.buffer);
    if (setter === 'setBigInt64') view.setBigInt64(0, BigInt(n)); else view[setter](0, Number(n));
    for (const b of bytes) this.byte(b);
  }
  int(n: number) { this.number(n, 4, 'setInt32'); }
  short(n: number) { this.number(n, 2, 'setInt16'); }
  char(n: number) { this.byte(n >>> 8); this.byte(n); }
  long(n: bigint) { this.number(n, 8, 'setBigInt64'); }
  float(n: number) { this.number(n, 4, 'setFloat32'); }
  double(n: number) { this.number(n, 8, 'setFloat64'); }
  string(s: string | null) {
    if (s === null) { this.compressedInt(-1); return; }
    this.compressedInt(s.length); let wide = false;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (!wide && (c === 0 || c > 127)) { this.byte(0); wide = true; } if (wide) this.char(c); else this.byte(c); }
  }
  finish() { return Uint8Array.from(this.data); }
}
interface ClassState { class: BinaryClass; features: Map<number, BinaryFeatureDefinition> }
interface PackageState { entry: BinaryPackage; classes: Map<number, ClassState> }

export function readBinary(bytes: Uint8Array, registry: BinaryRegistry): BinaryGraph {
  const r = new BinaryReader(bytes);
  const fail = (message: string): never => { throw new BinaryCodecError(message, r.offset); };
  for (const b of signature) if (r.byte() !== b) fail('Invalid binary EMF signature');
  const version = r.byte(); if (version !== 0) fail(`Unsupported binary version ${version}`);
  const graph: BinaryGraph = { version, roots: [], objects: [], packages: [], consumedBytes: 0 };
  const packages: PackageState[] = []; const uris: string[] = [];
  function uri(): BinaryUri | null {
    const id = r.compressedInt(); if (id === -1) return null;
    if (id === uris.length) { const base = r.string(); if (base === null) fail('Null URI base'); uris.push(base!); }
    else if (id < 0 || id >= uris.length) fail(`Invalid URI reference ${id}`);
    return { base: uris[id], fragment: r.string() };
  }
  function klass(): ClassState {
    const p = r.compressedInt();
    if (p === packages.length) {
      const namespaceURI = r.string(); if (namespaceURI === null) fail('Null package namespace');
      const entry = { namespaceURI: namespaceURI!, uri: uri() }; graph.packages.push(entry); packages.push({ entry, classes: new Map() });
    }
    const pkg = packages[p]; if (!pkg) fail(`Invalid package reference ${p}`);
    const id = r.compressedInt(); if (id < 0) fail(`Invalid class id ${id}`); let state = pkg.classes.get(id);
    if (!state) {
      const name = r.string(); if (name === null) fail('Null class name');
      if (!registry.packages.find(p => p.namespaceURI === pkg.entry.namespaceURI)?.classes.some(c => c.name === name)) fail(`Unknown class schema ${pkg.entry.namespaceURI}#${name}`);
      state = { class: { packageUri: pkg.entry.namespaceURI, name: name! }, features: new Map() }; pkg.classes.set(id, state);
    }
    return state;
  }
  function feature(state: ClassState, id: number): BinaryFeatureDefinition {
    if (id < 0) fail(`Invalid feature id ${id}`);
    let def = state.features.get(id);
    if (!def) {
      const name = r.string();
      const cls = registry.packages.find(p => p.namespaceURI === state.class.packageUri)?.classes.find(c => c.name === state.class.name);
      const definition = cls?.features.find(f => f.name === name);
      if (!definition) fail(`Unknown feature schema ${state.class.packageUri}#${state.class.name}.${name}`);
      def = { ...definition!, id }; state.features.set(id, def);
    }
    return def;
  }
  function value(def: BinaryFeatureDefinition, entry = false): BinaryValue {
    const kind = def.kind;
    if (refKind(kind)) {
      if (listKind(kind) && !entry) return Array.from({ length: r.count() }, () => object());
      return object();
    }
    switch (kind) {
      case 'STRING': case 'DATA': return r.string();
      case 'DATA_LIST': return Array.from({ length: r.count() }, () => r.string());
      case 'BOOLEAN': return r.byte() !== 0;
      case 'BYTE': return r.signedByte();
      case 'CHAR': return String.fromCharCode(r.char());
      case 'SHORT': return r.short();
      case 'INT': return r.int();
      case 'LONG': return r.long();
      case 'FLOAT': return r.float();
      case 'DOUBLE': return r.double();
      case 'FEATURE_MAP': return Array.from({ length: r.count() }, () => { const state = klass(); const def = feature(state, r.compressedInt()); return { class: state.class, feature: def, value: value(def, true) }; });
      default: return fail(`Unsupported feature kind ${kind}`);
    }
  }
  let depth = 0;
  function object(): BinaryReference | null {
    if (++depth > 512) return fail('Object nesting exceeds supported depth 512');
    try { return readObject(); } finally { depth--; }
  }
  function readObject(): BinaryReference | null {
    const id = r.compressedInt(); if (id === -1) return null;
    if (id < graph.objects.length) return { ref: id };
    if (id !== graph.objects.length) return fail(`Nonsequential object definition ${id}`);
    const state = klass(); const obj: BinaryObject = { id, class: state.class, features: [] }; graph.objects.push(obj);
    while (true) {
      const token = r.compressedInt(); if (token === 0) break;
      if (token === -1) { obj.proxy = uri() ?? fail('Null proxy URI'); break; }
      const def = feature(state, token - 1); if (obj.features.some(f => f.id === def.id || f.name === def.name)) fail(`Duplicate feature ${state.class.name}.${def.name}`); obj.features.push({ id: def.id, name: def.name, kind: def.kind, value: value(def) });
    }
    return { ref: id };
  }
  graph.roots = Array.from({ length: r.count() }, () => object()?.ref ?? null);
  graph.consumedBytes = r.offset;
  if (r.offset !== bytes.length) fail(`Trailing binary data: ${bytes.length - r.offset} bytes`);
  return graph;
}

/** Encodes the editable graph anew. It never retains or returns input bytes. */
export function writeBinary(graph: BinaryGraph): Uint8Array {
  if (graph.version !== 0) throw new BinaryCodecError(`Unsupported binary version ${graph.version}`);
  const w = new BinaryWriter(); for (const b of signature) w.byte(b); w.byte(graph.version);
  const objects = new Map(graph.objects.map(o => [o.id, o]));
  if (objects.size !== graph.objects.length) throw new BinaryCodecError('Duplicate object ids');
  const classFeatures = new Map<string, Map<number, { name: string; kind: BinaryKind }>>();
  for (const obj of graph.objects) {
    if (!Number.isSafeInteger(obj.id) || obj.id < 0) throw new BinaryCodecError(`Invalid object id ${obj.id}`);
    const key = obj.class.packageUri + '#' + obj.class.name;
    let schema = classFeatures.get(key); if (!schema) { schema = new Map(); classFeatures.set(key, schema); }
    const ids = new Set<number>(); const names = new Set<string>();
    for (const f of obj.features) {
      if (!Number.isSafeInteger(f.id) || f.id < 0) throw new BinaryCodecError(`Invalid feature id ${f.id}`);
      if (ids.has(f.id) || names.has(f.name)) throw new BinaryCodecError(`Duplicate feature ${obj.class.name}.${f.name}`);
      const known = schema.get(f.id);
      if (known && (known.name !== f.name || known.kind !== f.kind)) throw new BinaryCodecError(`Conflicting feature schema ${key}.${f.name}`);
      if ([...schema.entries()].some(([id, def]) => def.name === f.name && id !== f.id)) throw new BinaryCodecError(`Conflicting feature id ${key}.${f.name}`);
      schema.set(f.id, { name: f.name, kind: f.kind });
      ids.add(f.id); names.add(f.name);
    }
    if (obj.proxy && obj.features.length) throw new BinaryCodecError('Proxy object cannot carry persisted features');
  }
  const objectIds = new Map<number, number>(); const uriIds = new Map<string, number>();
  const packages = new Map<string, { id: number; classes: Map<string, { id: number; features: Set<number> }> }>();
  function uri(u: BinaryUri | null) { if (u === null) { w.compressedInt(-1); return; } let id = uriIds.get(u.base); if (id === undefined) { id = uriIds.size; uriIds.set(u.base, id); w.compressedInt(id); w.string(u.base); } else w.compressedInt(id); w.string(u.fragment); }
  function klass(c: BinaryClass) {
    let pkg = packages.get(c.packageUri);
    if (!pkg) { pkg = { id: packages.size, classes: new Map() }; packages.set(c.packageUri, pkg); w.compressedInt(pkg.id); w.string(c.packageUri); uri(graph.packages.find(p => p.namespaceURI === c.packageUri)?.uri ?? { base: c.packageUri, fragment: null }); }
    else w.compressedInt(pkg.id);
    let cls = pkg.classes.get(c.name);
    if (!cls) { cls = { id: pkg.classes.size, features: new Set() }; pkg.classes.set(c.name, cls); w.compressedInt(cls.id); w.string(c.name); } else w.compressedInt(cls.id);
    return cls;
  }
  function feature(state: { features: Set<number> }, f: {id:number;name:string}) { if (!state.features.has(f.id)) { state.features.add(f.id); w.string(f.name); } }
  function value(kind: BinaryKind, v: BinaryValue, entry = false) {
    if (refKind(kind)) {
      if (listKind(kind) && !entry) { const list = v as BinaryValue[]; w.compressedInt(list.length); for (const ref of list) object(ref as BinaryReference | null); }
      else object(v as BinaryReference | null);
      return;
    }
    switch (kind) {
      case 'STRING': case 'DATA': w.string(v as string | null); return;
      case 'DATA_LIST': { const list = v as Array<string | null>; w.compressedInt(list.length); for (const s of list) w.string(s); return; }
      case 'BOOLEAN': w.byte(v ? 1 : 0); return;
      case 'BYTE': w.byte(v as number); return;
      case 'CHAR': w.char((v as string).charCodeAt(0)); return;
      case 'SHORT': w.short(v as number); return;
      case 'INT': w.int(v as number); return;
      case 'LONG': w.long(v as bigint); return;
      case 'FLOAT': w.float(v as number); return;
      case 'DOUBLE': w.double(v as number); return;
      case 'FEATURE_MAP': { const entries = v as BinaryMapEntry[]; w.compressedInt(entries.length); for (const e of entries) { const state = klass(e.class); w.compressedInt(e.feature.id); feature(state, e.feature); value(e.feature.kind, e.value, true); } return; }
      default: throw new BinaryCodecError(`Unsupported feature kind ${kind}`);
    }
  }
  let depth = 0;
  function object(ref: BinaryReference | null) {
    if (++depth > 512) throw new BinaryCodecError('Object nesting exceeds supported depth 512');
    try { writeObject(ref); } finally { depth--; }
  }
  function writeObject(ref: BinaryReference | null) {
    if (ref === null) { w.compressedInt(-1); return; }
    const existing = objectIds.get(ref.ref); if (existing !== undefined) { w.compressedInt(existing); return; }
    const obj = objects.get(ref.ref); if (!obj) throw new BinaryCodecError(`Dangling object reference ${ref.ref}`);
    const id = objectIds.size; objectIds.set(ref.ref, id); w.compressedInt(id);
    const state = klass(obj.class);
    if (obj.proxy) { w.compressedInt(-1); uri(obj.proxy); return; }
    for (const f of obj.features) { w.compressedInt(f.id + 1); feature(state, f); value(f.kind, f.value); }
    w.compressedInt(0);
  }
  w.compressedInt(graph.roots.length); for (const id of graph.roots) object(id === null ? null : { ref: id });
  if (objectIds.size !== graph.objects.length) throw new BinaryCodecError(`Unreachable objects would be lost: ${graph.objects.length - objectIds.size}`);
  return w.finish();
}
