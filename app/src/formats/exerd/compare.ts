import generated from './schema.generated.json' with { type: 'json' };
import type { BinaryFeatureDefinition, BinaryMapEntry, BinaryObject, BinaryRegistry, BinaryValue } from './binary';
import type { NativeExerdDocument } from './native-document';

export type NativeChangeKind = 'added' | 'removed' | 'changed' | 'moved';
export interface NativeObjectMatch {
  strategy: 'uuid' | 'qualified-name' | 'containment' | 'key-reference' | 'ordinal' | 'proxy';
  confidence: 'exact' | 'tentative'; beforeUuid?: string; afterUuid?: string;
}
export interface NativeChange {
  id: string; kind: NativeChangeKind; objectType: string; uuid?: string; path: string;
  feature?: string; before?: unknown; after?: unknown;
  risk?: 'additive' | 'destructive' | 'rename' | 'reference' | 'ordering' | 'layout' | 'metadata' | 'review';
  match?: NativeObjectMatch;
}
export interface NativeComparison {
  changes: NativeChange[];
  summary: {
    total: number; added: number; removed: number; changed: number; moved: number;
    beforeObjects: number; afterObjects: number; matchedObjects: number; exactMatches: number;
    tentativeMatches: number; unmatchedBefore: number; unmatchedAfter: number; comparedFeatures: number; durationMs: number;
  };
}
interface Owner { id: number; feature: string; many: boolean; index: number }
interface Node { object: BinaryObject; uuid?: string; type: string; fields: Map<string, BinaryValue>; definitions: Map<string, BinaryFeatureDefinition>; owner?: Owner }
interface Index { nodes: Map<number, Node>; roots: number[]; path(id: number): string }
interface Pair { before: Node; after: Node; canonical: string; match: NativeObjectMatch }
const registry = generated as BinaryRegistry;
const classes = new Map(registry.packages.flatMap(pkg => pkg.classes.map(cls => [pkg.namespaceURI + '#' + cls.name, new Map(cls.features.map(feature => [feature.name, feature]))] as const)));
const nameOf = (node: Node | undefined) => node ? ['physicalName', 'name', 'logicalName'].map(key => node.fields.get(key)).find((value): value is string => typeof value === 'string' && !!value) ?? '' : '';
const refs = (value: BinaryValue | BinaryMapEntry | undefined): number[] => {
  if (Array.isArray(value)) return (value as Array<BinaryValue | BinaryMapEntry>).flatMap(refs);
  if (value && typeof value === 'object') {
    if ('ref' in value) return [value.ref];
    if ('value' in value) return refs(value.value);
  }
  return [];
};
function index(document: NativeExerdDocument): Index {
  const all = new Map<number, Node>();
  for (const object of document.graph.objects) {
    const fields = new Map(object.features.map(feature => [feature.name, feature.value]));
    const rawUuid = fields.get('UUID'), uuid = typeof rawUuid === 'string' && rawUuid ? rawUuid : undefined;
    const type = object.class.packageUri + '#' + object.class.name;
    all.set(object.id, { object, fields, uuid, type, definitions: classes.get(type) ?? new Map() });
  }
  const roots = document.graph.roots.filter((id): id is number => id !== null), nodes = new Map<number, Node>(), stack = [...roots];
  while (stack.length) {
    const id = stack.pop()!; if (nodes.has(id)) continue;
    const node = all.get(id); if (!node) continue; nodes.set(id, node);
    for (const [name, value] of node.fields) {
      const definition = node.definitions.get(name); if (definition?.transient || definition?.derived) continue;
      const targets = refs(value); stack.push(...targets);
      if (definition?.containment) targets.forEach((id, position) => {
        const target = all.get(id); if (target && !target.owner) target.owner = { id: node.object.id, feature: name, many: !!definition.many, index: position };
      });
    }
  }
  const paths = new Map<number, string>();
  function path(id: number, active = new Set<number>()): string {
    const cached = paths.get(id); if (cached) return cached;
    const node = nodes.get(id); if (!node) return `/missing:${id}`;
    if (active.has(id)) return `/cycle:${node.uuid ?? node.object.class.name}`;
    active.add(id);
    let result: string;
    if (node.owner && nodes.has(node.owner.id)) {
      let discriminator = '';
      if (node.uuid) discriminator = `[uuid=${JSON.stringify(node.uuid)}]`;
      else if (node.fields.has('key')) {
        const key = node.fields.get('key'), target = refs(key)[0];
        discriminator = `[key=${JSON.stringify(target === undefined ? key : nodes.get(target)?.uuid ?? nameOf(nodes.get(target)!) ?? `binary:${target}`)}]`;
      } else if (node.owner.many) discriminator = `[${nameOf(node) ? 'name=' + JSON.stringify(nameOf(node)) : `${node.object.class.name}:${node.owner.index}`}]`;
      result = path(node.owner.id, active) + '/' + node.owner.feature + discriminator;
    } else result = `/${node.object.class.name}[${node.uuid ? 'uuid=' + JSON.stringify(node.uuid) : node.object.proxy ? 'proxy=' + JSON.stringify(node.object.proxy) : nameOf(node) || roots.indexOf(id)}]`;
    active.delete(id); paths.set(id, result); return result;
  }
  return { nodes, roots, path };
}
function groupBy<T>(items: Iterable<T>, key: (value: T) => string | undefined): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) { const value = key(item); if (value === undefined) continue; const group = grouped.get(value) ?? []; group.push(item); grouped.set(value, group); }
  return grouped;
}
function enumDefault(node: Node, definition: BinaryFeatureDefinition): unknown {
  const type = String(definition.type ?? ''), name = type.split('#//').at(-1);
  type Enumeration = { name: string; literals: Array<{ literal: string }> };
  const packages = registry.packages as Array<{ namespaceURI: string; enumerations?: Enumeration[] }>;
  const owner = packages.find(pkg => pkg.namespaceURI === node.object.class.packageUri)?.enumerations?.find(value => value.name === name);
  if (owner) return owner.literals[0]?.literal ?? null;
  const alternatives = packages.flatMap(pkg => pkg.enumerations?.filter(value => value.name === name) ?? []);
  return alternatives.length === 1 ? alternatives[0].literals[0]?.literal ?? null : null;
}
function defaultValue(node: Node, name: string): unknown {
  const definition = node.definitions.get(name); if (!definition) return null;
  if (definition.many || definition.kind.endsWith('_LIST')) return [];
  const literal = definition.defaultValueLiteral;
  if (literal !== null && literal !== undefined) {
    if (definition.kind === 'BOOLEAN') return literal === 'true';
    if (definition.kind === 'LONG') { try { return BigInt(String(literal)); } catch { return literal; } }
    if (['BYTE', 'SHORT', 'INT', 'FLOAT', 'DOUBLE'].includes(definition.kind)) return Number(literal);
    return literal;
  }
  if (definition.kind === 'BOOLEAN') return false;
  if (definition.kind === 'LONG') return 0n;
  if (['BYTE', 'SHORT', 'INT', 'FLOAT', 'DOUBLE'].includes(definition.kind)) return 0;
  if (definition.kind === 'CHAR') return '\0';
  if (definition.kind === 'DATA') return enumDefault(node, definition);
  return null;
}
const field = (node: Node, name: string) => node.fields.has(name) ? node.fields.get(name) : defaultValue(node, name);
const persisted = (node: Node, name: string) => name !== 'UUID' && !node.definitions.get(name)?.transient && !node.definitions.get(name)?.derived;
const hash = (value: string) => { let result = 2166136261; for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619); return (result >>> 0).toString(16).padStart(8, '0'); };

/** Read-only whole-model semantic comparison. UUID matches are authoritative;
 * external name/containment/ordinal matches expose tentative confidence explicitly.
 * Stable EMap keys prevent array URI shifts from inventing unrelated changes.
 * This function intentionally does not merge or splice binary graphs.
 */
export function compareNativeDocuments(beforeDocument: NativeExerdDocument, afterDocument: NativeExerdDocument): NativeComparison {
  const started = performance.now(), before = index(beforeDocument), after = index(afterDocument);
  const beforePairs = new Map<number, Pair>(), afterPairs = new Map<number, Pair>(), pairs: Pair[] = [];
  function pair(left: Node, right: Node, strategy: NativeObjectMatch['strategy'], exact = false): boolean {
    if (beforePairs.has(left.object.id) || afterPairs.has(right.object.id)) return false;
    if (strategy !== 'uuid' && left.type !== right.type) return false;
    const match: NativeObjectMatch = { strategy, confidence: exact ? 'exact' : 'tentative', ...(left.uuid ? { beforeUuid: left.uuid } : {}), ...(right.uuid ? { afterUuid: right.uuid } : {}) };
    const value = { before: left, after: right, canonical: `object:${pairs.length}`, match };
    pairs.push(value); beforePairs.set(left.object.id, value); afterPairs.set(right.object.id, value); return true;
  }
  function uniquePass(
    left: Iterable<Node>, right: Iterable<Node>, key: (node: Node, side: 'before' | 'after') => string | undefined,
    strategy: NativeObjectMatch['strategy'], confidence: (left: Node, right: Node) => boolean = () => false,
  ): number {
    const leftGroups = groupBy(left, node => beforePairs.has(node.object.id) ? undefined : key(node, 'before'));
    const rightGroups = groupBy(right, node => afterPairs.has(node.object.id) ? undefined : key(node, 'after'));
    let count = 0;
    for (const [key, values] of leftGroups) { const candidates = rightGroups.get(key); if (values.length === 1 && candidates?.length === 1 && pair(values[0], candidates[0], strategy, confidence(values[0], candidates[0]))) count++; }
    return count;
  }
  uniquePass(before.nodes.values(), after.nodes.values(), node => node.uuid, 'uuid', () => true);
  uniquePass(before.roots.map(id => before.nodes.get(id)!).filter(Boolean), after.roots.map(id => after.nodes.get(id)!).filter(Boolean), node => node.type, 'containment');
  uniquePass(before.nodes.values(), after.nodes.values(), node => node.object.proxy ? node.type + JSON.stringify(node.object.proxy) : undefined, 'proxy', () => true);
  const paired = (node: Node, side: 'before' | 'after') => (side === 'before' ? beforePairs : afterPairs).get(node.object.id);
  const ownerPair = (node: Node, side: 'before' | 'after') => node.owner && (side === 'before' ? beforePairs : afterPairs).get(node.owner.id);
  const role = (node: Node, side: 'before' | 'after') => { const owner = ownerPair(node, side); return owner && node.owner ? `${owner.canonical}/${node.owner.feature}/${node.type}` : undefined; };
  const exactOwner = (left: Node, right: Node) => !left.uuid && !right.uuid && ownerPair(left, 'before')?.match.confidence === 'exact';
  const keyIdentity = (node: Node, side: 'before' | 'after'): string | undefined => {
    const parent = role(node, side); if (!parent || !node.fields.has('key')) return undefined;
    const value = node.fields.get('key'), targetId = refs(value)[0];
    if (targetId === undefined) return parent + '/key:' + JSON.stringify(value);
    const target = (side === 'before' ? beforePairs : afterPairs).get(targetId);
    return target ? parent + '/key:' + target.canonical : undefined;
  };
  const normalize = (value: unknown, side: 'before' | 'after', display = false): unknown => {
    if (value === undefined) return null;
    if (typeof value === 'bigint') return { bigint: value.toString() };
    if (Array.isArray(value)) return value.map(item => normalize(item, side, display));
    if (value && typeof value === 'object') {
      if ('ref' in value && typeof value.ref === 'number') {
        const index = side === 'before' ? before : after, target = index.nodes.get(value.ref);
        if (!target) return { missingReference: value.ref };
        if (display) return { objectType: target.object.class.name, ...(target.uuid ? { uuid: target.uuid } : { path: index.path(value.ref) }) };
        return { ref: paired(target, side)?.canonical ?? `${side}:${target.uuid ?? index.path(value.ref)}`, type: target.type };
      }
      const source = value as Record<string, unknown>;
      // FeatureMap metadata has a schema feature ID, which is an encoding detail.
      if ('class' in source && 'feature' in source && 'value' in source) {
        const feature = source.feature as { name: string; kind: string };
        return { class: source.class, feature: feature.name, kind: feature.kind, value: normalize(source.value, side, display) };
      }
      return Object.fromEntries(Object.entries(source).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, normalize(value, side, display)]));
    }
    return value;
  };
  let changed: number;
  do {
    changed = uniquePass(before.nodes.values(), after.nodes.values(), (node, side) => node.owner && !node.owner.many ? role(node, side) : undefined, 'containment', exactOwner);
    changed += uniquePass(before.nodes.values(), after.nodes.values(), keyIdentity, 'key-reference', exactOwner);
    changed += uniquePass(before.nodes.values(), after.nodes.values(), (node, side) => { const parent = role(node, side), name = nameOf(node); return parent && name ? parent + '/name:' + name : undefined; }, 'qualified-name', exactOwner);
  } while (changed);
  // Unnamed repeated values can be anchored by their unchanged persisted shape.
  // Changed anonymous elements only use ordinal matching when both lists retain
  // the same cardinality; changed UUID-bearing external objects are not guessed.
  do {
    changed = uniquePass(before.nodes.values(), after.nodes.values(), (node, side) => {
      const parent = role(node, side); if (!parent) return undefined;
      const shape = Object.fromEntries([...node.fields].filter(([name]) => persisted(node, name) && !node.definitions.get(name)?.containment).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, normalize(value, side)]));
      return parent + '/shape:' + JSON.stringify(shape);
    }, 'containment', exactOwner);
    if (changed) {
      let descendants: number;
      do {
        descendants = uniquePass(before.nodes.values(), after.nodes.values(), (node, side) => node.owner && !node.owner.many ? role(node, side) : undefined, 'containment', exactOwner);
        descendants += uniquePass(before.nodes.values(), after.nodes.values(), keyIdentity, 'key-reference', exactOwner);
        descendants += uniquePass(before.nodes.values(), after.nodes.values(), (node, side) => { const parent = role(node, side), name = nameOf(node); return parent && name ? parent + '/name:' + name : undefined; }, 'qualified-name', exactOwner);
      } while (descendants);
    }
  } while (changed);
  const anonymous = (nodes: Iterable<Node>, side: 'before' | 'after') => groupBy([...nodes].filter(node => !node.uuid && !paired(node, side)), node => role(node, side));
  const anonymousBefore = anonymous(before.nodes.values(), 'before'), anonymousAfter = anonymous(after.nodes.values(), 'after');
  for (const [key, left] of anonymousBefore) {
    const right = anonymousAfter.get(key); if (!right || right.length !== left.length) continue;
    left.sort((a, b) => (a.owner?.index ?? 0) - (b.owner?.index ?? 0)); right.sort((a, b) => (a.owner?.index ?? 0) - (b.owner?.index ?? 0));
    left.forEach((node, i) => pair(node, right[i], 'ordinal'));
  }
  const changes: NativeChange[] = [], changeIds = new Set<string>(); let comparedFeatures = 0;
  const risk = (node: Node, feature?: string): NativeChange['risk'] => {
    if (['location', 'manualSize', 'theme', 'textColor', 'backgroundColor', 'viewSettings', 'printSettings'].includes(feature ?? '') || ['Diagram', 'TableDiagram', 'Note', 'ViewSettings', 'PrintSettings'].includes(node.object.class.name)) return 'layout';
    if (['physicalName', 'logicalName', 'name', 'oppositeModeName'].includes(feature ?? '')) return 'rename';
    if (feature === 'comment' || feature === 'version') return 'metadata';
    if (feature && node.definitions.get(feature)?.kind.startsWith('EOBJECT')) return 'reference';
    return 'review';
  };
  function add(change: Omit<NativeChange, 'id'>) {
    const basis = [change.uuid ?? change.path, change.kind, change.feature ?? '$object', change.objectType].join('\0');
    const base = 'change-' + hash(basis); let id = base, suffix = 1;
    while (changeIds.has(id)) id = base + '-' + suffix++;
    changeIds.add(id); changes.push({ id, ...change });
  }
  const snapshot = (node: Node, side: 'before' | 'after') => ({ objectType: node.object.class.name, namespaceURI: node.object.class.packageUri, attributes: Object.fromEntries([...node.fields].filter(([name]) => persisted(node, name)).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, normalize(value, side, true)])) });
  for (const node of before.nodes.values()) if (!beforePairs.has(node.object.id)) add({ kind: 'removed', objectType: node.object.class.name, uuid: node.uuid, path: before.path(node.object.id), before: snapshot(node, 'before'), risk: 'destructive' });
  for (const node of after.nodes.values()) if (!afterPairs.has(node.object.id)) add({ kind: 'added', objectType: node.object.class.name, uuid: node.uuid, path: after.path(node.object.id), after: snapshot(node, 'after'), risk: 'additive' });
  const ownership = (node: Node, side: 'before' | 'after') => {
    if (!node.owner) return null;
    const owner = (side === 'before' ? before : after).nodes.get(node.owner.id);
    return { owner: owner ? paired(owner, side)?.canonical ?? `${side}:${owner.uuid ?? node.owner.id}` : 'missing', feature: node.owner.feature };
  };
  for (const pair of pairs) {
    const left = pair.before, right = pair.after, path = after.path(right.object.id), uuid = right.uuid ?? left.uuid;
    const base = { objectType: right.object.class.name, uuid, path, match: pair.match };
    if (left.type !== right.type) add({ ...base, kind: 'changed', feature: '$class', before: left.type, after: right.type, risk: 'destructive' });
    if (JSON.stringify(ownership(left, 'before')) !== JSON.stringify(ownership(right, 'after'))) add({ ...base, kind: 'moved', feature: '$containment', before: before.path(left.object.id), after: path, risk: 'reference' });
    if (JSON.stringify(left.object.proxy ?? null) !== JSON.stringify(right.object.proxy ?? null)) add({ ...base, kind: 'changed', feature: '$proxy', before: left.object.proxy, after: right.object.proxy, risk: 'reference' });
    const names = [...new Set([...left.fields.keys(), ...right.fields.keys()])].sort();
    for (const name of names) {
      if (!persisted(left, name) || !persisted(right, name)) continue;
      comparedFeatures++;
      const beforeValue = field(left, name), afterValue = field(right, name);
      const normalizedBefore = normalize(beforeValue, 'before'), normalizedAfter = normalize(afterValue, 'after');
      if (JSON.stringify(normalizedBefore) === JSON.stringify(normalizedAfter)) continue;
      const reordered = Array.isArray(normalizedBefore) && Array.isArray(normalizedAfter) && normalizedBefore.length === normalizedAfter.length && JSON.stringify(normalizedBefore.map(value => JSON.stringify(value)).sort()) === JSON.stringify(normalizedAfter.map(value => JSON.stringify(value)).sort());
      add({ ...base, kind: name === 'location' || reordered ? 'moved' : 'changed', feature: name,
        before: normalize(beforeValue, 'before', true), after: normalize(afterValue, 'after', true), risk: reordered ? 'ordering' : risk(right, name) });
    }
  }
  changes.sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind) || (a.feature ?? '').localeCompare(b.feature ?? ''));
  const counts = { added: 0, removed: 0, changed: 0, moved: 0 }; for (const change of changes) counts[change.kind]++;
  return { changes, summary: { total: changes.length, ...counts, beforeObjects: before.nodes.size, afterObjects: after.nodes.size, matchedObjects: pairs.length,
    exactMatches: pairs.filter(pair => pair.match.confidence === 'exact').length, tentativeMatches: pairs.filter(pair => pair.match.confidence === 'tentative').length,
    unmatchedBefore: before.nodes.size - pairs.length, unmatchedAfter: after.nodes.size - pairs.length, comparedFeatures, durationMs: performance.now() - started } };
}
