import type { BinaryClass, BinaryFeatureDefinition, BinaryRegistry, BinaryValue } from './binary';

/** Validates the editable subset before vendor-specific datatype conversion can fail. */
export function parseNativeScalar(definition: BinaryFeatureDefinition, owner: BinaryClass, value: string, registry: BinaryRegistry): BinaryValue {
  const kind = definition.kind;
  if (kind === 'STRING') return value;
  if (kind === 'DATA') {
    const type = String(definition.type || ''), [uri, name] = type.split('#//');
    const pkg = registry.packages.find(p => p.namespaceURI === (uri || owner.packageUri));
    const enums = pkg?.enumerations as Array<{ name: string; literals: Array<{ literal: string }> }> | undefined;
    const enumeration = enums?.find(e => e.name === name);
    if (enumeration) {
      if (!enumeration.literals.some(l => l.literal === value)) throw new Error(`${name} 속성에 허용되지 않는 값입니다.`);
      return value;
    }
    if (name === 'Point') {
      const match = /^Point\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(value);
      if (!match || !match.slice(1).every(n => Number(n) >= -2147483648 && Number(n) <= 2147483647)) throw new Error('좌표는 Point(x, y) 형식의 32비트 정수여야 합니다.');
      return `Point(${Number(match[1])}, ${Number(match[2])})`;
    }
    throw new Error(`${name || type} 사용자 정의 자료형은 전용 편집기를 사용해야 합니다.`);
  }
  if (kind === 'BOOLEAN') { if (value !== 'true' && value !== 'false') throw new Error('Boolean 속성은 true 또는 false여야 합니다.'); return value === 'true'; }
  if (kind === 'CHAR') { if (value.length !== 1) throw new Error('CHAR 속성은 UTF-16 코드 단위 1개여야 합니다.'); return value; }
  if (kind === 'LONG') { if (!/^-?\d+$/.test(value)) throw new Error('LONG 속성은 정수여야 합니다.'); const n = BigInt(value); if (n < -(1n << 63n) || n >= 1n << 63n) throw new Error('LONG 범위를 초과합니다.'); return n; }
  if (['BYTE', 'SHORT', 'INT', 'FLOAT', 'DOUBLE'].includes(kind)) {
    if (!value.trim()) throw new Error('수치 속성에 빈 값을 저장할 수 없습니다.');
    const n = Number(value);
    if (!Number.isFinite(n) || kind === 'FLOAT' && !Number.isFinite(Math.fround(n))) throw new Error('유효한 수치 또는 자료형 범위가 아닙니다.');
    const ranges: Record<string, [number, number]> = { BYTE: [-128, 127], SHORT: [-32768, 32767], INT: [-2147483648, 2147483647] };
    if (ranges[kind] && (!Number.isInteger(n) || n < ranges[kind][0] || n > ranges[kind][1])) throw new Error(`${kind} 정수 범위를 초과합니다.`);
    return n;
  }
  throw new Error(`참조·목록·구조 속성 '${kind}'은 별도의 구조 편집 명령이 필요합니다.`);
}
