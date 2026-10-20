# eXERD DB별 파일 호환성 조사

2026-10-16 기준. 대상은 사용자가 제공한 eXERD **3.3.56.20260820-1610** 업데이트 파일이다. 아래 버전 표시는 해당 파일 안의 제품 등록값이며 현재 DB 제조사의 지원 범위를 뜻하지 않는다.

## 판정 기준

- **등록 확인**: `plugin.xml`의 productId·패키지·물리 속성 공급자 및 현재 독립 schema의 존재를 확인한다.
- **Native 읽기·저장**: 실제 DB 확장 객체를 포함한 모델을 전체 읽고, 모든 객체·속성·참조·순서를 새로 인코딩한 뒤 재검사한다. 바이너리 전체 바이트 소비와 feature ID도 검사한다.
- **Scalar 편집**: 테이블 논리명 한 곳과 수동 이름 표시만 변경하고, XML·바이너리 일치 및 DB identity·다른 모델 속성 보존을 검사한다.
- **원본 판독**: 원본 binary/XML reader·writer의 독립 검사다. 이 결과는 실제 GUI 재열기, DB 접속, DDL 실행 및 신규 모델 기본값 지원과 구분한다.
- 한 DB의 productId만 바꾼 모델은 다른 DB의 호환성 증거로 사용하지 않는다. 제공된 원본 코드·eCore·샘플은 배포 소스에 복사하지 않는다.

## 제공 파일에서 확인한 사실

`REF/updateSite.zip`의 SHA-256은 `daedb252b7e4644e7484dd9d1d22d93083c71fc61c63142c8b811d3a9906841d`이다. 전체 **51개 JAR**의 엔트리를 파일 확장자와 무관하게 native 서명으로 검사했다.

- 제품 등록은 **8 DB 계열·9 productId**다. CUBRID 9와 10/11이 별도 productId다.
- DB별 Native 샘플 8개가 제공된 것은 아니다. 서명이 있는 파일은 **Oracle 역사 샘플 1개**뿐이다.
- 경로는 `com.tomato.exerd.product.oracle.model_...jar` 안의 `model/history/document/0.0.0_to_1.7.0/143_oracle_example.erd`다.
- 이 역사 샘플의 파일 헤더는 `1.3.0`, qualifier는 `qualifier`다. 현재 Native API가 허용하는 `3.0.0 / 20190111-1604`와 다르다. 개별 binary 검사도 TypeScript에서 `http://exerd.tomato.com/oracle10g#ForeignKeyConstraint` 미등록으로 byte 345에서 중단한다. 현재 원본 `ErdResourceImpl`도 같은 obsolete class 때문에 거부했다. 정식 변환 서비스가 XML을 생성한 뒤에도 원본 XML reader가 obsolete 물리 속성 클래스를 찾지 못해 오류를 반환했다. 부분 객체가 만들어졌어도 성공이나 저장으로 처리하지 않았다. 이 결과는 현재 factory의 Oracle 모델과 구분한다. GUI의 전체 역사 형식 변환 경로는 별도 확인 대상이다.

| DB 계열 | 등록 productId 끝부분 | 제공 등록 버전 | 확장 패키지 URI | DB별 실제 파일 검사 |
|---|---|---|---|---|
| PostgreSQL | `postgresql` | 9.0 ~ 14.0 | `http://exerd.tomato.com/postgresql/model` | 사용자 실파일 전체 읽기·편집·저장 및 원본 GUI 재열기 별도 검증 완료. 작은 DB fixture도 원본 양방향 재판독 통과 |
| Oracle | `oracle_10g` | 9i ~ 21c | `http://exerd.tomato.com/oracle10g` | 역사 샘플은 양쪽 현재 reader가 거부. 현재 factory fixture 및 원본 양방향 재판독 통과 |
| SQL Server | `sqlserver_2005` | 2005 ~ 2019 | `http://exerd.tomato.com/sqlserver/model` | 현재 factory fixture 및 원본 양방향 재판독 통과 |
| DB2 | `db2` | UDB 8 ~ 11 for LUW | `http://exerd.tomato.com/db2/model` | 현재 factory fixture 및 원본 양방향 재판독 통과 |
| MySQL | `mysql` | 5.1 ~ 8.0 | `http://exerd.tomato.com/mysql/model` | 현재 factory fixture 및 원본 양방향 재판독 통과 |
| Tibero | `tibero` | 4/5/6 | `http://exerd.tomato.com/tibero/model` | 현재 factory fixture 및 원본 양방향 재판독 통과 |
| MariaDB | `mariadb` | 5.5 ~ 11.5 | `http://exerd.tomato.com/mariadb/model` | 현재 factory fixture 및 원본 양방향 재판독 통과 |
| CUBRID | `cubrid`, `cubrid10` | 9.0 ~ 9.3 / 10.1 ~ 11.2 | `http://exerd.tomato.com/cubrid/model` | cubrid10 원본 factory 통과. cubrid9·10 독립 신규 생성의 원본 수용도 통과 |

## 현재 factory 모델의 실측 결과

8종 모두 원본의 해당 DB `EPackage/EFactory`로 각각 생성했다. 구성은 2테이블·3컬럼·2PK·1FK이며 DB별 실제 물리 속성 객체를 포함한다. 원본 provenance는 `.analysis/db-matrix/original-generated/provenance.json`, TypeScript 전체 결과는 `.analysis/db-matrix/run-eight-1/report.json`이다.

| DB | 객체 수 | binary 바이트 | Native 읽기·저장·논리명 편집 | binary 재인코딩 바이트 동일 | 확장 클래스 종류 수 |
|---|---:|---:|---|---|---:|
| PostgreSQL | 44 | 4,633 | 통과 | 동일 | 7 |
| MySQL | 42 | 4,417 | 통과 | 동일 | 6 |
| Oracle | 43 | 4,521 | 통과 | 동일 | 6 |
| SQL Server | 44 | 4,662 | 통과 | 동일 | 7 |
| DB2 | 36 | 3,927 | 통과 | 동일 | 3 |
| CUBRID 10 | 42 | 4,420 | 통과 | 동일 | 6 |
| MariaDB | 41 | 4,328 | 통과 | 동일 | 5 |
| Tibero | 38 | 4,117 | 통과 | 동일 | 4 |

- 공통 파일 헤더는 `3.0.0 / 20190111-1604`, binary version은 0이다. 각 파일의 binary 전체를 소비했고 저장 feature ID와 독립 schema의 차이는 모두 0개다.
- 이 fixture에서 저장된 kind는 STRING·EOBJECT·EOBJECT_LIST·DATA·INT, PostgreSQL에는 BOOLEAN도 포함한다. 복잡한 전체 DB 확장 속성·각 타입의 모든 경계값을 검증한 결과는 아니다.
- 확장 객체 종류 수 차이는 DB별 메타모델 차이다. 예를 들어 DB2 fixture는 ForeignKeyConstraintProperties·TableProperties·DatabaseProperties를 포함하며, 존재하지 않는 ColumnProperties를 다른 DB 모델로 대체하지 않았다.
- `databaseVersion`은 **원본 factory 기본값 null/unset**이다. 원본 UI의 DB provider를 통해 기본값을 주입하는 과정은 실행하지 않았다. 따라서 이 결과만으로 실제 DB 버전별 신규 생성 기본값을 확정하지 않는다.
- 8종의 무편집/편집 **16개 파일**에 대해 원본 binary/XML **32회 검사 전부 통과**했고 원본 writer로 재저장했다. 이 16개를 TypeScript로 다시 읽었을 때 객체·DB identity·속성·참조·순서의 의미 차이는 0개였다. 원본이 `derivedLogicalName=false`를 생략하는 경우에는 schema의 BOOLEAN 기본값과 동등한 것으로 비교했으며 producer version은 별도 제외했다. 원문은 `run-eight-1/original-oracle/batch.json`, 역방향 비교는 `run-eight-1/reverse-read.json`이다.
- GUI 재열기 및 실제 DB 접속/DDL 검증은 이 파일 codec 검증에 포함하지 않는다.

모든 ID의 공통 접두사는 `com.tomato.db.`이다. Tibero와 MariaDB 모델 클래스는 별도 `.model` JAR가 아니라 해당 제품 JAR 안에 들어 있다.

## 재현 스크립트

```sh
PATH=/Users/zeaha/.nvm/versions/node/v24.18.0/bin:$PATH \
  node_modules/.bin/vite-node app/scripts/compatibility/db-matrix.ts -- \
  --run-db-matrix --out .analysis/db-matrix/run-새번호
```

추가 실제 모델은 JSON manifest로 지정한다. `--manifest .analysis/db-matrix/inputs.json`을 붙인다.

```json
[
  {
    "path": ".analysis/db-matrix/original-generated/postgresql-original-factory.exerd",
    "provenance": "vendor-generated",
    "expectedProductId": "com.tomato.db.postgresql"
  }
]
```

- 결과는 `.analysis` 아래의 **새 디렉터리**만 허용한다. 입력·REF·기존 결과를 덮어쓰지 않는다.
- `report.json`에는 archive/입력 해시, 파일 헤더/qualifier, DB identity, 확장 클래스별 개수, 저장된 feature kind, feature ID 불일치, 바이트 동일성, 편집 범위가 기록된다.
- 성공한 파일별 `*-roundtrip.exerd`, `*-edited.exerd`를 원본 oracle에 전달한다. 실패도 보고서에 남기므로 CLI 종료만으로 전체 지원을 판정하면 안 된다.
- PostgreSQL 사용자 실파일은 `3.0.0 / 20190111-1604`, binary version 0이며 **2,371,391바이트 전부 소비**, **36,057객체·609테이블**, 새 binary 인코딩 바이트 동일, schema feature ID 불일치 0개, 논리명·수동이름표시 이외 변경 0개로 통과했다. 실측 3.87초이며 한 번의 로컬 실행값이다. `.analysis/db-matrix/run-pg-1/report.json`에 기록했다.
- 초기 archive 검사 원문: `.analysis/db-matrix/run-1/report.json`. 독립 합성 입력 기반 단위 검사: `app/tests/unit/db-matrix.test.ts`.

## 신규 모델 API

기존 `createNativeDocument(name?)` 호출을 유지하면서 8계열·9제품 ID의 신규 생성을 구현했다. `database-products.ts`는 제품 사실과 편집 가능한 시작값만 포함하고, `create.ts`는 이를 재노출한다. DB별 새 모델의 원본 수용 결과는 별도 기록한다.

```ts
interface CreateNativeOptions {
  database: {
    productId: NativeDatabaseProductId;
    databaseVersion?: string;
  };
}
// 기존 호출 유지. 등록되지 않은 productId와 비어 있는 명시 버전은 오류 처리.
createNativeDocument(name?: string, options?: CreateNativeOptions): NativeExerdDocument;
```

- `NATIVE_DATABASE_PRODUCTS`는 productId·이름·namespace·defaultType·defaultSchema를 제공한다. DB2/Oracle/SQL Server 등의 외부 API 표기와 productId를 임의로 섞지 않는다.
- Document와 DomainDefinition의 DB identity를 함께 생성한다.
- 해당 DB의 실제 namespace·EClass·physicalProperties 및 소유 관계를 생성한다. PostgreSQL 확장 객체를 남긴 채 productId만 변경하지 않는다.
- 기본 컬럼은 PostgreSQL `BIGINT`, 나머지 `INTEGER`로 시작한다. 기본 Schema 이름은 PostgreSQL `public`, 나머지 `default_schema`다. 이 값은 편집 가능한 **앱의 시작 선택값**이며 실제 DB에 스키마가 존재하거나 원본 UI의 기본값이라는 주장이 아니다.
- 신규 객체만 해당 DB의 실존 물리 속성 클래스를 생성한다. 기존 문서를 여는 과정이나 다시 직렬화할 때 누락된 속성을 일괄 주입하지 않는다. DB2/Tibero에 없는 ColumnProperties는 만들지 않는다. 복제는 기존 패키지와 속성을 보존하며 자동 초기화를 다시 수행하지 않는다.
- 미지정 `databaseVersion`은 원본 factory와 같이 unset이다. 기존 PostgreSQL 신규 생성에서 강제하던 `PostgreSQL 9.0`도 제거했다. 명시한 비어 있지 않은 문자열은 그대로 보존한다. 버전 문자열과 실제 DB provider의 허용 목록 검증은 아직 별도 과제다.
- 사용자 원본 36,057객체에서 테이블을 하나 추가한 결과는 36,068객체다. 기존 객체의 변경은 Schema.tables·BusinessArea.tables·Diagram.diagramEntry 3곳의 목록 추가뿐이며 unrelated 변경 0개, 입력 해시/기존 문서 저장 해시 불변이었다. `.analysis/db-matrix/source-append-regression.json`에 기록했다.
- 읽기/저장, 새 모델 생성, 구조 명령, DDL, 실제 DB 접속의 지원 수준은 각각 표시한다. DB별 전용 동작은 검증된 범위부터 추가한다.

## 독립 신규 모델의 원본 수용

`createNativeDocument`로 각 제품을 새로 만들고 테이블·FK를 추가한 **9개 모델**을 원본에서 검사했다. 원본 그래프를 템플릿으로 복사하지 않았다.

| 제품 | 원본 판독 객체 수 | 원본 describe/binary/XML | 두 표현 persisted graph 차이 | 원본 재저장 후 TS 역판독 |
|---|---:|---|---:|---|
| PostgreSQL | 42 | 통과 | 0 | 통과 |
| Oracle | 41 | 통과 | 0 | 통과 |
| SQL Server | 42 | 통과 | 0 | 통과 |
| DB2 | 35 | 통과 | 0 | 통과 |
| MySQL | 40 | 통과 | 0 | 통과 |
| Tibero | 37 | 통과 | 0 | 통과 |
| MariaDB | 39 | 통과 | 0 | 통과 |
| CUBRID 9 | 40 | 통과 | 0 | 통과 |
| CUBRID 10/11 | 40 | 통과 | 0 | 통과 |

- 18회 원본 binary/XML 검사 모두 성공했고 productId도 9개 전부 일치했다. `.analysis/db-matrix/independent-created/original-oracle/{batch.json,graph-checks.json}`에 기록했다.
- 원본 재저장 9개를 TypeScript로 읽은 결과 의미 차이 0개다. 원본이 명시한 기본값·enum의 첫 값 ASC를 생략하거나 `Point(100, 100)`을 `Point(100.0, 100.0)`으로 쓰는 정규화 90건은 따로 기록했다. 근거 없는 차이를 일괄 제외하지 않았다. `.analysis/db-matrix/independent-created/reverse-read.json` 참조.
- 이 검증은 파일 읽기·저장 및 해당 PK/FK 구조의 수용 결과다. 9개 모델의 GUI 화면, DB별 기본값 provider, 모든 물리 속성, 다른 DB의 DDL 실행은 미검증이다.
- 신규 9제품·기존 PG 호출·명시/미지정 version·기존 누락 속성 보존·테이블/FK/컬럼 추가를 포함한 생성 테스트 15개와 관련 22개 테스트가 통과했다. 사용자 원본 binary/native/배치 회귀 28개도 통과했다. TypeScript 검사도 통과했다.

## 신규 모델의 원본 Forward 폴더 초기화 보완

2026-10-16 후속 원본 GUI 검사에서 Oracle 모델은 열렸지만 Forward 마법사의 `SchemaSequenceFolder.getSequences()`가 null SequenceGroup을 직접 참조해 중단됐다. 파일 reader 통과와 DDL 마법사 수용은 별도 관문이다.

- 신규 Oracle SchemaProperties에 빈 SequenceGroup을 초기화했다. 시퀀스 자체나 의미 있는 DB 설정을 추가하지 않는다.
- 같은 원본 폴더 경로의 bytecode를 확인한 결과 PostgreSQL도 SequenceGroup과 UserDatatypeGroup을 직접 참조하므로 신규 PostgreSQL 스키마의 두 빈 폴더를 초기화했다.
- MariaDB·SQL Server는 `SchemaProperties.getSequences()`가 EList를 직접 반환하므로 이 group 객체 초기화가 필요하지 않았다. Oracle 테이블의 storageAttributes/parallel은 현재 문제의 근거가 없어 일괄 추가하지 않았다.
- 추가 적용 대상은 신규 스키마뿐이다. 기존 모델을 열거나 다시 저장하면서 누락된 속성을 자동 주입하지 않는다.
- 독립 신규 모델 표의 객체 수는 당시 고정 fixture의 값이다. 이 보완으로 현재 신규 PostgreSQL에는 빈 객체 2개, Oracle에는 1개가 더 생긴다.
- 호환성 사실의 근거는 `.analysis/oracle/sequence-folder-facts/*.javap.txt`, Oracle GUI 재검사 fixture는 `.analysis/spec/oracle-independent-ddl-sequence-v2.exerd`다. 해당 fixture는 기존 파일 사본에 빈 group 1개만 보완한 66객체 모델이며 입력 해시는 유지됐다.
- 생성 20개·PostgreSQL DDL 12개·MySQL/MariaDB DDL 14개 등 46개 검사와 TypeScript 검사가 통과했다. 원본 GUI Forward 재실행 결과는 별도로 확인한다.
