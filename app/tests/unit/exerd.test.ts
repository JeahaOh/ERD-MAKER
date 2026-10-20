import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { importExerd, importExerdFile } from '../../src/formats/exerd/import';

// Independent miniature fixture: invented names and IDs, observed public XMI shape.
const fixture = `<?xml version="1.1" encoding="utf-8"?>
<e:Document xmlns:e="http://exerd.tomato.com/model" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" UUID="doc" productId="com.tomato.db.postgresql" openedDiagrams="diagram">
<relationManager><relation key="fk"><value foreignKeyColumnGroup="fk" identifying="true" childCardinalityType="EXACTLY_ONE"/></relation></relationManager>
<configuration><domainDefinition><domain UUID="domain" name="코드" suggestedDataType="VARCHAR(20)"/></domainDefinition></configuration>
<businessAreas UUID="area" logicalName="영업" tables="parent child"><diagrams UUID="diagram" logicalName="업무"><diagramEntry table="parent" location="Point(12.5, 80.0)"/><diagramEntry table="child" location="Point(400.0, 80.0)"/></diagrams></businessAreas>
<databaseModel logicalName="테스트"><schema physicalName="public">
<tables UUID="parent" physicalName="account" logicalName="계정" comment="a &amp; b"><columns UUID="pk" physicalName="id" logicalName="식별자" dataType="BIGINT" notNull="TRUE"><memberships key="primary"><value xsi:type="e:PrimaryKeyMembership" group="primary"/></memberships></columns><columnGroups xsi:type="e:PrimaryKeyColumnGroup" UUID="primary"/></tables>
<tables UUID="child" physicalName="profile" logicalName="프로필"><columns UUID="child-pk" physicalName="account_id" dataType="BIGINT" notNull="TRUE"><memberships key="child-primary"><value xsi:type="e:PrimaryKeyMembership" group="child-primary"/></memberships><memberships key="fk"><value xsi:type="e:ColumnReference" group="fk" parentColumn="pk" entryIndex="0"/></memberships></columns><columns UUID="code" physicalName="code" domain="domain" notNull="FALSE" defaultValue="'A'"/><columnGroups UUID="child-primary" xsi:type="e:PrimaryKeyColumnGroup"/><columnGroups UUID="fk" physicalName="fk_profile_account" xsi:type="e:ForeignKeyColumnGroup" parentColumnGroup="primary"/></tables>
</schema></databaseModel></e:Document>`;

describe('eXERD XMI import', () => {
  it('preserves table/column identity, names, domain types, nulls, references and coordinates', () => {
    const { model, warnings } = importExerd(fixture);
    expect(model.name).toBe('테스트');
    expect(model.dialect).toBe('postgresql');
    expect(model.tables[0]).toMatchObject({ id: 'parent', name: 'account', logicalName: '계정', schema: 'public', comment: 'a & b', x: 12.5, y: 80, subjectId: 'area' });
    expect(model.tables[1].columns[1]).toMatchObject({ type: 'VARCHAR(20)', nullable: true, defaultValue: "'A'" });
    expect(model.tables[0].columns[0]).toMatchObject({ primaryKey: true, nullable: false });
    expect(model.relationships).toEqual([{ id: 'fk', name: 'fk_profile_account', parentTableId: 'parent', childTableId: 'child', parentColumnIds: ['pk'], childColumnIds: ['child-pk'], identifying: true, cardinality: '1:1', onDelete: 'NO ACTION' }]);
    expect(warnings.join('\n')).toContain('부분 호환');
  });
  it('orders composite foreign key columns by membership entryIndex', () => {
    const composite = fixture.replace('entryIndex="0"', 'entryIndex="1"')
      .replace('<columnGroups xsi:type="e:PrimaryKeyColumnGroup" UUID="primary"/>', '<columns UUID="pk2" physicalName="region_id" dataType="BIGINT" notNull="TRUE"><memberships key="primary"><value xsi:type="e:PrimaryKeyMembership" group="primary"/></memberships></columns><columnGroups xsi:type="e:PrimaryKeyColumnGroup" UUID="primary"/>')
      .replace('<columnGroups UUID="child-primary"', '<columns UUID="child-region" physicalName="region_id" dataType="BIGINT" notNull="TRUE"><memberships key="fk"><value xsi:type="e:ColumnReference" group="fk" parentColumn="pk2" entryIndex="0"/></memberships></columns><columnGroups UUID="child-primary"');
    const relation = importExerd(composite).model.relationships[0];
    expect(relation.parentColumnIds).toEqual(['pk2', 'pk']);
    expect(relation.childColumnIds).toEqual(['child-region', 'child-pk']);
  });
  it('warns when source DBMS cannot be represented by the current product', () => {
    expect(importExerd(fixture.replace('com.tomato.db.postgresql', 'com.tomato.db.oracle_10g')).warnings.join(' ')).toContain('PostgreSQL을 임시 선택');
  });
  it('drops unresolved references with an explicit warning', () => {
    const result = importExerd(fixture.replace('parentColumn="pk"', 'parentColumn="missing"'));
    expect(result.model.relationships).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('참조를 확인하지 못해 제외');
  });
  it('rejects unrelated XML, malformed XML, DTD/entity input and duplicate IDs', () => {
    expect(() => importExerd('<root/>')).toThrow('Document');
    expect(() => importExerd('<e:Document>')).toThrow('형식 오류');
    expect(() => importExerd('<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + fixture)).toThrow('엔티티');
    expect(() => importExerd(fixture.replace('UUID="child"', 'UUID="parent"'))).toThrow('중복 식별자');
  });
  it('accepts XML files and rejects invalid binary headers', () => {
    expect(importExerdFile(new TextEncoder().encode(fixture)).model.tables).toHaveLength(2);
    expect(() => importExerdFile(new Uint8Array([0, 1, 2]))).toThrow('헤더');
  });
});

for (const archive of ['REF/updateSite.zip', 'REF/updateSite (1).zip']) {
  describe.skipIf(!existsSync(archive))(`actual user reference ${archive}`, () => {
    let samples: { name: string; bytes: Uint8Array }[] | undefined;
    const load = () => {
      if (samples) return samples;
      const bundles = unzipSync(new Uint8Array(readFileSync(archive)), { filter: f => f.name.includes('com.tomato.exerd.intro_') && f.name.endsWith('.jar') });
      const intro = Object.values(bundles)[0];
      const zipExamples = unzipSync(intro, { filter: f => /examples\/(pos|study)\.zip$/.test(f.name) });
      samples = Object.entries(zipExamples).flatMap(([name, bytes]) => Object.entries(unzipSync(bytes, { filter: f => f.name.endsWith('.exerd') })).map(([file, data]) => ({ name: `${name}/${file}`, bytes: data })));
      return samples;
    };
    it('reads all bundled language variants and preserves every table/column/foreign key', () => {
      const actual = load();
      expect(actual.length).toBeGreaterThanOrEqual(4);
      for (const sample of actual) {
        const { model, warnings } = importExerdFile(sample.bytes);
        const counts = sample.name.includes('/pos.zip') ? [9, 42, 8] : [14, 41, 16];
        expect([model.tables.length, model.tables.reduce((n, t) => n + t.columns.length, 0), model.relationships.length], sample.name).toEqual(counts);
        expect(new Set(model.tables.flatMap(t => [t.id, ...t.columns.map(c => c.id)])).size).toBe(counts[0] + counts[1]);
        for (const relation of model.relationships) {
          const parent = model.tables.find(t => t.id === relation.parentTableId)!;
          const child = model.tables.find(t => t.id === relation.childTableId)!;
          expect(relation.parentColumnIds.every(id => parent.columns.some(c => c.id === id))).toBe(true);
          expect(relation.childColumnIds.every(id => child.columns.some(c => c.id === id))).toBe(true);
        }
        expect(warnings.some(w => w.includes('외래키') && w.includes('제외'))).toBe(false);
        expect(warnings.some(w => w.includes('부분 호환'))).toBe(true);
      }
    });
    it('rejects damaged compressed content rather than loading silent corruption', () => {
      const damaged = new Uint8Array(load()[0].bytes);
      const data = new DataView(damaged.buffer);
      const start = 26 + data.getUint32(22, false) + 8;
      const length = data.getUint32(start - 4, false);
      damaged[start + length - 12] ^= 0x01; // CRC in first local-entry descriptor.
      expect(() => importExerdFile(damaged)).toThrow('CRC');
    });
  });
}
