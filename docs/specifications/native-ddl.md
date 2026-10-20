# 원본 모델 기반 DDL 생성

- 구현: `app/src/formats/sql/native-ddl.ts`. 구형 단순 모델용 `ddl.ts`와 독립적이다.
- 입력 정본은 `NativeExerdDocument.graph`다. 화면의 축약 모델·첫 다이어그램·XML 일부만으로 SQL을 만들지 않는다.
- PostgreSQL 및 DB별 전용 생성기 7종을 공통 진입점에 연결했다. 제품별 생성 범위와 실제 DB 적용 증거는 아래 표처럼 구분한다. 모든 DB 옵션·버전 지원 완료를 의미하지 않는다.
- 생성 함수는 SQL 텍스트만 반환한다. DB 접속·DDL 실행·사용자 파일 변경을 수행하지 않는다.

```ts
const result = generateNativeDdl(document, {
  dialect: 'postgresql',       // 생략 시 원본 productId에서 판별
  tableUuids: selectedUuids,    // 생략 시 전체, []이면 빈 선택
});
// sql, dialect, complete, executionVerified, diagnostics, unsupported, statistics
```

| 결과 | 의미 |
|---|---|
| `complete` | 요청 범위에서 확인된 누락 속성·구조 오류가 없는 생성 결과. DB 적용 성공을 의미하지 않음 |
| `executionVerified:false` | 이 순수 함수는 실제 DB 검증을 수행하지 않음 |
| `diagnostics` | 구조 오류, 선택 오류, SQL 표현식 오류, 명시적인 SQL 변환 안내 |
| `unsupported` | 해석하지 못한 물리 옵션·객체·방언·외부 의존성. 항목이 있으면 complete=false |
| `statistics` | 실제 출력한 테이블·컬럼·PK·FK·UNIQUE·독립 인덱스·CHECK·시퀀스 수 |

알 수 없는 DB를 PostgreSQL로 바꿔 저장하거나 출력하지 않는다. PostgreSQL이 아닌 원본을 옵션으로 PostgreSQL에 지정해도 타입 변환이 없으므로 SQL을 반환하지 않는다.

## 방언별 상태

| 방언 | 생성 상태 | 근거·다음 검증 |
|---|---|---|
| PostgreSQL | 아래 범위 구현, 실파일 생성·단위 시험 확인 | [CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html), [CREATE INDEX](https://www.postgresql.org/docs/current/sql-createindex.html), [ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html). 현재 공식 문법은 18 기준이며 지원 버전 하한은 DB 실행 후 확정 |
| MySQL | 전용 생성기 연결. 8.4.11 격리 서버에서 독립 2테이블·11컬럼 및 13개 동작 검사 통과 | `.analysis/mysql-ddl/mysql-run-v4/report.json`. 타입·기본값·문자셋·복합 키·인덱스 방향·AUTO_INCREMENT·CHECK·참조 동작 대조 |
| MariaDB | 전용 생성기 연결. 11.4.13 격리 서버에서 같은 범위의 독립 검사 통과 | `.analysis/mysql-ddl/mariadb-run-v4/report.json`. MySQL과 다른 모델 옵션·서버 결과를 별도로 검증 |
| Oracle | 전용 생성기 연결, 단위 검사·원본 메타모델/생성기 대조 | [구현 범위](oracle-ddl.md). 실제 Oracle 서버 실행은 미검증 |
| SQL Server | 전용 생성기 연결, 계산 컬럼·IDENTITY·명명 DEFAULT·인덱스 등 단위 검사 | [구현 범위](enterprise-ddl.md). 실제 SQL Server 실행은 미검증 |
| DB2 | 전용 생성기 연결, tablespace 참조·키·참조 동작 등 단위 검사 | [구현 범위](enterprise-ddl.md). 실제 Db2 실행은 미검증 |
| Tibero | 전용 생성기 연결, Oracle과 다른 물리 객체·삭제 규칙을 별도로 해석 | [구현 범위](oracle-ddl.md). 실제 Tibero 실행은 미검증 |
| CUBRID | 전용 생성기 연결, AUTO_INCREMENT·SHARED·literal DEFAULT·문자셋 등 단위 검사 | [구현 범위](enterprise-ddl.md). CHECK 강제 여부·스키마 버전 불명은 unsupported. 실제 서버 실행은 미검증 |

외부 문서 근거와 확인일은 각 생성기 명세에 기록한다. 문법 조사·텍스트 생성·실제 DB 적용·원본 DDL 동등성은 각각 다른 증거다. 원본과 요청 DB가 다르면 공통 진입점에서 SQL을 반환하지 않는다.

## PostgreSQL 구현 범위

- **기본 구조:** 스키마·테이블·컬럼, 인용 식별자, 자료형 원문, NULL/NOT NULL, SQL 기본값, 테이블·컬럼 주석.
- **도메인:** 계층에서 제안 타입·기본값·NULL을 조회한다. 미기록/null일 때만 상속하며 **명시적 빈 문자열은 상속으로 바꾸지 않는다.** PK 컬럼은 NOT NULL이다.
- **키:** PK, 대체키의 명시 UNIQUE 제약, 제약 없이 존재하는 대체키의 UNIQUE INDEX, 일반 인덱스, 복합 FK 대응.
- **순서:** PK는 원본 `IndexUtil`의 PK 전용 분기처럼 테이블 컬럼 순서를 사용한다. 일반 키·인덱스·FK는 entryIndex 오름차순, 동순위는 테이블 포함 순서를 유지한다.
- **인덱스:** ASC/DESC, NULLS FIRST/LAST, 접근 방식, collation, opclass, fillfactor, tablespace, 부분 인덱스 조건. FK의 `useIndexing=true`도 별도 인덱스를 생성한다.
- **제약:** CHECK 원래 조건, NO INHERIT, FK ON DELETE/UPDATE, MATCH SIMPLE/FULL, DEFERRABLE·INITIALLY 상태, 원본 관측에 따른 NOT VALID 플래그.
- **스토리지:** UNLOGGED, fillfactor, tablespace, 저장된 autovacuum·TOAST 옵션.
- **시퀀스:** 스키마의 SequenceGroup에서 이름·증가·시작·범위·캐시·cycle을 생성한다.
- **선택 내보내기:** 선택한 테이블만 생성하고, 범위 밖 부모키 의존성은 `unsupported`로 명시한다.

DB별 자료형의 유효성·사용자 함수·운영 tablespace 존재·기본값에 사용된 외부 sequence/function은 실제 DB 환경에서 추가 확인해야 한다. 함수가 반환하는 complete는 이 외부 환경을 검증했다는 뜻이 아니다.

## 원본 조사에서 확인한 예외

| 항목 | 관측 근거 | 적용 |
|---|---|---|
| `validated` | 원본 PG `DDLConstraintGenerator`는 true일 때 NOT VALID를 생성. false/미기록 기본 FK의 실제 GUI DDL에는 NOT VALID 없음 | 속성 이름을 직관적으로 해석해 반대로 생성하지 않음 |
| PK 순서 | 원본 `IndexUtil` PK overload는 Table.columns 순회, 그 외 membership은 entryIndex로 정렬 | 종류별 순서 분리 |
| `nulls` | 원본 `DDLIndexGenerator`: true→FIRST, false→LAST | DESC일 때도 원본 설정을 LAST로 보존 가능 |
| NULL과 빈 문자열 | 원본 `ColumnImpl.getDataType/getDefaultValue`, `DomainImpl` getter는 null 여부로 상속 | 빈 기본값을 도메인 기본값으로 다시 채우지 않음 |
| 제약 인덱스 DESC/특수 옵션 | 원본 GUI가 별도 UNIQUE INDEX와 USING INDEX를 생성하지만, PostgreSQL은 제약에 연결할 인덱스에 기본 정렬을 요구 | 해당 옵션은 unsupported로 표시. 원본 SQL과 같다는 이유로 정상 실행을 보장하지 않음 |

- 원본 모델 구조: `.analysis/ref/3.3.56/com.tomato.exerd.model_3.3.56.20260820-1610/model/exerd.ecore`.
- PG 속성: `.analysis/ref/3.3.56/com.tomato.exerd.product.postgresql.model_3.3.56.20260820-1610/model/postgreSQL.ecore`.
- 로컬 정적 관측: `.analysis/spec/ColumnImpl.javap.txt`, `.analysis/spec/DomainImpl.javap.txt`, `.analysis/spec/ColumnGroupImpl.javap.txt`.
- 원본 GUI 출력: `.analysis/oracle/ui/input/browser-structure-original-pg.sql`, `.analysis/oracle/ui/input/mutation-groups-check-v2-original-pg.sql`.
- 실제 GUI 산출물과의 비교에서 PK/FK·일반 인덱스 구성과 CHECK 표현식을 대조했다. 현재 생성기는 제약 인덱스를 기본적으로 inline 제약으로 표현하므로 원본과 SQL 문장 텍스트가 동일한 것은 아니다.

## 식별자와 표현식

- 물리 식별자는 doublequote로 감싸고 내부 doublequote를 이중화한다. 기본 PostgreSQL의 63바이트 식별자 한도를 넘으면 서버 설정·잘림·충돌 검증 필요로 표시한다.
- CHECK/인덱스 조건에 원본의 대문자 컬럼 참조가 unquoted로 저장된 경우, 그대로 출력하면 PostgreSQL의 소문자 변환 때문에 인용된 컬럼을 찾지 못한다.
- 생성 시 현재 테이블 컬럼과 일치하는 unquoted 토큰만 인용한다. 문자열·기존 quoted 식별자·함수·키워드·일반 cast 문맥은 보존한다. casefold 중복 등 확정하지 못하는 이름은 unsupported로 표시한다.
- 이 처리는 SQL 출력에만 적용한다. 원본 graph와 `.exerd`의 CHECK 문자열을 수정하지 않는다. 변환 수는 단일 `EXPRESSION_COLUMN_IDENTIFIERS_QUOTED` 경고로 알린다.
- 표현식에 독립 SQL 문장 구분·지원하지 않는 주석·닫히지 않은 문자열이 있으면 해당 구문을 생략하고 오류를 반환한다. SQL 리터럴 안의 세미콜론·주석 모양 문자열은 정상 처리한다.
- 이 문자열 처리는 완전한 PostgreSQL 파서가 아니다. 특수 cast·확장 연산자·사용자 정의 문법의 의미는 DB 실행과 대조해야 한다.

## 미지원 속성의 취급

- 테이블·컬럼·키·제약·멤버십·스키마·DB의 실제 PG 물리 속성을 순회한다. 미처리한 저장 필드는 객체·필드 단위로 `PHYSICAL_PROPERTY_NOT_IMPLEMENTED`를 반환한다.
- UUID뿐인 물리 객체·초기화된 빈 그룹은 특정 SQL 옵션이 설정됐다는 근거가 아니므로 불필요한 unsupported로 세지 않는다.
- Exclusion constraint, 사용자 정의 타입, view/function/procedure/trigger, tablespace 생성, 다른 DB의 물리 속성, 외부 사용자 정의 타입 파일, 제약과 인덱스의 상충 이름 등은 현재 한계를 명시한다.
- 과거 OID 테이블 옵션과 MATCH PARTIAL을 현재 PostgreSQL의 지원 기능으로 가장하지 않는다.
- 임시 `temporaryContents`의 테이블은 스키마 테이블 내보내기에 포함하지 않는다.

## 현재 확인 결과와 실DB 검증 입력

| 입력 | 생성 결과 |
|---|---|
| 사용자 실파일 | 609테이블·10,045컬럼·609PK·561FK·8명시 UNIQUE·94독립 INDEX·492CHECK |
| 독립 인덱스 94개 | 일반 93개 + 명시 UNIQUE 제약이 없는 대체키 1개의 UNIQUE INDEX. PK/UNIQUE 자동 생성 인덱스를 합치면 DB 인덱스 기대값 711개 |
| 실파일 변환 안내 | CHECK 표현식 492개 컬럼 인용 안내 1건. 알려진 누락 속성 0건. `executionVerified:false` |
| 원본 GUI의 복합 UNIQUE DESC fixture | 기본 구조·FK·CHECK 출력, 제약 인덱스 특수 정렬 unsupported 1건으로 partial 판정 |

- 단위 시험: `app/tests/unit/native-ddl.test.ts`. 생성/참조/순서·옵션·빈값 상속·미지원 방언·선택·표현식·원본 불변을 검증한다.
- 실파일 SQL: `.analysis/spec/native-ddl-user.sql`, 요약 `.analysis/spec/native-ddl-user.json`. 사용자 모델 SQL은 로컬 분석 경로에만 기록한다.
- 별도 독립 fixture: `.analysis/spec/native-ddl-fixture.sql`, `.analysis/spec/native-ddl-fixture.exerd`, `.analysis/spec/native-ddl-fixture-expected.json`.
- fixture 전용 스키마는 `native_ddl_fixture`. DB 기대값은 **2테이블·5컬럼·2PK·1FK·1UNIQUE·1일반 INDEX·1CHECK**, 제약 포함 인덱스 **4개**다.
- 실DB 적용은 별도 검증 작업이다. 새 임시 DB에서 오류 즉시 중단으로 적용한 뒤 catalog의 컬럼 순서·제약·인덱스·참조 동작·CHECK·기본값·주석을 읽어 비교한다. 실행 보고서가 없는 상태를 DB 검증 완료로 집계하지 않는다.
