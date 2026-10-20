import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { inspectDatabaseSample, scanUpdateSite, runDatabaseMatrix } from '../../scripts/compatibility/db-matrix';
import { createNativeDocument } from '../../src/formats/exerd/create';
import { saveNativeDocument, openNativeDocument } from '../../src/formats/exerd/native-document';
import registryJson from '../../src/formats/exerd/schema.generated.json';
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
const registry = registryJson as BinaryRegistry;

describe('database compatibility evidence generator', () => {
  it('reads registered products and finds native bytes even with a legacy .erd extension', () => {
    const native = saveNativeDocument(createNativeDocument('독립 샘플'));
    const plugin = `<plugin><extension point="com.tomato.exerd.model.ui.product"><product id="com.tomato.db.cubrid10" name="%name" ePackage="test.CubridPackage" defaultPropertyProvider="test.Provider"/></extension><extension point="org.eclipse.emf.ecore.generated_package"><package class="test.CubridPackage" uri="urn:test:cubrid"/></extension></plugin>`;
    const jar = zipSync({ 'plugin.xml': strToU8(plugin), 'OSGI-INF/l10n/bundle_ko.properties': strToU8('name=CUBRID 10'), 'model/history/example.erd': native, 'fake.exerd': strToU8('not a native model') });
    const result = scanUpdateSite(zipSync({ 'plugins/test.jar': jar }));
    expect(result.scannedJars).toBe(1);
    expect(result.products).toEqual([{ id: 'com.tomato.db.cubrid10', family: 'cubrid', label: 'CUBRID 10', packageClass: 'test.CubridPackage', propertyProvider: 'test.Provider', packageUris: ['urn:test:cubrid'], plugin: 'plugins/test.jar' }]);
    expect(result.embeddedSamples).toHaveLength(1);
    expect(result.embeddedSamples[0].entry).toBe('model/history/example.erd');
    expect(result.embeddedSamples[0].bytes).toEqual(native);
  });
  it('keeps DB2 identity and reports absent samples without inventing a successful test', () => {
    const jar = zipSync({ 'plugin.xml': strToU8('<plugin><extension point="com.tomato.exerd.model.ui.product"><product id="com.tomato.db.db2" name="DB2"/></extension></plugin>') });
    const result = scanUpdateSite(zipSync({ 'plugins/db2.jar': jar }));
    expect(result.products[0].family).toBe('db2');
    expect(result.embeddedSamples).toEqual([]);
  });
  it('independently reencodes all objects and synchronizes one scalar edit without relabeling database identity', () => {
    const source = createNativeDocument('DB 검증'), bytes = saveNativeDocument(source), snapshot = bytes.slice();
    const result = inspectDatabaseSample(bytes);
    expect(bytes).toEqual(snapshot);
    expect(result.report.productId).toBe('com.tomato.db.postgresql');
    expect(result.report.consumedBytes).toBe(result.report.binaryBytes);
    expect(result.report.binaryBitIdentical).toBe(true);
    expect(result.report.featureIdMismatches).toEqual([]);
    expect(result.report.scalarEdit.changedFeatures).toHaveLength(2);
    const edited = openNativeDocument(result.edited, registry);
    const table = edited.byUuid.get(result.report.scalarEdit.uuid)!;
    expect(table.features.find(f => f.name === 'logicalName')?.value).toBe(result.report.scalarEdit.after);
    expect(edited.graph.objects).toHaveLength(source.graph.objects.length);
  });
  it('refuses unsupported schema and all output locations outside a fresh private evidence directory', () => {
    const bytes = saveNativeDocument(createNativeDocument());
    expect(() => inspectDatabaseSample(bytes, { packages: [] })).toThrow('Unknown class schema');
    expect(() => runDatabaseMatrix('REF/updateSite.zip', 'REF/output')).toThrow('새 디렉터리');
    expect(() => runDatabaseMatrix('REF/updateSite.zip', '.analysis')).toThrow('새 디렉터리');
  });
});
