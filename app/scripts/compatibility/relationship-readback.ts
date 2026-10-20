/** Verify an original-writer roundtrip without printing private model values. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import registry from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import { compareNativeDocuments, type NativeChange } from '../../src/formats/exerd/compare';
import { nativeGraph } from '../../src/formats/exerd/create';
import { openNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { generateNativeDdl } from '../../src/formats/sql/native-ddl';

const [beforeArg, afterArg, reportArg] = process.argv.slice(2);
if (!beforeArg || !afterArg || !reportArg) throw new Error('Usage: vite-node relationship-readback.ts BEFORE AFTER NEW_REPORT');
const reportPath = resolve(reportArg), analysis = resolve('.analysis');
if (!reportPath.startsWith(analysis + sep) || existsSync(reportPath)) throw new Error('보고서는 .analysis 아래의 새 파일이어야 합니다.');
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const beforeBytes = readFileSync(beforeArg), afterBytes = readFileSync(afterArg);
const before = openNativeDocument(beforeBytes, registry as BinaryRegistry), after = openNativeDocument(afterBytes, registry as BinaryRegistry);
const comparison = compareNativeDocuments(before, after);
function point(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const match = /^Point\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}
function equivalentPoint(change: NativeChange) {
  if (change.objectType !== 'TableDiagram' || change.feature !== 'location') return false;
  const a = point(change.before), b = point(change.after);
  return !!a && !!b && a.every((n, i) => Number.isFinite(n) && n === b[i]);
}
const pointNormalizations = comparison.changes.filter(equivalentPoint);
const unexpected = comparison.changes.filter(c => !equivalentPoint(c));
// Exclude the transient binary:<id> locator, while retaining stable FK identities.
const relations = (document: typeof before) => projectNativeDocument(document).allRelationships.map(({ relationUuid: _, ...relation }) => relation).sort((a, b) => a.uuid.localeCompare(b.uuid));
const membershipIds = (document: typeof before) => document.graph.objects.filter(o => ['ColumnReference', 'PrimaryKeyMembership'].includes(o.class.name)).map(o => nativeGraph.uuid(o)).sort();
const relationsEqual = JSON.stringify(relations(before)) === JSON.stringify(relations(after));
const membershipsEqual = JSON.stringify(membershipIds(before)) === JSON.stringify(membershipIds(after));
const ddlEqual = generateNativeDdl(before).sql === generateNativeDdl(after).sql;
const inputUnchanged = hash(readFileSync(beforeArg)) === hash(beforeBytes) && hash(readFileSync(afterArg)) === hash(afterBytes);
const passed = unexpected.length === 0 && relationsEqual && membershipsEqual && ddlEqual && inputUnchanged;
const report = { passed, before: { path: relative(process.cwd(), resolve(beforeArg)), sha256: hash(beforeBytes), objects: before.graph.objects.length }, after: { path: relative(process.cwd(), resolve(afterArg)), sha256: hash(afterBytes), objects: after.graph.objects.length }, relationships: relations(before).length, relationsEqual, membershipsEqual, ddlEqual, inputUnchanged, pointNormalizations: pointNormalizations.length, rawChanges: comparison.changes, unexpectedChanges: unexpected, uiVerified: false, liveDatabaseVerified: false };
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed, relationships: report.relationships, rawChanges: comparison.changes.length, pointNormalizations: pointNormalizations.length, unexpectedChanges: unexpected.length, relationsEqual, membershipsEqual, ddlEqual, inputUnchanged, report: relative(process.cwd(), reportPath) }));
assert(passed, '원본 재저장 전후의 관계 또는 저장 속성이 다릅니다. 비공개 보고서를 확인하세요.');
