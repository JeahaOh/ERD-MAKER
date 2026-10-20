import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from './ui';
import { download } from '../browser/exports';
import {
  createTermDictionary,
  openTermDictionary,
  saveTermDictionary,
  upsertTerm,
  removeTerm,
  upsertTag,
  removeTag,
  setTermDelimiter,
  mergeDictionaries,
  type TermDictionary,
  type Term,
} from '../../formats/terms/dictionary';
import {
  exportTermCsv,
  importTermCsv,
  exportTermXlsx,
  importTermXlsx,
} from '../../formats/terms/exchange';
import {
  defaultNamingPolicy,
  namingProposals,
  reverseEngineerTerms,
  translateTerm,
  type NamingPolicy,
  type NamingProposal,
} from '../../formats/terms/naming';
import type { NativeDocumentView } from '../../formats/exerd/view';
import type { RunNativeCommand } from './NativeTools';

const storageKey = 'erd-maker.term-dictionary.v1';
const blank = () => ({
  name: '',
  physicalName: '',
  description: '',
  physicalDescription: '',
  synonyms: '',
  physicalSynonyms: '',
  tags: '',
});
const strings = (s: string) =>
  s.trim().startsWith('[')
    ? (JSON.parse(s) as string[])
    : s
        .split(/\r?\n|\|/)
        .map((v) => v.trim())
        .filter(Boolean);
export function TermDictionaryDialog({
  view,
  busy,
  run,
  close,
}: {
  view: NativeDocumentView | null;
  busy: boolean;
  run: RunNativeCommand;
  close: () => void;
}) {
  const [dictionary, setDictionary] = useState<TermDictionary>(createTermDictionary),
    [filename, setFilename] = useState('용어사전.xdic');
  const [history, setHistory] = useState<Array<{ source: string; filename: string }>>([]),
    [future, setFuture] = useState<Array<{ source: string; filename: string }>>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [storageError, setStorageError] = useState('');
  const [ready, setReady] = useState(false),
    [dirty, setDirty] = useState(true),
    [pending, setPending] = useState<{ d: TermDictionary; name: string }>();
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(''),
    [form, setForm] = useState(blank);
  const [tagId, setTagId] = useState(''),
    [tagName, setTagName] = useState(''),
    [tagDescription, setTagDescription] = useState(''),
    [detach, setDetach] = useState(false);
  const [logicalDelimiter, setLogicalDelimiter] = useState(' '),
    [physicalDelimiter, setPhysicalDelimiter] = useState('_');
  const [policy, setPolicy] = useState<NamingPolicy>(defaultNamingPolicy),
    [scope, setScope] = useState(''),
    [proposals, setProposals] = useState<NamingProposal[]>([]),
    [checked, setChecked] = useState<Set<string>>(new Set());
  const [reverseInput, setReverseInput] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const clearSelections = () => {
    setSelected('');
    setForm(blank());
    setTagId('');
    setTagName('');
    setTagDescription('');
    setDetach(false);
    setPage(0);
  };
  useEffect(() => setProposals([]), [policy]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const recovered = JSON.parse(raw);
        setDictionary(openTermDictionary(recovered.xml));
        setFilename(recovered.filename || '복구한 사전.xdic');
        if (recovered.policy) setPolicy(recovered.policy);
        setNotice('이 기기의 사전 복구본을 열었습니다.');
        setDirty(true);
      }
    } catch {
      setStorageError('사전 복구본을 읽지 못했습니다. 새 사전을 파일로 저장해 보관하세요.');
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ xml: dictionary.source, filename, policy }),
      );
      setStorageError('');
    } catch {
      setStorageError('사전 복구본 저장에 실패했습니다. 파일 다운로드로 보관하세요.');
    }
  }, [ready, dictionary, filename, policy]);
  useEffect(() => {
    setLogicalDelimiter(dictionary.delimiters[0]?.logicalNameDelimiter || ' ');
    setPhysicalDelimiter(dictionary.delimiters[0]?.physicalNameDelimiter ?? '_');
  }, [dictionary.source]);
  const commit = (next: TermDictionary) => {
    setHistory((h) => [...h.slice(-19), { source: dictionary.source, filename }]);
    setFuture([]);
    setDictionary(next);
    setDirty(true);
    setProposals([]);
    setPage(0);
    setError('');
  };
  const attempt = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  function undo() {
    if (!history.length) return;
    setFuture((f) => [...f, { source: dictionary.source, filename }]);
    setDictionary(openTermDictionary(history.at(-1)!.source));
    setFilename(history.at(-1)!.filename);
    setHistory((h) => h.slice(0, -1));
    setDirty(true);
    clearSelections();
    setProposals([]);
  }
  function redo() {
    if (!future.length) return;
    setHistory((h) => [...h, { source: dictionary.source, filename }]);
    setDictionary(openTermDictionary(future.at(-1)!.source));
    setFilename(future.at(-1)!.filename);
    setFuture((f) => f.slice(0, -1));
    setDirty(true);
    clearSelections();
    setProposals([]);
  }
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && ['s', 'z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key.toLowerCase() === 's') {
          download(saveTermDictionary(dictionary).slice().buffer, filename, 'application/xml');
          setDirty(false);
        } else if (e.key.toLowerCase() === 'y' || e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  });
  const tagNames = useMemo(() => new Map(dictionary.tags.map((t) => [t.id, t.name])), [dictionary]);
  const filtered = useMemo(
    () =>
      dictionary.terms.filter((t) =>
        [
          t.name,
          t.physicalName,
          t.description,
          ...t.synonyms,
          ...t.physicalSynonyms,
          ...t.tags.map((id) => tagNames.get(id) || ''),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [dictionary, query, tagNames],
  );
  const selectedProposals = proposals.filter((p) => checked.has(p.uuid));
  function select(t: Term) {
    setSelected(t.id);
    setForm({
      name: t.name,
      physicalName: t.physicalName,
      description: t.description,
      physicalDescription: t.physicalDescription,
      synonyms: JSON.stringify(t.synonyms),
      physicalSynonyms: JSON.stringify(t.physicalSynonyms),
      tags: JSON.stringify(t.tags.map((id) => dictionary.tags.find((tag) => tag.id === id)!.name)),
    });
  }
  async function importFile(file: File) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const d = /\.xlsx$/i.test(file.name)
        ? importTermXlsx(bytes)
        : /\.csv$/i.test(file.name)
          ? importTermCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          : openTermDictionary(bytes);
      setPending({ d, name: file.name.replace(/\.(xlsx|csv|xml)$/i, '.xdic') });
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal
      title="용어사전"
      subtitle="용어·동의어·태그·이름 정책을 편집하고 .xdic 파일로 보관합니다."
      close={close}
      wide
    >
      <div className="modal-body terminology">
        <div className="terminology-actions">
          <strong>{filename}</strong>
          <span>{dirty ? '사전 변경사항 있음' : '파일 다운로드 완료'}</span>
          <button className="secondary-button" onClick={() => input.current?.click()}>
            사전 가져오기
          </button>
          <input
            ref={input}
            type="file"
            accept=".xdic,.xml,.csv,.xlsx"
            aria-label="용어사전 파일"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          <button
            className="secondary-button"
            onClick={() =>
              attempt(() => {
                commit(createTermDictionary());
                setFilename('새 용어사전.xdic');
                clearSelections();
              })
            }
          >
            새 사전
          </button>
          <button className="secondary-button" disabled={!history.length} onClick={undo}>
            사전 실행 취소
          </button>
          <button className="secondary-button" disabled={!future.length} onClick={redo}>
            사전 다시 실행
          </button>
          <button
            className="primary-button"
            onClick={() =>
              attempt(() => {
                download(
                  saveTermDictionary(dictionary).slice().buffer,
                  filename,
                  'application/xml',
                );
                setDirty(false);
                setNotice('사전 다운로드를 시작했습니다. 모델 파일과 별도로 보관하세요.');
              })
            }
          >
            사전 저장
          </button>
        </div>
        {(error || storageError) && (
          <p className="export-warning" role="alert">
            {error || storageError}
          </p>
        )}
        {notice && (
          <p role="status" className="help-text">
            {notice}
          </p>
        )}
        {dictionary.warnings.map((w) => (
          <p className="export-warning" key={w}>
            {w}
          </p>
        ))}
        {pending && (
          <section className="term-import-review">
            <strong>가져오기 검토: {pending.name}</strong>
            <p>
              {pending.d.terms.length}개 용어 · {pending.d.tags.length}개 태그 ·{' '}
              {pending.d.delimiters.length}개 구분자. 현재 사전은 선택 전까지 유지됩니다.
            </p>
            <button
              className="primary-button"
              onClick={() =>
                attempt(() => {
                  commit(pending.d);
                  setFilename(pending.name);
                  setPending(undefined);
                  clearSelections();
                })
              }
            >
              가져온 사전으로 교체
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                attempt(() => {
                  commit(mergeDictionaries(dictionary, pending.d));
                  setPending(undefined);
                })
              }
            >
              현재 사전에 병합
            </button>
            <button className="secondary-button" onClick={() => setPending(undefined)}>
              가져오기 취소
            </button>
          </section>
        )}
        <div className="term-columns">
          <section>
            <div className="section-label">
              <strong>용어 {dictionary.terms.length}개</strong>
              <button
                className="secondary-button"
                onClick={() => {
                  setSelected('');
                  setForm(blank());
                }}
              >
                새 용어
              </button>
            </div>
            <input
              aria-label="용어 검색"
              placeholder="용어·약어·동의어·태그 검색"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
            <div className="term-list">
              {filtered.slice(page * 100, page * 100 + 100).map((t) => (
                <button
                  key={t.id}
                  className={selected === t.id ? 'active' : ''}
                  onClick={() => select(t)}
                >
                  <strong>{t.name}</strong>
                  <code>{t.physicalName}</code>
                </button>
              ))}
            </div>
            <div className="terminology-actions">
              <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                이전 용어
              </button>
              <span>{filtered.length}개 검색 결과</span>
              <button
                disabled={(page + 1) * 100 >= filtered.length}
                onClick={() => setPage((p) => p + 1)}
              >
                다음 용어
              </button>
            </div>
          </section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              attempt(() => {
                const names = strings(form.tags);
                if (!Array.isArray(names) || names.some((n) => typeof n !== 'string'))
                  throw new Error('태그는 문자열 목록이어야 합니다.');
                const tags = names.map((name) => {
                  const tag = dictionary.tags.find((t) => t.name === name);
                  if (!tag) throw new Error(`태그를 먼저 등록하세요: ${name}`);
                  return tag.id;
                });
                commit(
                  upsertTerm(dictionary, {
                    ...form,
                    id: selected || undefined,
                    synonyms: strings(form.synonyms),
                    physicalSynonyms: strings(form.physicalSynonyms),
                    tags,
                  }),
                );
                setSelected('');
                setForm(blank());
              });
            }}
          >
            <strong>{selected ? '용어 편집' : '용어 추가'}</strong>
            {(
              [
                ['name', '용어명', '사전 용어명', false],
                ['physicalName', '물리 약어', '사전 물리 약어', false],
                ['description', '용어 설명', '사전 용어 설명', true],
                ['physicalDescription', '물리 설명', '사전 물리 설명', true],
                ['synonyms', '논리 동의어', '사전 논리 동의어', true],
                ['physicalSynonyms', '물리 동의어', '사전 물리 동의어', true],
                ['tags', '연결 태그', '사전 연결 태그', true],
              ] as const
            ).map(([field, label, aria, multiline]) => (
              <label className="field" key={field}>
                <span>{label}</span>
                {multiline ? (
                  <textarea
                    aria-label={aria}
                    rows={2}
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                ) : (
                  <input
                    aria-label={aria}
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <p className="help-text">
              동의어와 태그는 |로 구분하거나 JSON 문자열 배열을 입력하세요.
            </p>
            <button
              className="primary-button"
              disabled={!form.name.trim() || !form.physicalName.trim()}
            >
              {selected ? '용어 변경 적용' : '용어 추가'}
            </button>
            <button
              type="button"
              className="danger-link"
              disabled={!selected}
              onClick={() =>
                attempt(() => {
                  commit(removeTerm(dictionary, selected));
                  setSelected('');
                  setForm(blank());
                })
              }
            >
              선택 용어 삭제
            </button>
          </form>
        </div>
        <details>
          <summary>태그 · 구분자 · 파일 교환</summary>
          <div className="term-columns">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                attempt(() => {
                  commit(
                    upsertTag(dictionary, {
                      id: tagId || undefined,
                      name: tagName,
                      description: tagDescription,
                    }),
                  );
                  setTagId('');
                  setTagName('');
                  setTagDescription('');
                });
              }}
            >
              <label className="field">
                <span>태그 선택</span>
                <select
                  aria-label="사전 태그 선택"
                  value={tagId}
                  onChange={(e) => {
                    setTagId(e.target.value);
                    const t = dictionary.tags.find((t) => t.id === e.target.value);
                    setTagName(t?.name || '');
                    setTagDescription(t?.description || '');
                  }}
                >
                  <option value="">새 태그</option>
                  {dictionary.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>태그명</span>
                <input
                  aria-label="사전 태그명"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>태그 설명</span>
                <input
                  aria-label="사전 태그 설명"
                  value={tagDescription}
                  onChange={(e) => setTagDescription(e.target.value)}
                />
              </label>
              <button className="secondary-button" disabled={!tagName.trim()}>
                태그 저장
              </button>
              <label className="check-field">
                <input
                  aria-label="태그 연결 해제"
                  type="checkbox"
                  checked={detach}
                  onChange={(e) => setDetach(e.target.checked)}
                />
                삭제 시 용어의 태그 연결 해제
              </label>
              <button
                type="button"
                className="danger-link"
                disabled={!tagId}
                onClick={() =>
                  attempt(() => {
                    commit(removeTag(dictionary, tagId, detach));
                    setTagId('');
                    setTagName('');
                    setTagDescription('');
                  })
                }
              >
                선택 태그 삭제
              </button>
            </form>
            <section>
              <label className="field">
                <span>논리 구분자</span>
                <input
                  aria-label="사전 논리 구분자"
                  value={logicalDelimiter}
                  onChange={(e) => setLogicalDelimiter(e.target.value)}
                />
              </label>
              <label className="field">
                <span>물리 구분자</span>
                <input
                  aria-label="사전 물리 구분자"
                  value={physicalDelimiter}
                  onChange={(e) => setPhysicalDelimiter(e.target.value)}
                />
              </label>
              <button
                className="secondary-button"
                onClick={() =>
                  attempt(() =>
                    commit(setTermDelimiter(dictionary, logicalDelimiter, physicalDelimiter)),
                  )
                }
              >
                구분자 저장
              </button>
              <p className="help-text">
                구분자는 앱의 보조 정책이며 원본 프로그램 재저장 시 주석 정책이 없어질 수 있습니다.
                XLSX는 Terms·Tags·Delimiters 시트를 교환합니다. CSV는 용어와 연결 태그명만
                교환합니다. 원본 확장 속성은 .xdic으로 보관하세요.
              </p>
              <button
                className="secondary-button"
                onClick={() =>
                  attempt(() =>
                    download(
                      exportTermXlsx(dictionary).slice().buffer,
                      filename.replace(/\.xdic$/i, '') + '.xlsx',
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    ),
                  )
                }
              >
                사전 XLSX 내보내기
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  attempt(() =>
                    download(
                      exportTermCsv(dictionary),
                      filename.replace(/\.xdic$/i, '') + '.csv',
                      'text/csv;charset=utf-8',
                    ),
                  )
                }
              >
                사전 CSV 내보내기
              </button>
            </section>
          </div>
        </details>
        <details>
          <summary>이름 정책 · 모델 적용</summary>
          <p className="help-text">
            현재 모델의 사전 경로: {view?.termFilePath || '연결 없음'}. 경로의 파일을 자동으로
            읽거나 덮어쓰지 않습니다.
          </p>
          <button
            className="secondary-button"
            disabled={!view || busy}
            onClick={() => void run({ type: 'setTermDictionaryPath', path: filename })}
          >
            현재 사전 경로 연결
          </button>
          <button
            className="secondary-button"
            disabled={!view || busy || !view.termFilePath}
            onClick={() => void run({ type: 'setTermDictionaryPath', path: null })}
          >
            모델 사전 연결 해제
          </button>
          <button
            className="secondary-button"
            disabled={!view}
            onClick={() =>
              attempt(() => {
                setPending({ d: reverseEngineerTerms(view!), name: '모델에서 추출한 사전.xdic' });
              })
            }
          >
            모델에서 용어 추출
          </button>
          <div className="term-policy">
            <label className="field">
              <span>적용 범위</span>
              <select
                aria-label="이름 정책 범위"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setProposals([]);
                }}
              >
                <option value="">전체 모델</option>
                {view?.allTables.map((t) => (
                  <option key={t.uuid} value={t.uuid}>
                    {t.schemaName}.{t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>대소문자</span>
              <select
                aria-label="이름 정책 대소문자"
                value={policy.casing}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, casing: e.target.value as NamingPolicy['casing'] }))
                }
              >
                <option value="upper">대문자</option>
                <option value="lower">소문자</option>
                <option value="preserve">사전 값 유지</option>
              </select>
            </label>
            {(['separator', 'tablePrefix', 'columnPrefix', 'maxLength'] as const).map((k, i) => (
              <label className="field" key={k}>
                <span>{['조합 구분자', '테이블 접두사', '컬럼 접두사', '최대 길이'][i]}</span>
                <input
                  aria-label={`이름 정책 ${['구분자', '테이블 접두사', '컬럼 접두사', '최대 길이'][i]}`}
                  value={policy[k]}
                  onChange={(e) => {
                    setPolicy((p) => ({
                      ...p,
                      [k]: k === 'maxLength' ? Number(e.target.value) : e.target.value,
                    }));
                    setProposals([]);
                  }}
                />
              </label>
            ))}
          </div>
          <button
            className="secondary-button"
            disabled={!view}
            onClick={() =>
              attempt(() => {
                const p = namingProposals(view!, dictionary, policy, scope || undefined);
                setProposals(p);
                setChecked(new Set(p.map((p) => p.uuid)));
              })
            }
          >
            이름 변환 미리보기
          </button>
          <p className="help-text">
            논리명과 사전이 일치하는 이름만 제안합니다. 충돌·미등록 단어·CHECK 참조는 자동 변경하지
            않습니다. 적용한 변경 전체는 모델 실행 취소 한 번으로 되돌립니다.
          </p>
          {!!proposals.length && (
            <>
              <table className="term-proposals">
                <thead>
                  <tr>
                    <th>적용</th>
                    <th>논리명</th>
                    <th>현재 물리명</th>
                    <th>제안 물리명</th>
                    <th>검토</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.uuid}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`이름 적용: ${p.logicalName} · ${p.uuid}`}
                          checked={checked.has(p.uuid)}
                          onChange={(e) =>
                            setChecked((current) => {
                              const next = new Set(current);
                              if (e.target.checked) next.add(p.uuid);
                              else next.delete(p.uuid);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        {p.logicalName}
                        <small>{p.owner}</small>
                      </td>
                      <td>{p.before}</td>
                      <td>{p.after}</td>
                      <td>{p.problem || (p.before === p.after ? '변경 없음' : '변경 예정')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                className="primary-button"
                disabled={
                  busy ||
                  selectedProposals.some((p) => p.problem) ||
                  !selectedProposals.some((p) => p.before !== p.after)
                }
                onClick={async () => {
                  if (
                    await run({
                      type: 'applyNamingPolicy',
                      changes: selectedProposals
                        .filter((p) => p.before !== p.after)
                        .map((p) => ({
                          uuid: p.uuid,
                          before: p.before,
                          after: p.after,
                          logicalName: p.logicalName,
                        })),
                    })
                  ) {
                    setProposals([]);
                    setNotice('이름을 한 번의 변경으로 적용했습니다. 모델 파일도 저장하세요.');
                  }
                }}
              >
                선택 이름 적용
              </button>
            </>
          )}
          <label className="field">
            <span>물리명 → 논리명 조회</span>
            <input
              aria-label="사전 역방향 조회"
              value={reverseInput}
              onChange={(e) => setReverseInput(e.target.value)}
            />
          </label>
          {reverseInput && (
            <p>
              {translateTerm(reverseInput, dictionary, policy, true).value ||
                translateTerm(reverseInput, dictionary, policy, true).problem}
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}
