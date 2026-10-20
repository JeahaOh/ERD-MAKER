/** Rasterize a generated, self-contained SVG within a bounded browser canvas. */
export async function diagramPng(svg: string, width: number, height: number): Promise<{ bytes: Uint8Array; width: number; height: number; scaled: boolean }> {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('이미지 크기가 유효하지 않습니다.');
  const ratio = Math.min(1, 8192 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  const outputWidth = Math.max(1, Math.floor(width * ratio)), outputHeight = Math.max(1, Math.floor(height * ratio));
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') throw new Error('SVG 이미지 형식을 읽지 못했습니다.');
  xml.documentElement.setAttribute('width', String(outputWidth)); xml.documentElement.setAttribute('height', String(outputHeight));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(xml)], { type: 'image/svg+xml' }));
  try {
    const picture = new Image(); picture.src = url; await picture.decode();
    const canvas = document.createElement('canvas'); canvas.width = outputWidth; canvas.height = outputHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('이 환경에서 PNG 이미지를 만들 수 없습니다. SVG로 저장해 주세요.');
    context.drawImage(picture, 0, 0, outputWidth, outputHeight);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('PNG 이미지 저장에 실패했습니다.')), 'image/png'));
    canvas.width = canvas.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: outputWidth, height: outputHeight, scaled: ratio < 1 };
  } finally { URL.revokeObjectURL(url); }
}
