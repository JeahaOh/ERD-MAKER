import type { Model } from '../../core/model';
const escape = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function download(content: BlobPart, filename: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function modelCsv(model: Model) {
  const rows = [['스키마', '테이블', '테이블 논리명', '컬럼', '컬럼 논리명', '타입', 'PK', 'NULL 허용', 'UNIQUE', '기본값', '설명']];
  model.tables.forEach(t => t.columns.forEach(c => rows.push([t.schema, t.name, t.logicalName, c.name, c.logicalName, c.type, c.primaryKey ? 'Y' : '', c.nullable ? 'Y' : 'N', c.unique ? 'Y' : '', c.defaultValue, c.comment])));
  // Prevent formula execution when CSV is opened in spreadsheet applications.
  return '\uFEFF' + rows.map(row => row.map(v => '"' + (/^[=+\-@\t\r]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
}
export function modelSvg(model: Model) {
  const minX = Math.min(0, ...model.tables.map(t => t.x)) - 50; const minY = Math.min(0, ...model.tables.map(t => t.y)) - 50;
  const width = Math.max(800, ...model.tables.map(t => t.x + 380)) - minX;
  const height = Math.max(500, ...model.tables.map(t => t.y + 85 + t.columns.length * 30)) - minY;
  const relations = model.relationships.map(r => {
    const p = model.tables.find(t => t.id === r.parentTableId), c = model.tables.find(t => t.id === r.childTableId); if (!p || !c) return '';
    const x1 = p.x + 310, y1 = p.y + 67 + Math.max(0, p.columns.findIndex(col => col.id === r.parentColumnIds[0])) * 30;
    const x2 = c.x, y2 = c.y + 67 + Math.max(0, c.columns.findIndex(col => col.id === r.childColumnIds[0])) * 30;
    return `<path d="M${x1},${y1} H${(x1 + x2) / 2} V${y2} H${x2}" fill="none" stroke="#6c7f96" stroke-width="1.5" ${r.identifying ? '' : 'stroke-dasharray="5 4"'} marker-end="url(#many)"/><text x="${(x1 + x2) / 2 + 5}" y="${(y1 + y2) / 2 - 5}" font-size="10" fill="#64748b">${escape(r.name)}</text>`;
  }).join('');
  const tables = model.tables.map(t => `<g transform="translate(${t.x},${t.y})"><rect width="310" height="${65 + t.columns.length * 30}" rx="8" fill="white" stroke="#ccd6e1"/><path d="M8 0 H302 Q310 0 310 8 V46 H0 V8 Q0 0 8 0" fill="${/^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#0f9f8f'}"/><text x="14" y="20" fill="white" font-weight="600" font-size="13">${escape(t.logicalName || t.name)}</text><text x="14" y="36" fill="white" font-size="10">${escape(t.schema ? t.schema + '.' + t.name : t.name)}</text>${t.columns.map((c, i) => `<text x="12" y="${68 + i * 30}" font-size="11" fill="${c.primaryKey ? '#0d9488' : '#3a4a60'}">${c.primaryKey ? '◆ ' : '   '}${escape(c.name)}</text><text x="295" text-anchor="end" y="${68 + i * 30}" fill="#7c899a" font-size="10">${escape(c.type)}</text>`).join('')}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}"><defs><marker id="many" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0,1 L10,6 L0,11 M0,6 H10" fill="none" stroke="#6c7f96"/></marker></defs><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#f5f7fa"/><g font-family="system-ui, sans-serif">${relations}${tables}</g></svg>`;
}
