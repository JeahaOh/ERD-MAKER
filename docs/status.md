# 구현·검증 상태

기준일: 2026-10-21. 계획 작성 후 사용자 승인에 따라 구현을 진행 중이다. 전체 제품 완료나 전체 OS 지원 완료 상태가 아니다.

10월 20일에는 현재 소스의 전체 단위검사·빌드·Chrome E2E를 다시 실행했다. 후속으로 관계 편집본의 원본 reader/writer 및 앱 역판독까지 확인했다. FK 옵션·용어사전 구현과 9개 제품 ID의 원본 FK 옵션 왕복, 독립 XLSX 대조도 진행했다. 아래 원본 GUI·DB·Electron·OS 결과는 기존 검증 기록이며 이번 실행 결과와 구분한다. [관계 편집 재개 검증](worklog/2026-10-20-relationship-verification.md), [후속 호환성 검증](worklog/2026-10-20-relationship-compatibility.md), [FK 옵션·용어사전 구현](worklog/2026-10-20-fk-terms.md).

10월 21일에는 사용자 지정 Oracle·MariaDB·PostgreSQL·MySQL의 독립 FK 모델 37개를 실제 서버에서 실행했다. 최종 SQL 적용·카탈로그·동작 검사 217개, 전체 단위검사 255개, Chrome E2E 19개가 통과했다. 기존 DB와 분리된 컨테이너를 사용했다. [네 DB 실제 검증](worklog/2026-10-21-fk-live-databases.md). 원본 GUI·Electron·다른 OS 기록은 이전 시점의 증거다.

## 확인한 실행 결과

| 항목 | 확인 결과 | 근거와 범위 |
| --- | --- | --- |
| 독립 바이너리 코덱 | 실파일 2,371,391바이트 전부 해석, 36,057객체 재구성, 재인코딩 바이트 일치 | `exerd-binary.test.ts`, 원본 바이트 반환 경로가 아닌 writer 실행 |
| 컨테이너·XML | 두 ZIP 로컬 레코드 재압축, CRC·크기 검사, 원문 보존 속성 편집 | `exerd-container.test.ts`, `exerd-native-document.test.ts` |
| 원본 실파일 보존 | 609테이블·10,045컬럼·561관계·118도메인·38다이어그램·615배치·53노트 | native projection 및 실제 Chrome 다운로드 파일 검사 |
| 원본 코드 재열기 | 편집본의 바이너리·XML을 원본 reader로 각각 정상 복원 | 로컬 원본 oracle, 두 표현 복원 그래프 차이 0 |
| 관계 편집본 원본 왕복 | 10/20 원본 인식기·바이너리/XML reader·writer 수용, 58객체 보존 | 두 표현 및 원본 재저장 전후 원본 그래프 차이 0. 앱 역판독의 관계·PK/FK UUID·물리 옵션·SQL 동일, 원문 좌표 표기 차이 2곳은 수치 동일. 이번 파일의 원본 GUI 재열기는 미검증 |
| DB별 FK 옵션 원본 왕복 | 8개 DB 계열·9개 제품 ID의 바이너리/XML·원본 재저장·앱 역판독 | 원본 저장 그래프 차이 0, FK 식별/옵션·SQL 동일. 좌표 문자열 표기 차이는 수치 동일로 별도 기록. 실제 서버/GUI 실행과 구분 |
| 용어사전 | 용어·동의어·태그 편집, 사전/모델별 Undo, 이름 정책, .xdic·XLSX·CSV | 원본 TermModelPackage/EFactory 어휘 그래프 차이 0, openpyxl 독립 대조. 앱 구분자 정책은 원본 재저장 시 제거될 수 있음 |
| 원본 화면 재열기 | 실파일 논리명 편집과 원본 GUI 재저장 확인 | `.analysis/oracle/ui/gui-verification.json` 및 `research/original-oracle.md` |
| 신규 모델 | 독립 생성 파일을 원본 GUI에서 열고 다시 저장 | 신규 2테이블 v3 fixture, `e:Document` root 접두사 인식 조건 반영 |
| 10회 교대 저장 | 원본 GUI 재저장본에서 시작, TS→원본 writer 10회, 그래프 차이 0 | `.analysis/compatibility/cycles-1792071781738/report.json`, producer version 제외, GUI 10회 조작 시험과 구분 |
| 웹 동작 | 신규 생성·속성/구조 편집·저장 직전 입력·Undo/Redo·복구·두 탭·저장소 실패·구 복구본 이전·실파일·메모·인덱스·CHECK·SQL·카탈로그·비교·도메인 전파·관계 표시/편집 | 10/21 로컬 정적 빌드의 Chrome Playwright 19개 통과, 실패·생략 0(약 1.0분).Oracle·MariaDB·MySQL 옵션 적용/Undo/다운로드 3개 추가. 기존 PG FK 옵션·사전 편집/파일 교환·이름 일괄 적용·사전 저장소 실패·관계선 클릭/키보드·원본 실파일·팔레트·내보내기 검사 포함 |
| 단위 검사 | 코덱·트랜잭션·검사·투영·배치·비교·8방언 DDL·역공학·출력·관계 편집 | 10/21 최종 재실행 23파일 255개 통과, 실패·생략 0(14.50초). 관계 편집 7개, DB별 초기 물리 속성·공통 DDL 연결 회귀 포함 |
| Electron | 개발 실행과 생성된 macOS ARM 패키지에서 신규 생성·수정·609테이블 열기, Node API 미노출 | `app/scripts/desktop/smoke.mjs`, sandbox·contextIsolation 유지 |
| macOS 패키지 | ARM DMG·ZIP 생성 성공, ASAR 2,448파일 검사에서 REF·분석·JAR·EXE·EXERD 산출물 포함 0 | `release/`, 팔레트·복구 검증 시점 빌드의 웹 4파일·Electron 진입점 해시 일치. 이후 관계 표시·편집·FK 옵션·용어사전 변경 전 스냅샷이며 기록은 `.analysis/releases/palette-recovery-20261016/checkpoint.json`. 10/20 패키지는 갱신하지 않았다. 코드 서명·공증·DMG 설치 및 타 OS 설치는 미검증 |
| PostgreSQL 실행 | 17.11에서 실파일 DDL 적용·독립 카탈로그 재조회 | 609테이블·10,045컬럼·609PK·561FK·8UNIQUE·492CHECK·711인덱스 일치 |
| DB 제약 동작 | 독립 fixture의 유효 행 삽입 성공, FK/CHECK/UNIQUE/PK NULL 위반 SQLSTATE 확인 | `verify-postgres.py --behavior-fixture`, 기존 DB에 접속하지 않는 격리·폐기 컨테이너 |
| MySQL·MariaDB 실행 | MySQL 8.4.11 및 MariaDB 11.4.13에서 독립 fixture 적용·카탈로그·각 13개 동작 검사 통과 | 각 2테이블·11컬럼, 복합 FK의 UPDATE CASCADE·DELETE SET NULL 포함. `.analysis/mysql-ddl/{mysql-run-v4,mariadb-run-v4}/report.json` |
| 10/21 네 DB FK 실행 | Oracle 26ai Free 23.26.3.0.0·MariaDB 11.4.13·PostgreSQL 17.11·MySQL 8.4.11 | 독립 모델 37개·SQL 적용/카탈로그/동작 217검사 통과. 삭제·갱신 규칙, PG/Oracle 지연 검사·기존 행 검증 생략, Oracle 제약 비활성 검사. [범위와 증거](worklog/2026-10-21-fk-live-databases.md) |
| PG 역공학 | 실제 DB 카탈로그 → native → 원본 reader/XML → DDL → 새 DB 적용 | 609테이블·11시퀀스 포함 원본 reader 보존. 카탈로그 278,352필드 중 CHECK 캐스트 원문 980곳 외 일치 |
| CHECK 캐스트 대조 | 관측된 CHECK490개의 서버 재표현을 별도로 분류·실행 | 9,828개의 typed VALUES에서 TRUE/FALSE/NULL 불일치 0. 원문 문자열 차이 자체는 유지하며 일반 SQL 동등성 증명으로 확대하지 않음 |
| 8개 DB 계열 파일 | 원본 factory8종·독립 신규9개 제품 ID의 바이너리/XML·원본 재저장→TS 역판독 통과 | [호환 행렬](research/database-compatibility.md), 기본값·Point 표기 정규화 내역 별도. 타 DB 실행 및 모든 물리 옵션의 동등성 근거와 구분 |
| Linux | ARM64 및 x64 에뮬레이션 스냅샷에서 설치·빌드·브라우저·Electron·sandbox 검사 통과 | [Linux 검증](platforms/linux-verification.md). x64 단위146통과/16생략, E2E4통과/1생략. 원본 실파일 미포함·고정 source hash에 귀속 |
| UI 팔레트 | 사용자 제공 블라리요 기본·파생 토큰 적용 | [색상 규칙](architecture/color-palette.md), 원본 모델 색상 속성은 변경하지 않음 |
| 전체 빌드 | TypeScript 및 Vite 빌드 통과 | Node 24, 현재 작업 환경 |

## 현재 구현

- `src/formats/exerd/`의 전체 바이너리 그래프·원문 XML·컨테이너가 저장 정본이다. 화면 projection은 저장용 모델이 아니다.
- Web Worker에서 파일 해석·명령·저장 수행. 20개 스냅샷 Undo/Redo, 탭·모델별 IndexedDB 복구본 저장. 선택 복구는 이전 상태를 보존하는 별도 복구본으로 분기한다. [복구 범위·검증](specifications/local-recovery.md).
- 테이블·컬럼 속성 편집, 테이블 추가, 컬럼 추가·삭제·순서 변경, 기본키 설정, 관계 생성·삭제, 도메인 추가·연결, 다이어그램 추가·복제·삭제 등의 구조 명령을 구현·검증 중이다.
- 전체 native 비교는 동일 실파일 36,057객체·98,160속성 차이 0. FK 삭제는 객체 9개 삭제·참조 배열 3개 변경 외 차이 0. 외부 모델 이름 매칭은 임시 연결로 표시한다.
- 자동 배치는 다이어그램 배치 UUID 기준으로 메모·고정 영역·모든 컬럼 높이를 고려한다. 전체 609테이블 단일 다이어그램에서 계획 120ms·적용/재읽기 2,362ms·겹침 0·재실행 변경 0의 로컬 관측을 확보했다.
- 이름·소속·키·참조·도메인 순환·배치 검사. 기존 파일을 자동 보정하지 않고 오류·경고로 제시한다.
- 도메인·스키마·업무영역 탐색과 속성 편집. 도메인 전파 시 컬럼의 개별 재정의는 유지하며 명시적으로 도메인 값으로 되돌릴 수 있다.
- 전체 모델을 크게 축소하면 컬럼 DOM 대신 테이블 요약을 표시한다. 609테이블 축소·저장 전후 바이너리/XML 해시 일치 확인. 확대하면 컬럼을 다시 표시하며 저장 데이터는 축약하지 않는다.
- 8개 DB 방언의 전용 SQL 생성기를 연결했다. 원본 DB와 다른 방언으로의 추정 변환은 거부하며, 구현하지 않은 물리 옵션은 누락 항목으로 표시한다. 실제 서버 적용 증거는 PostgreSQL·MySQL·MariaDB 및 10/21 Oracle의 독립 FK 모델 범위다.
- 다이어그램 SVG·PNG, HTML 정의서·CSV를 내보낸다. 원본 수동 관계 경로·압축 표시를 그대로 복제하지 않으며 출력 도형 겹침을 경고한다.
- 다이어그램별 관계 표시·숨김을 저장한다. 외래키·SQL 정의를 유지하며 Undo/Redo·복제·SVG에 반영한다. [동작과 검증](specifications/relationship-visibility.md).
- 관계선 클릭·키보드 선택 후 부모 키·복합 컬럼 대응·식별 여부·카디널리티·그룹명/제약명을 편집한다. FK UUID·물리 옵션과 재사용 가능한 대응 객체 UUID를 보존하며, 식별 해제 시 자식 PK를 제거하지 않는다. [동작과 검증](specifications/relationship-editing.md).
- DB별 FK 물리 옵션을 편집하고 기본값 복귀·조합 검사를 수행한다. 이름·식별자·카디널리티·자식 PK/NULL을 자동 변경하지 않는다. [범위와 검증](specifications/foreign-key-options.md).
- 용어·약어·동의어·태그 사전을 편집·교환하고 테이블/컬럼 이름 정책을 미리보기 후 일괄 적용한다. 외부 사전 경로를 보존하며 사전 자체 Undo/Redo·복구·저장소 실패 안내를 제공한다. [범위와 검증](specifications/term-dictionary.md).
- 미지 형식 버전·크기 제한·CRC 불일치·잘림·DTD·명확한 표현 불일치를 거부한다. 참조·목록 변경은 단순 속성 편집으로 수행할 수 없다.

## 아직 남은 수용 범위

- 전체 편집 메뉴·용어 정책의 원본 GUI 동작 대조·스타일·관계 수동 경로·자동 배치의 장시간/복잡 사례·정의서 전체 페이지/글꼴 수용·ERwin 교환·스크립트 기능.
- PostgreSQL 외 DB의 실제 카탈로그 역공학, 각 DB의 모든 DDL 옵션·버전 호환, Oracle의 독립 FK 모델 외 전체 물리 옵션 및 SQL Server·Db2·Tibero·CUBRID의 실제 서버 적용. PG의 선택 병합·마이그레이션 SQL도 추가 작업이다.
- 구버전 모델 마이그레이션과 DB별 원본 GUI·전체 속성 호환 행렬. 현재 최소 DB별 모델의 reader/writer 성공과 구버전 지원을 혼동하지 않는다.
- 브라우저 오프라인 재실행·강제 종료·실제 디스크 부족·장시간·대형 모델 성능 시험. 다중 탭의 별도 복구와 저장소 실패 안내는 기본 흐름을 검증했으며 확장 충돌 시험은 남아 있다.
- Windows·Intel Mac 실제 실행, Linux AppImage 설치·배포와 원본 실파일 교차 검증, 코드 서명·공증·업데이트.

## 증거 취급

`REF/` 원본에는 쓰지 않는다. 원본 파일·배포물은 Git·앱 패키지에서 제외한다. 원본 JAR 및 Eclipse는 개발 중 로컬 비교 실험에만 사용한다. 원본 GUI의 라이선스·로그인·기간 검사를 우회하는 수정은 하지 않았다. 제공 모델의 외부 용어사전 `/S2B/S2BWordict.xdic`는 제공되지 않아 원본 GUI에서 누락 경고가 표시된다.

테스트 수·객체 수 보존·원본 reader·원본 GUI·실제 DB·OS 설치 검증은 서로 다른 결과다. 어느 한 결과로 다른 범위의 완료를 대신하지 않는다.
