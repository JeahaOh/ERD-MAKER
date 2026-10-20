# ERD Maker

eXERD 수준의 독립 데이터 모델링 제품을 위한 프로젝트입니다. 브라우저와 Electron에서 macOS·Linux·Windows 공통 실행을 목표로 합니다.

- **현재 단계:** 계획 승인 후 독립 코덱과 모델 편집기를 구현하고 있습니다. 전체 제품은 개발 중입니다.
- **파일 호환:** 제공된 PostgreSQL `.exerd` 실파일을 읽고 XML·바이너리를 함께 편집·재직렬화합니다. 원본 eXERD 화면에서 재열기·다시 저장, 새 엔진과 원본의 10회 교대 저장을 확인했습니다. 다른 버전·DB까지 호환 완료한 것은 아닙니다.
- **실행 상태:** 웹 빌드·Chrome 편집·저장·복구와 macOS ARM 패키지 실행을 확인했습니다. Linux ARM64·x64 에뮬레이션은 고정 소스 스냅샷에서 확인했습니다. Windows·Intel Mac 실제 실행과 Linux 설치물 검증은 남아 있습니다.
- **사용 조건:** 로그인·라이선스 키·활성화·기간 제한 없이 로컬에서 처리합니다. 새 앱 실행·파일 저장에 원본 프로그램이나 JAR가 필요하지 않습니다.

**먼저 읽을 문서**

- [회사 PC 설치·실행·사용 방법](docs/guides/usage.md)
- [Oracle 19c 회사 테스트와 실행 SQL](docs/testing/oracle19.md)
- [AI 개발 도구용 테스트 프롬프트](docs/testing/ai-testing.md)
- [Electron·외부 API·라이선스 전송 확인](docs/guides/network-and-privacy.md)
- [전체 제품 완성도 평가: 약 60%, 개발 범위 추정](docs/readiness.md)
- [전체 제품 재구현 계획](docs/plans/product-reimplementation-plan.md)
- [현재 구현·검증 상태](docs/status.md)
- [화면 색상 규칙](docs/architecture/color-palette.md)
- [탭·모델별 로컬 복구](docs/specifications/local-recovery.md)
- [디렉터리 설계·파일 이동표](docs/architecture/directory-structure.md)
- [eXERD 정적 분석](docs/research/reference-analysis.md)
- [사용자 실파일 조사 근거](docs/research/evidence/planning-input-inventory.json)
- [현재 코어 엔진의 지원·제한](docs/architecture/core-engine.md)
- [플랫폼 실행·검증 계획](docs/platforms/platform-support.md)

**디렉터리**

```text
app/
  src/core/               공통 모델·검사·비교
  src/formats/            eXERD·SQL·프로젝트 JSON 처리
  src/renderer/           공통 웹 화면·컴포넌트·브라우저 기능
  desktop/                Electron 진입점
  tests/unit/             공통 엔진·형식 처리 테스트
  scripts/                참조 조사·데스크톱 검증 도구
docs/                     계획·구조·조사·플랫폼 문서와 근거
REF/                      사용자 제공 원본, 로컬 보관·Git 제외
.analysis/                추출·역분석 자료, 로컬 보관·Git 제외
.cache/                   도구 캐시, Git 제외
```

**검증 명령**

저장소 루트에서 실행합니다. 현재 검증 환경은 Node.js 24입니다.

```sh
npm ci
npm test                  # 코덱·구조·형식 처리 테스트
npm run build             # 타입 검사 및 정적 웹 앱 생성
npm run dev               # http://127.0.0.1:5173
npm run test:e2e           # 실제 브라우저 편집·저장·복구
npm run desktop           # 빌드 후 Electron 실행
npm run package           # 현재 OS 설치 파일 생성
npm run inspect:references # REF 배포물 조사 및 근거 JSON 갱신
```

`REF/`가 없는 환경에서는 실제 배포물 기반 테스트가 건너뛰어집니다. 독립 작성 fixture 테스트와 원본 샘플 검증을 구분해야 합니다. `inspect:references`는 원본을 읽고 `.analysis/ref/`와 `docs/research/evidence/reference-inventory.json`에 결과를 씁니다.

`test:e2e`는 로컬에서 Chrome을 사용합니다. CI에서는 Playwright Chromium을 설치합니다. `REF/` 없는 환경의 성공과 제공 파일 기반 호환 검증을 구분합니다.

현재 편집기는 네이티브 객체 그래프를 정본으로 사용하며 화면용 데이터로 원본 전체를 덮어쓰지 않습니다. 8개 DB 방언의 전용 DDL 생성기, PostgreSQL 카탈로그 가져오기, 모델 비교·자동 배치, SVG·PNG·HTML 정의서·CSV 내보내기, FK 옵션·용어사전·이름 정책을 연결했습니다. 실제 DB 적용은 PostgreSQL 실파일과 Oracle·MySQL·MariaDB 독립 FK fixture에서 확인했습니다. Oracle은 26ai Free 검증이며 19c는 회사 테스트 전까지 미검증입니다. 기존 `app/src/core/model.ts`와 `app/src/formats/sql/ddl.ts`는 제한된 초안으로 별도 유지합니다. 세부 지원 범위와 미구현 항목은 상태 문서를 확인하세요.

Electron은 제품 코드에서 외부 HTTP/HTTPS/WS/WSS 요청을 취소하며, 외부 API·라이선스 인증·사용량 분석·자동 업데이트 클라이언트를 넣지 않았습니다. Git/npm/브라우저 설치 등 개발 환경 다운로드는 별개입니다. 최신 기능은 소스에서 실행하세요. 기존 `release/` 패키지는 FK·용어사전 변경 전 스냅샷입니다.
