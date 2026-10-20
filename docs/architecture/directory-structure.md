# 프로젝트 디렉터리 설계

- 정리일: 2026-10-15
- 적용 범위: 기존 파일 이동·참조 경로·실행 설정·문서 링크·Git 제외 규칙. 신규 제품 기능은 포함하지 않는다.
- 운영 방식: **단일 npm 패키지**. 브라우저와 Electron의 공통 TypeScript 소스를 책임별로 분리한다. 현재 규모에서 npm workspace나 별도 패키지 배포 체계를 추가하지 않는다.

**현재 구조와 책임**

```text
ERD-MAKER/
├── README.md
├── package.json / package-lock.json
├── tsconfig.json / vite.config.ts
├── index.html                       웹 진입 HTML
├── electron-builder.yml             데스크톱 배포 설정
├── .github/workflows/verify.yml      검증·패키징 초안
├── app/                             구현·테스트·도구를 묶는 디렉터리
│   ├── src/
│   │   ├── core/                    공통 모델·검사·비교
│   │   ├── formats/
│   │   │   ├── exerd/import.ts       기존 부분 가져오기 초안
│   │   │   ├── project/json.ts       프로젝트 JSON 읽기
│   │   │   └── sql/ddl.ts            SQL 입출력 초안
│   │   └── renderer/
│   │       ├── main.tsx             웹 UI 진입점
│   │       ├── components/          화면 컴포넌트
│   │       ├── hooks/               React 기반 편집 이력
│   │       ├── browser/             다운로드·SVG·CSV 출력
│   │       └── fixtures/            독립 작성 데모 모델
│   ├── desktop/main.cjs             Electron 창·보안 설정
│   ├── tests/unit/                  모델·SQL·eXERD 테스트
│   └── scripts/
│       ├── references/inventory.py    원본 배포물 조사·근거 생성
│       └── desktop/smoke.mjs        Electron 실행 검증
├── public/                          웹 정적 자산
├── docs/
│   ├── plans/                       전체 제품 계획
│   ├── architecture/               구조·기존 엔진 계약
│   ├── research/
│   │   ├── reference-analysis.md    정적 분석 보고서
│   │   └── evidence/                버전·해시·객체 수·관측 근거
│   └── platforms/                  플랫폼별 실행·검증 상태
├── REF/                             원본 파일, Git 제외
├── .analysis/                       추출·바이트코드 분석, Git 제외
├── .cache/                          도구 캐시, Git 제외
├── node_modules/                    설치 의존성, Git 제외
├── dist/                            웹 빌드 산출물, 생성 시 Git 제외
└── release/                         설치 파일, 생성 시 Git 제외
```

`App.tsx`·`styles.css`는 현재 존재하지 않는다. 트리에 완성된 파일로 표시하거나 임시 화면을 추가하지 않았다. 향후 구현 위치는 `app/src/renderer/`다.

**의존 방향**

```text
renderer ──→ formats ──→ core
    └──────────────────→ core

desktop ──→ dist/index.html
tests ──→ 검증 대상 모듈
scripts ──→ REF / .analysis / docs/research/evidence
```

- `core`는 React·DOM·Electron·파일 시스템과 특정 파일 형식을 참조하지 않는다.
- `formats`는 `core`를 사용한다. 기본 파싱·모델 변환을 UI·OS API와 분리하고, 파일 선택·다운로드는 `renderer/browser`에서 처리한다.
- `renderer`는 공통 모델과 형식 처리를 호출한다. React 훅을 공통 모델 코드에 넣지 않는다.
- `desktop`은 브라우저 UI의 빌드 산출물을 연다. 향후 네이티브 파일·DB 연결을 추가할 때 명시적인 경계와 프로세스 간 계약을 설계한다.
- `scripts`는 제품에 번들링하지 않는다. `REF`·추출 파일을 `public` 또는 제품 소스로 옮기지 않는다.
- `docs/research/evidence`에는 조사 메타데이터를 둔다. 원본 파일·압축 해제한 XML·바이너리·클래스는 `.analysis`에 로컬 보관한다.

**최초 경로에서 현재 경로로의 이동표**

| 이전 경로 | 현재 경로 |
|---|---|
| `src/model.ts` | `app/src/core/model.ts` |
| `src/validation.ts` | `app/src/core/validation.ts` |
| `src/diff.ts` | `app/src/core/diff.ts` |
| `src/model-io.ts` | `app/src/formats/project/json.ts` |
| `src/exerd.ts` | `app/src/formats/exerd/import.ts` |
| `src/sql.ts` | `app/src/formats/sql/ddl.ts` |
| `src/main.tsx` | `app/src/renderer/main.tsx` |
| `src/Inspector.tsx` | `app/src/renderer/components/Inspector.tsx` |
| `src/TableNode.tsx` | `app/src/renderer/components/TableNode.tsx` |
| `src/ui.tsx` | `app/src/renderer/components/ui.tsx` |
| `src/history.ts` | `app/src/renderer/hooks/useModelHistory.ts` |
| `src/demo.ts` | `app/src/renderer/fixtures/demo.ts` |
| `src/exports.ts` | `app/src/renderer/browser/exports.ts` |
| `electron/main.cjs` | `app/desktop/main.cjs` |
| `tests/core.test.ts` | `app/tests/unit/core.test.ts` |
| `tests/exerd.test.ts` | `app/tests/unit/exerd.test.ts` |
| `scripts/inspect-references.py` | `app/scripts/references/inventory.py` |
| `scripts/electron-smoke.mjs` | `app/scripts/desktop/smoke.mjs` |
| `docs/product-reimplementation-plan.md` | `docs/plans/product-reimplementation-plan.md` |
| `docs/reference-analysis.md` | `docs/research/reference-analysis.md` |
| `docs/core-engine.md` | `docs/architecture/core-engine.md` |
| `docs/platform-support.md` | `docs/platforms/platform-support.md` |
| `evidence/reference-inventory.json` | `docs/research/evidence/reference-inventory.json` |
| `evidence/planning-input-inventory.json` | `docs/research/evidence/planning-input-inventory.json` |

**실행 설정과 조사 경로**

- `index.html`: `app/src/renderer/main.tsx`를 읽는다.
- `package.json`의 `main`, 패키징 목록, CI 문법 검사: `app/desktop/main.cjs`로 연결한다.
- Electron Builder의 앱 기준 경로는 `directories.app: .`로 루트에 고정한다. `app/`은 소스 묶음이며 별도 npm 패키지가 아니다.
- Electron 진입점은 루트 `dist/index.html`을 계속 읽는다. 진입점이 `app/desktop`에 있으므로 상위 두 디렉터리를 거쳐 `dist/index.html`을 찾는다.
- `npm run inspect:references`: `app/scripts/references/inventory.py` 실행. 스크립트 파일의 `parents[3]`가 저장소 루트다.
- 조사 결과: `docs/research/evidence/reference-inventory.json`. 기존 근거 기록은 파일 이동 외 내용을 바꾸지 않는다.
- 테스트와 조사 명령의 실행 기준은 저장소 루트다. `REF` 원본 경로는 유지한다.

**향후 확장 위치**

- `.exerd` 컨테이너·XML·바이너리 코덱: `app/src/formats/exerd/`.
- DB 방언별 SQL 처리: `app/src/formats/sql/`의 하위 모듈로 분리. 실제 DB 연결은 순수 코어에 넣지 않는다.
- 모델 명령·Undo 계약: UI 훅에 영구 결합하지 않고 `app/src/core/`의 별도 모듈로 설계한다.
- 렌더러 기능별 화면·컴포넌트: `app/src/renderer/`. 다중 다이어그램의 실제 모델 계약은 [전체 계획](../plans/product-reimplementation-plan.md)을 따른다.
- 향후 통합·원본 왕복·OS 실행 시험은 각각 `app/tests/integration/`, `app/tests/compatibility/`, `app/tests/e2e/`에 추가한다. 이번에는 빈 시험 디렉터리나 통과용 테스트를 생성하지 않는다.
- 공통 엔진을 별도 도구에서 소비하거나 독립 배포할 필요가 입증되면 `packages/` 분리를 검토한다. 현재는 패키지 간 버전·빌드 설정을 도입하지 않는다.

**Git 범위**

- 포함 대상: 제품 초안, 테스트, 재현 가능한 조사 스크립트, 문서, 근거 메타데이터, 잠금 파일, 빌드·CI 설정.
- 제외 대상: `REF/`, `.analysis/`, `.cache/`, `node_modules/`, `dist/`, `release/`, 테스트 산출물, 로컬 환경 변수, OS 메타데이터.
- `git init`은 로컬 저장소와 `main` 기본 브랜치를 초기화한다. 최초 커밋·원격 등록·푸시는 별도 작업이다.

**경로 정리 후 검증 결과**

- 1차 정리에서 파일 24개를 분류했고, 추가 정리에서 `src`·`desktop`·`tests`·`scripts` 4개 디렉터리의 파일 18개를 `app/` 아래로 이동했다.
- `npm test`: 2개 파일·32개 테스트 통과. 이동 전에도 32개가 통과했다.
- `npm run inspect:references`: 새 경로에서 실행 성공. 원본 4개와 동봉 샘플 28개 메타데이터를 정해진 근거 경로에 기록했다.
- Electron 진입점·스모크 스크립트의 Node 문법 검사, Python 문법·저장소 루트 계산, 문서 상대 링크 검사 통과.
- 이동된 소스의 상대 import에 새 누락 없음. 기존 미구현 `App`·`styles.css`만 남아 있다.
- `npm run build`: 이동 전후 모두 기존 `App` 누락으로 실패. 전체 앱 빌드·GUI 실행을 검증한 상태가 아니다.
- `REF/` 원본 4개 SHA-256 불변 확인.
- Git 초기화 완료. 기본 브랜치 `main`, 최초 커밋 없음, 원격 없음. `git check-ignore`로 원본·추출물·캐시·의존성 제외 확인.
