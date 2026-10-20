import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { auditRepresentations } from '../../src/formats/exerd/consistency';
import { indexXml, patchXmlAttributes } from '../../src/formats/exerd/xml';
import { openNativeDocument } from '../../src/formats/exerd/native-document';
import type { BinaryGraph, BinaryRegistry } from '../../src/formats/exerd/binary';
import schema from '../../src/formats/exerd/schema.generated.json';

const registry = { packages: [{ namespaceURI: 'urn:test', enumerations: [{ name: 'Status', literals: [{ name: 'NONE', literal: '', value: 0 }, { name: 'READY', literal: 'ready', value: 1 }] }], classes: [{ name: 'Record', features: [
  { name: 'UUID', id: 0, kind: 'STRING' }, { name: 'name', id: 1, kind: 'STRING' },
  { name: 'status', id: 2, kind: 'DATA', type: '#//Status' },
  { name: 'enabled', id: 3, kind: 'BOOLEAN' },
  { name: 'scale', id: 4, kind: 'DOUBLE', defaultValueLiteral: '1.0' },
  { name: 'count', id: 5, kind: 'INT' }, { name: 'ratio', id: 6, kind: 'FLOAT' },
  { name: 'computed', id: 7, kind: 'STRING', derived: true },
] }] }] } as BinaryRegistry;
const graph: BinaryGraph = { version: 0, roots: [0], packages: [], consumedBytes: 0, objects: [{ id: 0, class: { packageUri: 'urn:test', name: 'Record' }, features: [
  { name: 'UUID', id: 0, kind: 'STRING', value: 'r' }, { name: 'name', id: 1, kind: 'STRING', value: 'private value' },
  { name: 'ratio', id: 6, kind: 'FLOAT', value: Math.fround(0.1) },
] }] };
const xml = (attributes: string) => indexXml(new TextEncoder().encode(`<Record UUID="r" ${attributes}/>`));

describe('representation consistency audit', () => {
  it('honors explicit and implicit scalar defaults, enum literals and FLOAT precision', () => {
    expect(auditRepresentations({ graph, xml: xml('name="private value" enabled="false" scale="1" count="0" status="" ratio="0.1"') }, registry)).toEqual([]);
  });
  it('detects changed explicit attributes without leaking private values', () => {
    const mismatch = auditRepresentations({ graph, xml: xml('name="changed private value"') }, registry);
    expect(mismatch).toEqual([{ uuid: 'r', className: 'Record', feature: 'name', reason: 'VALUE_MISMATCH' }]);
    expect(JSON.stringify(mismatch)).not.toContain('private value');
  });
  it('rejects invalid enum text and avoids asserting consistency for derived fields', () => {
    expect(auditRepresentations({ graph, xml: xml('status="invalid" computed="ignored"') }, registry)).toEqual([{ uuid: 'r', className: 'Record', feature: 'status', reason: 'INVALID_XML_VALUE' }]);
  });
});

const source = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
describe.skipIf(!existsSync(source))('real reference representation consistency', () => {
  it('accepts the original without false positives and detects a single XML-only physical-name change', () => {
    const doc = openNativeDocument(new Uint8Array(readFileSync(source)), schema as BinaryRegistry);
    expect(auditRepresentations(doc, schema as BinaryRegistry)).toEqual([]);
    const table = doc.graph.objects.find(o => o.class.name === 'Table')!;
    const uuid = table.features.find(f => f.name === 'UUID')!.value as string;
    const changedXml = indexXml(patchXmlAttributes(doc.container.xml, [{ uuid, name: 'physicalName', value: 'XML_ONLY_AUDIT' }]));
    expect(auditRepresentations({ graph: doc.graph, xml: changedXml }, schema as BinaryRegistry)).toEqual([{ uuid, className: 'Table', feature: 'physicalName', reason: 'VALUE_MISMATCH' }]);
  });
});
