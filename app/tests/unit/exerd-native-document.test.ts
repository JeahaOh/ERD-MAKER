import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import registryJson from '../../src/formats/exerd/schema.generated.json';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import { editNativeAttributes, openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { decodeAttribute, encodeAttribute, indexXml, patchXmlAttributes } from '../../src/formats/exerd/xml';
import { readContainer, writeContainer } from '../../src/formats/exerd/container';
import { createNativeDocument } from '../../src/formats/exerd/create';

const registry = registryJson as BinaryRegistry;
const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);
describe('native attribute transaction boundaries', () => {
  it('requires a structure command even when a reference is cleared', () => {
    const doc = createNativeDocument('검증');
    const table = doc.graph.objects.find(o => o.class.name === 'Table')!;
    const uuid = String(table.features.find(f => f.name === 'UUID')!.value);
    expect(() => editNativeAttributes(doc, registry, [{ uuid, name: 'columns', value: null }])).toThrow('구조');
  });
  it('refuses to save unsynchronized public graph mutations', () => {
    const doc = createNativeDocument('검증');
    const table = doc.graph.objects.find(o => o.class.name === 'Table')!;
    table.features.find(f => f.name === 'physicalName')!.value = 'unsynchronized_name';
    expect(() => saveNativeDocument(doc)).toThrow('일치');
  });
  it('makes manually edited names explicit without renaming related constraints', () => {
    const doc = createNativeDocument('명명 정책');
    const group = doc.graph.objects.find(o => o.class.name === 'PrimaryKeyColumnGroup')!;
    const uuid = String(group.features.find(f => f.name === 'UUID')!.value);
    const constraint = doc.graph.objects.find(o => o.class.name === 'PrimaryKeyConstraint')!;
    const constraintUuid = String(constraint.features.find(f => f.name === 'UUID')!.value);
    const beforeName = constraint.features.find(f => f.name === 'physicalName')?.value;
    const changed = editNativeAttributes(doc, registry, [{ uuid, name: 'physicalName', value: 'custom_index' }]);
    expect(changed.byUuid.get(uuid)!.features.find(f => f.name === 'derivedPhysicalName')?.value).toBe(false);
    expect(changed.byUuid.get(constraintUuid)!.features.find(f => f.name === 'physicalName')?.value).toBe(beforeName);
  });
});
describe('lossless XML source editing', () => {
  const xml = `<?xml version="1.1"?><e:Document xmlns:e="http://exerd.tomato.com/model" UUID="doc"><!-- a & b --><table UUID='t' name='A &amp; B' unknown="keep > me"><![CDATA[<unchanged>]]></table></e:Document>`;
  it('retains unknown fields, comments, quote style, CDATA and untouched source spans', () => {
    const changed = patchXmlAttributes(bytes(xml), [{ uuid: 't', name: 'name', value: `한글 é 😀 ' " & < >\n\t` }]);
    const element = indexXml(changed).byUuid.get('t')!;
    expect(element.attributes.find(a => a.name === 'name')!.value).toBe(`한글 é 😀 ' " & < >\n\t`);
    expect(text(changed)).toContain(`unknown="keep > me"><![CDATA[<unchanged>]]>`);
    expect(text(changed)).toContain('<!-- a & b -->');
    expect(text(changed)).toContain("name='");
  });
  it('adds multiple absent attributes and removes explicit values without rewriting the element', () => {
    const changed = patchXmlAttributes(bytes(xml), [{ uuid: 't', name: 'name', value: null }, { uuid: 't', name: 'logicalName', value: '논리명' }, { uuid: 't', name: 'comment', value: '설명' }]);
    const e = indexXml(changed).byUuid.get('t')!;
    expect(e.attributes.find(a => a.name === 'name')).toBeUndefined();
    expect(e.attributes.find(a => a.name === 'comment')?.value).toBe('설명');
    expect(text(changed)).toContain('unknown="keep > me"');
  });
  it('preserves UTF-8 BOM and distinguishes literal whitespace from character references', () => {
    expect(decodeAttribute('A\r\nB\tC&#xA;D')).toBe('A B C\nD');
    expect(encodeAttribute('é😀\r\n')).toBe('é😀&#xd;&#xa;');
    const bom = bytes('\uFEFF' + xml);
    expect(patchXmlAttributes(bom, [])).toEqual(bom);
  });
  it('rejects invalid XML, identity changes, duplicate edits, missing objects, entities and invalid Unicode', () => {
    expect(() => indexXml(bytes('<root>'))).toThrow();
    expect(() => indexXml(bytes('<!DOCTYPE x [<!ENTITY hi "x">]><root/>'))).toThrow('DTD');
    expect(() => patchXmlAttributes(bytes(xml), [{ uuid: 't', name: 'UUID', value: 'other' }])).toThrow('식별자');
    expect(() => patchXmlAttributes(bytes(xml), [{ uuid: 'missing', name: 'name', value: 'x' }])).toThrow('UUID');
    expect(() => patchXmlAttributes(bytes(xml), [{ uuid: 't', name: 'name', value: 'x' }, { uuid: 't', name: 'name', value: 'y' }])).toThrow('중복');
    expect(() => encodeAttribute('\u0000')).toThrow();
    expect(() => encodeAttribute('\ud800')).toThrow();
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('complete user document, XML and binary synchronized', () => {
  it('rejects unknown model versions and invalid enum/custom values before writing a file', () => {
    const doc = openNativeDocument(readFileSync(source), registry);
    const column = doc.graph.objects.find(o => o.class.name === 'Column')!;
    const uuid = String(column.features.find(f => f.name === 'UUID')!.value);
    expect(() => editNativeAttributes(doc, registry, [{ uuid, name: 'notNull', value: 'MAYBE' }])).toThrow('BooleanEnum');
    const placement = doc.graph.objects.find(o => o.class.name === 'TableDiagram')!;
    const p = String(placement.features.find(f => f.name === 'UUID')!.value);
    expect(() => editNativeAttributes(doc, registry, [{ uuid: p, name: 'location', value: 'not a point' }])).toThrow('Point');
    const badVersion = readContainer(readFileSync(source)); badVersion.header.version = [999, 0, 0];
    expect(() => openNativeDocument(writeContainer(badVersion), registry)).toThrow('버전');
  });
  it('retains all binary objects and all XML UUIDs on a no-edit reserialization', () => {
    const doc = openNativeDocument(readFileSync(source), registry);
    expect(doc.graph.objects.length).toBe(36057); expect(doc.xml.byUuid.size).toBe(34853);
    const read = openNativeDocument(saveNativeDocument(doc), registry);
    const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
    expect(digest(read.container.binary)).toBe(digest(doc.container.binary));
    expect(digest(read.container.xml)).toBe(digest(doc.container.xml));
  });
  it('edits present and absent properties in both representations, preserving the original document', () => {
    const doc = openNativeDocument(readFileSync(source), registry);
    const table = doc.graph.objects.find(o => o.class.name === 'Table' && o.features.some(f => f.name === 'logicalName'))!;
    const uuid = String(table.features.find(f => f.name === 'UUID')!.value);
    const before = table.features.find(f => f.name === 'logicalName')!.value;
    const value = 'ERD Maker 검증 é 😀 & "\n두 번째 줄';
    const changed = editNativeAttributes(doc, registry, [{ uuid, name: 'logicalName', value }, { uuid, name: 'comment', value: '원본 코드 재열기 검증' }]);
    expect(changed.byUuid.get(uuid)!.features.find(f => f.name === 'logicalName')!.value).toBe(value);
    expect(changed.xml.byUuid.get(uuid)!.attributes.find(a => a.name === 'logicalName')!.value).toBe(value);
    expect(changed.byUuid.get(uuid)!.features.find(f => f.name === 'comment')!.value).toBe('원본 코드 재열기 검증');
    expect(changed.graph.objects.length).toBe(doc.graph.objects.length);
    expect(table.features.find(f => f.name === 'logicalName')!.value).toBe(before);
  });
});
