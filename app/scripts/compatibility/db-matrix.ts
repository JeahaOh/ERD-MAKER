/** Local evidence generator. Vendor samples remain under .analysis and never ship.
 * Run: npx vite-node app/scripts/compatibility/db-matrix.ts -- --run-db-matrix --out .analysis/db-matrix/run-1
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import registryJson from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import { readBinary, writeBinary, type BinaryRegistry, type BinaryGraph, type BinaryObject } from '../../src/formats/exerd/binary';
import { readContainer, writeContainer, type ExerdHeader } from '../../src/formats/exerd/container';
import { editNativeAttributes, openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';

export interface ProductFact { id: string; family: string; label: string; packageClass: string; packageUris: string[]; propertyProvider: string; plugin: string }
export interface EmbeddedSample { plugin: string; entry: string; sha256: string; bytes: Uint8Array }
export interface ArchiveInventory { archiveSha256: string; products: ProductFact[]; embeddedSamples: EmbeddedSample[]; scannedJars: number }
export interface SampleInput { path: string; provenance: 'embedded-history' | 'vendor-generated' | 'user-supplied' | 'independent-generated'; expectedProductId?: string }
const utf8 = new TextDecoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false });
const magic = new TextEncoder().encode('eXERD File');
const unicodeProperties = (text: string) => text.replace(/\\u([\da-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const family = (id: string) => id.replace('com.tomato.db.', '').replace(/_.*$/, '').replace(/^cubrid10$/, 'cubrid');
/** Archive scan uses signature bytes, not suffixes: legacy samples can have .erd names. */
export function scanUpdateSite(bytes: Uint8Array): ArchiveInventory {
  const products: ProductFact[] = [], embeddedSamples: EmbeddedSample[] = [];
  const jars = Object.entries(unzipSync(bytes)).filter(([name]) => name.startsWith('plugins/') && name.endsWith('.jar'));
  const packageUris = new Map<string, Set<string>>();
  const pending: Array<Omit<ProductFact, 'packageUris'>> = [];
  for (const [plugin, jar] of jars) {
    const entries = unzipSync(jar);
    const xml = entries['plugin.xml'];
    if (xml) {
      const data = parser.parse(utf8.decode(xml));
      for (const extension of array<any>(data.plugin?.extension)) {
        if (extension.point === 'org.eclipse.emf.ecore.generated_package') for (const pkg of array<any>(extension.package)) {
          if (typeof pkg.class === 'string' && typeof pkg.uri === 'string') {
            if (!packageUris.has(pkg.class)) packageUris.set(pkg.class, new Set());
            packageUris.get(pkg.class)!.add(pkg.uri);
          }
        }
        if (extension.point === 'com.tomato.exerd.model.ui.product') for (const product of array<any>(extension.product)) {
          if (typeof product.id !== 'string' || !product.id.startsWith('com.tomato.db.')) continue;
          let label = String(product.name || product.id);
          if (label.startsWith('%')) {
            const key = label.slice(1);
            for (const path of ['OSGI-INF/l10n/bundle_ko.properties', 'OSGI-INF/l10n/bundle.properties', 'plugin.properties']) {
              const props = entries[path]; if (!props) continue;
              const line = unicodeProperties(utf8.decode(props)).split(/\r?\n/).find(l => l.slice(0, l.indexOf('=')).trim() === key);
              if (line) { label = line.slice(line.indexOf('=') + 1).trim().replace(/\\u([\da-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16))); break; }
            }
          }
          pending.push({ id: product.id, family: family(product.id), label, packageClass: product.ePackage || '', propertyProvider: product.defaultPropertyProvider || '', plugin });
        }
      }
    }
    for (const [entry, data] of Object.entries(entries)) if (data.length >= magic.length && magic.every((b, i) => data[i] === b)) embeddedSamples.push({ plugin, entry, sha256: hash(data), bytes: data });
  }
  for (const item of pending) products.push({ ...item, packageUris: [...(packageUris.get(item.packageClass) || [])].sort() });
  return { archiveSha256: hash(bytes), products: products.sort((a, b) => a.id.localeCompare(b.id)), embeddedSamples, scannedJars: jars.length };
}
const value = (object: BinaryObject | undefined, name: string) => object?.features.find(f => f.name === name)?.value;
const json = (value: unknown) => JSON.stringify(value, (_, value) => typeof value === 'bigint' ? { bigint: String(value) } : value);
const canonical = (graph: BinaryGraph) => json({ ...graph, consumedBytes: 0 });
export function inspectDatabaseSample(bytes: Uint8Array, registry: BinaryRegistry = registryJson as BinaryRegistry) {
  const started = performance.now(), container = readContainer(bytes), graph = readBinary(container.binary, registry);
  const document = graph.objects.find(o => o.class.name === 'Document');
  const counts: Record<string, number> = {}, extensionCounts: Record<string, number> = {}, featureKinds: Record<string, number> = {};
  const featureIdMismatches: string[] = [];
  for (const object of graph.objects) {
    const key = `${object.class.packageUri}#${object.class.name}`;
    counts[key] = (counts[key] || 0) + 1;
    if (object.class.packageUri !== 'http://exerd.tomato.com/model') extensionCounts[key] = (extensionCounts[key] || 0) + 1;
    const schema = registry.packages.find(p => p.namespaceURI === object.class.packageUri)?.classes.find(c => c.name === object.class.name);
    for (const feature of object.features) {
      featureKinds[feature.kind] = (featureKinds[feature.kind] || 0) + 1;
      if (schema?.features.find(f => f.name === feature.name)?.id !== feature.id) featureIdMismatches.push(`${key}.${feature.name}:${feature.id}`);
    }
  }
  if (featureIdMismatches.length) throw new Error(`등록 schema와 feature ID가 ${featureIdMismatches.length}곳에서 다릅니다.`);
  const reencodedBinary = writeBinary(graph), decoded = readBinary(reencodedBinary, registry);
  if (canonical(decoded) !== canonical(graph)) throw new Error('재인코딩 후 전체 객체·참조·순서가 달라졌습니다.');
  const native = openNativeDocument(bytes, registry);
  const saved = saveNativeDocument(native);
  if (canonical(openNativeDocument(saved, registry).graph) !== canonical(graph)) throw new Error('Native 저장 후 그래프 차이');
  const target = graph.objects.find(o => o.class.name === 'Table' && typeof value(o, 'UUID') === 'string');
  if (!target) throw new Error('scalar 편집 검증할 Table이 없습니다.');
  const uuid = value(target, 'UUID') as string, before = value(target, 'logicalName');
  const editValue = `DB 호환 검증 ${typeof before === 'string' ? before : ''}`;
  const edited = saveNativeDocument(editNativeAttributes(native, registry, [{ uuid, name: 'logicalName', value: editValue }]));
  const editedGraph = openNativeDocument(edited, registry).graph;
  const changes: string[] = [];
  for (let i = 0; i < graph.objects.length; i++) {
    const a = graph.objects[i], b = editedGraph.objects[i];
    if (!b || JSON.stringify(a.class) !== JSON.stringify(b.class)) throw new Error('scalar 편집으로 클래스가 변경됐습니다.');
    for (const name of new Set([...a.features.map(f => f.name), ...b.features.map(f => f.name)])) if (json(value(a, name)) !== json(value(b, name))) changes.push(`${i}:${name}`);
  }
  if (editedGraph.objects.length !== graph.objects.length || changes.some(c => c !== `${target.id}:logicalName` && c !== `${target.id}:derivedLogicalName`)) throw new Error('scalar 편집 외 속성이 변경됐습니다.');
  return {
    report: { inputSha256: hash(bytes), header: container.header, binaryVersion: graph.version, binaryBytes: container.binary.length, consumedBytes: graph.consumedBytes, productId: value(document, 'productId') ?? null, databaseVersion: value(document, 'databaseVersion') ?? null, producerVersion: value(document, 'version') ?? null, objects: graph.objects.length, tables: graph.objects.filter(o => o.class.name === 'Table').length, classes: counts, extensionClasses: extensionCounts, featureKinds, featureIdMismatches, binaryBitIdentical: Buffer.from(reencodedBinary).equals(Buffer.from(container.binary)), nativeRoundtrip: true, scalarEdit: { uuid, feature: 'logicalName', before: before ?? null, after: editValue, changedFeatures: changes }, elapsedMs: Math.round(performance.now() - started) },
    reencoded: writeContainer({ ...container, binary: reencodedBinary }), edited,
  };
}
export function runDatabaseMatrix(archivePath: string, outPath: string, manifest: SampleInput[] = []) {
  const out = resolve(outPath), analysis = resolve('.analysis');
  if (!out.startsWith(analysis + sep) || existsSync(out)) throw new Error('.analysis 아래 새 디렉터리만 결과로 사용할 수 있습니다.');
  const archive = resolve(archivePath), beforeArchiveHash = hash(readFileSync(archive));
  const inventory = scanUpdateSite(readFileSync(archive));
  mkdirSync(out, { recursive: true });
  const samples: Array<SampleInput & { bytes: Uint8Array }> = manifest.map(input => ({ ...input, bytes: new Uint8Array(readFileSync(input.path)) }));
  for (let i = 0; i < inventory.embeddedSamples.length; i++) {
    const sample = inventory.embeddedSamples[i], path = resolve(out, `embedded-${i}-${basename(sample.entry)}.exerd`);
    writeFileSync(path, sample.bytes); samples.push({ path, provenance: 'embedded-history', bytes: sample.bytes });
  }
  const reports = samples.map((sample, index) => {
    const inputHash = hash(readFileSync(sample.path));
    let header: ExerdHeader | undefined;
    try {
      header = readContainer(sample.bytes).header;
      const result = inspectDatabaseSample(sample.bytes);
      if (sample.expectedProductId && result.report.productId !== sample.expectedProductId) throw new Error(`DB identity 불일치: expected ${sample.expectedProductId}, actual ${result.report.productId}`);
      const stem = `sample-${index}-${family(String(result.report.productId))}`;
      writeFileSync(resolve(out, stem + '-roundtrip.exerd'), result.reencoded);
      writeFileSync(resolve(out, stem + '-edited.exerd'), result.edited);
      if (hash(readFileSync(sample.path)) !== inputHash) throw new Error('입력 파일이 변경됐습니다.');
      return { input: sample.path, provenance: sample.provenance, status: 'passed', ...result.report, roundtripFile: stem + '-roundtrip.exerd', editedFile: stem + '-edited.exerd' };
    } catch (error) { return { input: sample.path, provenance: sample.provenance, status: 'failed', inputSha256: inputHash, header, error: String(error instanceof Error ? error.message : error) }; }
  });
  if (hash(readFileSync(archive)) !== beforeArchiveHash) throw new Error('원본 archive가 변경됐습니다.');
  const report = { archive: archivePath, archiveSha256: inventory.archiveSha256, scannedJars: inventory.scannedJars, products: inventory.products, embeddedSamples: inventory.embeddedSamples.map(({ bytes: _bytes, ...sample }) => sample), samples: reports };
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
const invocationIndex = process.argv.findIndex(arg => resolve(arg) === fileURLToPath(import.meta.url));
if (invocationIndex >= 1 || process.argv.includes('--run-db-matrix')) {
  const args = process.argv.slice(invocationIndex >= 1 ? invocationIndex + 1 : 2).filter(a => a !== '--');
  const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const manifestPath = option('--manifest', '');
  const report = runDatabaseMatrix(option('--archive', 'REF/updateSite.zip'), option('--out', `.analysis/db-matrix/run-${Date.now()}`), manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : []);
  console.log(JSON.stringify({ products: report.products.length, families: new Set(report.products.map(p => p.family)).size, embeddedSamples: report.embeddedSamples.length, results: report.samples.map(s => ({ status: s.status, input: s.input })) }));
}
