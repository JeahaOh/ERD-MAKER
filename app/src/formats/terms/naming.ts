import type { NativeDocumentView } from '../exerd/view';
import { createTermDictionary, openTermDictionary, type TermDictionary } from './dictionary';
import { encodeAttribute } from '../exerd/xml';

export interface NamingPolicy {
  casing: 'upper' | 'lower' | 'preserve';
  separator: string;
  tablePrefix: string;
  columnPrefix: string;
  maxLength: number;
}
export const defaultNamingPolicy: NamingPolicy = {
  casing: 'upper',
  separator: '_',
  tablePrefix: '',
  columnPrefix: '',
  maxLength: 63,
};
export interface NamingProposal {
  uuid: string;
  kind: 'table' | 'column';
  owner: string;
  logicalName: string;
  before: string;
  after: string;
  problem?: string;
}
interface Trie {
  next: Map<string, Trie>;
  values?: Set<string>;
}
const vocabulary = new WeakMap<
  TermDictionary,
  Map<boolean, { words: Map<string, Set<string>>; trie: Trie }>
>();
function wordIndex(dictionary: TermDictionary, reverse: boolean) {
  let directions = vocabulary.get(dictionary);
  if (!directions) {
    directions = new Map();
    vocabulary.set(dictionary, directions);
  }
  const cached = directions.get(reverse);
  if (cached) return cached;
  const words = new Map<string, Set<string>>(),
    trie: Trie = { next: new Map() };
  for (const t of dictionary.terms)
    for (const alias of (reverse
      ? [t.physicalName, ...t.physicalSynonyms]
      : [t.name, ...t.synonyms]
    ).filter(Boolean)) {
      const normalized = alias.normalize('NFC'),
        name = reverse ? normalized.toLocaleUpperCase('en-US') : normalized;
      const values = words.get(name) || new Set<string>();
      values.add(reverse ? t.name : t.physicalName);
      words.set(name, values);
    }
  for (const [name, values] of words) {
    let node = trie;
    for (let i = 0; i < name.length; i++) {
      let child = node.next.get(name[i]);
      if (!child) {
        child = { next: new Map() };
        node.next.set(name[i], child);
      }
      node = child;
    }
    node.values = values;
  }
  const result = { words, trie };
  directions.set(reverse, result);
  return result;
}
export function translateTerm(
  input: string,
  dictionary: TermDictionary,
  policy: NamingPolicy,
  reverse = false,
): { value?: string; problem?: string } {
  if (
    !Number.isInteger(policy.maxLength) ||
    policy.maxLength < 1 ||
    policy.maxLength > 512 ||
    !/^[A-Za-z0-9_]*$/.test(policy.separator)
  )
    return { problem: '이름 정책의 구분자·최대 길이를 확인하세요.' };
  const source = input.normalize('NFC').trim();
  if (!source) return { problem: '변환할 이름이 없습니다.' };
  const { words, trie } = wordIndex(dictionary, reverse);
  const query = reverse ? source.toLocaleUpperCase('en-US') : source;
  if (query.length > 256) return { problem: '이름은 256자 이하만 변환할 수 있습니다.' };
  const exact = words.get(query);
  const transform = (v: string) =>
    reverse || policy.casing === 'preserve'
      ? v
      : policy.casing === 'upper'
        ? v.toLocaleUpperCase('en-US')
        : v.toLocaleLowerCase('en-US');
  if (exact)
    return exact.size === 1
      ? { value: transform([...exact][0]) }
      : { problem: '동의어가 여러 용어와 일치합니다.' };
  const delimiters = [
    ...new Set(
      [
        reverse ? policy.separator : '',
        ...dictionary.delimiters.map((d) =>
          reverse ? d.physicalNameDelimiter : d.logicalNameDelimiter,
        ),
        ' ',
        '\t',
        '\n',
      ].filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);
  const memo = new Map<number, string[][]>();
  const solve = (at: number): string[][] => {
    if (at === query.length) return [[]];
    if (memo.has(at)) return memo.get(at)!;
    const delimiter = delimiters.find((d) => query.startsWith(reverse ? d.toUpperCase() : d, at));
    if (delimiter) {
      const result = solve(at + delimiter.length);
      memo.set(at, result);
      return result;
    }
    const result: string[][] = [];
    let node = trie;
    for (let end = at; end < query.length; end++) {
      const child = node.next.get(query[end]);
      if (!child) break;
      node = child;
      for (const name of node.values || [])
        for (const rest of solve(end + 1)) {
          const candidate = [name, ...rest];
          if (!result.some((r) => JSON.stringify(r) === JSON.stringify(candidate)))
            result.push(candidate);
          if (result.length === 2) {
            memo.set(at, result);
            return result;
          }
        }
    }
    memo.set(at, result);
    return result;
  };
  const solutions = solve(0);
  if (!solutions.length) return { problem: '사전에 없는 단어가 포함돼 있습니다.' };
  if (solutions.length > 1)
    return { problem: '이름을 여러 방식으로 분해할 수 있습니다. 복합 용어를 등록하세요.' };
  return {
    value: transform(
      solutions[0].join(
        reverse ? dictionary.delimiters[0]?.logicalNameDelimiter || '' : policy.separator,
      ),
    ),
  };
}
export function namingProposals(
  view: NativeDocumentView,
  dictionary: TermDictionary,
  policy: NamingPolicy,
  tableUuid?: string,
): NamingProposal[] {
  const proposals: NamingProposal[] = [];
  for (const table of view.allTables.filter((t) => !tableUuid || t.uuid === tableUuid)) {
    for (const target of [
      { ...table, kind: 'table' as const, owner: table.schemaName },
      ...table.columns.map((c) => ({
        ...c,
        kind: 'column' as const,
        owner: `${table.schemaName}.${table.name}`,
      })),
    ]) {
      const translated = translateTerm(target.logicalName, dictionary, policy);
      const after = translated.value
        ? (target.kind === 'table' ? policy.tablePrefix : policy.columnPrefix) + translated.value
        : '';
      let problem = translated.problem;
      if (!problem && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(after))
        problem = '물리명은 영문자 또는 밑줄로 시작하는 영문·숫자·밑줄이어야 합니다.';
      if (!problem && after.length > policy.maxLength)
        problem = `최대 길이 ${policy.maxLength}자를 초과합니다.`;
      proposals.push({
        uuid: target.uuid,
        kind: target.kind,
        owner: target.owner,
        logicalName: target.logicalName,
        before: target.name,
        after,
        ...(problem ? { problem } : {}),
      });
    }
  }
  const proposed = new Map(
    proposals.filter((p) => !p.problem).map((p) => [p.uuid, p.after.toUpperCase()]),
  );
  for (const p of proposals.filter((p) => !p.problem)) {
    const table = view.allTables.find(
      (t) => t.uuid === p.uuid || t.columns.some((c) => c.uuid === p.uuid),
    )!;
    const peers =
      p.kind === 'table'
        ? view.allTables.filter((t) => t.schemaUuid === table.schemaUuid)
        : table.columns;
    if (
      peers.some(
        (peer) =>
          peer.uuid !== p.uuid &&
          (proposed.get(peer.uuid) || peer.name.toUpperCase()) === p.after.toUpperCase(),
      )
    )
      p.problem = '같은 소속 안에서 물리명이 충돌합니다.';
  }
  return proposals;
}
export function reverseEngineerTerms(view: NativeDocumentView): TermDictionary {
  const pairs = new Map<string, { name: string; physicalName: string; description: string }>();
  for (const t of view.allTables)
    for (const o of [t, ...t.columns]) {
      if (!o.logicalName.trim() || !o.name.trim()) continue;
      const old = pairs.get(o.logicalName);
      if (old && old.physicalName !== o.name)
        throw new Error(`동일한 논리명에 다른 물리명이 있습니다: ${o.logicalName}`);
      if (!old)
        pairs.set(o.logicalName, {
          name: o.logicalName,
          physicalName: o.name,
          description: o.comment,
        });
    }
  if (!pairs.size) return createTermDictionary();
  const body = [...pairs.values()]
    .map(
      (p) =>
        `<term name="${encodeAttribute(p.name)}" physicalName="${encodeAttribute(p.physicalName)}" description="${encodeAttribute(p.description)}"/>`,
    )
    .join('');
  return openTermDictionary(
    `<?xml version="1.0" encoding="UTF-8"?><tm:TermDictionary xmlns:tm="http://exerd.com/term-model" version="1.1">${body}</tm:TermDictionary>`,
  );
}
