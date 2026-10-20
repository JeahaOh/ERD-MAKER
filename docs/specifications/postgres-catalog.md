# PostgreSQL 카탈로그 역공학 계약

- 구현: `app/src/formats/sql/postgres-catalog.ts`.
- 조회: `app/scripts/database/postgres-catalog.sql`. TypeScript의 `POSTGRES_CATALOG_SQL`은 이 파일을 직접 읽어 내보내므로 SQL 복사본이 생기지 않는다.
- 입력: PostgreSQL 15–17의 시스템 카탈로그 조회 결과 JSON. 실제 서버 실행 검증은 별도 DB 검증 보고서로 구분한다.
- 출력: `importPostgresCatalog(input: unknown): { document, diagnostics, unsupported, complete }`.
- 네트워크·인증정보·DB 연결 기능이 없다. 사용자 테이블 행을 조회하지 않는다. SQL 파일은 단일 조회문이며 테이블·데이터·서버 설정을 변경하지 않는다.

## 조회 및 입력 형식

호출자가 직접 읽기 전용 연결을 사용한다. 여러 단계의 비교에는 동일한 읽기 전용 트랜잭션 스냅샷을 권장한다. 파일 출력 예시는 실행 환경의 인증 설정을 사용한다. 인증정보를 JSON에 저장하지 않는다.

```sh
psql -X -A -t -v ON_ERROR_STOP=1 -f app/scripts/database/postgres-catalog.sql > catalog.json
```

```ts
import { importPostgresCatalog } from './postgres-catalog';
const result = importPostgresCatalog(JSON.parse(jsonText));
if (!result.document) throw new Error(result.diagnostics.map(d => d.message).join('\n'));
// 부분 변환이면 unsupported 목록을 사용자에게 보여준 뒤 문서를 검토한다.
const { document, diagnostics, unsupported, complete } = result;
```

JSON 루트는 다음 필드를 갖는다. OID(서버 내 객체 식별 번호)는 정밀도·키 일관성을 위해 문자열로 전달한다. 컬럼 번호와 인덱스 키 순번은 정수다. 배열 순서는 조회문의 명시적 정렬을 따른다.

| 필드 | 내용 |
| --- | --- |
| `format`, `version` | `erd-maker.postgresql-catalog`, `1` |
| `serverVersionNum`, `serverVersion`, `database` | 서버 버전·현재 DB 이름 |
| `schemas` | OID·이름·설명 |
| `sequences` (선택) | OID·스키마·이름·자료형·정밀 정수 옵션·cycle·설명·소유 컬럼/의존 종류 |
| `tables` | 스키마 OID·이름·설명·종류·영속성·파티션·상속·보안·저장 옵션 |
| `columns` | 테이블 OID·attnum·이름·정확한 format_type·NULL·기본식·설명·자료형·identity/generated·정렬·저장 정보 |
| `constraints` | OID·소유 테이블·이름·종류·순서 있는 컬럼 번호·부모 컬럼 번호·소유/참조 인덱스 OID·동작·지연·검증·CHECK 표현식 |
| `indexes` | OID·소유 테이블·이름·접근 방식·unique·제약 OID·키별 순서/정렬/NULL·부분 조건·INCLUDE·저장 정보 |
| `unsupportedObjects` | 뷰·물리화 뷰·사용자 자료형·사용자 트리거·규칙 등 현재 변환하지 않는 객체 |

## 보존 규칙

- 스키마·테이블·컬럼의 물리명은 대소문자·공백·따옴표를 포함해 그대로 저장한다. 논리명은 DB가 제공하지 않으므로 물리명으로 초기화한다. 원래 ERD의 논리명·UUID·업무영역·배치를 복원했다고 주장하지 않는다.
- 자료형은 `format_type`의 결과를 그대로 저장한다. 기본식·CHECK·부분 인덱스 조건식은 `pg_get_expr` 결과를 사용하며 입력 SQL 원문의 공백·철자를 복구하는 기능은 아니다.
- PK·UK·일반 인덱스의 DB 컬럼 순서를 membership `entryIndex`로 기록한다. 제약 이름과 소유 인덱스 이름은 각각 별도 객체에 저장한다.
- FK는 `conindid`가 가리키는 부모 PK/UK/유일 인덱스와 컬럼 집합을 대조한다. 부모키의 컬럼 순열을 참조하는 경우도 허용하고 FK가 지정한 양쪽 순서와 명시적 컬럼 대응을 보존한다. FK 컬럼과 부모 컬럼을 이름으로 추측하지 않는다. 부모키의 컬럼 집합이 일치하지 않으면 해당 FK를 생략하고 명시적으로 보고한다.
- FK ON DELETE/UPDATE, MATCH, DEFERRABLE/INITIALLY DEFERRED를 저장한다. PostgreSQL `convalidated=false`는 원본 eXERD의 `validated=true`로 옮긴다. 이 원본 물리 속성은 `NOT VALID`를 뜻한다.
- 일반 인덱스의 ASC/DESC·NULLS FIRST/LAST·부분 조건식·지원 접근 방식·fillfactor·tablespace를 저장한다. 제약 인덱스의 비기본 키 옵션은 별도 미지원 항목으로 기록한다.
- 모든 객체를 하나의 그래프에 먼저 만든다. 테이블마다 명령·직렬화를 반복하지 않고 마지막에 `rebuildNativeDocument`를 한 번 호출해 binary/XML을 함께 생성한다.

## 결과와 제한

- `document=null`: 계약·OID 참조·필수 값 오류 또는 모델 생성 실패. 성공한 빈 문서로 바꾸지 않는다.
- `document`가 있어도 `unsupported`가 하나 이상이면 `complete=false`다. 각 항목은 `code`, `path`, `message`, 필요시 원래 `value`를 제공한다.
- `complete=true`는 입력 스키마의 지원 범위 안에서 확인된 누락이 없다는 뜻이다. DB 실행 승인·전체 DB 백업·소스 ERD 동등성 증거가 아니다.
- 기본키가 없는 정상 DB 테이블은 설계 검증 경고가 나올 수 있다. 경고만으로 변환 실패로 판정하지 않는다.
- 원본 기본키 getter는 물리 컬럼 순서를 따른다. DB PK 순서가 이와 다르면 테이블을 재정렬하지 않고 `PRIMARY_KEY_ORDER_NOT_REPRESENTABLE`를 보고한다.
- 시퀀스의 start/min/max/increment/cache는 정밀도 손실 없이 문자열로 읽어 원본 PostgreSQL Sequence의 숫자 속성에 저장한다. 자료형·영속성·소유 컬럼은 `extendedProperty`의 원본 지원 CORE PropertyEntry (`erd-maker.postgresql.sequence.v1`) JSON에 저장한다. 앱 DDL 엔진은 AS 자료형·UNLOGGED·CREATE 이전/OWNED BY 이후 순서를 처리한다. 원본 프로그램의 포워드 엔진이 이 새 확장을 해석한다고 주장하지 않는다.
- `sequences`가 없는 기존 버전 1 JSON도 허용한다. 구버전 `unsupportedObjects`에 있는 시퀀스는 계속 미지원으로 보고하며 이름으로 옵션을 추측하지 않는다. IDENTITY 내부 의존 (`i`)은 일반 SERIAL 소유권 (`a`)으로 대체하지 않는다.
- identity·generated 컬럼은 방식·표현식을 미지원 정보로 보고한다. generated 식을 DEFAULT로 변환하지 않는다.
- 파티션·상속·외부/임시 테이블, RLS·복제 옵션, 비기본 저장·압축·통계 옵션, 표현식 인덱스, INCLUDE, NULLS NOT DISTINCT, 배제 제약, FK SET NULL/DEFAULT 대상 컬럼 부분 집합 등은 명시적으로 보고한다.
- 원본 물리 속성은 일부 opclass/collation을 열거형으로만 지원한다. 자유 문자열을 원본 엔진에서 읽지 못할 enum으로 저장하지 않는다.
- 뷰·사용자 자료형·트리거·규칙은 존재를 보고하며 DDL 복원을 약속하지 않는다. 소유자·권한·함수·확장·DB 설정은 이 스키마 모델 계약의 범위 밖이다.
- 파일에 DB 객체 이름·설명·표현식이 포함된다. 증거용 실제 카탈로그는 `.analysis` 아래에서만 관리하며 저장소에 실사용 모델을 포함하지 않는다.

## 검증

```sh
npx vitest run app/tests/unit/native-postgres-catalog.test.ts
npx tsc --noEmit
```

- 인용 식별자·자료형/기본식/설명·PK/FK/CHECK·partial DESC/NULLS FIRST·지연·NOT VALID의 의미 검증.
- 깨진 참조와 미지원 생성 컬럼·인덱스 옵션·PK 순서 차이의 진단 검증.
- 합성 609테이블·9,744컬럼을 한 번의 bulk import로 처리하는 성능 회귀 검증. 단일 로컬 실행 약 0.5초이며 기기/부하에 따라 달라진다.
- 실제 PostgreSQL 17.11의 2테이블·5컬럼 및 609테이블·10,045컬럼 카탈로그를 import하고 원본 엔진 binary/XML reader로 해석했다. 양쪽 표현 차이는 각각 0이며, 원본 graph와 카탈로그 메타데이터 비교 60 / 50,593항목도 차이 0이다. 원본 FK getter의 561개 대응도 일치한다. 후속 시퀀스 11개까지 포함한 50,593항목 비교도 차이 0이며, 원본 reader→writer→reader 재저장에서 전체 그래프와 확장 11개가 그대로 보존됐다.
- 실제 DB export→import→재생성 SQL→독립 DB 재적용 비교는 별도 보고서로 제시해야 한다. 합성 단위 테스트는 이를 대체하지 않는다.
- 실제 쿼리 검증에서 PostgreSQL 내부 `"char"`와 문자열 연결의 명시 캐스팅 필요, PostgreSQL 17 `attstattarget=null`의 기본값 의미를 확인해 수정했다. 단위 테스트와 실 DB 쿼리를 구분한다.

## 공식 근거

- [PostgreSQL 17 pg_attribute](https://www.postgresql.org/docs/17/catalog-pg-attribute.html): attnum·attidentity·attgenerated·컬럼 물리 속성.
- [PostgreSQL 17 pg_constraint](https://www.postgresql.org/docs/17/catalog-pg-constraint.html): conkey/confkey 순서·참조 동작·지연·검증 상태.
- [PostgreSQL 17 pg_index](https://www.postgresql.org/docs/17/catalog-pg-index.html): indkey의 표현식 0·키/포함 컬럼 구분·NULLS NOT DISTINCT.
- [PostgreSQL 17 정보 함수](https://www.postgresql.org/docs/17/functions-info.html): format_type·pg_get_expr·pg_get_indexdef 등 카탈로그 표현식 변환.

## 실제 DB 왕복의 CHECK 표현 차이 검증

- 고정 원본/재적용 카탈로그의 객체 OID 참조를 같은 스키마·테이블·객체 이름으로 연결해 **278,352필드**를 비교했다.
- 원문 문자열 차이는 **980필드**이며, **490 CHECK의 expression/definition 각각 1개**에 한정됐다. 다른 **277,372필드**(정확한 자료형·DEFAULT·FK 순서/동작·인덱스 정렬·시퀀스11개 옵션/소유권 포함)는 일치했다.
- 차이 형태: `(ARRAY['Y'::varchar, ...])::text[]`가 재파싱 뒤 `ARRAY[('Y'::varchar)::text, ...]`로 표현됐다. 원문 차이를 0으로 덮어쓰지 않고 별도 유지한다.
- [PostgreSQL 17 배열 생성자 문서](https://www.postgresql.org/docs/17/sql-expressions.html#SQL-SYNTAX-ARRAY-CONSTRUCTORS)는 배열 생성자에 적용한 캐스트가 각 원소에 개별 적용한 것과 같은 효과라고 설명한다. [CREATE CAST 문서](https://www.postgresql.org/docs/17/sql-createcast.html)는 varchar/text가 이진 호환 변환임을 명시한다.
- `prepare_check_cast_evaluation.py`는 관측된 **단일 컬럼 varchar 리터럴 enum ANY**와 정확한 캐스트 분배 형태만 허용한다. 임의 SQL 논리 동등성을 판정하는 도구가 아니다.
- 독립 PostgreSQL **17.11** 컨테이너에서 사용자 테이블 없이 **READ ONLY + typed VALUES**로 원문·재표현을 동시에 계산했다. 허용 리터럴 전부, NULL, 빈 문자열, 비허용값, 공백, 대소문자, 한글 등을 포함한 **9,828회** 결과 비교의 불일치는 **0**이었다.
- 결과 분포: TRUE **2,936**, FALSE **6,402**, NULL **490**. **490개 CHECK 각각에서 TRUE/FALSE/NULL을 모두 확인**했다. NULL 비교에는 `IS DISTINCT FROM`을 사용했다.
- 이는 공식 캐스트 규칙·제한된 구문 형태·유한 입력 계산의 근거다. 임의 표현식/함수/사용자 캐스트/서로 다른 서버 설정의 일반 논리 동등성을 증명한 것으로 확대하지 않는다.
- 증거: `.analysis/catalog/database-roundtrip-comparison.json`(원문 차이 유지), `database-roundtrip-normalized.json`(제한 형태 분류), `check-evaluation/{plan.json,evaluate.sql,execution-report.json}`(실제 계산).
- 컨테이너는 `--network none`, 호스트 포트 없음, 임시 데이터 볼륨으로 생성하고 `finally`에서 제거했다. 최초 준비 감지 경합 실패도 `startup-race-report.json`에 보존했다. 최종 실행은 로컬 TCP 준비 완료를 기다려 통과했다.
