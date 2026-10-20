import { deflateSync, inflateSync } from 'fflate';

/** Native .exerd is two ZIP local records, preceded by a big-endian model header.
 * It intentionally has no ZIP central directory. XML and binary carry the same model.
 */
export interface ExerdHeader { version: [number, number, number]; qualifier: string }
export interface EntryMetadata {
  neededVersion: number; flags: number; method: 0 | 8;
  dosTime: number; dosDate: number; extra: Uint8Array;
}
export interface ExerdContainer {
  header: ExerdHeader;
  xml: Uint8Array;
  binary: Uint8Array;
  metadata: { xml: EntryMetadata; binary: EntryMetadata };
}
export const CONTAINER_LIMITS = { fileBytes: 128 * 1024 * 1024, entryBytes: 64 * 1024 * 1024 } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAGIC = encoder.encode('eXERD File');
const LOCAL = 0x04034b50, DESCRIPTOR = 0x08074b50;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}
function fail(message: string): never { throw new Error(`eXERD 컨테이너: ${message}`); }
function checkBounds(start: number, end: number, length: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > length) fail('잘린 파일 또는 잘못된 구간 길이입니다.');
}
function readEntry(bytes: Uint8Array, start: number, end: number, expectedName: string) {
  checkBounds(start, end, bytes.length);
  if (end - start < 30) fail(`${expectedName} 엔트리가 잘렸습니다.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(start, true) !== LOCAL) fail(`${expectedName} ZIP 서명이 올바르지 않습니다.`);
  const flags = view.getUint16(start + 6, true), method = view.getUint16(start + 8, true);
  if (flags & ~0x0808) fail('암호화 또는 지원하지 않는 ZIP 플래그입니다.');
  if (method !== 0 && method !== 8) fail(`지원하지 않는 압축 방식 ${method}입니다.`);
  const nameLength = view.getUint16(start + 26, true), extraLength = view.getUint16(start + 28, true);
  const payloadStart = start + 30 + nameLength + extraLength;
  checkBounds(start + 30, payloadStart, end);
  const name = decoder.decode(bytes.subarray(start + 30, start + 30 + nameLength));
  if (name !== expectedName) fail(`예상한 ${expectedName} 대신 ${name} 엔트리가 있습니다.`);
  let payloadEnd = end, crc: number, compressedSize: number, size: number;
  if (flags & 8) {
    if (end - payloadStart < 16) fail(`${name} 데이터 서술자가 없습니다.`);
    payloadEnd = end - 16;
    if (view.getUint32(payloadEnd, true) !== DESCRIPTOR) fail(`${name} 데이터 서술자 서명이 올바르지 않습니다.`);
    crc = view.getUint32(payloadEnd + 4, true);
    compressedSize = view.getUint32(payloadEnd + 8, true);
    size = view.getUint32(payloadEnd + 12, true);
  } else {
    crc = view.getUint32(start + 14, true);
    compressedSize = view.getUint32(start + 18, true);
    size = view.getUint32(start + 22, true);
  }
  if (size > CONTAINER_LIMITS.entryBytes) fail(`${name} 압축 해제 크기가 64 MiB 제한을 초과합니다.`);
  if (compressedSize !== payloadEnd - payloadStart) fail(`${name} 압축 구간 길이가 일치하지 않습니다.`);
  const compressed = bytes.subarray(payloadStart, payloadEnd);
  let raw: Uint8Array;
  try {
    // One extra byte detects an under-declared size while bounding allocation.
    raw = method === 8 ? inflateSync(compressed, { out: new Uint8Array(size + 1) }) : compressed;
  } catch { return fail(`${name} 압축 데이터가 손상되었습니다.`); }
  if (raw.length !== size || crc32(raw) !== crc) fail(`${name} 크기 또는 CRC 검증 실패입니다.`);
  return {
    raw: Uint8Array.from(raw),
    metadata: {
      neededVersion: view.getUint16(start + 4, true), flags, method: method as 0 | 8,
      dosTime: view.getUint16(start + 10, true), dosDate: view.getUint16(start + 12, true),
      extra: Uint8Array.from(bytes.subarray(start + 30 + nameLength, payloadStart)),
    },
  };
}
export function readContainer(bytes: Uint8Array): ExerdContainer {
  if (bytes.length > CONTAINER_LIMITS.fileBytes) fail('파일이 128 MiB 제한을 초과합니다.');
  if (bytes.length < 34 || MAGIC.some((value, index) => bytes[index] !== value)) fail('전용 헤더 서명이 올바르지 않습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const qualifierSize = view.getUint32(22, false);
  if (qualifierSize > 1024) fail('버전 qualifier 길이가 올바르지 않습니다.');
  const headerEnd = 34 + qualifierSize;
  checkBounds(26, headerEnd, bytes.length);
  const qualifier = decoder.decode(bytes.subarray(26, 26 + qualifierSize));
  const xmlEntrySize = view.getBigUint64(26 + qualifierSize, false);
  if (xmlEntrySize > BigInt(bytes.length - headerEnd)) fail('XML 엔트리 길이가 파일을 초과합니다.');
  const xmlEnd = headerEnd + Number(xmlEntrySize);
  const xml = readEntry(bytes, headerEnd, xmlEnd, 'xml-content.xml');
  const binary = readEntry(bytes, xmlEnd, bytes.length, 'binary-content');
  return {
    header: { version: [view.getUint32(10, false), view.getUint32(14, false), view.getUint32(18, false)], qualifier },
    xml: xml.raw, binary: binary.raw,
    metadata: { xml: xml.metadata, binary: binary.metadata },
  };
}
export function defaultEntryMetadata(): EntryMetadata {
  return { neededVersion: 20, flags: 8, method: 8, dosTime: 0, dosDate: 0x21, extra: new Uint8Array() };
}
function writeEntry(name: string, raw: Uint8Array, metadata: EntryMetadata): Uint8Array {
  if (raw.length > CONTAINER_LIMITS.entryBytes) fail(`${name} 엔트리가 64 MiB 제한을 초과합니다.`);
  if (metadata.flags & ~0x0808 || ![0, 8].includes(metadata.method)) fail('지원하지 않는 저장 옵션입니다.');
  if (metadata.extra.length > 65535) fail('ZIP 확장 필드가 너무 큽니다.');
  const content = metadata.method === 8 ? deflateSync(raw, { level: 6 }) : raw;
  const encodedName = encoder.encode(name), descriptorSize = metadata.flags & 8 ? 16 : 0;
  const headerSize = 30 + encodedName.length + metadata.extra.length;
  const bytes = new Uint8Array(headerSize + content.length + descriptorSize);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LOCAL, true); view.setUint16(4, metadata.neededVersion, true);
  view.setUint16(6, metadata.flags, true); view.setUint16(8, metadata.method, true);
  view.setUint16(10, metadata.dosTime, true); view.setUint16(12, metadata.dosDate, true);
  view.setUint16(26, encodedName.length, true); view.setUint16(28, metadata.extra.length, true);
  bytes.set(encodedName, 30); bytes.set(metadata.extra, 30 + encodedName.length); bytes.set(content, headerSize);
  const checksum = crc32(raw);
  if (descriptorSize) {
    const position = headerSize + content.length;
    view.setUint32(position, DESCRIPTOR, true); view.setUint32(position + 4, checksum, true);
    view.setUint32(position + 8, content.length, true); view.setUint32(position + 12, raw.length, true);
  } else {
    view.setUint32(14, checksum, true); view.setUint32(18, content.length, true); view.setUint32(22, raw.length, true);
  }
  return bytes;
}
/** Recompresses both representations. Callers must first synchronize their model contents. */
export function writeContainer(container: ExerdContainer): Uint8Array {
  for (const version of container.header.version) if (!Number.isInteger(version) || version < 0 || version > 0xffffffff) fail('버전 정수가 올바르지 않습니다.');
  const qualifier = encoder.encode(container.header.qualifier);
  if (qualifier.length > 1024) fail('버전 qualifier가 너무 깁니다.');
  const xml = writeEntry('xml-content.xml', container.xml, container.metadata.xml);
  const binary = writeEntry('binary-content', container.binary, container.metadata.binary);
  const headerSize = 34 + qualifier.length;
  if (headerSize + xml.length + binary.length > CONTAINER_LIMITS.fileBytes) fail('저장 결과가 파일 크기 제한을 초과합니다.');
  const bytes = new Uint8Array(headerSize + xml.length + binary.length), view = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  container.header.version.forEach((part, i) => view.setUint32(10 + i * 4, part, false));
  view.setUint32(22, qualifier.length, false); bytes.set(qualifier, 26);
  view.setBigUint64(26 + qualifier.length, BigInt(xml.length), false);
  bytes.set(xml, headerSize); bytes.set(binary, headerSize + xml.length);
  return bytes;
}
