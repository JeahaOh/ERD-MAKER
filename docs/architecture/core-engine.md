# Core schema engine

현재 UI는 `formats/exerd/`의 전체 native 엔진을 사용한다. 이 문서의 `core/model.ts` 기반 API는 초기 제한 모델의 범위다. native의 실제 구현·검증은 [현재 상태](../status.md), [검사 규칙](../specifications/native-validation-rules.md), [PostgreSQL DDL](../specifications/native-ddl.md), [카탈로그 역공학](../specifications/postgres-catalog.md), [전체 모델 비교](../specifications/native-comparison.md)를 참고한다.

브라우저에서 실행하는 순수 TypeScript 엔진입니다. DB 연결·SQL 실행은 하지 않습니다.

## API

- `exportSql(model: Model): string` — 모델을 PostgreSQL, MySQL 또는 SQLite DDL로 생성합니다. 오류 등급 모델 검증 실패 시 예외를 발생시킵니다.
- `importSql(sql: string, dialect: Dialect): { model: Model; warnings: string[] }` — 지원 DDL을 모델로 변환합니다. 핵심 구조를 보존할 수 없는 구문은 예외로 거부합니다. 기타 제외 문장은 warnings에 기록합니다.
- `validateModel(model: Model): Issue[]` — 중복 ID·물리명, 필수 필드, 참조, PK NULL 허용, 인덱스, FK 대상 유일성, SET NULL, 1:1 유일성 등을 검사합니다.
- `parseModel(text: string): Model` — JSON 프로젝트 구조, 버전 및 관계·인덱스·주제 영역 참조를 검사합니다. 유효하지 않으면 예외를 발생시킵니다.
- `diffModels(before: Model, after: Model): string[]` — 구조 변경 검토 목록을 반환합니다. 마이그레이션 SQL을 생성하거나 실행하지 않습니다.

## 지원 범위

- CREATE TABLE, 스키마·따옴표 식별자, 컬럼 자료형, NULL/NOT NULL, 기본값 표현식
- 단일·복합 기본키, UNIQUE 컬럼·복합 UNIQUE 키, 일반·UNIQUE 인덱스
- 단일·복합 외래키, CREATE TABLE 내부 및 ALTER TABLE ADD CONSTRAINT
- ON DELETE NO ACTION/CASCADE/RESTRICT/SET NULL
- PostgreSQL COMMENT ON TABLE/COLUMN, MySQL 인라인 COMMENT
- SQLite에는 DB 자체 주석 기능이 없어 `-- ERD-MAKER-COMMENT {JSON}` 메타데이터로 설명을 SQL 원문에 보존합니다. SQLite 데이터베이스 내부에는 저장되지 않습니다.
- PostgreSQL 비인용 식별자는 소문자로 정규화합니다. 인용 식별자의 대소문자는 보존합니다.
- 외래키 참조를 마지막에 해석하므로 테이블 정의 순서와 순환 참조를 지원합니다. PostgreSQL/MySQL은 모든 테이블·인덱스 생성 후 ALTER로 FK를 생성하고, SQLite는 테이블 안에서 생성합니다.

## 명시적 제한

- 범용 SQL parser가 아닙니다. 가져오기는 보수적인 DDL 부분집합입니다.
- CHECK, 생성 컬럼, identity/auto_increment, collation, nondefault ON UPDATE, deferrability, 표현식·부분·정렬·prefix 인덱스는 현재 모델 계약에서 보존할 수 없어 거부합니다.
- 프로시저, 뷰, 트리거, 데이터 INSERT/UPDATE/DELETE 및 기타 제외 문장은 warnings로 알리며 실행하지 않습니다. CREATE TABLE이 없는 파일은 거부합니다.
- PK 제약 이름을 보존하지 않으며, 복합 PK 순서가 컬럼 순서와 다르면 컬럼 순서로 정규화하고 warnings로 알립니다. CHECK 등의 핵심 제약은 조용히 버리지 않습니다.
- 스토리지 엔진·문자셋 등 테이블 옵션은 warnings로 알리고 모델에는 저장하지 않습니다. MySQL 외래키 실행에는 해당 엔진의 FK 지원이 필요합니다.
- 주제 영역, 용어 사전, 논리명, 색, 좌표는 SQL 스키마 정보가 아닙니다. 전체 프로젝트 보존에는 모델 JSON을 사용합니다.
- 자료형과 기본값의 DB별 의미·서버 버전 호환성을 완전히 검사하지 않습니다. 방언 변경 시 자동 자료형 변환을 하지 않습니다.
- PostgreSQL 스키마는 CREATE SCHEMA로 생성합니다. MySQL 데이터베이스는 사용자가 준비해야 합니다. SQLite는 main/temp만 생성하며 ATTACH와 스키마 간 FK를 지원하지 않습니다.
- SQL 모드에 따라 의미가 바뀌는 MySQL 역슬래시 문자열·주석과 MySQL 실행형 주석은 추측하지 않고 거부합니다. PostgreSQL 기본 문자열은 `standard_conforming_strings=on`을 전제하며 E/N/X/B 접두사 문자열은 거부합니다.
- diff는 동일 ID를 먼저 비교하고, ID가 다른 SQL 재수입 모델은 물리명으로 연결합니다. 물리명과 ID를 동시에 바꾸면 추가·삭제로 나타납니다.

## 검증

`app/tests/unit/core.test.ts`는 3개 방언의 DDL round trip, 복합 FK/PK/UNIQUE, SQL 문자열 보존, 비지원 구문 거부, JSON 구조·참조 검증, 모델 비교를 검사합니다. `sqlite3`가 설치되어 있으면 생성 DDL을 실제 메모리 DB에서 실행하고 복합 외래키·CASCADE·UNIQUE가 적용되는지 확인합니다. PostgreSQL/MySQL 서버 실행 검증은 별도 필요합니다.
