import { unzipSync, zipSync, strToU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { decodeAttribute, encodeAttribute, indexXml } from '../exerd/xml';
import {
  decodeXmlText,
  openTermDictionary,
  setTermDelimiters,
  type TermDictionary,
} from './dictionary';

const headers = ['용어명', '물리명', '설명', '물리 설명', '동의어', '물리 동의어', '태그'];
const rowsOf = (d: TermDictionary): string[][] => [
  headers,
  ...d.terms.map((t) => [
    t.name,
    t.physicalName,
    t.description,
    t.physicalDescription,
    JSON.stringify(t.synonyms),
    JSON.stringify(t.physicalSynonyms),
    JSON.stringify(t.tags.map((id) => d.tags.find((tag) => tag.id === id)!.name)),
  ]),
];
const list = (s = ''): string[] => {
  if (!s.trim()) return [];
  if (s.trim().startsWith('[')) {
    const v: unknown = JSON.parse(s);
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))
      throw new Error('동의어·태그 목록은 문자열 배열이어야 합니다.');
    return v;
  }
  return s
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
};
function dictionaryFromRows(
  rows: string[][],
  tags: string[][] = [],
  delimiters: string[][] = [],
): TermDictionary {
  const aliases = [
    ['용어명', '논리명', 'name'],
    ['물리명', '약어', 'physicalName'],
    ['설명', 'description'],
    ['물리 설명', 'physicalDescription'],
    ['동의어', 'synonyms'],
    ['물리 동의어', 'physicalSynonyms'],
    ['태그', 'tags'],
  ];
  const head = rows[0]?.map((v) => v.replace(/^\uFEFF/, '').trim()) || [];
  const indices = aliases.map((names) => head.findIndex((h) => names.includes(h)));
  if (aliases.some((names) => head.filter((h) => names.includes(h)).length > 1))
    throw new Error('같은 의미의 열 제목이 중복됐습니다.');
  if (indices[0] < 0 || indices[1] < 0) throw new Error('용어명·물리명 열이 필요합니다.');
  if (rows.length > 20001) throw new Error('한 번에 20,000개 용어까지만 가져올 수 있습니다.');
  const names = new Set<string>(),
    tagNames = new Map<string, string>();
  for (const [name, description = ''] of tags.slice(1)) {
    if (!name?.trim()) continue;
    if (tagNames.has(name)) throw new Error('태그 이름이 중복됐습니다.');
    tagNames.set(name, description);
  }
  const data = rows
    .slice(1)
    .filter((r) => r.some((v) => v.trim()))
    .map((r) => {
      const values = indices.map((i) => (i < 0 ? '' : r[i] || ''));
      if (!values[0].trim() || !values[1].trim() || names.has(values[0].normalize('NFC')))
        throw new Error('용어명·물리명이 비어 있거나 용어명이 중복됐습니다.');
      names.add(values[0].normalize('NFC'));
      const attached = list(values[6]);
      attached.forEach((t) => {
        if (!tagNames.has(t)) tagNames.set(t, '');
      });
      return { values, attached };
    });
  const tagIds = new Map([...tagNames.keys()].map((n, i) => [n, i]));
  const terms = data
    .map(
      ({ values: v, attached }) =>
        `<term name="${encodeAttribute(v[0])}" physicalName="${encodeAttribute(v[1])}" description="${encodeAttribute(v[2])}" physicalDescription="${encodeAttribute(v[3])}"${attached.length ? ` tag="${attached.map((n) => `//@tag.${tagIds.get(n)}`).join(' ')}"` : ''}>${list(
          v[4],
        )
          .map((s) => `<synonyms>${encodeAttribute(s)}</synonyms>`)
          .join('')}${list(v[5])
          .map((s) => `<physicalSynonyms>${encodeAttribute(s)}</physicalSynonyms>`)
          .join('')}</term>`,
    )
    .join('');
  const tagXml = [...tagNames]
    .map(
      ([name, description]) =>
        `<tag name="${encodeAttribute(name)}" description="${encodeAttribute(description)}"/>`,
    )
    .join('');
  const dictionary = openTermDictionary(
    `<?xml version="1.0" encoding="UTF-8"?><tm:TermDictionary xmlns:tm="http://exerd.com/term-model" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.1">${terms}${tagXml}</tm:TermDictionary>`,
  );
  const policies = delimiters
    .slice(1)
    .filter((r) => r[0])
    .map(([logicalNameDelimiter, physicalNameDelimiter = '']) => ({
      logicalNameDelimiter,
      physicalNameDelimiter,
    }));
  return policies.length ? setTermDelimiters(dictionary, policies) : dictionary;
}
export function exportTermCsv(d: TermDictionary): string {
  // Format marker makes the spreadsheet-injection escaping reversible.
  const quote = (s: string) =>
    '"' + (/^[\t=+\-@]/.test(s) ? '\t' + s : s).replaceAll('"', '""') + '"';
  return (
    '\uFEFF#ERD-MAKER-TERMS-CSV-1\r\n' +
    rowsOf(d)
      .map((row) => row.map(quote).join(','))
      .join('\r\n')
  );
}
export function importTermCsv(source: string): TermDictionary {
  if (source.length > 16 * 1024 * 1024) throw new Error('CSV가 너무 큽니다.');
  let input = source.replace(/^\uFEFF/, ''),
    escaped = false;
  if (input.startsWith('#ERD-MAKER-TERMS-CSV-1')) {
    input = input.slice(input.indexOf('\n') + 1);
    escaped = true;
  }
  const rows: string[][] = [],
    row: string[] = [];
  let value = '',
    quoted = false,
    closed = false;
  for (let i = 0; i <= input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else if (c === undefined) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
      else value += c;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (c === ',' || c === '\r' || c === '\n' || c === undefined) {
      row.push(escaped && value.startsWith('\t') ? value.slice(1) : value);
      value = '';
      closed = false;
      if (c !== ',') {
        rows.push([...row]);
        row.length = 0;
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else {
      if (closed || c === '"') throw new Error('잘못된 CSV 구분 형식입니다.');
      value += c;
    }
  }
  return dictionaryFromRows(rows);
}
const col = (i: number) => {
  let s = '';
  for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};
export function exportTermXlsx(d: TermDictionary): Uint8Array {
  const sheets = [
    rowsOf(d),
    [['태그', '설명'], ...d.tags.map((t) => [t.name, t.description])],
    [
      ['논리 구분자', '물리 구분자'],
      ...d.delimiters.map((t) => [t.logicalNameDelimiter, t.physicalNameDelimiter]),
    ],
  ];
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: Record<string, Uint8Array> = {};
  const add = (name: string, xml: string) =>
    (files[name] = strToU8('<?xml version="1.0" encoding="UTF-8"?>' + xml));
  add(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  );
  add(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    'xl/workbook.xml',
    `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${['Terms', 'Tags', 'Delimiters'].map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  );
  sheets.forEach((rows, i) =>
    add(
      `xl/worksheets/sheet${i + 1}.xml`,
      `<worksheet xmlns="${ns}"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t xml:space="preserve">${encodeAttribute(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`,
    ),
  );
  return zipSync(files);
}
export function importTermXlsx(bytes: Uint8Array): TermDictionary {
  if (bytes.length > 16 * 1024 * 1024) throw new Error('XLSX는 16MiB 이하만 가져올 수 있습니다.');
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: (info) => {
      total += info.originalSize;
      count++;
      if (total > 32 * 1024 * 1024 || info.originalSize > 16 * 1024 * 1024 || count > 1000)
        throw new Error('압축 해제 크기 제한을 초과했습니다.');
      return true;
    },
  });
  const xml = (name: string) => {
    if (!files[name]) throw new Error(`XLSX 필수 항목이 없습니다: ${name}`);
    indexXml(files[name]);
    return new XMLParser({
      ignoreAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      removeNSPrefix: true,
      processEntities: false,
    }).parse(new TextDecoder('utf-8', { fatal: true }).decode(files[name]));
  };
  const array = <T>(v: T | T[] | undefined): T[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const value = (v: unknown): string =>
    typeof v === 'string' || typeof v === 'number'
      ? decodeXmlText(String(v))
      : v && typeof v === 'object' && '#text' in v
        ? decodeXmlText(String(v['#text']))
        : '';
  const rich = (v: { t?: unknown; r?: { t: unknown }[] }) =>
    v
      ? value(v.t) +
        array(v.r)
          .map((r) => value(r.t))
          .join('')
      : '';
  const shared = files['xl/sharedStrings.xml']
    ? array(xml('xl/sharedStrings.xml').sst?.si).map((v: unknown) =>
        rich(v as { t?: unknown; r?: { t: unknown }[] }),
      )
    : [];
  const book = array(xml('xl/workbook.xml').workbook?.sheets?.sheet) as Array<
    Record<string, string>
  >;
  const relationships = array(
    xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship,
  ) as Array<Record<string, string>>;
  const read = (sheet: Record<string, string> | undefined): string[][] => {
    if (!sheet) return [];
    const r = relationships.find((r) => r['@_Id'] === sheet['@_id']);
    if (!r || r['@_TargetMode'] === 'External' || !r['@_Type']?.endsWith('/worksheet'))
      throw new Error('외부 또는 알 수 없는 워크시트를 가져올 수 없습니다.');
    const target = r['@_Target'].replace(/^\//, '');
    if (target.split('/').includes('..') || target.includes('\\'))
      throw new Error('워크시트 경로가 올바르지 않습니다.');
    const path = target.startsWith('xl/') ? target : 'xl/' + target;
    const rows = array(xml(path).worksheet?.sheetData?.row) as Array<{
      c?: Array<Record<string, unknown>>;
    }>;
    if (rows.length > 20001) throw new Error('워크시트 행 수 제한을 초과했습니다.');
    return rows.map((row) => {
      const result: string[] = [];
      for (const c of array(row.c)) {
        if (c.f !== undefined)
          throw new Error('수식 셀은 가져올 수 없습니다. 값을 붙여넣은 파일을 사용하세요.');
        const address = String(c['@_r'] || ''),
          m = /^([A-Z]+)\d+$/.exec(address);
        if (!m) throw new Error('셀 주소가 올바르지 않습니다.');
        const index = [...m[1]].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;
        if (index > 255) throw new Error('256개 열을 초과하는 워크시트입니다.');
        if (Object.hasOwn(result, index))
          throw new Error('워크시트에 같은 셀 주소가 중복됐습니다.');
        if (
          c['@_t'] === 's' &&
          (!Number.isInteger(Number(value(c.v))) ||
            Number(value(c.v)) < 0 ||
            shared[Number(value(c.v))] === undefined)
        )
          throw new Error('공유 문자열 참조가 올바르지 않습니다.');
        result[index] =
          c['@_t'] === 's'
            ? (shared[Number(value(c.v))] ?? '')
            : c['@_t'] === 'inlineStr'
              ? rich(c.is as { t?: unknown; r?: { t: unknown }[] })
              : value(c.v);
      }
      return Array.from({ length: result.length }, (_, i) => result[i] || '');
    });
  };
  return dictionaryFromRows(
    read(book.find((s) => s['@_name'] === 'Terms') || book[0]),
    read(book.find((s) => s['@_name'] === 'Tags')),
    read(book.find((s) => s['@_name'] === 'Delimiters')),
  );
}
