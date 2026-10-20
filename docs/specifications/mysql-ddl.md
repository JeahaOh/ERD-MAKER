# Native MySQL·MariaDB DDL

2026-10-16 구현·검증 기준. 공개 API는 `generateNativeMysqlDdl(document, { dialect: 'mysql' | 'mariadb', tableUuids? })`이며 결과는 `NativeDdlResult`와 같다. 이 모듈은 `native-ddl.ts`에서 타입만 가져와 런타임 순환 의존성을 만들지 않는다.

- 입력 DB productId와 방언이 정확히 일치해야 한다. PostgreSQL이나 MySQL 모델을 MariaDB로 바꾸어 출력하지 않는다.
- 모델의 native graph가 정본이다. 입력 문서나 그래프를 수정하지 않는다.
- `complete`는 알려진 누락이나 오류가 없다는 뜻이다. 함수는 DB에 접속하지 않으며 `executionVerified`는 항상 `false`다. 아래 실DB 증거는 지정한 fixture와 서버 버전에 한정된다.
- 명시한 테이블만 선택할 수 있다. 범위 밖 부모 FK는 의존성으로 보고하고, 없는 UUID는 오류로 반환한다.

## 속성의 SQL 대응

| 모델 | 출력·규칙 |
|---|---|
| Schema.physicalName | MySQL/MariaDB의 database 이름으로 인용. 선택한 테이블의 database만 생성 |
| Column.dataType | 저장된 타입 문자열을 그대로 사용. 정수·수치·문자·ENUM/SET·시간·바이너리·JSON·공간 타입의 지원 구문을 검사. 다른 DB 타입으로 변환하지 않음 |
| dataType/defaultValue/notNull의 Domain 상속 | 컬럼 자체 값 우선. 명시한 빈 기본값은 도메인 기본값을 다시 상속하지 않음 |
| Column.defaultValue | 리터럴·CURRENT_TIMESTAMP·괄호 표현식. MariaDB 함수 기본값도 지원. SQL 텍스트를 값 문자열로 재포장하지 않음 |
| Column.notNull | TRUE/FALSE를 NOT NULL/NULL로 대응. PK·AUTO_INCREMENT는 DB 규칙상 NOT NULL |
| Column.comment / Table.comment | 인용부호·역슬래시·줄바꿈을 보존한 COMMENT |
| PrimaryKeyColumnGroup | 원본 PK overload와 같은 Table.columns 순서. 제약 객체의 물리명을 SQL에 사용 |
| AlternateKeyColumnGroup | entryIndex의 안정 정렬 순서. 이름은 실제 UniqueConstraint 우선. 그룹명과 실제 제약명이 다르면 동시 보존 불가 진단 |
| InversionEntryColumnGroup | 멤버 순서·ASC/DESC·인덱스 방식·주석. MySQL의 parser/keyBlockSize 구문도 구별 |
| ForeignKeyColumnGroup | 명시한 parentColumn 대응을 부모 PK/UK 순서에 맞춰 함께 정렬. 부모/자식 대응 자체는 바꾸지 않음 |
| ForeignKeyConstraintProperties | ON DELETE/UPDATE의 RESTRICT·NO ACTION·CASCADE·SET NULL |
| CheckConstraint.expression | 인용된 문자열을 구별하여 표현식 검사 후 CHECK 생성 |
| MySQL TableProperties | engine·characterSet·collation·autoIncrement·rowFormat 및 확인된 숫자/열거형 테이블 옵션 |
| MariaDB TableProperties | characterSet·collation·startValue → AUTO_INCREMENT. 해당 원본 클래스에 없는 engine 필드를 MySQL 속성처럼 처리하지 않음 |
| ColumnProperties.autoIncrement | AUTO_INCREMENT. 정수 타입·테이블당 1개·첫 인덱스 컬럼·기본값 없음 검사 |

물리 속성 클래스와 namespace는 제공된 원본 모델의 독립 관측 사실을 사용한다. 원본 팩토리가 만든 MySQL/MariaDB 파일 각각에서도 2테이블·3컬럼·2PK·1FK 생성이 누락/오류 없이 통과했다. 원문 코드를 제품에 복사하지 않았다.

타입·컬럼·키·테이블 옵션 문법의 기준은 [MySQL 8.4 CREATE TABLE](https://dev.mysql.com/doc/refman/8.4/en/create-table.html)과 [MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table)이다. 서버는 명시한 PK 이름을 `PRIMARY`로 정규화하고 정수 표시 폭·리터럴 표현도 다르게 저장할 수 있으므로 raw DDL 문자열과 catalog의 바이트 동일성을 요구하지 않는다.

## SQL 모드와 표현식

SQL은 세션 모드를 저장한 뒤 기존 모드 중 ANSI_QUOTES·NO_BACKSLASH_ESCAPES만 제외하고 STRICT_TRANS_TABLES·NO_ENGINE_SUBSTITUTION을 추가한 뒤 생성문을 실행하고 마지막에 복원한다. 날짜·그룹화 등 다른 기존 모드는 보존한다. 이 계약에서는 ANSI_QUOTES·NO_BACKSLASH_ESCAPES를 사용하지 않는다. 모델의 기본값/표현식은 해당 모드의 SQL로 해석하며, 생성한 COMMENT 문자열은 역슬래시와 인용부호를 이중 처리한다. SQL 모드에 따른 문자열 해석은 [MySQL 문자열 규칙](https://dev.mysql.com/doc/refman/8.4/en/string-literals.html), [MariaDB 문자열 규칙](https://mariadb.com/docs/server/reference/sql-structure/sql-language-structure/string-literals)에 근거한다.

- 문장 구분자·주석·NUL·닫히지 않은 인용/괄호·최상위 쉼표는 오류다. 문자열 안의 동일한 문자는 문자열 값으로 보존한다.
- 모든 SQL 표현식을 완전한 AST로 분석하거나 서버의 함수 허용 여부까지 검증하는 SQL 컴파일러는 아니다. 실행 시 서버의 추가 제약을 받을 수 있다.
- MySQL의 JSON/TEXT/BLOB 리터럴 기본값은 서버 문법에 맞게 괄호만 추가한다. 값·표현식 본문은 유지한다. [MySQL 기본값 규칙](https://dev.mysql.com/doc/refman/8.4/en/data-type-defaults.html)
- 생성 파일이 중간 오류로 중단되면 마지막 복원문이 실행되지 않을 수 있다. 검증 harness는 같은 세션에서 끝까지 적용한 뒤 SQL 모드 복원을 직접 확인한다.

## 미지원·오류 처리

저장된 물리 옵션을 사용 여부로 추적한다. UUID·임시 값·빈 목록을 제외하고 해석하지 못한 옵션은 `unsupported`로 반환한다. 예: partition, triggers, tablespace, logfile group, 데이터/인덱스 디렉터리, 외부 타입 파일, 사용자 정의 속성, 다른 DB의 물리 객체, 별도 FK useIndexing 정책. View·Function·Procedure·Trigger DDL도 구현 범위 밖이다.

- MySQL MATCH는 의미를 강제하지 않고 ON DELETE/UPDATE까지 무시시킬 수 있어 출력하지 않는다. SET DEFAULT도 InnoDB/NDB가 거부하므로 미지원으로 반환한다. [MySQL FK 규칙](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)
- MariaDB FK는 InnoDB·같은 타입/부호·인덱스를 요구하며 SET DEFAULT가 지원되지 않는다. 여기서는 명시한 비InnoDB 엔진의 FK와 비PK/UK 부모를 미지원으로 반환한다. [MariaDB FK 규칙](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys)
- MySQL CHECK의 AUTO_INCREMENT 컬럼 참조를 오류로 반환한다. [MySQL CHECK 규칙](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html)
- TEXT/BLOB 일반 인덱스의 prefix 길이는 현재 모델에서 해석하지 못해 미지원이다. FULLTEXT/SPATIAL/HASH의 DESC, MEMORY 이외 HASH, 효과가 검증되지 않은 엔진별 옵션도 미지원으로 구분한다.
- MariaDB DESC 인덱스의 실행 검증 대상은 11.4다. 이전 버전의 정렬 효과를 동일하게 보장하지 않는다. [MariaDB 인덱스 버전 규칙](https://mariadb.com/docs/server/server-usage/tables/create-table#index-definitions)
- 전체 타입별 최대 길이·정밀도·문자셋별 인덱스 바이트 한도·스토리지 엔진/플러그인 설치·모든 표현식 함수는 DB의 추가 검사 대상이다. 모든 엔진/타입/버전의 실행 지원으로 확대하지 않는다.

## 실제 DB 실행 결과

공식 이미지로 새 컨테이너를 만들어 적용했다. `--network none`, 호스트 포트 없음, 메모리 1GiB, `/var/lib/mysql` tmpfs, host bind mount 없음이다. 초기화 중 임시 서버와 구분하기 위해 TCP readiness를 사용했다. 검증 종료 후 해당 컨테이너와 임시 데이터는 제거했고 다운로드 이미지는 보존했다.

| 항목 | MySQL | MariaDB |
|---|---|---|
| 실제 버전 | 8.4.11 Community Server | 11.4.13-MariaDB-ubu2404 |
| 이미지 | mysql:8.4 | mariadb:11.4 |
| DDL 적용·카탈로그 비교 | 통과 | 통과 |
| 컬럼·정밀도·NULL·기본값·주석 | 11컬럼 확인 | 11컬럼 확인 |
| PK/UK/FK/CK 이름·종류 | 5제약 확인 | 5제약 확인 |
| 인덱스 컬럼 순서·방향·주석 | 8 index parts 확인 | 8 index parts 확인 |
| 복합 FK 컬럼 대응·참조 동작 | 2쌍, UPDATE CASCADE / DELETE SET NULL | 동일 |
| AUTO_INCREMENT / 타입별 기본값 | 시작 100, DECIMAL·ENUM·TIMESTAMP·VARBINARY·역슬래시 포함 문자열 | 동일 |
| 실제 거부·행동 검사 | 13개 통과 | 13개 통과 |
| 세션 SQL 모드 복원·컨테이너 제거 | 확인 | 확인 |

각 DB에서 PK NULL `1048/23000`, PK·UK 중복 `1062/23000`, 잘못된 FK `1452/23000`을 확인했다. 음수 CHECK 위반은 MySQL `3819/HY000`, MariaDB `4025/23000`으로 실제 거부됐다. 단순 개수 일치 외에 기본값을 생략한 INSERT 결과, 부모 키 변경에 따른 자식 두 컬럼 갱신, 부모 삭제 후 두 컬럼 NULL을 조회했다.

- 최신 보고서: `.analysis/mysql-ddl/{mysql-run-v4,mariadb-run-v4}/report.json`
- 카탈로그 원문: 각 결과 디렉터리 `catalog.json`, `*.show-create.sql`
- 생성 모델·SQL·명시 기대값: `.analysis/mysql-ddl/fixtures-v3/`
- 원본 팩토리 모델 생성 결과: `.analysis/mysql-ddl/original-factory-generation.json`
- 단위 검사: `native-mysql-ddl.test.ts` 14개, TypeScript 검사 통과. 별도 테스트 helper로 그래프를 독립 생성한다.

재현은 미리 받은 로컬 공식 이미지만 사용한다. 기존 DB나 외부 서비스에 접속하지 않는다.

```sh
python3 app/scripts/database/verify-mysql.py \
  --sql .analysis/mysql-ddl/fixtures-v3/mysql.sql \
  --expected .analysis/mysql-ddl/fixtures-v3/mysql-expected.json \
  --out .analysis/mysql-ddl/mysql-새결과
```

MariaDB는 파일명을 `mariadb`로 바꾼다. 결과 경로는 `.analysis` 아래의 새 디렉터리여야 한다. 스크립트는 입력 해시·실제 이미지 ID/digest·컨테이너 ID·버전·각 행동의 출력/오류를 기록하고, 실패나 정상 중단에도 자신이 만든 컨테이너를 정리한다.
