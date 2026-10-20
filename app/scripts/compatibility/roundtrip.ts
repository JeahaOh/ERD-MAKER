/** Local compatibility artifact generator. Run from repo root with vite-node. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import registryJson from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import { openNativeDocument, editNativeAttributes, saveNativeDocument } from '../../src/formats/exerd/native-document';

const input = resolve(process.argv[2] || 'REF/S2B_DA_D00_ERD_20260922_V1.0.exerd');
const output = resolve(process.argv[3] || '.analysis/compatibility/typescript-edited.exerd');
const ref = resolve('REF');
if (output === input || output === ref || output.startsWith(ref + sep) || existsSync(output)) throw new Error('입력·REF·기존 결과 파일을 덮어쓸 수 없습니다.');
const original = readFileSync(input), beforeHash = createHash('sha256').update(original).digest('hex');
const started = performance.now();
const document = openNativeDocument(original, registryJson as BinaryRegistry);
const table = document.graph.objects.find(o => o.class.name === 'Table' && o.features.some(f => f.name === 'logicalName'));
if (!table) throw new Error('편집 검증할 테이블이 없습니다.');
const uuid = table.features.find(f => f.name === 'UUID')?.value;
if (typeof uuid !== 'string') throw new Error('UUID가 없습니다.');
const before = table.features.find(f => f.name === 'logicalName')!.value;
const value = `ERD Maker 검증 ${before}`;
const edited = editNativeAttributes(document, registryJson as BinaryRegistry, [{ uuid, name: 'logicalName', value }]);
const bytes = saveNativeDocument(edited);
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes);
const afterHash = createHash('sha256').update(readFileSync(input)).digest('hex');
if (beforeHash !== afterHash) throw new Error('입력 해시가 변경됐습니다.');
console.log(JSON.stringify({ input: relative(process.cwd(), input), inputSha256: beforeHash, output: relative(process.cwd(), output), outputSha256: createHash('sha256').update(bytes).digest('hex'), objects: edited.graph.objects.length, xmlUuids: edited.xml.byUuid.size, changedUuid: uuid, changedFeature: 'logicalName', elapsedMs: Math.round(performance.now() - started) }));
