# Oracle·Tibero 네이티브 DDL

- 구현: `app/src/formats/sql/native-oracle-ddl.ts`.
- 두 방언의 제품 식별·메타모델·지원 범위를 각각 확인했다. Oracle SQL과 호환될 것이라는 가정만으로 Tibero 지원을 선언하지 않는다.
- 2026-10-21 Oracle 공식 ARM 이미지의 26ai Free 23.26.3.0.0에서 독립 FK 모델 6개·SQL 적용/카탈로그/동작 34검사가 통과했다. [범위·재현·제한](../worklog/2026-10-21-fk-live-databases.md). 이 검증은 아래 기존 원본 대조 fixture나 모든 물리 옵션의 서버 수용을 대신하지 않는다. Tibero 실행은 미검증이다. 일반 생성 API의 `executionVerified`는 계속 `false`다.

## API와 완료 판단

```ts
generateNativeOracleDdl(document, {
  dialect: 'oracle' | 'tibero',
  tableUuids?: string[],
}): NativeDdlResult
```

- 결과 형식은 `native-ddl.ts`의 타입만 참조한다. dispatch 연결과 UI는 부모 작업 범위다.
- `complete:true`는 요청 범위에서 알려진 미지원 속성과 오류 진단이 없다는 뜻이다. 서버 실행 성공이나 원본 GUI와 문자열 일치를 의미하지 않는다.
- 원본 productId가 요청 방언과 다르면 SQL을 생성하지 않는다. 다른 DB의 타입·기본값을 추정 변환하지 않는다.
- 모든 테이블 생성 후 인덱스·키·CHECK·외래키·주석을 생성한다. 사용자 계정·권한·테이블스페이스가 이미 있어야 한다. PostgreSQL식 `CREATE SCHEMA IF NOT EXISTS`는 사용하지 않는다.
- 일부 테이블만 선택하면 범위 밖 부모키 의존성을 `unsupported`에 표시한다. 빈 선택은 빈 SQL이다.
- 원본 그래프와 XML을 수정하지 않는다. SQL은 공유·검토용 별도 산출물이다.

## 관측한 제품별 저장 구조

| 항목 | Oracle | Tibero |
|---|---|---|
| productId | `com.tomato.db.oracle_10g` | `com.tomato.db.tibero` |
| 물리 모델 URI | `http://exerd.tomato.com/oracle10g` | `http://exerd.tomato.com/tibero/model` |
| 테이블 저장 속성 | `storageAttributes: PhysicalStorageAttributes` | `segmentAttribute: SegmentAttribute` |
| INITRANS 필드 | `initialTransations` | `initialTransactions` |
| 압축 필드 | `compression` | `compress` |
| FK 삭제 규칙 | `deleteRule` | `onDeleteRule` |
| 제약 상태 | `enabled`, `validated`, `deferrable`, `deferred` | `status` |
| 시퀀스 | `SchemaProperties.sequenceGroup` | 해당 제공 메타모델에 동형 클래스 없음 |

- Oracle의 오탈자 형태 필드 `initialTransations`도 정본 이름 그대로 읽는다.
- Tibero `status`를 Oracle `enabled`와 같은 의미로 추정하지 않는다. 원본 Tibero DDL 템플릿에서도 이를 출력하지 않는다. 명시된 값이 있으면 미지원 진단으로 남긴다.
- 원본 getter 기본값도 직접 확인했다. Oracle `IndexProperties`의 미지정 `uniqueness`는 **UNIQUE**, `logging`은 **false(NOLOGGING)**다. Tibero FK의 미지정 `onDeleteRule`은 **CASCADE**이며 명시적인 빈 문자열만 **NONE**이다. Tibero `Storage.maxExtentsType`의 미지정 값은 **UNLIMITED**다. 단순히 필드가 없다고 일반적인 DB 기본값으로 대체하지 않는다.
- Oracle `ColumnProperties`의 역공학용 자료형 분해 속성을 보고 코어 `Column.dataType`을 덮어쓰지 않는다. 원본 Oracle/Tibero 테이블 생성기도 컬럼 getter의 자료형 문자열을 사용한다. 별도로 저장된 분해 속성을 해석하지 못하면 미지원으로 남긴다.

## 공통 지원

- 코어 컬럼 자료형, 기본값, NULL/NOT NULL, 한글·작은따옴표를 포함한 테이블·컬럼 주석.
- 도메인의 자료형·기본값·NULL 상속. 명시적인 빈 문자열은 상위 기본값으로 대체하지 않는다. PK 컬럼의 NOT NULL 계산은 원본 getter 규칙을 따른다.
- 실제 PK·UK·FK 제약 객체와 그룹 이름을 구분한다. 제약 객체가 없으면 가상의 제약을 만들지 않는다. AK에 UK 제약이 없으면 UNIQUE 인덱스로 출력한다.
- PK 구성원은 테이블 컬럼 순서, 다른 그룹은 `entryIndex`와 동일 순서의 테이블 위치를 사용한다. FK의 부모·자식 컬럼 대응은 각 membership의 `parentColumn`으로 읽는다.
- 일반 인덱스의 ASC/DESC, CHECK 식, FK의 CASCADE/SET NULL. 요청 방언에 없는 ON UPDATE를 생성하지 않는다.
- 식별자를 큰따옴표로 감싸고 내부 큰따옴표를 이스케이프한다. 주석은 SQL 문자열 리터럴로 이스케이프한다.
- CHECK의 인용되지 않은 모델 컬럼명은 출력 컬럼명과 일치하도록 인용하고 변경 건수를 경고한다. 원본 식은 유지한다. 완전한 SQL 파서·타입 검사기는 아니다.
- 기본값·표현식에서 별도 SQL 문장 구분자와 지원하지 않는 SQL 주석을 진단한다. 문자열 리터럴 내부의 세미콜론·주석 문자는 값으로 유지한다. Oracle 대체 인용도 처리한다. Tibero 대체 인용의 버전 호환성은 미지원 진단이다.

## Oracle 지원과 한계

- 테이블: TABLESPACE, PCTFREE/PCTUSED, INITRANS, STORAGE의 INITIAL/NEXT/MINEXTENTS/MAXEXTENTS/PCTINCREASE/FREELISTS/FREELIST GROUPS/BUFFER_POOL, LOGGING, COMPRESS, CACHE, ROWDEPENDENCIES, ROW MOVEMENT, PARALLEL degree.
- 키: 별도 인덱스를 생성해 그룹 이름을 유지하고 활성 키에는 `USING INDEX`로 연결한다. 비활성 제약에 이를 강제로 붙이지 않는다. DEFERRABLE 키는 비고유 인덱스를 사용한다. 제약 상태는 DEFERRABLE/INITIALLY와 ENABLE/DISABLE·VALIDATE/NOVALIDATE를 해석한다.
- 인덱스: NORMAL, NORMAL/REV, UNIQUE/BITMAP, 저장 옵션·TABLESPACE·LOGGING·압축 접두 컬럼 수·NOSORT·ONLINE·COMPUTE STATISTICS·PARALLEL degree. 서로 충돌하는 옵션은 오류로 보고한다.
- 시퀀스: START WITH, INCREMENT BY, MINVALUE/MAXVALUE, CACHE/NOCACHE, CYCLE, ORDER. 0 증분·유효하지 않은 정수·CACHE 1은 오류다.
- 미지원 예: DOMAIN/CLUSTER/IOT 계열 인덱스, 파티션·함수 기반 인덱스, DESC 제약 인덱스 연결, PARALLEL instances, MAXTRANS, 모니터링, 역공학용 자료형 분해 속성, DB 계정·테이블스페이스·루틴·트리거 생성. 저장된 해당 속성은 `unsupported`에서 확인할 수 있다.
- 원본 ID가 10g 계열이고 버전이 명시되지 않은 모델도 있으므로 식별자 30바이트 초과는 버전·문자셋 검토 대상으로 표시한다. 최신 Oracle의 확장 한도를 임의 적용하지 않는다.

## Tibero 지원과 한계

- 테이블: TABLESPACE, `SegmentAttribute`의 PCTFREE/INITRANS/LOGGING, STORAGE의 MAXEXTENTS·UNLIMITED·BUFFER_POOL, COMPRESS.
- 일반 인덱스: `IndexAttribute.segmentAttribute`, REVERSE, ONLINE, UNUSABLE.
- PK/UK는 기본 제약 생성에 한정한다. 별도 그룹명·정렬·물리 옵션을 제약 인덱스에 정확히 연결해야 하는 경우 `TIBERO_CONSTRAINT_INDEX_BINDING_NOT_IMPLEMENTED`를 반환한다.
- Tibero 전용 `onDeleteRule`만 읽는다. Oracle의 `deleteRule`이나 제약 상태 옵션을 가져오지 않는다.
- 미지원 예: 명시된 `status`, `tablespaceDefault` 의미, DB 테이블스페이스·암호화·루틴·트리거 생성. Oracle 시퀀스 모델을 Tibero에 삽입해 동형 지원으로 취급하지 않는다.
- 원본 Tibero 테이블 템플릿은 저장 옵션 중 TABLESPACE만 출력한다. 본 구현의 Segment 속성 지원은 Tibero 공식 문서에 근거한 독립 구현이며 원본 템플릿과 출력 문자열이 같다고 주장하지 않는다.

## 검증 결과

- `app/tests/unit/native-oracle-ddl.test.ts` **15개 통과**, TypeScript 검사 통과. 원본 GUI/API 비교 테스트는 로컬 고정 입력과 실제 SQL이 있을 때 실행하며, 해당 파일이 없는 CI에서는 생략한다.
- 각 DB 독립 생성 모델: **2테이블·5컬럼·2PK·1FK·1UK·1일반 인덱스·1CHECK**. Oracle은 별도 PK/UK 인덱스 3개를 포함하여 명시 인덱스 4개, Tibero는 일반 인덱스 1개다.
- 원본 DB 팩토리 생성 파일 2개: 실제 제품 식별·테이블/컬럼 이름·USERS 테이블스페이스·PK/FK 출력과 입력 불변성 확인.
- 로컬 독립 입력과 결과: `.analysis/spec/{oracle,tibero}-independent-ddl.{exerd,sql}`, `*-result.json`. 옵션 페이지의 예시 SQL을 결과 근거로 사용하지 않는다.
- 실제 Oracle/Tibero DB 실행은 미검증이다. NLS·사용자 권한·기존 객체·저장 환경·서버 세대별 추가 제약은 대상 DB에서 검토해야 한다.

### Tibero 원본 GUI 실제 SQL 대조

- 원본 eXERD 3.3.56에서 모델 선택 후 실제 DDL 결과를 파일로 저장했다. 물리 테이블·제약 옵션과 스키마 표기를 켰으며, 실제 주석만 사용하고 논리명 대체는 껐다. DB 연결 단계 전에 취소했다.
- 고정 입력: `.analysis/oracle/ui/input/enterprise-comparison-v1/tibero-independent-ddl.exerd`, SHA-256 `ec98a6307fb0a6543d6c4d293c05d25cbe2d229650e14af4b22d16360247d101`.
- 원본 SQL: 같은 폴더 `tibero-original-forward.sql`, SHA-256 `e844e95e3984421cb6fb1aa87fb8981295b123ebe8546aafd321843bb2c9a7b7`. 옵션·GUI 상태는 `gui-evidence.json`에 기록했다.
- 고정 입력을 앱 생성기에 다시 읽혀 비교했다. 최신 가변 경로의 모델과 이전 GUI 결과를 섞지 않았다.

| 항목 | 직접 대조 결과 | 판단 범위 |
|---|---|---|
| 테이블·컬럼 | `new_table`, `child`의 실제 5컬럼 이름·타입·NULL/NOT NULL 일치 | 출력 정의 일치 확인 |
| 키 | 이름을 포함한 PK 2개·UK 1개와 구성 순서 일치 | 출력 제약 정의 일치 확인 |
| FK | `parent_id, code` → `new_table.id, code`, 삭제 동작 생략 일치 | 컬럼 대응·순서 일치 확인 |
| 일반 인덱스 | `ix_child`: code DESC, parent_id ASC 일치 | 이름·컬럼·정렬 일치 확인 |
| 주석 | 한글·작은따옴표 포함 실제 테이블 주석 일치 | SQL 문자열 값 일치 확인 |
| TABLESPACE | 원본 `USERS`, 앱 `"USERS"` | 대문자 이름 규칙상 같은 대상 의도, 서버 조회 미검증 |
| 키 인덱스 | 원본은 PK/UK UNIQUE INDEX 3개를 별도로 생성, 앱은 키 제약으로 암시 생성 | SQL 구조 차이. 실제 카탈로그·인덱스 속성 동등 미검증 |
| CHECK | 원본은 id/code를 인용하지 않음, 앱은 선언된 소문자 컬럼명과 동일하게 인용 | 의도적인 식별자 변환. 원문 동일·서버 동등으로 처리하지 않음 |
| 배치·설명 | 원본은 테이블별 문장 묶음과 논리명 SQL 주석, 앱은 의존 순서별 묶음 | 문장 순서·설명 차이 |

- 원본 CHECK는 컬럼을 `"id"`, `"code"`로 선언한 뒤 조건에서는 인용하지 않는다. [Tibero 이름 규칙](https://technet.tmax.co.kr/upload/download/online/tibero/pver-20240502-000002/tibero_admin/chapter_01.html)에 비춰 대소문자 불일치 위험이 있다는 **추론**이다. 서버 오류로 재현한 것은 아니며 앱은 모델 컬럼명을 명시 인용하는 변환과 경고를 유지한다.
- 따라서 원본과의 **출력 정의 일치**, **의도적인 SQL 차이**, **실제 DB 실행·카탈로그 미검증**을 구분한다.

### Oracle 원본 생성 API 대조와 GUI 상태

- 최초 Oracle 입력은 원본 GUI에서 열렸지만 `SchemaSequenceFolder.getSequences()`가 `SchemaProperties.sequenceGroup=null`에서 중단됐다. 근거는 `.analysis/oracle/ui/workspace/.metadata/.log`, **2026-10-16 06:45:06**이다.
- 빈 SequenceGroup을 보완한 **66객체** 고정 입력으로 GUI 마법사·테이블 목록까지 진입했다. 이후 macOS CoreFoundation 네이티브 SIGSEGV가 JDK 25·21에서 발생했으므로 **GUI SQL 내보내기 완료로 판단하지 않는다**.
- 같은 입력을 변경하지 않은 원본 `DDLGenerator.generateDDLWithSeparator`에 전달해 **2테이블·2,125문자** 실제 SQL을 확보했다. 이는 원본 생성 API 실행 성공이며 실제 Oracle 서버 실행 성공이 아니다.
- 입력: `.analysis/oracle/ui/input/enterprise-comparison-v1/oracle-independent-ddl-sequence-v2.exerd`, SHA-256 `0d2fcbc147998caaa17c273fbeffbde2d61ab809cae40f9ef720c8b6df0d2d63`.
- 원본 출력: 같은 폴더 `oracle-original-headless-forward-v3.sql`, SHA-256 `fae013e3e06b52659bd9d0072ad12e51fa7e9555d0addb2add0c0428427e4453`. 마지막 문장도 실제 파일에서 세미콜론 종결을 확인했다.
- 생성 옵션·원본 JAR/입력/출력/도구 해시는 `oracle-original-headless-forward-v3.report.json`에 기록했다. 테이블·PK/UK/일반 인덱스·제약 생성, 물리 옵션·제약 상태·큰따옴표·스키마를 켜고 실제 주석만 사용했다.
- 실행 도구: `app/scripts/compatibility/OriginalOracleDdl.java`, `original_oracle_ddl.py`. 제품 생성기·인증 코드를 변경하지 않았다.

| 항목 | 원본 API와 앱 대조 | 판단 범위 |
|---|---|---|
| 테이블·5컬럼 | 실제 이름·자료형·NULL 의도 일치 | 앱의 nullable 컬럼은 NULL을 명시하고 원본은 생략 |
| PK2·UK1·FK1 | 제약 이름·순서·양 끝 컬럼 대응·NOT DEFERRABLE/ENABLE/VALIDATE 일치 | 실제 서버 수용 미검증 |
| 인덱스 4개 | 실제 이름·고유성·ASC/DESC·NOLOGGING 일치 | 원본 NOCOMPRESS 명시, 앱은 문서상 기본값 사용 |
| TABLESPACE·주석 | USERS와 실제 한글 주석 값 일치 | 저장소 존재·권한 미검증 |
| 테이블 기본 옵션 | LOGGING/NOCOMPRESS/NOCACHE/NOROWDEPENDENCIES/DISABLE ROW MOVEMENT 일치 | 아래 보존 오류 교정 후 재대조 |
| 키 인덱스 연결 | 앱은 활성 키에 USING INDEX를 명시 | 원본은 앞서 만든 인덱스를 서버가 선택, 실제 카탈로그 동등 미검증 |
| CHECK | 앱은 선언한 소문자 컬럼명으로 인용 | 원본과 문자열이 다르며 대소문자 위험은 실행 재현 미검증 |
| 모니터링·배치 | 원본의 테이블 MONITORING·인덱스 NOMONITORING USAGE와 문장 묶음을 앱이 복제하지 않음 | 구문 동일성·서버 상태 동등을 주장하지 않음 |

- 원본 테이블 `MONITORING` 구문은 [Oracle 10g 관리자 안내서](https://docs.oracle.com/cd/B19306_01/server.102/b14231.pdf)의 설명상 폐기된 설정이다. 인덱스 사용 모니터링과 같은 기능으로 취급하지 않는다.
- 고정 입력의 앱 결과는 `complete:true`, `unsupported:0`, CHECK 인용 변환 경고 1개다. **19개 이름·순서·속성 구문을 양쪽에서 확인했으며** 비교 파일은 `.analysis/spec/oracle-api-ddl-comparison.json`, 앱 SQL은 `oracle-api-input-app-ddl.sql`이다.
- 현재 확인 상태는 **원본 API 생성 성공 / GUI 내보내기 미완료 / 실제 DB 실행 미검증**이다.

### 원본 API 대조에서 교정한 기본값 보존 오류

- 이전 앱 출력은 Oracle `TableProperties.logging`이 저장되지 않으면 LOGGING을 생략했다. 원본 getter 기본값은 true이므로 원본은 LOGGING을 출력한다.
- [Oracle logging_clause](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/sqlrf/logging_clause.html)에 따르면 생략한 객체의 로깅 속성은 테이블스페이스 설정을 상속한다. 따라서 NOLOGGING 테이블스페이스에서는 원본 모델과 달라질 수 있는 **보존 오류**였다.
- SQL 생성 단계에서 미지정 getter 기본값을 명시 출력하도록 교정했다. LOGGING=true, compression/cache/rowDependencies/rowMovement=false를 각각 LOGGING/NOCOMPRESS/NOCACHE/NOROWDEPENDENCIES/DISABLE ROW MOVEMENT로 출력한다. 명시된 반대 값도 유지한다.
- 고정 원본 API 입력 대조와 빈 물리 속성·명시된 반대 값·입력 불변성 회귀를 추가해 **15개 테스트와 TypeScript 검사**를 통과했다. 원본 모델은 변경하지 않았다. 실제 DB에서 테이블스페이스별 결과를 조회한 검증은 남아 있다.

## 원문 근거

- 원본 Ecore: `.analysis/ref/3.3.56/com.tomato.exerd.product.oracle.model_3.3.56.20260820-1610/model/oracle10g.ecore`, `.analysis/ref/3.3.56/com.tomato.exerd.product.tibero_3.3.56.20260820-1610/model/tibero.ecore`.
- 원본 팩토리 파일: `.analysis/db-matrix/original-generated/oracle-original-factory.exerd`, `tibero-original-factory.exerd`.
- 원본 템플릿의 관측용 추출: `.analysis/spec/original-oracle10g-DDL{Table,Constraint,Common}Generator.xtend`, `original-tibero-DDL{Table,Constraint,Index}Generator.xtend`. 벤더 소스는 제품 코드에 복사하지 않았다.
- 기본값 바이트코드 관측: `.analysis/spec/OracleIndexPropertiesImpl.javap.txt`의 static 초기화·생성자, `TiberoForeignKeyPropertiesImpl.javap.txt`의 static 초기화. 이 관측은 선언된 필드명이 같아도 DB별 기본 동작을 추정하지 않기 위한 근거다.
- [Oracle CREATE TABLE](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/CREATE-TABLE.html), [물리 속성](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/physical_attributes_clause.html): 저장·테이블 옵션의 문법 대조.
- [Oracle 제약](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/constraint.html), [인덱스](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/CREATE-INDEX.html), [시퀀스](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/CREATE-SEQUENCE.html), [주석](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/COMMENT.html): 해당 구문의 독립 확인.
- [Tibero Studio 테이블 생성](https://docs.tibero.com/tiberostudio/3.0_manual/about/schema-tree-browser/table/create-table), [인덱스 생성](https://docs.tibero.com/tiberostudio.en/about/schema-tree-browser/index/create-index), [Tibero 스키마 객체 관리](https://technet.tmax.co.kr/upload/download/online/tibero/pver-20240502-000002/tibero_admin/chapter_04.html): Tibero의 제약·저장·인덱스 범위를 Oracle과 별도로 대조.
