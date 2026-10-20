import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep, dirname } from 'node:path';
import { listPackage, extractFile } from '@electron/asar';

// Run after packaging the current dist. Verifies bytes actually shipped in ASAR.
const root = process.cwd();
const archive = resolve(process.argv[2] || 'release/mac-arm64/ERD Maker.app/Contents/Resources/app.asar');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entries = listPackage(archive).map(name => name.replace(/^[/\\]+/, '').replaceAll('\\', '/'));
const forbidden = entries.filter(name => name.split('/').some(part => ['REF', '.analysis', '.git', '.codex', '.agents'].includes(part)) || /\.(?:exerd|jar|exe|map)$/i.test(name));
const compared = [], missing = [], mismatches = [];
function verify(name) {
  const source = readFileSync(resolve(root, name));
  if (!entries.includes(name)) { missing.push(name); return; }
  const packed = extractFile(archive, name);
  const expected = hash(source), actual = hash(packed);
  compared.push({ path: name, bytes: packed.length, sha256: actual });
  if (expected !== actual) mismatches.push({ path: name, expected, actual });
}
function walk(directory) {
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue; // Empty-directory placeholder is intentionally omitted by electron-builder.
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in build: ${name}`);
    if (entry.isDirectory()) walk(name); else if (entry.isFile() && !name.endsWith('.map')) verify(name);
  }
}
walk('dist'); verify('app/desktop/main.cjs');
const expectedAssets = new Set(compared.filter(file => file.path.startsWith('dist/')).map(file => file.path));
const extraAssets = entries.filter(name => name.startsWith('dist/') && /\.[^/]+$/.test(name) && !expectedAssets.has(name));
const report = { createdUtc: new Date().toISOString(), archive: relative(root, archive), archiveBytes: statSync(archive).size,
  archiveSha256: hash(readFileSync(archive)), entries: entries.length, compared, forbidden, missing, mismatches, extraAssets,
  passed: !forbidden.length && !missing.length && !mismatches.length && !extraAssets.length };
if (process.argv[3]) {
  const output = resolve(process.argv[3]), analysisRoot = resolve(root, '.analysis') + sep;
  if (!output.startsWith(analysisRoot)) throw new Error('Report must be a new file under .analysis.');
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ ...report, compared: compared.length }));
if (!report.passed) process.exitCode = 1;
