/** Ten alternating independent writer cycles; private input and graphs stay in .analysis. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, basename, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import registryJson from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';

const source = resolve(process.argv[2] || '.analysis/oracle/ui/workspace/OracleReview/gui-resaved.exerd');
const destination = resolve(process.argv[3] || `.analysis/compatibility/cycles-${Date.now()}`);
if (!destination.startsWith(resolve('.analysis') + sep) || existsSync(destination)) throw new Error('결과는 .analysis 아래의 새 디렉터리에만 기록할 수 있습니다.');
if (!existsSync(source)) throw new Error('검증할 입력 파일이 없습니다.');
mkdirSync(destination, { recursive: true });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const inputHash = digest(readFileSync(source));
const registry = registryJson as BinaryRegistry;
const oracle = (file: string, save?: string) => {
  const result = spawnSync('python3', ['app/scripts/compatibility/original_oracle.py', file, ...(save ? ['--save', save] : [])], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(resolve(destination, basename(file) + '.oracle.log'), result.stdout + result.stderr);
  if (result.status !== 0) throw new Error(`원본 읽기·저장 실패: ${basename(file)}. 비공개 로그를 확인하세요.`);
  return JSON.parse(readFileSync(resolve('.analysis/oracle/output', basename(file) + '.graph.json'), 'utf8')) as Record<string, { type: string; features: Record<string, unknown> }>;
};
const initialView = projectNativeDocument(openNativeDocument(readFileSync(source), registry));
const counts = (v: typeof initialView) => [v.allTables.length, v.allTables.reduce((n, t) => n + t.columns.length, 0), v.allRelationships.length, v.domains.length, v.diagrams.length, v.placements.length, v.allNotes.length];
const reference = oracle(source), cycleReports: object[] = [];
let current = source;
for (let cycle = 1; cycle <= 10; cycle++) {
  const started = performance.now();
  const document = openNativeDocument(readFileSync(current), registry);
  const output = resolve(destination, `cycle-${cycle}-typescript.exerd`), vendorOutput = resolve(destination, `cycle-${cycle}-vendor.exerd`);
  writeFileSync(output, saveNativeDocument(document));
  const graph = oracle(output, vendorOutput);
  const differences: string[] = [];
  for (const uuid of new Set([...Object.keys(reference), ...Object.keys(graph)])) {
    const a = reference[uuid], b = graph[uuid];
    if (!a || !b || a.type !== b.type) { differences.push(uuid + ':object'); continue; }
    for (const feature of new Set([...Object.keys(a.features), ...Object.keys(b.features)])) {
      if (JSON.stringify(a.features[feature]) === JSON.stringify(b.features[feature])) continue;
      // The original serializer legitimately replaces its own producer version.
      if (a.type === 'http://exerd.tomato.com/model#Document' && feature === 'version') continue;
      differences.push(uuid + ':' + feature);
    }
  }
  if (differences.length) { writeFileSync(resolve(destination, `cycle-${cycle}-differences.json`), JSON.stringify(differences)); throw new Error(`모델 속성 차이 ${differences.length}건이 발견되었습니다.`); }
  const readback = projectNativeDocument(openNativeDocument(readFileSync(vendorOutput), registry));
  if (JSON.stringify(counts(readback)) !== JSON.stringify(counts(initialView))) throw new Error('원본 재저장 후 모델 개수가 바뀌었습니다.');
  const report = { cycle, persistedGraphDifferences: differences.length, objects: Object.keys(graph).length, counts: counts(readback), elapsedMs: Math.round(performance.now() - started) };
  cycleReports.push(report); console.log(JSON.stringify(report));
  current = vendorOutput;
}
if (digest(readFileSync(source)) !== inputHash) throw new Error('입력 파일 해시가 변경되었습니다.');
const result = { input: relative(process.cwd(), source), inputSha256: inputHash, inputUnchanged: true, cycles: cycleReports, excludedProducerVersion: true, uiCycles: 0, final: relative(process.cwd(), current) };
writeFileSync(resolve(destination, 'report.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ complete: true, cycles: cycleReports.length, inputUnchanged: true, directory: relative(process.cwd(), destination) }));
