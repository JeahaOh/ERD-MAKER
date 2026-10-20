import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { zipSync, strToU8, unzipSync } from 'fflate';
import {
  createTermDictionary,
  openTermDictionary,
  saveTermDictionary,
  upsertTerm,
  upsertTag,
  removeTag,
  setTermDelimiter,
  mergeDictionaries,
} from '../../src/formats/terms/dictionary';
import {
  exportTermCsv,
  importTermCsv,
  exportTermXlsx,
  importTermXlsx,
} from '../../src/formats/terms/exchange';
import {
  defaultNamingPolicy,
  namingProposals,
  reverseEngineerTerms,
  translateTerm,
} from '../../src/formats/terms/naming';
import { createNativeDocument } from '../../src/formats/exerd/create';
import {
  editNativeAttributes,
  saveNativeDocument,
  openNativeDocument,
} from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { mutateNativeDocument } from '../../src/formats/exerd/mutations';
import schema from '../../src/formats/exerd/schema.generated.json';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
const term = (name: string, physicalName: string) => ({
  name,
  physicalName,
  description: '설명 & <내용>\n다음',
  physicalDescription: '',
  synonyms: [] as string[],
  physicalSynonyms: [] as string[],
  tags: [] as string[],
});
function dictionary() {
  let d = createTermDictionary();
  d = upsertTag(d, { name: '표준', description: '공통' });
  d = upsertTerm(d, {
    ...term('고객', 'CUST'),
    synonyms: ['회원'],
    physicalSynonyms: ['CUSTOMER'],
    tags: ['tag:0'],
  });
  d = upsertTerm(d, term('번호', 'ID'));
  return setTermDelimiter(d, ' ', '_');
}
describe('native .xdic dictionary and exchange', () => {
  it('roundtrips terms, synonyms, tags and delimiters while preserving unedited bytes', () => {
    const d = dictionary(),
      read = openTermDictionary(saveTermDictionary(d));
    expect(read.terms).toEqual(d.terms);
    expect(read.delimiters).toEqual(d.delimiters);
    expect(read.tags).toEqual(d.tags);
    expect(saveTermDictionary(read)).toEqual(saveTermDictionary(d));
    expect(read.terms[0].description).toContain('\n');
  });
  it('preserves unknown extension fields, comments, CDATA and unresolved external tag refs on an edit', () => {
    const raw =
      '<?xml version="1.0"?><tm:TermDictionary xmlns:tm="http://exerd.com/term-model" xmlns:custom="urn:custom" version="1.1"><!--keep--><custom:data value="a &amp; b"><![CDATA[<opaque>]]></custom:data><term name="고객" physicalName="CUST" custom:flag="yes" tag="other.xdic#//@tag.0"><synonyms>회원</synonyms></term></tm:TermDictionary>';
    const d = openTermDictionary(raw),
      next = upsertTerm(d, { ...d.terms[0], physicalName: 'CUSTOMER' });
    expect(next.source).toContain('custom:flag="yes"');
    expect(next.source).toContain('other.xdic#//@tag.0');
    expect(next.source).toContain('<!--keep-->');
    expect(next.source).toContain('<![CDATA[<opaque>]]>');
    expect(next.warnings).not.toHaveLength(0);
    expect(d.source).toBe(raw);
  });
  it('rejects referenced-tag deletion unless detached and reindexes remaining local references', () => {
    let d = dictionary();
    d = upsertTag(d, { name: '추가', description: '' });
    d = upsertTerm(d, { ...d.terms[1], tags: ['tag:1'] });
    expect(() => removeTag(d, 'tag:0')).toThrow('사용 중');
    const next = removeTag(d, 'tag:0', true);
    expect(next.tags[0].name).toBe('추가');
    expect(next.terms[0].tags).toEqual([]);
    expect(next.terms[1].tags).toEqual(['tag:0']);
  });
  it('handles href-form tag links and blocks destructive edits with unresolved references', () => {
    const d = openTermDictionary(
      '<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" version="1.1"><term name="연결" physicalName="LINK"><tag href="#//@tag.0"/></term><tag name="참조"/></tm:TermDictionary>',
    );
    expect(d.terms[0].tags).toEqual(['tag:0']);
    expect(() => removeTag(d, 'tag:0')).toThrow('사용 중');
    expect(removeTag(d, 'tag:0', true).terms[0].tags).toEqual([]);
    expect(upsertTerm(d, { ...d.terms[0], physicalName: 'LINKED' }).terms[0].tags).toEqual([
      'tag:0',
    ]);
    const merged = mergeDictionaries(dictionary(), d);
    expect(merged.terms.at(-1)?.tags).toEqual(['tag:1']);
    const external = openTermDictionary(d.source.replace('#//@tag.0', 'other.xdic#//@tag.0'));
    expect(() => removeTag(external, 'tag:0', true)).toThrow('해석하지 못한');
  });
  it('rejects malformed/unsafe XML, unsupported versions and duplicate mutations', () => {
    for (const text of [
      '<!DOCTYPE x [<!ENTITY y "z">]><x/>',
      '<x/>',
      '<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" version="99"/>',
    ])
      expect(() => openTermDictionary(text)).toThrow();
    const d = dictionary();
    expect(() => upsertTerm(d, term('고객', 'OTHER'))).toThrow('같은 용어');
    expect(() => upsertTerm(d, { ...term('새말', 'NEW'), tags: ['tag:99'] })).toThrow('태그');
    expect(() =>
      mergeDictionaries(d, upsertTerm(createTermDictionary(), term('고객', 'DIFFERENT'))),
    ).toThrow('충돌');
  });
  it('keeps app delimiters outside the original Term list and preserves them in app roundtrips', () => {
    const d = dictionary();
    expect(d.source).not.toContain('xsi:type="tm:TermDelimiter"');
    expect(d.source).toContain('ERD-MAKER-TERM-DELIMITERS-V1:');
    expect(openTermDictionary(saveTermDictionary(d)).delimiters).toEqual(d.delimiters);
    expect(() =>
      openTermDictionary(
        '<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><term xsi:type="tm:TermDelimiter" logicalNameDelimiter=" " physicalNameDelimiter="_"/></tm:TermDictionary>',
      ),
    ).toThrow('내부 타입');
  });
  it('merges terms with tags, aliases and unknown term fields without dropping metadata', () => {
    const incoming = openTermDictionary(
      '<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" xmlns:x="urn:extra" version="1.1"><term name="추가" physicalName="ADD" x:flag="keep" tag="//@tag.0"><synonyms>덧붙임</synonyms></term><tag name="새태그" description="태그 설명"/></tm:TermDictionary>',
    );
    const d = mergeDictionaries(dictionary(), incoming);
    expect(d.terms.at(-1)).toMatchObject({ name: '추가', synonyms: ['덧붙임'], tags: ['tag:1'] });
    expect(d.source).toContain('x:flag="keep"');
    expect(d.tags[1].description).toBe('태그 설명');
    expect(d.delimiters).toHaveLength(1);
    expect(mergeDictionaries(dictionary(), dictionary()).terms).toHaveLength(2);
  });
  it('preserves BOM and numeric XML character references without double decoding', () => {
    const bytes = new TextEncoder().encode(
      '\uFEFF<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" version="1.1"><term name="값" physicalName="VALUE" description="A&#xA;B &amp;lt;"/></tm:TermDictionary>',
    );
    const d = openTermDictionary(bytes);
    expect(saveTermDictionary(d)).toEqual(bytes);
    expect(d.terms[0].description).toBe('A\nB &lt;');
    expect(upsertTerm(d, { ...d.terms[0], physicalName: 'VAL' }).terms[0].description).toBe(
      'A\nB &lt;',
    );
  });
  it('exchanges XLSX terms, tags with descriptions and delimiters using literal strings', () => {
    const d = dictionary(),
      r = importTermXlsx(exportTermXlsx(d));
    expect(r.terms).toEqual(d.terms);
    expect(r.tags).toEqual(d.tags);
    expect(r.delimiters.map(({ id, ...v }) => v)).toEqual(d.delimiters.map(({ id, ...v }) => v));
    const special = upsertTerm(d, {
      ...term('수식', 'FORMULA'),
      description: '=HYPERLINK("https://example.invalid")',
    });
    expect(importTermXlsx(exportTermXlsx(special)).terms.at(-1)?.description).toBe(
      special.terms.at(-1)?.description,
    );
    const files = unzipSync(exportTermXlsx(d));
    files['xl/worksheets/sheet1.xml'] = strToU8(
      new TextDecoder().decode(files['xl/worksheets/sheet1.xml']).replace('<is>', '<f>1+1</f><is>'),
    );
    expect(() => importTermXlsx(zipSync(files))).toThrow('수식');
  });
  it('roundtrips quoted/newline CSV and reversibly escapes spreadsheet formulas', () => {
    let d = upsertTerm(createTermDictionary(), {
      ...term('수식', 'FORMULA'),
      description: '=SUM(1,2)\n"text"',
      physicalDescription: '\t+value',
    });
    const csv = exportTermCsv(d);
    expect(csv).toContain('\t=SUM');
    const r = importTermCsv(csv);
    expect(r.terms).toEqual(d.terms);
    expect(() => importTermCsv('용어명,물리명\n"닫히지 않음,ID')).toThrow();
  });
  it('rejects ambiguous headers and invalid XLSX shared-string references instead of inventing blank cells', () => {
    expect(() => importTermCsv('용어명,논리명,물리명\n값,다른값,VALUE')).toThrow('중복');
    const files = unzipSync(exportTermXlsx(dictionary()));
    const source = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
    files['xl/worksheets/sheet1.xml'] = strToU8(
      source.replace('t="inlineStr"', 't="s"').replace('<is>', '<v>999</v><is>'),
    );
    expect(() => importTermXlsx(zipSync(files))).toThrow('공유 문자열');
  });
  it('loads available vendor dictionaries without distributing sample content', () => {
    const path =
      '.analysis/ref/3.3.56/com.tomato.exerd.intro_3.3.56.20260820-1610/nl/ko/examples/study/study.xdic';
    if (!existsSync(path)) return;
    const raw = readFileSync(path),
      d = openTermDictionary(raw);
    expect(d.terms.length).toBeGreaterThan(20);
    expect(saveTermDictionary(d)).toEqual(Uint8Array.from(raw));
  });
});
describe('naming policy preview and atomic model application', () => {
  it('resolves aliases and compounds in both directions, rejects missing and ambiguous words', () => {
    const d = dictionary();
    expect(translateTerm('회원 번호', d, defaultNamingPolicy).value).toBe('CUST_ID');
    expect(translateTerm('고객번호', d, defaultNamingPolicy).value).toBe('CUST_ID');
    expect(translateTerm('customer_ID', d, defaultNamingPolicy, true).value).toBe('고객 번호');
    expect(translateTerm('미등록', d, defaultNamingPolicy).problem).toBeTruthy();
    const ambiguous = upsertTerm(d, { ...term('손님', 'GUEST'), synonyms: ['회원'] });
    expect(translateTerm('회원', ambiguous, defaultNamingPolicy).problem).toContain('여러');
  });
  it('previews and applies a batch, preserves identifiers and external dictionary path, and rejects stale previews', () => {
    let d = createNativeDocument('용어 검증');
    let t = projectNativeDocument(d).allTables[0];
    d = editNativeAttributes(d, schema as BinaryRegistry, [
      { uuid: t.uuid, name: 'logicalName', value: '고객' },
      { uuid: t.columns[0].uuid, name: 'logicalName', value: '번호' },
    ]);
    d = mutateNativeDocument(d, {
      type: 'setTermDictionaryPath',
      path: '/unavailable/original.xdic',
    });
    const proposals = namingProposals(projectNativeDocument(d), dictionary(), defaultNamingPolicy);
    expect(proposals.every((p) => !p.problem)).toBe(true);
    const cmd = {
      type: 'applyNamingPolicy' as const,
      changes: proposals.map((p) => ({
        uuid: p.uuid,
        before: p.before,
        after: p.after,
        logicalName: p.logicalName,
      })),
    };
    const before = saveNativeDocument(d),
      changed = mutateNativeDocument(d, cmd),
      read = openNativeDocument(saveNativeDocument(changed), schema as BinaryRegistry),
      view = projectNativeDocument(read);
    expect(view.allTables[0]).toMatchObject({ uuid: t.uuid, name: 'CUST' });
    expect(view.allTables[0].columns[0]).toMatchObject({
      uuid: t.columns[0].uuid,
      name: 'ID',
      primaryKey: true,
    });
    expect(view.termFilePath).toBe('/unavailable/original.xdic');
    expect(saveNativeDocument(d)).toEqual(before);
    expect(() => mutateNativeDocument(changed, cmd)).toThrow('미리보기');
    expect(reverseEngineerTerms(view).terms).toHaveLength(2);
  });
  it('detects name collisions and rejects an invalid batch without partially applying it', () => {
    let d = createNativeDocument();
    const t = projectNativeDocument(d).allTables[0];
    d = mutateNativeDocument(d, {
      type: 'addColumn',
      tableUuid: t.uuid,
      name: 'second',
      logicalName: '다른 번호',
      dataType: 'BIGINT',
    });
    const columns = projectNativeDocument(d).allTables[0].columns,
      before = saveNativeDocument(d);
    expect(() =>
      mutateNativeDocument(d, {
        type: 'applyNamingPolicy',
        changes: columns.map((c) => ({
          uuid: c.uuid,
          before: c.name,
          after: 'SAME',
          logicalName: c.logicalName,
        })),
      }),
    ).toThrow('충돌');
    expect(saveNativeDocument(d)).toEqual(before);
  });
  it('rejects a naming batch that would leave a CHECK expression referring to the old column', () => {
    let d = createNativeDocument();
    const t = projectNativeDocument(d).allTables[0];
    d = mutateNativeDocument(d, {
      type: 'addCheckConstraint',
      tableUuid: t.uuid,
      name: 'ck_positive',
      expression: '"id" > 0',
    });
    const before = saveNativeDocument(d);
    expect(() =>
      mutateNativeDocument(d, {
        type: 'applyNamingPolicy',
        changes: [
          {
            uuid: t.columns[0].uuid,
            before: 'id',
            after: 'CUSTOMER_ID',
            logicalName: t.columns[0].logicalName,
          },
        ],
      }),
    ).toThrow('CHECK');
    expect(saveNativeDocument(d)).toEqual(before);
  });
  it('indexes a large dictionary once and resolves compounds without scanning every term per query', () => {
    const rows = Array.from(
      { length: 20000 },
      (_, i) => `<term name="단어${i}" physicalName="WORD${i}"/>`,
    ).join('');
    const d = openTermDictionary(
      `<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" version="1.1">${rows}<term name="번호" physicalName="ID"/></tm:TermDictionary>`,
    );
    for (let i = 0; i < 250; i++)
      expect(translateTerm(`단어${19999 - i} 번호`, d, defaultNamingPolicy).value).toBe(
        `WORD${19999 - i}_ID`,
      );
  });
});
