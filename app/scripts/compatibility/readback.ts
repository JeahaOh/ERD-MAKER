/** Read private compatibility artifacts without printing business names or values. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import registry from '../../src/formats/exerd/schema.generated.json' with { type: 'json' };
import type { BinaryRegistry } from '../../src/formats/exerd/binary';
import { openNativeDocument, saveNativeDocument } from '../../src/formats/exerd/native-document';
import { projectNativeDocument } from '../../src/formats/exerd/view';
import { validateNativeDocument } from '../../src/formats/exerd/validation';
for (const input of process.argv.slice(2)) {
  const bytes = readFileSync(input), document = openNativeDocument(bytes, registry as BinaryRegistry);
  const view = projectNativeDocument(document), diagnostics = validateNativeDocument(document);
  const serialized = openNativeDocument(saveNativeDocument(document), registry as BinaryRegistry);
  if (serialized.graph.objects.length !== document.graph.objects.length) throw new Error('재직렬화 중 객체 수가 변경됐습니다.');
  console.log(JSON.stringify({ input, sha256: createHash('sha256').update(bytes).digest('hex'), objects: document.graph.objects.length, xmlUuids: document.xml.byUuid.size, tables: view.allTables.length, columns: view.allTables.reduce((n, t) => n + t.columns.length, 0), foreignKeys: view.allRelationships.length, diagrams: view.diagrams.length, domains: view.domains.length, notes: view.allNotes.length, placements: view.placements.length, errors: diagnostics.filter(d => d.severity === 'error').length, warnings: diagnostics.filter(d => d.severity === 'warning').length, reserializedReadback: true }));
}
