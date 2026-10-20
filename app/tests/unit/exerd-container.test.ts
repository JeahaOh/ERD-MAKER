import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { crc32, defaultEntryMetadata, readContainer, writeContainer, type ExerdContainer } from '../../src/formats/exerd/container';

function fixture(): ExerdContainer {
  return { header: { version: [3, 0, 0], qualifier: '20190111-1604' }, xml: new TextEncoder().encode('<?xml version="1.1"?><model name="한국어"/>'), binary: new Uint8Array([0x89, 101, 109, 102, 10, 13, 26, 10, 0, 1, 2, 0xff]), metadata: { xml: defaultEntryMetadata(), binary: defaultEntryMetadata() } };
}
describe('native eXERD container', () => {
  it('uses the standard CRC-32 check vector', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
  it('is independently readable with node:zlib using declared big-endian boundaries', () => {
    const input = fixture(), bytes = writeContainer(input), v = new DataView(bytes.buffer);
    const first = 34 + v.getUint32(22, false), length = Number(v.getBigUint64(first - 8, false));
    let start = first;
    for (const [name, raw, end] of [['xml-content.xml', input.xml, first + length], ['binary-content', input.binary, bytes.length]] as const) {
      const size = v.getUint16(start + 26, true), extra = v.getUint16(start + 28, true);
      expect(new TextDecoder().decode(bytes.subarray(start + 30, start + 30 + size))).toBe(name);
      expect(new Uint8Array(inflateRawSync(bytes.subarray(start + 30 + size + extra, end - 16)))).toEqual(raw);
      expect(v.getUint32(end - 16, true)).toBe(0x08074b50);
      start = end;
    }
    const parsed = readContainer(bytes);
    expect(parsed.header).toEqual(input.header); expect(parsed.xml).toEqual(input.xml); expect(parsed.binary).toEqual(input.binary);
  });
  it('supports stored entries, descriptor-free records and retained ZIP extra fields', () => {
    const input = fixture(); input.metadata.xml = { ...input.metadata.xml, method: 0, flags: 0, extra: new Uint8Array([1, 0, 0, 0]) };
    const parsed = readContainer(writeContainer(input)); expect(parsed).toEqual(input);
  });
  it('rejects truncation, overflowed header lengths, data corruption and under-declared output sizes', () => {
    const bytes = writeContainer(fixture());
    for (const size of [0, 9, 25, 40, bytes.length - 1]) expect(() => readContainer(bytes.subarray(0, size))).toThrow('컨테이너');
    const length = bytes.slice(); new DataView(length.buffer).setBigUint64(39, 0xffffffffffffffffn, false); expect(() => readContainer(length)).toThrow();
    const crc = bytes.slice(); crc[crc.length - 12] ^= 1; expect(() => readContainer(crc)).toThrow('CRC');
    const undersize = bytes.slice(); new DataView(undersize.buffer).setUint32(undersize.length - 4, 3, true); expect(() => readContainer(undersize)).toThrow('CRC');
  });
  const file = 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd';
  it.skipIf(!existsSync(file))('recompresses the actual user file while retaining every XML and binary byte', () => {
    const original = readFileSync(file), parsed = readContainer(original);
    expect(parsed.header.version).toEqual([3, 0, 0]);
    expect(parsed.xml.length).toBe(5_381_614); expect(parsed.binary.length).toBe(2_371_391);
    const serialized = writeContainer(parsed), reread = readContainer(serialized);
    expect(reread.header).toEqual(parsed.header); expect(reread.metadata).toEqual(parsed.metadata);
    const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    expect(digest(reread.xml)).toBe(digest(parsed.xml));
    expect(digest(reread.binary)).toBe(digest(parsed.binary));
    expect(serialized).not.toBe(original);
  });
});
