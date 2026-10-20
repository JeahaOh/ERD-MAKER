import { XMLValidator } from 'fast-xml-parser';

export interface XmlAttribute { name: string; value: string; start: number; end: number; valueStart: number; valueEnd: number; quote: string }
export interface XmlElement { name: string; start: number; openEnd: number; insertAt: number; end: number; parent: number | null; attributes: XmlAttribute[] }
export interface XmlIndex { text: string; elements: XmlElement[]; byUuid: Map<string, XmlElement> }
export interface AttributeEdit { uuid: string; name: string; value: string | null }
const fail = (message: string): never => { throw new Error(`eXERD XML: ${message}`); };
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
function validCodePoint(n: number) { return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 0xfffe && n !== 0xffff; }
export function decodeAttribute(raw: string): string {
  // Literal whitespace is normalized by XML; numeric character references are not.
  const normalized = raw.replace(/\r\n|[\r\n\t]/g, ' ');
  return normalized.replace(/&([^;\s]*);|&/g, (whole, entity: string | undefined) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity && Object.hasOwn(named, entity)) return named[entity];
    if (entity && /^#(?:x[0-9a-f]+|[0-9]+)$/i.test(entity)) {
      const n = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (validCodePoint(n)) return String.fromCodePoint(n);
    }
    return fail(`허용하지 않는 엔티티 ${whole}입니다.`);
  });
}
export function encodeAttribute(value: string): string {
  let result = '';
  for (const char of value) {
    const n = char.codePointAt(0)!;
    if (!validCodePoint(n)) fail('저장할 수 없는 XML 문자가 포함됐습니다.');
    if (char === '&') result += '&amp;';
    else if (char === '<') result += '&lt;';
    else if (char === '>') result += '&gt;';
    else if (char === '"') result += '&quot;';
    else if (char === "'") result += '&apos;';
    else if (n < 32 || n === 0x7f || n >= 0x80 && n <= 0x9f) result += `&#x${n.toString(16)};`;
    else result += char;
  }
  return result;
}
/** Indexes source spans without reformatting namespaces, numbers, comments or unknown fields. */
export function indexXml(bytes: Uint8Array): XmlIndex {
  let text: string;
  try { text = decoder.decode(bytes); } catch { return fail('UTF-8 인코딩이 올바르지 않습니다.'); }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) fail('DTD 또는 사용자 정의 엔티티는 허용하지 않습니다.');
  const valid = XMLValidator.validate(text);
  if (valid !== true) fail(`잘못된 XML: ${valid.err.msg}`);
  const elements: XmlElement[] = [], stack: number[] = [], byUuid = new Map<string, XmlElement>();
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor); if (start === -1) break;
    if (text.startsWith('<!--', start)) { const end = text.indexOf('-->', start + 4); if (end === -1) fail('잘린 주석입니다.'); cursor = end + 3; continue; }
    if (text.startsWith('<![CDATA[', start)) { const end = text.indexOf(']]>', start + 9); if (end === -1) fail('잘린 CDATA입니다.'); cursor = end + 3; continue; }
    if (text.startsWith('<?', start)) { const end = text.indexOf('?>', start + 2); if (end === -1) fail('잘린 처리 지시문입니다.'); cursor = end + 2; continue; }
    let end = start + 1, quote = '';
    for (; end < text.length; end++) {
      const char = text[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === text.length) fail('잘린 태그입니다.');
    cursor = end + 1;
    if (text[start + 1] === '/') {
      const id = stack.pop(); if (id === undefined) fail('닫는 태그가 일치하지 않습니다.');
      elements[id!].end = cursor; continue;
    }
    const nameMatch = /^[^\s/>]+/.exec(text.slice(start + 1, end));
    if (!nameMatch) fail('요소 이름이 없습니다.');
    const name = nameMatch![0], attributes: XmlAttribute[] = [];
    const selfClosing = text[end - 1] === '/';
    const insertAt = end - (selfClosing ? 1 : 0);
    const source = text.slice(start + 1 + name.length, insertAt);
    const pattern = /([^\s=]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    let attr: RegExpExecArray | null;
    while ((attr = pattern.exec(source))) {
      const attrStart = start + 1 + name.length + attr.index;
      const openingQuote = attr[0].indexOf(attr[2]);
      attributes.push({ name: attr[1], value: decodeAttribute(attr[3]), start: attrStart, end: attrStart + attr[0].length, valueStart: attrStart + openingQuote + 1, valueEnd: attrStart + attr[0].length - 1, quote: attr[2] });
    }
    const element: XmlElement = { name, start, openEnd: cursor, insertAt, end: cursor, parent: stack.at(-1) ?? null, attributes };
    const id = elements.push(element) - 1;
    const uuid = attributes.find(a => a.name === 'UUID')?.value;
    if (uuid) { if (byUuid.has(uuid)) fail(`중복 UUID ${uuid}입니다.`); byUuid.set(uuid, element); }
    if (!selfClosing) stack.push(id);
  }
  if (stack.length) fail('닫히지 않은 요소가 있습니다.');
  return { text, elements, byUuid };
}
/** Applies only requested attribute source-span changes; all other XML text is retained. */
export function patchXmlAttributes(bytes: Uint8Array, edits: AttributeEdit[]): Uint8Array {
  const index = indexXml(bytes), patches: { start: number; end: number; value: string }[] = [];
  const seen = new Set<string>();
  const additions = new Map<number, string>();
  for (const edit of edits) {
    if (!/^[A-Za-z_][\w.:-]*$/.test(edit.name) || edit.name === 'UUID' || edit.name.startsWith('xmlns')) fail('속성 이름 또는 식별자·네임스페이스 변경은 별도 구조 명령이 필요합니다.');
    const key = `${edit.uuid}\0${edit.name}`; if (seen.has(key)) fail('같은 속성의 편집이 중복됐습니다.'); seen.add(key);
    const element = index.byUuid.get(edit.uuid); if (!element) fail(`UUID ${edit.uuid} 요소가 없습니다.`);
    const attribute = element!.attributes.find(a => a.name === edit.name);
    if (attribute) {
      if (edit.value === null) patches.push({ start: attribute.start, end: attribute.end, value: '' });
      else patches.push({ start: attribute.valueStart, end: attribute.valueEnd, value: encodeAttribute(edit.value) });
    } else if (edit.value !== null) additions.set(element!.insertAt, (additions.get(element!.insertAt) || '') + ` ${edit.name}="${encodeAttribute(edit.value)}"`);
  }
  for (const [start, value] of additions) patches.push({ start, end: start, value });
  patches.sort((a, b) => b.start - a.start);
  let text = index.text;
  for (const patch of patches) text = text.slice(0, patch.start) + patch.value + text.slice(patch.end);
  const encoded = encoder.encode(text); indexXml(encoded); return encoded;
}
