# SQL Server·Db2 LUW·CUBRID native DDL

- 구현: `app/src/formats/sql/native-enterprise-ddl.ts`.
- API: `generateNativeEnterpriseDdl(document, { dialect: 'sqlserver' | 'db2' | 'cubrid', tableUuids? })`.
- 반환은 `NativeDdlResult`와 동일하다. `sql`, `statistics`, `diagnostics`, `unsupported`, `complete`, `executionVerified:false`를 제공한다.
- 상위 `native-ddl.ts`의 제품별 dispatcher는 별도로 연결한다. 다른 DB 모델에 dialect 이름만 지정하는 자료형 변환은 거부한다.
- 원본 식별자는 SQL Server `com.tomato.db.sqlserver_2005`(기존 별칭 sqlserver 포함), Db2 `com.tomato.db.db2`, CUBRID `com.tomato.db.cubrid`/`cubrid10`이다.

## 범위와 완료 기준

`complete=true`는 요청한 모델 범위의 저장된 DB 의미에서 확인된 미지원·오류가 없다는 뜻이다. 실제 DB 실행, 권한, 기존 객체와의 충돌, 서버 버전·설정·외부 함수의 호환성을 검증했다는 뜻은 아니다. 이 모듈은 네트워크·드라이버·DB 설치·인증정보·EULA 동의 기능을 포함하지 않는다.

- XML 문자열 추출 대신 전체 native graph를 읽는다. 모델은 변경하지 않는다.
- 물리 식별자·자료형·기본값과 domain 상속, 컬럼 순서, PK/UK/index membership, FK의 명시적 parentColumn 대응을 사용한다.
- 원본 `IndexUtil` 사실에 따라 PK는 Table.columns 물리 순서, UK/FK/일반 인덱스는 entryIndex와 원래 물리 순서를 기준으로 정렬한다.
- 전체 테이블을 생성한 다음 인덱스·FK를 생성한다. 순환 FK도 DDL 생성 순서 때문에 먼저 실패하지 않도록 분리한다.
- 선택 범위 밖 FK 부모는 필요한 외부 객체로 보고해 `complete=false`로 반환한다. 존재하지 않는 선택 UUID는 오류다.
- 자료형을 다른 DB의 이름으로 자동 치환하지 않는다. 표현식은 해당 DB에서 작성된 내용을 사용하며, 인용되지 않은 모델 컬럼 이름은 출력 식별자와 맞춘다. SQL 전체 문장·주석을 넣은 scalar 필드는 거부한다.
- DB 물리 객체의 도달 가능한 저장 속성을 검사한다. 처리하지 않은 비기본 값·중첩 객체·다른 DB 속성·사용자 확장은 `unsupported`로 보고한다. 단순 UUID·schema 기본값·비어 있는 초기화 컨테이너는 SQL 옵션으로 오인하지 않는다.

## SQL Server 전용 처리

| 원본 물리 클래스·필드 | 생성 동작 |
| --- | --- |
| ColumnProperties.identity → Identity | `IDENTITY(seed, increment)` 및 `NOT FOR REPLICATION` |
| ComputedColumnDetail.expression/persisted | `AS (expression) PERSISTED`, 지속 컬럼의 명시 NOT NULL |
| DefaultValueConstraint.expression/name | 이름 있는 `CONSTRAINT ... DEFAULT ...`; core 기본값과 다르면 오류 |
| ColumnProperties.collationName/rowGuidColumn | `COLLATE ...`, uniqueidentifier의 `ROWGUIDCOL` |
| IndexProperties.clustered/unique/includedColumns | CLUSTERED/NONCLUSTERED·UNIQUE·비키 `INCLUDE` |
| RelationalIndexOption | PAD_INDEX/FILLFACTOR/IGNORE_DUP_KEY/ALLOW_ROW_LOCKS/ALLOW_PAGE_LOCKS |
| IndexProperties.dataSpace/partitionColumn | 파일그룹 `ON ...` 또는 이름 있는 분할 스키마 `ON ...(column)` 참조 |
| IndexProperties.disable | 생성 뒤 `ALTER INDEX ... DISABLE` |
| FK/CheckConstraintProperties.enable/notForReplication | `NOT FOR REPLICATION`, 생성 뒤 `NOCHECK CONSTRAINT` |
| FK onDelete/onUpdateReferentialAction | NO ACTION/CASCADE/SET NULL/SET DEFAULT |
| systemGeneratedName | 이름 자동 생성 의도를 유지. 이 경우 저장된 이름으로 disable/comment를 지정할 수 없으면 미지원 보고 |

- 스키마는 `SCHEMA_ID` 확인 뒤 동적 별도 batch `EXEC(N'CREATE SCHEMA ...')`를 생성한다. 사용자·권한·파일은 생성하지 않는다.
- 설명은 `sys.sp_addextendedproperty`, `MS_Description`, Unicode `N'...'`와 SCHEMA/TABLE/COLUMN·CONSTRAINT·INDEX 계층으로 생성한다.
- computed+identity/default 충돌, IDENTITY 여러 개·증가값0·지원 미확인 자료형, 잘못된 INCLUDE, CLUSTERED 여러 개, 암시적 클러스터 기본키와 별도 CLUSTERED 인덱스 충돌, 잘못된 FILLFACTOR 등을 진단한다.
- FILESTREAM·XML/spatial index·실제 파일그룹/파티션 정의·bound rule·시퀀스 등 구현하지 않은 속성은 묵살하지 않는다. 데이터 공간 참조를 생성하는 것과 물리 파일을 생성하는 것은 다르다.
- 기본값 SQL에 필요한 `N'...'` 같은 DB 문법은 입력 표현식에서 유지한다. 설명의 Unicode 인용과 기본값 표현식 변환을 혼동하지 않는다.

## Db2 LUW 전용 처리

- 대문자화하지 않고 큰따옴표로 정확한 스키마·테이블·컬럼 이름을 출력한다.
- `CREATE SCHEMA`, PK·UNIQUE·CHECK·FK·ASC/DESC 인덱스, `COMMENT ON TABLE/COLUMN/INDEX`를 생성한다.
- TableProperties.tablespace/indexInTablespace는 문자열이 아니라 실제 Tablespace 참조를 따라 `IN ... INDEX IN ...`으로 출력한다.
- DatabaseProperties.tablespaces의 이름·REGULAR/LARGE/USER TEMPORARY/SYSTEM TEMPORARY 유형을 반영한다. 컨테이너·버퍼풀·스토리지 경로를 추정하지 않고 기본 자동 저장소 사용 전제는 경고한다.
- DELETE 동작은 NO ACTION/CASCADE/SET NULL/RESTRICT, UPDATE는 NO ACTION/RESTRICT만 허용한다. SQL Server의 UPDATE CASCADE를 복사하지 않는다.
- 부모 UNIQUE 제약 없이 단독 유일 인덱스를 참조하는 FK는 확인되지 않은 의미로 보고한다.
- Db2용 native ColumnProperties/Identity 클래스는 제공된 메타모델에 없다. SQL Server identity 객체를 Db2로 변환하지 않는다. 확인되지 않은 확장, 트리거·함수·사용자 정의 타입 파일은 미지원으로 보고한다.

## CUBRID 전용 처리

- 원본 ColumnProperties의 `useAutoIncrement`, `useShared`, `useDefault` 활성 플래그를 각각 적용한다. DEFAULT/SHARED 값은 원본 해당 템플릿의 문자열 리터럴 의미를 따른다. PG처럼 모든 기본값을 SQL 표현식으로 해석하지 않는다.
- `AUTO_INCREMENT(seed, increment)`를 출력하며 증가값은 양수여야 한다. 테이블 `AUTO_INCREMENT=seed`가 있으면 단일 기본 증가 컬럼의 인라인 seed/increment와 중복하지 않는다. 서로 충돌하면 오류다.
- REUSE_OID/DONT_REUSE_OID, 테이블 CHARSET/COLLATE, 테이블·컬럼·인덱스 설명을 생성한다.
- 사용자 스키마 한정명은 DB 버전이 11.2 이상으로 확인된 경우에만 생성한다. 사용자 생성·암호·권한은 다루지 않는다. 버전이 없거나 오래됐으면 스키마 생략을 미지원으로 보고하며 이름 충돌도 검사한다.
- CUBRID9 공식 문서는 CHECK를 파싱하지만 무시한다고 명시한다. 제공된 모델이 CHECK를 보유하더라도 제약 강제를 확인한 것으로 생성하지 않고 `CUBRID_CHECK_ENFORCEMENT_UNVERIFIED`로 보고한다. 최신 버전 일반 강제 지원으로 확대하지 않는다.
- 비기본 부모키 FK, 파티션·트리거·unionTables·checksum·schema charset 등의 미검증 옵션은 별도로 보고한다.
- 역슬래시 문자열은 서버 `no_backslash_escapes` 설정과 대조가 필요하다. 기본 설정을 임의로 변경하는 SQL은 생성하지 않는다.

## 검증과 남은 범위

```sh
npx vitest run app/tests/unit/native-enterprise-ddl.test.ts
npx tsc --noEmit
```

- 3제품 독립 모델에서 composite PK/FK·UK·DESC 인덱스·식별자·객체 수·비변경성을 검사한다.
- SQL Server의 identity/computed/default/collation/설명/INCLUDE/인덱스 옵션/disabled/replication을 별도 검사한다.
- Db2 tablespace 참조 및 UPDATE 제약, CUBRID 활성 플래그·리터럴·자동 증가 충돌·CHECK 미강제·스키마 버전 경계를 검사한다.
- 총 16개 테스트에서 선택 범위·교차 DB 거부·미지원 속성·위험한 scalar 필드, 명시 저장된 EMF enum 기본값과 비기본 값 구별도 검사한다. CAST/CONVERT 대상 타입이 컬럼 이름과 같더라도 타입 토큰을 컬럼으로 바꾸지 않는 회귀도 포함한다. 중첩된 빈 초기화 컨테이너는 containment·기본값을 재귀 검사하고, 실제 HASH 파티션 설정은 계속 미지원으로 보고한다.
- 실제 SQL Server·Db2·CUBRID 서버 실행은 아직 수행하지 않았다. `executionVerified:false`를 유지한다. 원본 파일 reader/writer 검증은 SQL 실행을 대신하지 않는다.

### 원본 Forward API 독립 비교

- `OriginalEnterpriseDdl.java`와 `original_oracle_ddl.py --enterprise`가 원본 EFactory로 ForwardConfiguration/ForwardContext를 구성하고 제품별 실제 DDLGenerator를 호출한다. 원본 클래스·템플릿·인증 로직을 수정하지 않으며 GUI나 DB 연결도 실행하지 않는다.
- Db2의 원본 팩토리 입력은 2테이블·3컬럼·PK2·FK1이다. 원본 결과는 `.analysis/oracle/output/db2-original-forward-v2.sql`(1,050문자), 옵션·소스/JAR/입출력 해시는 동명 `.report.json`에 있다. 앱 결과는 `db2-app-forward.sql`과 `.report.json`이다.
- 이 소형 입력의 물리 이름·INTEGER·NULL 의미·PK/FK 대응·저장된 테이블 설명을 직접 대조했다. 원본의 명시 PK backing UNIQUE INDEX2개와 앱의 제약 소유 암시 인덱스, 명시 NO ACTION·NULL의 기본값 생략, inline 제약/ALTER 문장 순서, 앱의 CREATE SCHEMA 추가를 원문 차이로 남긴다. 실제 Db2 서버에서 카탈로그·실행 계획·인덱스 속성 동등성을 검증한 것은 아니다.
- 첫 SQL Server 원본 팩토리 입력은 IndexProperties.relationalIndexOption이 없어서 원본 `DDLIndexGenerator.getIndexProperties`가 실패했다. 첫 CUBRID10 입력은 TableProperties.partition이 없어서 원본 `DDLTableGenerator.generateTablePhysicalProperties`가 실패했다. 읽기 성공과 원본 포워드 UI/API의 필수 빈 컨테이너 요구는 다르다. 초기 실패 로그도 `.analysis/oracle/output/{sqlserver,cubrid}-original-forward-v1.log`로 보존한다.
- 신규 팩토리에 SQL Server 빈 RelationalIndexOption, CUBRID 빈 Partition→PartitionAlgorithm을 초기화한 뒤 원본 API를 다시 실행했다. 고정 입력은 `.analysis/spec/sqlserver-forward-options-v2.exerd`(49객체)·`cubrid-forward-partition-v2.exerd`(48객체)다. **둘 다 원본 generator 성공**, SQL Server668문자·CUBRID10 546문자이며 결과는 `{sqlserver,cubrid}-original-forward-v2.sql` 및 동명 report/log다.
- 보완된 두 입력은 각각 2테이블·2컬럼·PK2·FK1·일반 인덱스1이다. 이름·INTEGER·NOT NULL·키 대응·인덱스 순서를 앱 출력과 직접 대조했다. SQL Server의 원본 `USE [Forward containers v2]`와 앱의 호출자 DB 컨텍스트, 자료형 인용·스키마 생성·기본 NO ACTION 생략·문장 배치는 원문 차이로 남긴다.
- CUBRID 원본은 버전이 저장되지 않았어도 owner prefix를 출력했다. 앱은 실제 11.2 이상이라는 근거가 없으므로 스키마 한정명을 생략하고 `CUBRID_SCHEMA_VERSION_UNVERIFIED`로 `complete=false`를 유지했다. 이 차이를 같은 SQL이라고 정규화하지 않는다. 중립 파티션 초기화는 별도 미지원으로 오인하지 않는다.
- 한정 대조·SHA-256·원문 차이·미검증 범위: `.analysis/oracle/output/enterprise-forward-comparison.json`. SQL Server/Db2 앱 출력은 해당 소형 입력에서 complete=true이고, 세 제품 모두 실제 DB 실행은 미검증이다.

```sh
python3 app/scripts/compatibility/original_oracle_ddl.py \
  .analysis/db-matrix/original-generated/db2-original-factory.exerd \
  .analysis/oracle/output/db2-original-forward-new.sql --enterprise
```

준비 조건과 출력 제한은 `docs/research/original-oracle.md`의 원본 DDL API 절과 같다. 원본 JAR는 로컬 `.analysis` 검증에만 사용하고 앱·릴리스에 포함하지 않는다.

## 공식 근거

- [Microsoft CREATE TABLE](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-table-transact-sql?view=sql-server-ver17): identity·computed·키/참조 제약·복제·데이터 공간.
- [Microsoft CREATE INDEX](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-index-transact-sql?view=sql-server-ver15): 정렬·INCLUDE·클러스터·인덱스 옵션.
- [Microsoft CREATE SCHEMA](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-schema-transact-sql): 별도 batch 요구.
- [Microsoft sp_addextendedproperty](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-addextendedproperty-transact-sql?view=sql-server-ver17): 설명 계층·Unicode·값 크기.
- [IBM Db2 CREATE TABLE](https://www.ibm.com/docs/en/db2/11.1.0?topic=statements-create-table): 키·CHECK·참조 동작과 UPDATE RESTRICT.
- [IBM Db2 CREATE INDEX](https://www.ibm.com/docs/en/db2/11.5.x?topic=statements-create-index): 키 정렬과 인덱스.
- [IBM Db2 CREATE TABLESPACE](https://www.ibm.com/docs/en/db2/11.1.0?topic=statements-create-tablespace): 공간 유형·기본 저장소.
- [IBM Db2 COMMENT](https://www.ibm.com/docs/en/db2-as-a-service?topic=statements-comment): 설명의 별도 문장.
- [CUBRID9.3 테이블](https://www.cubrid.org/manual/en/9.3.0/sql/schema/table.html): CHECK 파싱/무시, 초기화/제약 의미.
- [CUBRID11.2 SQL](https://www.cubrid.org/manual/en/11.2/sql/index.html), [CUBRID11.4 테이블](https://www.cubrid.org/manual/en/11.4/sql/schema/table_stmt.html): 사용자 스키마·자동 증가·설명·테이블 옵션.
- [CUBRID11.2 문자열](https://www.cubrid.org/manual/en/11.2/sql/datatype.html): 인용·역슬래시 설정.

제공된 원본 메타모델·템플릿은 `.analysis/oracle/enterprise`에서 호환 사실만 확인했다. 원본 실행 코드나 템플릿을 앱 구현에 복사하지 않았다. 전체 물리 옵션의 원본 Forward API 대조와 세 제품의 실제 서버 실행은 미검증이다.
