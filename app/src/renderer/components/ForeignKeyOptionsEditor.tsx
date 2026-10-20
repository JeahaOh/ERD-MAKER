import { useEffect, useState } from 'react';
import type { NativeRelationshipView } from '../../formats/exerd/view';
import type { RunNativeCommand } from './NativeTools';

export function ForeignKeyOptionsEditor({
  relation,
  busy,
  run,
}: {
  relation: NativeRelationshipView;
  busy: boolean;
  run: RunNativeCommand;
}) {
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const signature = JSON.stringify(relation.options);
  useEffect(
    () => setDraft(Object.fromEntries(relation.options.map((o) => [o.name, o.value]))),
    [relation.uuid, signature],
  );
  const changes = Object.fromEntries(
    relation.options
      .filter((o) => Object.hasOwn(draft, o.name) && draft[o.name] !== o.value)
      .map((o) => [o.name, draft[o.name]]),
  );
  const valid = !(draft.deferred === 'true' && draft.deferrable !== 'true');
  return (
    <form
      className="fk-options-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void run({ type: 'editForeignKeyOptions', foreignKeyUuid: relation.uuid, values: changes });
      }}
    >
      <div className="section-label">
        <strong>외래키 물리 옵션</strong>
      </div>
      <p className="help-text">
        원본 기본값은 지정하지 않은 상태를 유지합니다. 옵션 변경은 카디널리티·기본키·NULL 여부를
        자동 변경하지 않습니다.
      </p>
      {relation.options.map((option) => (
        <label className="field" key={option.name}>
          <span>{option.label}</span>
          {option.kind === 'text' ? (
            <>
              <input
                aria-label={`FK ${option.label}`}
                disabled={busy}
                value={draft[option.name] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [option.name]: e.target.value }))}
              />
              <button
                type="button"
                className="danger-link"
                disabled={busy || draft[option.name] === null}
                onClick={() => setDraft((d) => ({ ...d, [option.name]: null }))}
              >
                {option.label} 원본 기본값으로
              </button>
            </>
          ) : (
            <select
              aria-label={`FK ${option.label}`}
              disabled={busy}
              value={
                draft[option.name] === null || draft[option.name] === undefined
                  ? '__UNSET__'
                  : draft[option.name]!
              }
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  [option.name]: e.target.value === '__UNSET__' ? null : e.target.value,
                }))
              }
            >
              <option value="__UNSET__">
                원본 기본값 · 미지정 (
                {option.defaultValue === 'true'
                  ? '예'
                  : option.defaultValue === 'false'
                    ? '아니요'
                    : option.defaultValue || 'NONE'}
                )
              </option>
              {option.value !== null &&
                option.kind === 'enum' &&
                !option.choices?.includes(option.value) && (
                  <option value={option.value}>{option.value} · 원본 값</option>
                )}
              {(option.kind === 'boolean' ? ['true', 'false'] : option.choices || []).map((v) => (
                <option key={v} value={v}>
                  {option.kind === 'boolean'
                    ? v === 'true'
                      ? '예'
                      : '아니요'
                    : v || 'NONE · 동작 없음'}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      {!valid && (
        <p role="alert" className="export-warning">
          처음부터 지연하려면 지연 가능 옵션을 켜세요.
        </p>
      )}
      {!relation.options.length && (
        <p className="help-text">
          원본 물리 속성 객체가 없어 이 패널에서 편집할 옵션을 확인하지 못했습니다.
        </p>
      )}
      <button className="primary-button" disabled={busy || !valid || !Object.keys(changes).length}>
        FK 옵션 적용
      </button>
    </form>
  );
}
