import type { Model } from '../../core/model';
import { validateModel } from '../../core/validation';

type ObjectValue = Record<string, unknown>;
function object(value: unknown, path: string): asserts value is ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: 객체가 필요합니다.`);
}
function fields(value: ObjectValue, path: string, strings: string[], booleans: string[] = []) {
  for (const key of strings) if (typeof value[key] !== 'string') throw new Error(`${path}.${key}: 문자열이 필요합니다.`);
  for (const key of booleans) if (typeof value[key] !== 'boolean') throw new Error(`${path}.${key}: 불리언이 필요합니다.`);
}
function array(value: ObjectValue, key: string, path: string): unknown[] {
  if (!Array.isArray(value[key])) throw new Error(`${path}.${key}: 배열이 필요합니다.`);
  return value[key] as unknown[];
}
function stringArray(value: ObjectValue, key: string, path: string) {
  if (array(value, key, path).some(v => typeof v !== 'string')) throw new Error(`${path}.${key}: 문자열 배열이 필요합니다.`);
}
function choice(value: unknown, allowed: unknown[], path: string) {
  if (!allowed.includes(value)) throw new Error(`${path}: 허용되지 않은 값입니다.`);
}

/** Load only version 1 project documents; reject invalid references before UI use. */
export function parseModel(text: string): Model {
  const value: unknown = JSON.parse(text);
  object(value, 'model');
  choice(value.format, ['erd-maker'], 'model.format');
  choice(value.version, [1], 'model.version');
  choice(value.dialect, ['postgresql', 'mysql', 'sqlite'], 'model.dialect');
  fields(value, 'model', ['id', 'name']);
  array(value, 'subjects', 'model').forEach((s, i) => { object(s, `subjects[${i}]`); fields(s, `subjects[${i}]`, ['id', 'name', 'color']); });
  array(value, 'terms', 'model').forEach((s, i) => { object(s, `terms[${i}]`); fields(s, `terms[${i}]`, ['id', 'logicalName', 'physicalName', 'type', 'description']); });
  array(value, 'tables', 'model').forEach((t, i) => {
    const path = `tables[${i}]`; object(t, path);
    fields(t, path, ['id', 'name', 'logicalName', 'schema', 'comment', 'color', 'subjectId']);
    for (const key of ['x', 'y']) if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) throw new Error(`${path}.${key}: 유한한 숫자가 필요합니다.`);
    array(t, 'columns', path).forEach((c, j) => { object(c, `${path}.columns[${j}]`); fields(c, `${path}.columns[${j}]`, ['id', 'name', 'logicalName', 'type', 'defaultValue', 'comment'], ['nullable', 'primaryKey', 'unique']); });
    array(t, 'indexes', path).forEach((idx, j) => { const p = `${path}.indexes[${j}]`; object(idx, p); fields(idx, p, ['id', 'name'], ['unique']); stringArray(idx, 'columnIds', p); });
  });
  array(value, 'relationships', 'model').forEach((r, i) => {
    const p = `relationships[${i}]`; object(r, p);
    fields(r, p, ['id', 'name', 'parentTableId', 'childTableId'], ['identifying']);
    stringArray(r, 'parentColumnIds', p); stringArray(r, 'childColumnIds', p);
    choice(r.cardinality, ['1:1', '1:N'], `${p}.cardinality`);
    choice(r.onDelete, ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT'], `${p}.onDelete`);
  });
  const model = value as unknown as Model;
  const errors = validateModel(model).filter(i => i.severity === 'error');
  if (errors.length) throw new Error(`유효하지 않은 모델:\n${errors.map(e => e.message).join('\n')}`);
  return model;
}
