import type { BinaryObject, BinaryValue } from './binary';
import type { NativeExerdDocument } from './native-document';
import { foreignKeyOptions, type ForeignKeyOption } from './foreign-key-options';

/** A display projection only. Save the NativeExerdDocument, never this view. */
export interface NativeColumnView {
  uuid: string; name: string; logicalName: string; type: string; nullable: boolean;
  primaryKey: boolean; defaultValue: string; comment: string; domainUuid?: string;
}
export interface NativeTableView {
  uuid: string; name: string; logicalName: string; schemaUuid: string; schemaName: string;
  comment: string; columns: NativeColumnView[]; x: number; y: number; placementUuid?: string;
  groups: NativeColumnGroupView[]; checks: NativeCheckView[];
}
export interface NativeColumnGroupView { uuid: string; kind: 'primary' | 'unique' | 'index' | 'foreign'; name: string; columnUuids: string[]; sortTypes: Array<'ASC' | 'DESC'>; constraintUuid?: string; constraintName?: string }
export interface NativeCheckView { uuid: string; name: string; expression: string }
export interface NativeSchemaView { uuid: string; name: string; logicalName: string }
export interface NativeBusinessAreaView { uuid: string; name: string }
export interface NativeDiagramView { uuid: string; name: string; businessAreaUuid: string; businessAreaName: string; tableUuids: string[]; hiddenRelationUuids?: string[] }
export interface NativeDomainView { uuid: string; name: string; parentUuid?: string; suggestedDataType: string; suggestedDefaultValue: string; suggestedNotNull: string; comment: string; localDataType?: string; localDefaultValue?: string; localNotNull?: string }
export interface NativeRelationshipView {
  uuid: string; name: string; parentTableUuid: string; childTableUuid: string;
  parentColumnUuids: string[]; childColumnUuids: string[]; identifying: boolean;
  parentCardinality: string; childCardinality: string; onDelete: string; onUpdate: string;
  constraintUuid?: string; constraintName?: string; relationUuid?: string; parentKeyUuid?: string;
  options: ForeignKeyOption[];
}
export interface NativeNoteView { uuid: string; text: string; x: number; y: number; diagramUuid?: string; width?: number; height?: number; targetPlacementUuid?: string }
export interface NativePlacementView { uuid: string; diagramUuid: string; tableUuid: string; x: number; y: number; reference: boolean }
export interface NativeDocumentView {
  termFilePath?: string;
  name: string; productId: string; tables: NativeTableView[]; diagrams: NativeDiagramView[];
  domains: NativeDomainView[]; relationships: NativeRelationshipView[]; notes: NativeNoteView[];
  allTables: NativeTableView[]; allRelationships: NativeRelationshipView[]; allNotes: NativeNoteView[];
  placements: NativePlacementView[]; warnings: string[];
  schemas: NativeSchemaView[]; businessAreas: NativeBusinessAreaView[];
}
interface CachedProjection { base: NativeDocumentView; byDiagram: Map<string, NativeDocumentView> }
const cache = new WeakMap<NativeExerdDocument, CachedProjection>();

function build(document: NativeExerdDocument): NativeDocumentView {
  const objects = document.graph.objects;
  const byId = new Map(objects.map(o => [o.id, o]));
  const features = new Map(objects.map(o => [o.id, new Map(o.features.map(f => [f.name, f.value]))]));
  const field = (o: BinaryObject | undefined, name: string): BinaryValue | undefined => o && features.get(o.id)?.get(name);
  const text = (o: BinaryObject | undefined, name: string, fallback = ''): string => {
    const value = field(o, name); return typeof value === 'string' ? value : fallback;
  };
  const id = (o: BinaryObject) => text(o, 'UUID') || `binary:${o.id}`;
  const name = (o: BinaryObject | undefined) => text(o, 'physicalName') || text(o, 'name') || text(o, 'logicalName');
  const ref = (value: BinaryValue | undefined): BinaryObject | undefined => {
    if (value && !Array.isArray(value) && typeof value === 'object' && 'ref' in value) return byId.get(value.ref);
    return undefined;
  };
  const refs = (o: BinaryObject | undefined, key: string): BinaryObject[] => {
    const value = field(o, key); return Array.isArray(value) ? (value as BinaryValue[]).map(ref).filter((o): o is BinaryObject => !!o) : [];
  };
  const point = (o: BinaryObject): { x: number; y: number } => {
    const match = /^Point\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)$/.exec(text(o, 'location'));
    const x = match ? Number(match[1]) : 0, y = match ? Number(match[2]) : 0;
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  };
  const ofType = (type: string) => objects.filter(o => o.class.packageUri === 'http://exerd.tomato.com/model' && o.class.name === type);
  const warnings: string[] = [];
  const groupOwner = new Map<number, BinaryObject>(), schemaOwner = new Map<number, BinaryObject>();
  for (const schema of ofType('Schema')) for (const table of refs(schema, 'tables')) schemaOwner.set(table.id, schema);
  const sourceTables = ofType('Table');
  for (const table of sourceTables) {
    for (const group of refs(table, 'columnGroups')) groupOwner.set(group.id, table);
  }
  const domainParent = new Map<number, BinaryObject>();
  const sourceDomains = ofType('Domain');
  for (const domain of sourceDomains) for (const child of refs(domain, 'domain')) domainParent.set(child.id, domain);
  function domainValue(domain: BinaryObject | undefined, key: string): string {
    const visited = new Set<number>();
    while (domain && !visited.has(domain.id)) {
      visited.add(domain.id); const value = field(domain, key);
      // Original DomainImpl inherits strings only when null/unset; NONE ('')
      // is different for the tri-state nullability enum and continues upward.
      if (typeof value === 'string' && (key !== 'suggestedNotNull' || value !== '')) return value;
      domain = domainParent.get(domain.id);
    }
    return '';
  }
  const domains = sourceDomains.map(domain => ({ uuid: id(domain), name: name(domain),
    ...(domainParent.has(domain.id) ? { parentUuid: id(domainParent.get(domain.id)!) } : {}),
    suggestedDataType: domainValue(domain, 'suggestedDataType'), suggestedDefaultValue: domainValue(domain, 'suggestedDefaultValue'),
    ...(typeof field(domain, 'suggestedDataType') === 'string' ? { localDataType: text(domain, 'suggestedDataType') } : {}),
    ...(typeof field(domain, 'suggestedDefaultValue') === 'string' ? { localDefaultValue: text(domain, 'suggestedDefaultValue') } : {}),
    ...(typeof field(domain, 'suggestedNotNull') === 'string' ? { localNotNull: text(domain, 'suggestedNotNull') } : {}),
    suggestedNotNull: domainValue(domain, 'suggestedNotNull'), comment: text(domain, 'comment') }));
  const inheritedColumnValue = (column: BinaryObject, own: string, suggested: string) => {
    const value = field(column, own);
    return typeof value === 'string' && (own !== 'notNull' || value !== '') ? value : domainValue(ref(field(column, 'domain')), suggested);
  };
  const membershipsByGroup = new Map<number, Array<{ membership: BinaryObject; column: BinaryObject; order: number; sequence: number }>>();
  let sequence = 0;
  for (const table of sourceTables) for (const column of refs(table, 'columns')) {
    for (const entry of refs(column, 'memberships')) {
      const membership = ref(field(entry, 'value')); if (!membership) continue;
      const group = ref(field(membership, 'group')) ?? ref(field(entry, 'key'));
      if (!group) continue;
      const entries = membershipsByGroup.get(group.id) ?? [];
      const index = field(membership, 'entryIndex');
      entries.push({ membership, column, order: typeof index === 'number' ? index : -1, sequence: sequence++ });
      membershipsByGroup.set(group.id, entries);
    }
  }
  for (const list of membershipsByGroup.values()) list.sort((a, b) => a.order - b.order || a.sequence - b.sequence);
  const primaryColumns = new Set<number>();
  for (const group of ofType('PrimaryKeyColumnGroup')) {
    for (const member of membershipsByGroup.get(group.id) ?? []) primaryColumns.add(member.column.id);
    for (const column of refs(group, 'member')) primaryColumns.add(column.id);
  }
  const allTables: NativeTableView[] = sourceTables.map(table => {
    const schema = schemaOwner.get(table.id);
    return { uuid: id(table), name: name(table), logicalName: text(table, 'logicalName'),
      schemaUuid: schema ? id(schema) : '', schemaName: name(schema), comment: text(table, 'comment'), x: 0, y: 0,
      groups: refs(table, 'columnGroups').flatMap(group => {
        const kinds: Record<string, NativeColumnGroupView['kind']> = { PrimaryKeyColumnGroup: 'primary', AlternateKeyColumnGroup: 'unique', InversionEntryColumnGroup: 'index', ForeignKeyColumnGroup: 'foreign' };
        const kind = kinds[group.class.name];
        if (!kind) { warnings.push(`컬럼 그룹 ${id(group)}의 표시 종류를 지원하지 않습니다.`); return []; }
        const members = membershipsByGroup.get(group.id) ?? [];
        const constraintField = kind === 'primary' ? 'primaryKeyConstraint' : kind === 'unique' ? 'uniqueConstraint' : kind === 'foreign' ? 'foreignKeyConstraint' : '';
        const constraint = constraintField ? ref(field(group, constraintField)) : undefined;
        return [{ uuid: id(group), kind, name: name(group), columnUuids: members.map(member => id(member.column)), sortTypes: members.map(member => text(member.membership, 'sortType') === 'DESC' ? 'DESC' as const : 'ASC' as const),
          ...(constraint ? { constraintUuid: id(constraint), constraintName: text(constraint, 'physicalName') || text(constraint, 'name') } : {}) }];
      }),
      checks: refs(table, 'checkConstraints').map(check => ({ uuid: id(check), name: name(check), expression: text(check, 'expression') })),
      columns: refs(table, 'columns').map(column => {
        const domain = ref(field(column, 'domain'));
        const notNull = inheritedColumnValue(column, 'notNull', 'suggestedNotNull');
        const primaryKey = primaryColumns.has(column.id);
        return { uuid: id(column), name: name(column), logicalName: text(column, 'logicalName'),
          type: inheritedColumnValue(column, 'dataType', 'suggestedDataType'), nullable: !primaryKey && notNull !== 'TRUE', primaryKey,
          defaultValue: inheritedColumnValue(column, 'defaultValue', 'suggestedDefaultValue'),
          comment: text(column, 'comment'), ...(domain ? { domainUuid: id(domain) } : {}) };
      }) };
  });
  const diagramArea = new Map<number, BinaryObject>();
  for (const area of ofType('BusinessArea')) for (const diagram of refs(area, 'diagrams')) diagramArea.set(diagram.id, area);
  const placements: NativePlacementView[] = [], allNotes: NativeNoteView[] = [];
  const noteView = (note: BinaryObject, diagramUuid?: string): NativeNoteView => {
    const size = text(note, 'manualSize'), match = /^Dimension\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)$/.exec(size);
    const width = match ? Number(match[1]) : undefined, height = match ? Number(match[2]) : undefined;
    const validSize = width !== undefined && height !== undefined && Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0;
    if (size && !validSize) warnings.push(`메모 ${id(note)}의 수동 크기를 표시하지 못했습니다.`);
    const target = ref(field(note, 'target'));
    return { uuid: id(note), text: text(note, 'text'), ...point(note), ...(diagramUuid ? { diagramUuid } : {}),
      ...(validSize ? { width, height } : {}), ...(target ? { targetPlacementUuid: id(target) } : {}) };
  };
  const diagrams = ofType('Diagram').map(diagram => {
    const area = diagramArea.get(diagram.id), tableUuids: string[] = [];
    for (const entry of refs(diagram, 'diagramEntry')) {
      if (entry.class.name === 'TableDiagram') {
        const table = ref(field(entry, 'table'));
        if (!table) { warnings.push(`배치 ${id(entry)}의 테이블 참조를 해석하지 못했습니다.`); continue; }
        tableUuids.push(id(table));
        placements.push({ uuid: id(entry), diagramUuid: id(diagram), tableUuid: id(table), ...point(entry), reference: field(entry, 'ref') === true });
      } else if (entry.class.name === 'Note') allNotes.push(noteView(entry, id(diagram)));
    }
    return { uuid: id(diagram), name: name(diagram), businessAreaUuid: area ? id(area) : '', businessAreaName: name(area), tableUuids, hiddenRelationUuids: refs(diagram, 'filteredRelations').map(id) };
  });
  const firstPlacements = new Map<string, NativePlacementView>();
  for (const placement of placements) if (!firstPlacements.has(placement.tableUuid)) firstPlacements.set(placement.tableUuid, placement);
  for (const table of allTables) {
    const placement = firstPlacements.get(table.uuid);
    if (placement) { table.x = placement.x; table.y = placement.y; table.placementUuid = placement.uuid; }
  }
  const relationByGroup = new Map<number, BinaryObject>();
  for (const relation of ofType('Relation')) {
    const group = ref(field(relation, 'foreignKeyColumnGroup'));
    if (group) relationByGroup.set(group.id, relation);
  }
  const allRelationships = ofType('ForeignKeyColumnGroup').map(group => {
    const parentGroup = ref(field(group, 'parentColumnGroup'));
    const parent = parentGroup && groupOwner.get(parentGroup.id), child = groupOwner.get(group.id);
    const relation = relationByGroup.get(group.id);
    const members = membershipsByGroup.get(group.id) ?? [];
    const parentColumnUuids: string[] = [], childColumnUuids: string[] = [];
    for (const member of members) {
      const parentColumn = ref(field(member.membership, 'parentColumn'));
      if (!parentColumn) { warnings.push(`외래키 ${id(group)}의 부모 컬럼 참조를 해석하지 못했습니다.`); continue; }
      parentColumnUuids.push(id(parentColumn)); childColumnUuids.push(id(member.column));
    }
    if (!parent || !child) warnings.push(`외래키 ${id(group)}의 테이블 소유 관계를 해석하지 못했습니다.`);
    const constraint = ref(field(group, 'foreignKeyConstraint'));
    const physical = ref(field(constraint, 'physicalProperties'));
    return { uuid: id(group), name: name(group), options: foreignKeyOptions(physical, group, text(ofType('Document')[0], 'productId')), parentTableUuid: parent ? id(parent) : '', childTableUuid: child ? id(child) : '',
      parentColumnUuids, childColumnUuids, identifying: field(relation, 'identifying') === true,
      ...(constraint ? { constraintUuid: id(constraint), constraintName: name(constraint) } : {}), ...(relation ? { relationUuid: id(relation) } : {}), ...(parentGroup ? { parentKeyUuid: id(parentGroup) } : {}),
      parentCardinality: text(relation, 'parentCardinalityType', 'EXACTLY_ONE'), childCardinality: text(relation, 'childCardinalityType', 'ZERO_OR_MORE'),
      onDelete: physical?.class.packageUri === 'http://exerd.tomato.com/tibero/model'
        ? (field(physical, 'onDeleteRule') == null ? 'CASCADE' : text(physical, 'onDeleteRule') || 'NO ACTION')
        : text(physical, 'onDeleteRule') || text(physical, 'deleteRule') || text(physical, 'onDeleteReferentialAction') || 'NO ACTION',
      onUpdate: text(physical, 'onUpdateRule') || text(physical, 'onUpdateReferentialAction') || 'NO ACTION' };
  });
  const root = byId.get(document.graph.roots.find((root): root is number => root !== null) ?? -1);
  const database = ref(field(root, 'databaseModel'));
  // Preserve orphan notes as metadata too, rather than silently omitting them.
  const noteIds = new Set(allNotes.map(note => note.uuid));
  for (const note of ofType('Note')) if (!noteIds.has(id(note))) allNotes.push(noteView(note));
  return { name: name(database) || name(root) || '데이터 모델', productId: text(root, 'productId'), termFilePath: text(ref(field(root, 'configuration')), 'termFilePath'),
    tables: allTables, diagrams, domains, relationships: allRelationships, notes: allNotes,
    allTables, allRelationships, allNotes, placements, warnings,
    schemas: ofType('Schema').map(schema => ({ uuid: id(schema), name: name(schema), logicalName: text(schema, 'logicalName') })),
    businessAreas: ofType('BusinessArea').map(area => ({ uuid: id(area), name: name(area) })) };
}

/** Cached by immutable document identity. Unknown diagram IDs fail explicitly. */
export function projectNativeDocument(document: NativeExerdDocument, diagramUuid?: string): NativeDocumentView {
  let projected = cache.get(document);
  if (!projected) { projected = { base: build(document), byDiagram: new Map() }; cache.set(document, projected); }
  if (diagramUuid === undefined) return projected.base;
  const existing = projected.byDiagram.get(diagramUuid); if (existing) return existing;
  const base = projected.base;
  if (!base.diagrams.some(diagram => diagram.uuid === diagramUuid)) throw new Error(`다이어그램을 찾지 못했습니다: ${diagramUuid}`);
  const tableByUuid = new Map(base.allTables.map(table => [table.uuid, table]));
  const tables = base.placements.filter(placement => placement.diagramUuid === diagramUuid).map((placement): NativeTableView | undefined => {
    const table = tableByUuid.get(placement.tableUuid);
    return table && { ...table, x: placement.x, y: placement.y, placementUuid: placement.uuid };
  }).filter((table): table is NativeTableView => !!table);
  const tableUuids = new Set(tables.map(table => table.uuid));
  const hidden = new Set(base.diagrams.find(diagram => diagram.uuid === diagramUuid)?.hiddenRelationUuids || []);
  const view = { ...base, tables, notes: base.allNotes.filter(note => note.diagramUuid === diagramUuid),
    relationships: base.allRelationships.filter(relation => tableUuids.has(relation.parentTableUuid) && tableUuids.has(relation.childTableUuid) && !(relation.relationUuid && hidden.has(relation.relationUuid))) };
  projected.byDiagram.set(diagramUuid, view);
  return view;
}
