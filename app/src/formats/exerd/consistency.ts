import type { BinaryFeatureDefinition, BinaryGraph, BinaryObject, BinaryRegistry, BinaryValue } from './binary';
import type { XmlIndex } from './xml';

export interface RepresentationMismatch {
  uuid: string; className: string; feature: string;
  reason: 'MISSING_OBJECT' | 'VALUE_MISMATCH' | 'INVALID_XML_VALUE';
}
interface Enumeration { name: string; literals: Array<{ name: string; literal: string; value: number }> }
interface PackageMetadata { namespaceURI: string; enumerations?: Enumeration[] }
const NUMERIC = new Set(['BYTE', 'SHORT', 'INT', 'LONG', 'FLOAT', 'DOUBLE']);

/** Compare XML's explicitly recorded scalar attributes with the native graph.
 * Scope: UUID-bearing objects and schema-known scalar values only. Reference paths,
 * external proxies, list encoding and attributes omitted from XML require separate
 * graph-level/original-reader validation. No private field values leave this audit.
 */
export function auditRepresentations(document: { graph: BinaryGraph; xml: XmlIndex }, registry: BinaryRegistry): RepresentationMismatch[] {
  const mismatches: RepresentationMismatch[] = [];
  const classes = new Map(registry.packages.flatMap(p => p.classes.map(c => [p.namespaceURI + '#' + c.name, c] as const)));
  const packages = new Map(registry.packages.map(p => [p.namespaceURI, p as PackageMetadata]));
  const values = new Map(document.graph.objects.map(object => [object.id, new Map(object.features.map(f => [f.name, f.value]))]));
  const byUuid = new Map<string, BinaryObject>();
  for (const object of document.graph.objects) {
    const uuid = values.get(object.id)?.get('UUID');
    if (typeof uuid === 'string') byUuid.set(uuid, object);
  }
  const enumeration = (object: BinaryObject, definition: BinaryFeatureDefinition): Enumeration | undefined => {
    const type = String(definition.type ?? '').split('#//').at(-1);
    const local = packages.get(object.class.packageUri)?.enumerations?.find(e => e.name === type);
    if (local) return local;
    const matches = [...packages.values()].flatMap(p => p.enumerations?.filter(e => e.name === type) ?? []);
    return matches.length === 1 ? matches[0] : undefined;
  };
  function defaultValue(object: BinaryObject, definition: BinaryFeatureDefinition): { known: boolean; value?: BinaryValue } {
    const literal = definition.defaultValueLiteral;
    if (typeof literal === 'string') return { known: true, value: literal };
    if (definition.kind === 'BOOLEAN') return { known: true, value: false };
    if (NUMERIC.has(definition.kind)) return { known: true, value: definition.kind === 'LONG' ? 0n : 0 };
    if (definition.kind === 'CHAR') return { known: true, value: '\0' };
    if (definition.kind === 'STRING') return { known: true, value: null };
    if (definition.kind === 'DATA') {
      const literal = enumeration(object, definition)?.literals[0]?.literal;
      // EEnum's implicit default is its first literal; custom datatype defaults
      // are deliberately left unknown unless explicitly declared by the schema.
      if (literal !== undefined) return { known: true, value: literal };
    }
    return { known: false };
  }
  function normalize(object: BinaryObject, definition: BinaryFeatureDefinition, value: BinaryValue | undefined): { valid: boolean; value: unknown } {
    if (value === null || value === undefined) return { valid: true, value: null };
    if (definition.kind === 'BOOLEAN') {
      if (value === true || value === 'true') return { valid: true, value: true };
      if (value === false || value === 'false') return { valid: true, value: false };
      return { valid: false, value: undefined };
    }
    if (definition.kind === 'LONG') {
      try { if (!/^[+-]?\d+$/.test(String(value))) return { valid: false, value: undefined }; return { valid: true, value: BigInt(String(value)) }; }
      catch { return { valid: false, value: undefined }; }
    }
    if (NUMERIC.has(definition.kind)) {
      if (!String(value).trim()) return { valid: false, value: undefined };
      const numeric = Number(value);
      return { valid: Number.isFinite(numeric), value: definition.kind === 'FLOAT' ? Math.fround(numeric) : numeric };
    }
    if (definition.kind === 'DATA') {
      const enumType = enumeration(object, definition);
      if (enumType) {
        const literal = enumType.literals.find(item => item.literal === value);
        return { valid: !!literal, value: literal?.literal };
      }
    }
    return { valid: typeof value === 'string', value };
  }
  for (const [uuid, element] of document.xml.byUuid) {
    const object = byUuid.get(uuid);
    if (!object) { mismatches.push({ uuid, className: '', feature: 'UUID', reason: 'MISSING_OBJECT' }); continue; }
    const definitions = classes.get(object.class.packageUri + '#' + object.class.name)?.features;
    if (!definitions) continue;
    const fieldValues = values.get(object.id)!;
    const byName = new Map(definitions.map(definition => [definition.name, definition]));
    for (const attribute of element.attributes) {
      const definition = byName.get(attribute.name);
      if (!definition || definition.derived || definition.transient || definition.many || definition.kind.startsWith('EOBJECT') || definition.kind === 'FEATURE_MAP') continue;
      const stored = fieldValues.has(attribute.name) ? { known: true, value: fieldValues.get(attribute.name) } : defaultValue(object, definition);
      if (!stored.known) continue;
      const xml = normalize(object, definition, attribute.value);
      const binary = normalize(object, definition, stored.value);
      if (!xml.valid) mismatches.push({ uuid, className: object.class.name, feature: attribute.name, reason: 'INVALID_XML_VALUE' });
      else if (!binary.valid || xml.value !== binary.value) mismatches.push({ uuid, className: object.class.name, feature: attribute.name, reason: 'VALUE_MISMATCH' });
    }
  }
  return mismatches;
}
