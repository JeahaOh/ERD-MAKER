import { XMLParser } from 'fast-xml-parser';
import { decodeAttribute, encodeAttribute, indexXml } from '../exerd/xml';

type XmlNode = { [key: string]: unknown; ':@'?: Record<string, string> };
export interface Term {
  id: string;
  name: string;
  physicalName: string;
  description: string;
  physicalDescription: string;
  synonyms: string[];
  physicalSynonyms: string[];
  tags: string[];
}
export interface TermTag {
  id: string;
  name: string;
  description: string;
}
export interface TermDelimiter {
  id: string;
  logicalNameDelimiter: string;
  physicalNameDelimiter: string;
}
export interface TermDictionary {
  source: string;
  tree: XmlNode[];
  rootName: string;
  terms: Term[];
  tags: TermTag[];
  delimiters: TermDelimiter[];
  version: string;
  warnings: string[];
}
const policyMarker = 'ERD-MAKER-TERM-DELIMITERS-V1:';
function policyValues(values: unknown): Array<Omit<TermDelimiter, 'id'>> {
  if (
    !Array.isArray(values) ||
    values.length > 32 ||
    values.some(
      (v) =>
        !v ||
        typeof v.logicalNameDelimiter !== 'string' ||
        !v.logicalNameDelimiter ||
        v.logicalNameDelimiter.length > 8 ||
        typeof v.physicalNameDelimiter !== 'string' ||
        v.physicalNameDelimiter.length > 8,
    )
  )
    throw new Error('구분자 정책의 형식이 올바르지 않습니다.');
  return values.map((v) => ({
    logicalNameDelimiter: v.logicalNameDelimiter,
    physicalNameDelimiter: v.physicalNameDelimiter,
  }));
}
const local = (name: string) => name.split(':').at(-1)!;
const key = (node: XmlNode) => Object.keys(node).find((k) => k !== ':@')!;
const children = (node: XmlNode) =>
  Array.isArray(node[key(node)]) ? (node[key(node)] as XmlNode[]) : [];
const text = (nodes: XmlNode[]): string =>
  nodes
    .map((n) =>
      typeof n['#text'] === 'string'
        ? n['#text']
        : typeof n['#cdata'] === 'string'
          ? n['#cdata']
          : text(children(n)),
    )
    .join('');
const values = (node: XmlNode, name: string) =>
  children(node)
    .filter((n) => key(n) === name)
    .map((n) => text(children(n)));
const attr = (node: XmlNode, name: string) => node[':@']?.[name] || '';
const rootNode = (d: Pick<TermDictionary, 'tree' | 'rootName'>) =>
  d.tree.find((n) => key(n) === d.rootName)!;
export const decodeXmlText = (value: string) =>
  decodeAttribute(
    value
      .replace(/\r\n|\r/g, '\n')
      .replaceAll('\t', '&#x9;')
      .replaceAll('\n', '&#xa;'),
  );
function decodeTree(nodes: XmlNode[], literal = false) {
  for (const node of nodes) {
    for (const [name, value] of Object.entries(node[':@'] || {}))
      node[':@']![name] = decodeAttribute(value);
    if (typeof node['#text'] === 'string' && !literal) node['#text'] = decodeXmlText(node['#text']);
    decodeTree(children(node), literal || ['#cdata', '#comment'].includes(key(node)));
  }
}
function serialize(nodes: XmlNode[]): string {
  return nodes
    .map((n) => {
      const name = key(n),
        content = n[name];
      if (name === '#text') return encodeAttribute(String(content));
      if (name === '#comment')
        return `<!--${Array.isArray(content) ? text(content) : String(content)}-->`;
      if (name === '#cdata')
        return `<![CDATA[${Array.isArray(content) ? text(content) : String(content)}]]>`;
      const attributes = Object.entries(n[':@'] || {})
        .map(([k, v]) => ` ${k}="${encodeAttribute(String(v))}"`)
        .join('');
      if (name.startsWith('?')) return `<${name}${attributes}?>`;
      const body = Array.isArray(content) ? serialize(content) : '';
      return body ? `<${name}${attributes}>${body}</${name}>` : `<${name}${attributes}/>`;
    })
    .join('');
}
export function openTermDictionary(input: string | Uint8Array): TermDictionary {
  const source =
    typeof input === 'string'
      ? input
      : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  if (new TextEncoder().encode(source).length > 16 * 1024 * 1024)
    throw new Error('용어사전은 16MiB 이하만 열 수 있습니다.');
  indexXml(new TextEncoder().encode(source));
  const tree = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
    commentPropName: '#comment',
    cdataPropName: '#cdata',
  }).parse(source) as XmlNode[];
  decodeTree(tree);
  const roots = tree.filter((n) => !key(n).startsWith('#') && !key(n).startsWith('?'));
  if (roots.length !== 1 || local(key(roots[0])) !== 'TermDictionary')
    throw new Error('eXERD TermDictionary 파일이 아닙니다.');
  const root = roots[0],
    rootName = key(root),
    prefix = rootName.includes(':') ? rootName.split(':')[0] : '';
  if (attr(root, prefix ? `xmlns:${prefix}` : 'xmlns') !== 'http://exerd.com/term-model')
    throw new Error('지원하지 않는 용어사전 네임스페이스입니다.');
  const version = attr(root, 'version');
  if (version && !['1.0', '1.1'].includes(version))
    throw new Error('지원하지 않는 용어사전 버전입니다.');
  const nodes = children(root),
    tags = nodes
      .filter((n) => key(n) === 'tag')
      .map((n, i) => ({
        id: `tag:${i}`,
        name: attr(n, 'name'),
        description: attr(n, 'description'),
      }));
  const terms: Term[] = [],
    delimiters: TermDelimiter[] = [],
    warnings: string[] = [];
  nodes
    .filter((n) => key(n) === 'term')
    .forEach((n, i) => {
      const id = `term:${i}`;
      const namespaces = { ...root[':@'], ...n[':@'] };
      const declared = Object.entries(n[':@'] || {}).find(
        ([k]) =>
          local(k) === 'type' &&
          k.includes(':') &&
          namespaces[`xmlns:${k.split(':')[0]}`] === 'http://www.w3.org/2001/XMLSchema-instance',
      )?.[1];
      if (declared?.endsWith(':TermDelimiter'))
        throw new Error(
          'TermDelimiter는 원본 사전에 저장할 수 없는 내부 타입입니다. 구분자는 앱 정책으로 등록하세요.',
        );
      if (
        declared &&
        (!declared.endsWith(':Term') ||
          namespaces[`xmlns:${declared.split(':')[0]}`] !== 'http://exerd.com/term-model')
      )
        throw new Error('지원하지 않는 용어 항목 타입입니다.');
      else {
        const refs = [
            ...attr(n, 'tag').split(/\s+/).filter(Boolean),
            ...children(n)
              .filter((c) => key(c) === 'tag')
              .map((c) => attr(c, 'href')),
          ],
          attached: string[] = [];
        for (const ref of refs) {
          const m = /^(?:#)?\/\/@tag\.(\d+)$/.exec(ref);
          if (m && tags[Number(m[1])]) attached.push(tags[Number(m[1])].id);
          else warnings.push('해석하지 못한 태그 참조가 있습니다. 원문 참조를 보존합니다.');
        }
        terms.push({
          id,
          name: attr(n, 'name'),
          physicalName: attr(n, 'physicalName'),
          description: attr(n, 'description'),
          physicalDescription: attr(n, 'physicalDescription'),
          synonyms: values(n, 'synonyms'),
          physicalSynonyms: values(n, 'physicalSynonyms'),
          tags: attached,
        });
      }
    });
  const policies = nodes.filter(
    (n) => key(n) === '#comment' && text(children(n)).startsWith(policyMarker),
  );
  if (policies.length > 1) throw new Error('구분자 정책이 중복됐습니다.');
  if (policies.length) {
    const hex = text(children(policies[0])).slice(policyMarker.length);
    if (!/^(?:[0-9a-f]{2}){1,4096}$/.test(hex))
      throw new Error('구분자 정책 인코딩이 올바르지 않습니다.');
    const bytes = Uint8Array.from(hex.match(/../g)!, (s) => parseInt(s, 16));
    const values = policyValues(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    );
    delimiters.push(...values.map((v, i) => ({ id: `policy:${i}`, ...v })));
  }
  return {
    source,
    tree,
    rootName,
    terms,
    tags,
    delimiters,
    version,
    warnings: [...new Set(warnings)],
  };
}
export function createTermDictionary(): TermDictionary {
  return openTermDictionary(
    '<?xml version="1.0" encoding="UTF-8"?>\n<tm:TermDictionary xmlns:tm="http://exerd.com/term-model" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1.1"/>',
  );
}
export function saveTermDictionary(d: TermDictionary): Uint8Array {
  return new TextEncoder().encode(d.source);
}
function edited(d: TermDictionary, edit: (root: XmlNode) => void) {
  const tree = structuredClone(d.tree),
    root = rootNode({ tree, rootName: d.rootName });
  edit(root);
  return openTermDictionary(serialize(tree));
}
function entry(root: XmlNode, id: string, type: 'term' | 'tag') {
  const found = children(root).filter((n) => key(n) === type)[Number(id.split(':')[1])];
  if (!id.startsWith(type + ':') || !found)
    throw new Error('사전 항목이 변경됐습니다. 다시 선택하세요.');
  return found;
}
export function upsertTerm(
  d: TermDictionary,
  value: Omit<Term, 'id'> & { id?: string },
): TermDictionary {
  if (
    [value.synonyms, value.physicalSynonyms, value.tags].some(
      (list) => !Array.isArray(list) || list.some((s) => typeof s !== 'string'),
    )
  )
    throw new Error('동의어·태그는 문자열 목록이어야 합니다.');
  if (!value.name.trim() || !value.physicalName.trim())
    throw new Error('용어명과 물리 약어가 필요합니다.');
  if (
    d.terms.some(
      (t) => t.id !== value.id && t.name.normalize('NFC') === value.name.trim().normalize('NFC'),
    )
  )
    throw new Error('같은 용어명이 있습니다.');
  if (value.tags.some((id) => !d.tags.some((t) => t.id === id)))
    throw new Error('없는 태그를 연결할 수 없습니다.');
  return edited(d, (root) => {
    const n = value.id ? entry(root, value.id, 'term') : ({ term: [] } as XmlNode);
    const attributes = {
      ...n[':@'],
      name: value.name.trim(),
      physicalName: value.physicalName.trim(),
      description: value.description,
      physicalDescription: value.physicalDescription,
    };
    const unresolved = (n[':@']?.tag || '')
      .split(/\s+/)
      .filter((s) => s && !/^(?:#)?\/\/@tag\.\d+$/.test(s));
    n[':@'] = {
      ...attributes,
      ...(value.tags.length || unresolved.length
        ? {
            tag: [
              ...unresolved,
              ...value.tags.map((id) => `//@tag.${Number(id.split(':')[1])}`),
            ].join(' '),
          }
        : {}),
    };
    if (!value.tags.length && !unresolved.length) delete n[':@'].tag;
    const retained = children(n).filter(
      (c) =>
        !['synonyms', 'physicalSynonyms'].includes(key(c)) &&
        !(key(c) === 'tag' && /^(?:#)?\/\/@tag\.\d+$/.test(attr(c, 'href'))),
    );
    n[key(n)] = [
      ...retained,
      ...[...new Set(value.synonyms.filter(Boolean))].map((s) => ({ synonyms: [{ '#text': s }] })),
      ...[...new Set(value.physicalSynonyms.filter(Boolean))].map((s) => ({
        physicalSynonyms: [{ '#text': s }],
      })),
    ];
    if (!value.id) children(root).push(n);
  });
}
export function upsertTag(d: TermDictionary, value: Omit<TermTag, 'id'> & { id?: string }) {
  if (!value.name.trim() || d.tags.some((t) => t.id !== value.id && t.name === value.name.trim()))
    throw new Error('태그 이름이 비어 있거나 중복됐습니다.');
  return edited(d, (root) => {
    const n = value.id ? entry(root, value.id, 'tag') : ({ tag: [] } as XmlNode);
    n[':@'] = { ...n[':@'], name: value.name.trim(), description: value.description };
    if (!value.id) children(root).push(n);
  });
}
export function removeTerm(d: TermDictionary, id: string) {
  if (/\/\/@term\.\d+/.test(d.source))
    throw new Error('용어를 가리키는 참조가 있어 삭제 전 검토가 필요합니다.');
  return edited(d, (root) => {
    const target = entry(root, id, 'term');
    root[key(root)] = children(root).filter((n) => n !== target);
  });
}
export function removeTag(d: TermDictionary, id: string, detach = false) {
  if (d.warnings.length)
    throw new Error('해석하지 못한 태그 참조가 있어 삭제 전 검토가 필요합니다.');
  if (!detach && d.terms.some((t) => t.tags.includes(id)))
    throw new Error('사용 중인 태그입니다. 연결 해제를 선택하세요.');
  return edited(d, (root) => {
    const index = Number(id.split(':')[1]),
      target = entry(root, id, 'tag');
    for (const n of children(root).filter((n) => key(n) === 'term')) {
      n[key(n)] = children(n).filter((c) => {
        if (key(c) !== 'tag') return true;
        const m = /^(?:#)?\/\/@tag\.(\d+)$/.exec(attr(c, 'href'));
        if (!m) return true;
        const i = Number(m[1]);
        if (i === index) return false;
        if (i > index) c[':@'] = { ...c[':@'], href: `#//@tag.${i - 1}` };
        return true;
      });
      if (n[':@']?.tag) {
        const refs = n[':@'].tag
          .split(/\s+/)
          .filter(Boolean)
          .flatMap((ref) => {
            const m = /^(?:#)?\/\/@tag\.(\d+)$/.exec(ref);
            if (!m) return [ref];
            const i = Number(m[1]);
            return i === index ? [] : [`//@tag.${i > index ? i - 1 : i}`];
          });
        if (refs.length) n[':@'].tag = refs.join(' ');
        else delete n[':@'].tag;
      }
    }
    root[key(root)] = children(root).filter((n) => n !== target);
  });
}
export function setTermDelimiter(d: TermDictionary, logical: string, physical: string) {
  if (d.delimiters.length > 1)
    throw new Error('구분자 정책이 여러 개입니다. XLSX의 Delimiters 시트에서 모두 검토하세요.');
  return setTermDelimiters(d, [{ logicalNameDelimiter: logical, physicalNameDelimiter: physical }]);
}
/** App policy metadata in an XML comment. The original vocabulary metamodel ignores it. */
export function setTermDelimiters(d: TermDictionary, values: Array<Omit<TermDelimiter, 'id'>>) {
  const checked = policyValues(values),
    hex = [...new TextEncoder().encode(JSON.stringify(checked))]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  return edited(d, (root) => {
    root[key(root)] = children(root).filter(
      (n) => !(key(n) === '#comment' && text(children(n)).startsWith(policyMarker)),
    );
    children(root).push({ '#comment': [{ '#text': policyMarker + hex }] });
  });
}
export function mergeDictionaries(d: TermDictionary, incoming: TermDictionary) {
  const sourceRoot = rootNode(incoming);
  const unknown = children(sourceRoot).some(
    (n) => !['term', 'tag', '#text', '#comment'].includes(key(n)),
  );
  if (
    unknown ||
    Object.keys(sourceRoot[':@'] || {}).some((k) => k !== 'version' && !k.startsWith('xmlns'))
  )
    throw new Error(
      '사전 루트 확장 정보는 자동 병합할 수 없습니다. 별도 사전으로 보관하거나 교체하세요.',
    );
  if (
    new Set([...d.terms.map((t) => t.name)]).size !== d.terms.length ||
    new Set(incoming.terms.map((t) => t.name)).size !== incoming.terms.length
  )
    throw new Error('중복 용어가 있어 병합할 수 없습니다.');
  const canonical = (node: XmlNode): string => {
    const n = structuredClone(node);
    const clean = (n: XmlNode) => {
      if (n[':@'])
        n[':@'] = Object.fromEntries(
          Object.entries(n[':@']).sort(([a], [b]) => a.localeCompare(b)),
        );
      const c = children(n).filter((c) => !(typeof c['#text'] === 'string' && !c['#text'].trim()));
      c.forEach(clean);
      if (Array.isArray(n[key(n)])) n[key(n)] = c;
    };
    clean(n);
    return JSON.stringify(n);
  };
  return edited(d, (root) => {
    root[':@'] = { ...root[':@'] };
    for (const [name, value] of Object.entries(sourceRoot[':@'] || {}).filter(([k]) =>
      k.startsWith('xmlns'),
    )) {
      if (root[':@'][name] && root[':@'][name] !== value)
        throw new Error('네임스페이스가 충돌해 병합할 수 없습니다.');
      root[':@'][name] = value;
    }
    const mapping = new Map<number, number>();
    for (const tag of incoming.tags) {
      const old = d.tags.find((t) => t.name === tag.name),
        node = entry(sourceRoot, tag.id, 'tag');
      if (old) {
        if (canonical(entry(root, old.id, 'tag')) !== canonical(node))
          throw new Error(`태그 내용이 충돌합니다: ${tag.name}`);
        mapping.set(Number(tag.id.split(':')[1]), Number(old.id.split(':')[1]));
      } else {
        const index = children(root).filter((n) => key(n) === 'tag').length;
        mapping.set(Number(tag.id.split(':')[1]), index);
        children(root).push(structuredClone(node));
      }
    }
    for (const source of children(sourceRoot).filter((n) => key(n) === 'term')) {
      const node = structuredClone(source);
      if (node[':@']?.tag)
        node[':@'].tag = node[':@'].tag
          .split(/\s+/)
          .map((ref) => {
            const m = /^(?:#)?\/\/@tag\.(\d+)$/.exec(ref);
            return m && mapping.has(Number(m[1])) ? `//@tag.${mapping.get(Number(m[1]))}` : ref;
          })
          .join(' ');
      for (const child of children(node).filter((c) => key(c) === 'tag')) {
        const m = /^(?:#)?\/\/@tag\.(\d+)$/.exec(attr(child, 'href'));
        if (m && mapping.has(Number(m[1])))
          child[':@'] = { ...child[':@'], href: `#//@tag.${mapping.get(Number(m[1]))}` };
      }
      const old = d.terms.find((t) => t.name === attr(node, 'name'));
      if (old) {
        if (canonical(entry(root, old.id, 'term')) !== canonical(node))
          throw new Error(`같은 용어 또는 구분자의 내용이 충돌합니다: ${attr(node, 'name')}`);
      } else children(root).push(node);
    }
    for (const comment of children(sourceRoot).filter((n) => key(n) === '#comment')) {
      if (text(children(comment)).startsWith(policyMarker) && d.delimiters.length) {
        if (JSON.stringify(d.delimiters) !== JSON.stringify(incoming.delimiters))
          throw new Error('구분자 정책이 충돌합니다.');
        continue;
      }
      if (!children(root).some((n) => canonical(n) === canonical(comment)))
        children(root).push(structuredClone(comment));
    }
  });
}
