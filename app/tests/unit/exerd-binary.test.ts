import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { BinaryReader, BinaryWriter, readBinary, writeBinary, type BinaryGraph, type BinaryRegistry } from '../../src/formats/exerd/binary';

const registry: BinaryRegistry = { packages: [{ namespaceURI: 'urn:test', classes: [{ name: 'Node', features: [
  { id: 0, name: 'label', kind: 'STRING' }, { id: 1, name: 'children', kind: 'EOBJECT_CONTAINMENT_LIST' }, { id: 2, name: 'link', kind: 'EOBJECT' },
] }] }] };
const fixture = (): BinaryGraph => ({ version: 0, roots: [0], packages: [{ namespaceURI: 'urn:test', uri: { base: 'urn:test', fragment: null } }], consumedBytes: 0, objects: [
  { id: 0, class: { packageUri: 'urn:test', name: 'Node' }, features: [{ id: 0, name: 'label', kind: 'STRING', value: '한글\0😀' }, { id: 1, name: 'children', kind: 'EOBJECT_CONTAINMENT_LIST', value: [{ ref: 1 }, { ref: 2 }] }] },
  { id: 1, class: { packageUri: 'urn:test', name: 'Node' }, features: [{ id: 0, name: 'label', kind: 'STRING', value: 'child' }, { id: 2, name: 'link', kind: 'EOBJECT', value: { ref: 0 } }] },
  { id: 2, class: { packageUri: 'urn:test', name: 'Node' }, features: [], proxy: { base: '../other.exerd', fragment: 'id' } },
] });
const semantic = (g: BinaryGraph) => ({ ...g, consumedBytes: 0 });

describe('eXERD binary primitives', () => {
  it('decodes independent boundary byte vectors for 6-bit prefix lengths and null', () => {
    const r = new BinaryReader(Uint8Array.from([0, 1, 63, 64, 64, 127, 255, 128, 64, 0, 191, 255, 255, 192, 64, 0, 0, 255, 255, 255, 255]));
    expect(Array.from({ length: 9 }, () => r.compressedInt())).toEqual([-1, 0, 62, 63, 16382, 16383, 4194302, 4194303, 1073741822]);
    const w = new BinaryWriter(); for (const v of [-1, 0, 62, 63, 16382, 16383, 4194302, 4194303, 1073741822]) w.compressedInt(v);
    expect(w.finish()).toEqual(r.bytes);
  });
  it('uses UTF-16 code unit lengths and permanent wide encoding after marker', () => {
    const r = new BinaryReader(Uint8Array.from([4, 65, 0, 0xac, 0x00, 0, 66]));
    expect(r.string()).toBe('A가B'); expect(r.offset).toBe(7);
    const w = new BinaryWriter(); w.string('A가B'); expect(w.finish()).toEqual(r.bytes);
    const unicode = new BinaryWriter(); unicode.string('한글\0😀'); expect(new BinaryReader(unicode.finish()).string()).toBe('한글\0😀');
  });
  it('preserves null, Latin-1, signed-byte-derived characters, surrogates and embedded NUL in new strings', () => {
    for (const source of [null, '', 'éÿ', '\uFF80\uFFFF', '\ud800', '😀', 'A\0B']) {
      const w = new BinaryWriter(); w.string(source); expect(new BinaryReader(w.finish()).string()).toBe(source);
    }
  });
  it('rejects premature EOF and unencodable compressed integers', () => {
    expect(() => new BinaryReader(Uint8Array.of(128, 1)).compressedInt()).toThrow('end');
    expect(() => new BinaryWriter().compressedInt(-2)).toThrow('range');
    expect(() => new BinaryWriter().compressedInt(1073741823)).toThrow('range');
  });
});

describe('generic graph codec', () => {
  it('keeps cross references, cycles, list order, proxies, Unicode and deliberate edits', () => {
    const source = fixture(); const bytes = writeBinary(source); const decoded = readBinary(bytes, registry);
    expect(semantic(decoded)).toEqual(source); expect(decoded.consumedBytes).toBe(bytes.length);
    decoded.objects[1].features[0].value = 'edited';
    const output = writeBinary(decoded); expect(output).not.toEqual(bytes);
    expect(readBinary(output, registry).objects[1].features[0].value).toBe('edited');
    expect(readBinary(output, registry).objects[1].features[1].value).toEqual({ ref: 0 });
  });
  it('rejects unsupported schemas, unknown versions, trailing bytes and dangling references', () => {
    const bytes = writeBinary(fixture()); expect(() => readBinary(bytes, { packages: [] })).toThrow('Unknown class schema');
    const badVersion = bytes.slice(); badVersion[8] = 1; expect(() => readBinary(badVersion, registry)).toThrow('version');
    expect(() => readBinary(Uint8Array.from([...bytes, 0]), registry)).toThrow('Trailing');
    const g = fixture(); g.objects[0].features[1].value = [{ ref: 999 }]; expect(() => writeBinary(g)).toThrow('Dangling');
  });
  it('rejects duplicate object IDs, feature IDs and feature names', () => {
    const objects = fixture(); objects.objects.push(objects.objects[0]); expect(() => writeBinary(objects)).toThrow('Duplicate object');
    const ids = fixture(); ids.objects[0].features.push({ ...ids.objects[0].features[0], name: 'different' }); expect(() => writeBinary(ids)).toThrow('Duplicate feature');
    const names = fixture(); names.objects[0].features.push({ ...names.objects[0].features[0], id: 100 }); expect(() => writeBinary(names)).toThrow('Duplicate feature');
  });
  it('refuses to silently discard graph objects unreachable from roots', () => {
    const g = fixture(); g.roots = []; expect(() => writeBinary(g)).toThrow('Unreachable');
  });
});

const realFile = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
const metadata = 'app/src/formats/exerd/schema.generated.json';
describe.skipIf(!existsSync(realFile) || !existsSync(metadata))('private user acceptance fixture (local only)', () => {
  it('consumes all 2,371,391 bytes, reconstructs all 36,057 objects and re-encodes identical bytes', () => {
    const data = readFileSync(realFile); const start = 26 + data.readUInt32BE(22) + 8;
    const binaryStart = start + Number(data.readBigUInt64BE(start - 8));
    const deflateStart = binaryStart + 30 + data.readUInt16LE(binaryStart + 26) + data.readUInt16LE(binaryStart + 28);
    const bytes = new Uint8Array(inflateRawSync(data.subarray(deflateStart)));
    const schema: BinaryRegistry = JSON.parse(readFileSync(metadata, 'utf8'));
    const graph = readBinary(bytes, schema);
    expect(graph.consumedBytes).toBe(2371391); expect(graph.objects).toHaveLength(36057);
    expect(graph.objects.filter(o => o.class.name === 'Table')).toHaveLength(609);
    expect(graph.objects.filter(o => o.class.name === 'Column')).toHaveLength(10045);
    expect(writeBinary(graph)).toEqual(bytes);
    const table = graph.objects.find(o => o.class.name === 'Table')!; const name = table.features.find(f => f.name === 'logicalName')!;
    name.value = 'ERD Maker 검증 ' + name.value;
    const decoded = readBinary(writeBinary(graph), schema);
    expect(decoded.objects[table.id].features.find(f => f.name === 'logicalName')!.value).toBe(name.value);
    expect(decoded.objects).toHaveLength(36057);
  });
});
