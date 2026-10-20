import schema from './schema.generated.json' with { type: 'json' };
import { nativeGraph } from './create';
import type { BinaryGraph, BinaryObject, BinaryRegistry } from './binary';
import { NATIVE_DATABASE_PRODUCTS } from './database-products';
import { parseNativeScalar } from './scalar';

const registry = schema as BinaryRegistry;
const { field, uuid, definitions, object, reference, set } = nativeGraph;
const labels: Record<string, string> = {
  onDeleteRule: '삭제 동작',
  deleteRule: '삭제 동작',
  onUpdateRule: '갱신 동작',
  onDeleteReferentialAction: '삭제 동작',
  onUpdateReferentialAction: '갱신 동작',
  deferrable: '지연 가능',
  deferred: '처음부터 지연',
  validated: '검증 상태',
  enabled: '제약 활성',
  enable: '제약 활성',
  status: '원본 상태 플래그 (status)',
  match: 'MATCH 방식',
  generated: '원본 생성 표시',
  notForReplication: '복제 시 검사 제외',
  systemGeneratedName: '서버 생성 이름',
  referenceOwner: '참조 소유자',
  referenceTable: '참조 테이블 메타정보',
  referenceConstraintName: '참조 제약 메타정보',
  referenceConstraintType: '참조 제약 종류',
};
export interface ForeignKeyOption {
  name: string;
  label: string;
  kind: 'boolean' | 'enum' | 'text';
  value: string | null;
  defaultValue: string;
  choices?: string[];
}
export function foreignKeyOptions(
  properties: BinaryObject | undefined,
  group?: BinaryObject,
  productId?: string,
): ForeignKeyOption[] {
  if (!properties && productId) {
    const product = NATIVE_DATABASE_PRODUCTS.find((p) => p.productId === productId);
    if (product)
      properties = {
        id: -1,
        class: { packageUri: product.namespace, name: 'ForeignKeyConstraintProperties' },
        features: [],
      };
  }
  if (!properties) return [];
  const result: ForeignKeyOption[] = (definitions(properties) || [])
    .filter((f) => Object.hasOwn(labels, f.name) && !f.derived && !f.transient)
    .map((f) => {
      const raw = field(properties, f.name),
        value = raw == null ? null : String(raw);
      const type = String(f.type || '')
        .split('#//')
        .at(-1);
      const pkg = registry.packages.find((p) => p.namespaceURI === properties.class.packageUri);
      const enumeration = (
        pkg?.enumerations as
          Array<{ name: string; literals: Array<{ literal: string }> }> | undefined
      )?.find((e) => e.name === type);
      let choices = enumeration?.literals.map((l) => l.literal);
      if (f.name === 'match')
        choices = properties.class.packageUri.includes('postgresql') ? ['SIMPLE', 'FULL'] : [''];
      if (properties.class.packageUri.includes('mysql'))
        choices = choices?.filter((v) => v !== 'SET DEFAULT');
      const defaultValue =
        typeof f.defaultValueLiteral === 'string'
          ? f.defaultValueLiteral
          : f.kind === 'BOOLEAN'
            ? 'false'
            : enumeration?.literals[0]?.literal || '';
      return {
        name: f.name,
        label:
          f.name === 'validated' && properties.class.packageUri.includes('postgresql')
            ? 'NOT VALID · 기존 행 검증 생략'
            : labels[f.name],
        kind: f.kind === 'BOOLEAN' ? 'boolean' : choices ? 'enum' : 'text',
        value,
        defaultValue,
        ...(choices ? { choices } : {}),
      };
    });
  if (group)
    result.push({
      name: 'useIndexing',
      label: 'FK 인덱스 사용',
      kind: 'boolean',
      value: field(group, 'useIndexing') == null ? null : String(field(group, 'useIndexing')),
      defaultValue: String(
        definitions(group)?.find((f) => f.name === 'useIndexing')?.defaultValueLiteral || 'false',
      ),
    });
  return result;
}
const references = (graph: BinaryGraph, owner: BinaryObject, name: string) => {
  const value = field(owner, name),
    refs = Array.isArray(value) ? value : value == null ? [] : [value];
  return refs.flatMap((r) =>
    r && typeof r === 'object' && 'ref' in r ? graph.objects.filter((o) => o.id === r.ref) : [],
  );
};
/** Caller owns a cloned graph. Only requested physical fields change. */
export function editForeignKeyOptions(
  graph: BinaryGraph,
  groupUuid: string,
  changes: Record<string, string | null>,
) {
  const group = graph.objects.find(
    (o) => o.class.name === 'ForeignKeyColumnGroup' && uuid(o) === groupUuid,
  );
  if (!group) throw new Error('외래키를 찾지 못했습니다.');
  const constraint = references(graph, group, 'foreignKeyConstraint')[0];
  if (!constraint) throw new Error('외래키 제약을 찾지 못했습니다.');
  const product = NATIVE_DATABASE_PRODUCTS.find(
    (p) =>
      p.productId ===
      field(
        graph.objects.find((o) => o.class.name === 'Document'),
        'productId',
      ),
  );
  if (!product) throw new Error('지원하지 않는 DB 제품입니다.');
  let properties = references(graph, constraint, 'physicalProperties')[0];
  if (!properties) {
    properties = object(graph, 'ForeignKeyConstraintProperties', {}, product.namespace, false);
    set(constraint, 'physicalProperties', reference(properties));
  }
  if (properties.class.packageUri !== product.namespace)
    throw new Error('외래키 물리 속성의 DB 제품이 일치하지 않습니다.');
  const options = foreignKeyOptions(properties, group);
  if (!Object.keys(changes).length) throw new Error('변경할 외래키 옵션이 없습니다.');
  for (const [name, value] of Object.entries(changes)) {
    if (name === 'useIndexing') {
      if (value === null) group.features = group.features.filter((f) => f.name !== name);
      else if (value === 'true' || value === 'false') set(group, name, value === 'true');
      else throw new Error('FK 인덱스 사용 값이 올바르지 않습니다.');
      continue;
    }
    const option = options.find((o) => o.name === name),
      def = definitions(properties)?.find((f) => f.name === name);
    if (!option || !def) throw new Error(`이 DB가 지원하지 않는 외래키 옵션입니다: ${name}`);
    if (value === null) properties.features = properties.features.filter((f) => f.name !== name);
    else {
      if (typeof value !== 'string' || (option.choices && !option.choices.includes(value)))
        throw new Error(`허용되지 않는 외래키 옵션 값입니다: ${name}`);
      set(properties, name, parseNativeScalar(def, properties.class, value, registry));
    }
  }
  if (field(properties, 'deferred') === true && field(properties, 'deferrable') !== true)
    throw new Error('처음부터 지연하려면 지연 가능 옵션을 켜야 합니다.');
  const children = graph.objects.filter(
    (o) =>
      o.class.name === 'Column' &&
      references(graph, o, 'memberships').some((e) =>
        references(graph, e, 'key').some((g) => g.id === group.id),
      ),
  );
  const inherited = (column: BinaryObject, own: string, suggestion: string) => {
    const value = field(column, own);
    if (typeof value === 'string' && (own !== 'notNull' || value !== '')) return value;
    let domain = references(graph, column, 'domain')[0];
    const seen = new Set<number>();
    while (domain && !seen.has(domain.id)) {
      seen.add(domain.id);
      const value = field(domain, suggestion);
      if (typeof value === 'string') return value;
      domain = graph.objects.find(
        (o) =>
          o.class.name === 'Domain' &&
          references(graph, o, 'domain').some((d) => d.id === domain.id),
      )!;
    }
    return '';
  };
  const actions = [
    'onDeleteRule',
    'deleteRule',
    'onUpdateRule',
    'onDeleteReferentialAction',
    'onUpdateReferentialAction',
  ].map((k) => String(field(properties, k) || '').replaceAll('_', ' '));
  if (
    actions.includes('SET NULL') &&
    children.some(
      (c) =>
        inherited(c, 'notNull', 'suggestedNotNull') === 'TRUE' ||
        references(graph, c, 'memberships').some((e) =>
          references(graph, e, 'value').some((m) => m.class.name === 'PrimaryKeyMembership'),
        ),
    )
  )
    throw new Error(
      'SET NULL에는 NULL을 허용하는 자식 컬럼이 필요합니다. 기본키·NOT NULL은 자동 변경하지 않습니다.',
    );
  if (
    actions.includes('SET DEFAULT') &&
    children.some((c) => !inherited(c, 'defaultValue', 'suggestedDefaultValue').trim())
  )
    throw new Error('SET DEFAULT에는 자식 컬럼의 기본값이 필요합니다.');
  // The remaining original physical fields, FK identity, memberships and cardinality stay untouched.
}
