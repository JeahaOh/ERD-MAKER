# 모델·DB별 물리 속성 관측 명세

- 기준: 제공된 3.3.56 Ecore와 등록 XML. **원본 소스 구현 재사용 없이 호환에 필요한 이름·종류·참조·순서·기본값을 관측한다.**
- 생성기: `python3 app/scripts/references/catalog-model.py`. 기본 출력은 `.analysis/spec/binary-registry.json`이다.
- 제품용 메타데이터: `python3 app/scripts/references/catalog-model.py --write-runtime`. `app/src/formats/exerd/schema.generated.json`에는 namespace, class, feature 이름/ID/종류/타입/다중값/소유참조/기본값 등의 호환 사실만 기록한다. 원본 Ecore 문서·주석·도움말·Java 클래스는 넣지 않는다.
- 원문: `.analysis/ref/3.3.56/com.tomato.exerd.model_3.3.56.20260820-1610/model/exerd.ecore`. DB별 파일은 아래 표 참조. 파일별 해시는 [카탈로그 요약](../research/evidence/model-catalog-summary.json)에 기록했다.
- 제외: `history/`, `diagram/`, `temp/`, `debug/` Ecore는 현행 runtime namespace와 중복되거나 과거/도식 보조 모델이므로 이번 현행 레지스트리에서 제외했다. **과거 형식 지원을 최종 범위에서 제외했다는 뜻이 아니다.**

## 공통 객체와 소유 관계

`소유`는 containment다. 자식이 부모에 포함되어 수명과 저장 위치를 공유한다. 일반 참조와 구분해야 삭제·복제·다이어그램 이동 시 객체가 사라지지 않는다.

| 객체 | 직접 선언한 주요 속성·참조 | 구현 계약 |
|---|---|---|
| ExerdModel | `temporaryContents`, `userDefiendProperty`, `extendedProperty` | 사용자/확장 key-value 별도 보존. `temporaryContents`는 transient |
| UUIDOwner | `UUID` | 공유 참조의 식별자, 이름과 구분 |
| Document | `version`, `modelVersion`, `productId`, `modelType`, `databaseVersion`, `customDataTypeFile` | DB제품/DB버전/앱저장버전/모델형식버전 별도 필드 |
| Document | 소유: `relationManager`, `configuration`, `businessAreas[]`, `databaseModel`, `sharedIcons`; 참조: `activeBusinessArea`, `activeSchema`, `openedDiagrams[]` | 활성/열린 목록이 모델 소유자가 아님 |
| Configuration | 소유: `domainDefinition`, `viewSettingsPreset[]`; `interactionMode`, `termFilePath` | 사전 외부 경로와 도메인 정의 구분 |
| DatabaseModel / Schema | 소유: 스키마, 테이블·뷰·함수·프로시저 | 업무영역 삭제가 DB객체 삭제를 의미하지 않음 |
| BusinessArea | 소유: `diagrams[]`; 참조: `tables[]`, `views[]`, `functions[]`, `procedures[]` | 하나의 DB객체를 여러 업무영역에서 참조 가능 |
| NameOwner | name/oppositeModeName/logicalName/physicalName + 각 derived 플래그 | 명시 이름과 유도값을 같은 필드로 합치지 않음 |
| Table | 소유: `columns[]`, `columnGroups[]`, `checkConstraints[]`; source/targetRelation | 관계 방향·중복 참조 검사 |
| Column | 소유: `memberships[]`; 참조: `domain`; dataType/defaultValue/notNull/tagColor/indexed | 도메인 유도·명시값·삼상 NOT NULL 유지 |
| ColumnGroup | 참조: `member[]`, `membership[]` | 구성순서와 membership entryIndex 대조 |
| PrimaryKeyColumnGroup | 소유: primaryKeyConstraint | PK그룹·실제 제약·개별 멤버를 구분 |
| AlternateKeyColumnGroup | 소유: uniqueConstraint | 일반 인덱스와 구분 |
| ForeignKeyColumnGroup | 참조: parentColumnGroup; 소유: foreignKeyConstraint; useIndexing | 참조대상은 식별가능키, 단순 테이블명 아님 |
| GroupMembership / ColumnReference | group, owner, entryIndex / childColumn,parentColumn | 복합키 컬럼 대응과 순서가 독립적으로 필요 |
| IndexableMembership | sortType | ASC/DESC 원래 값 보존 |
| RelationManager / RelationEntry | 소유: relation entries / value; key는FK그룹 참조 | 관계를 FK그룹과 매핑 |
| Relation | FK그룹참조, identifying, parentCardinalityType,childCardinalityType | 논리표기·물리키 일관성 별도 검사 |
| DomainContainer / Domain | 소유: domain[]; name,suggestedDataType,suggestedDefaultValue,suggestedNotNull,extendedData | 도메인 중첩·제안값·확장 정보 보존 |
| PhysicalPropertyOwner | 소유: physicalProperties | 클래스 namespace를 DB와 함께 보존 |
| Constraint / CheckConstraint | 공통 제약이름/확장속성 상속, CHECK expression | SQL 문자열을 정규화해 덮지 않음 |
| Diagram | 소유: diagramEntry[],viewSettings,printSettings; 참조:filteredRelations[] | 배치와 의미 모델 분리, 숨긴관계도 원본보존 |
| DiagramEntry / TableDiagram | location / table참조,theme,columnFilter,ref | 모델 하나·배치 여러개·위치 각각 유지 |
| Note | text,target,textColor,backgroundColor,baloonPoint,manualSize | note.target도 배치참조, 오타철자 원문 유지 |
| ViewSettings | cellsToShow[],showColumnHeader,name,description,showAltTableName,columnFilter,showTableComment,showColumnCount | 전역 preset과 다이어그램 설정 별도 |
| PrintSettings | 4방향 margin,paperKind,paperOrientation,scale,header,footter,배경/테두리 옵션 | 단위·OS별 실제 페이지영역 원본실험 필요 |
| SharedIcons / Icon | 소유: icon[] / imageData,name,builtin | 이미지 바이너리·공유 참조 보존 |
| View / Function / Procedure / Trigger | definition | 정의문의 언어/인코딩/소유위치 보존 |
| Clip | document소유,kind | 복사시 관계·ID 정책 확인 필요 |

## 코덱 타입·기본값

- 각 클래스에는 선언 feature와 상속을 펼친 전체 feature가 있다. 다중상속의 같은 선언은 한 번만 포함하고 상위→현재 선언순으로 ID를 부여한다.
- `EBoolean/EByte/EChar/EDouble/EFloat/EInt/ELong/EShort/EString` 단일값은 해당 BinaryIO scalar 종류에 대응한다. enum/custom datatype은 DATA다. **다중 attribute는 EString을 포함해 DATA_LIST**다. 객체 참조는 EOBJECT/EOBJECT_LIST이며 소유·proxy 정보는 별도 유지한다.
- 기본값은 `defaultValueLiteral`의 유무를 함께 저장한다. null·빈문자열·0·false·enum 첫값과 “원본에 미기록”을 임의로 같은 것으로 바꾸지 않는다. 실제 getter 기본값은 원본 runtime과 별도 대조한다.
- `RGB`, `Point`, `Dimension`, `PaperKind`, `TableTheme`, `ImageData`는 공통 primitive로 오인하면 안 된다. 독립 문자열/이미지 변환 계약과 범위 검사가 필요하다.
- Generic 타입을 명시하지 않은 경우 EMF 타입소거 관측값은 attribute=`EJavaObject`, reference=`EObject`다.
- `BooleanEnum`은 true/false/미정 계열의 enum이다. 저장 literal·실제 유도 의미는 파일/원본 getter와 대조한다.
- `transient`, `derived`, `volatile`, `unsettable`, `changeable`, `ordered`, `unique`, `resolveProxies`, `eOpposite`를 읽고 남긴다. 생성 setter/getter와의 완전 일치는 별도 검사한다.

검수 결과(2026-10-15):

| 독립 비교 | 범위 | 결과·한계 |
|---|---|---|
| Ecore 관측 ↔ 원본 generated runtime 메타모델 | feature 이름·상속ID·타입·many/transient/derived·명시 기본값·정규화 종류 **902개** | 불일치 **0**. runtime표본 없는 클래스 **208개**는 미검증 |
| 실파일 Binary stream ↔ 제품용 schema | **36,057 객체·133,013 feature ID** | 불일치 **0**. 객체의 값 전체나 원본 GUI 재열기 수용을 대신하지 않음 |

- 로컬 근거: `.analysis/spec/generated-schema-comparison.json`, `.analysis/spec/stream-schema-comparison.json`.
- 메타모델 비교 재현: `python3 app/scripts/references/catalog-model.py --oracle .analysis/oracle/output/metamodel.json --write-runtime`.
- stream 비교: Node 24의 `--experimental-transform-types`로 `.analysis/spec/check-stream-schema.mjs` 실행. 이 검사 입력은 `.analysis/codec/user.bin`이며 원본 컨테이너 추출·CRC 근거는 코덱 보고서와 함께 유지한다.

## DB별 물리 객체·속성

각 원문 경로는 `.analysis/ref/3.3.56/` 아래다. 표는 직접 관측한 구조이며 지원 DB버전·DDL 정합성·실제 편집 가능 여부를 증명하지 않는다.

| DB | 원문 Ecore | 객체·속성군 |
|---|---|---|
| PostgreSQL | `com.tomato.exerd.product.postgresql.model_3.3.56.20260820-1610/model/postgreSQL.ecore` | CHECK noInherit/validated; FK onDelete/onUpdate/match/deferrable/deferred/validated; PK/UNIQUE deferrable/deferred; index methodKind/fillfactor/tablespace/condition/exclusion; membership operation/opclass/nulls/collation; table oids/type/unlogged/fillfactor/tablespace/triggers/tableVacuum/toastVacuum; schema sequenceGroup/userDatatypeGroup; tablespace location; sequence min/max/start/increment/cache/cycle; userdatatype definition/type |
| Oracle | `com.tomato.exerd.product.oracle.model_3.3.56.20260820-1610/model/oracle10g.ecore` | tablespace/datafile/extent/storage/group; schema default/temporary tablespace・sequenceGroup; table logging/parallel/cache/rowMovement/monitoring/rowDependencies/compression/triggers; column type/length/precision/scale/inBytes; constraint enabled/deferrable/deferred/validated/generated; FK reference owner/table/constraint/deleteRule; function-based index columnExpressions/domainIndex/partitioned/online; sequence |
| SQL Server | `com.tomato.exerd.product.sqlserver.model_3.3.56.20260820-1610/model/sqlserver.ecore` | DB fileGroups/logFiles/collation/owner/compatibility/partitionFunctions/partitionSchemas/assemblies/users/filestream/xmlschema/triggers; table dataSpace/partitionColumn/xmlIndexes/spatialIndexes/optimization; column collation/rowGuid/filestream/XML/boundRule/computed/default/identity; index includedColumns/unique/clustered/partition/relational options; domain CLR/type/null/schema; sequence |
| DB2 | `com.tomato.exerd.product.db2.model_3.3.56.20260820-1610/model/db2.ecore` | tablespaces/type; table triggers/tablespace/indexInTablespace; view triggers; FK delete/update |
| MySQL | `com.tomato.exerd.product.mysql.model_3.3.56.20260820-1610/model/mysql.ecore` | schema characterSet/collation; DB logFileGroups/tablespaces/datafiles/engine/size; table engine/storage/rowformat/directories/union/partition/autoincrement/triggers; column storage/format/autoincrement; index indexType/keyBlockSize/parser; partition/subpartition algorithm/values; FK delete/update/match |
| Tibero | `com.tomato.exerd.product.tibero_3.3.56.20260820-1610/model/tibero.ecore` | tablespaces/dataFiles/extent/encryption; constraint status/FK delete; table compress/segment/tablespace/triggers; view triggers; index unusable/indexAttribute/reverse/online; storage maxExtents/bufferPool |
| MariaDB | `com.tomato.exerd.product.mariadb_3.3.56.20260820-1610/model/mariadb.ecore` | schema characterSet/collation/sequences; sequence increment/min/max/start/cache/cycle; table startValue/triggers/partition; column autoincrement; index type; partition/subpartition; FK delete/update |
| CUBRID | `com.tomato.exerd.product.cubrid.model_3.3.56.20260820-1610/model/cubrid.ecore` | schema charset/collation; table checksum/union/partition/autoincrement/triggers/reuseOid; column shared/default/autoincrement start/increment; partition data/index dirs/max/min/nodeGroup; FK delete/update |

`termModel.ecore` 원문은 `com.tomato.exerd.term.model_3.3.56.20260820-1610/model/termModel.ecore`다. `TermDictionary`는 term/tag/version을, `Term`은 name/description/synonyms/physicalName/physicalDescription/physicalSynonyms/tag를, `TermDelimiter`는 논리/물리 구분자를 가진다. 도메인과 용어사전은 별개 데이터 구조로 관리한다.

## 미확인과 다음 대조

- 관계선 꺾임점·수동 배선이 현재 공통 Ecore 어디에 영속화되는지 미확인. extendedProperty·UI 설정·계산값 가능성을 원본 한동작 실험으로 구분한다.
- 8DB Ecore에 나타난 속성은 현재 DB엔진에서 폐기됐을 수 있다. 제품버전과 DB버전별 유효성 검증 전 최신 SQL로 실행하지 않는다.
- 원본 getter가 `derived` 속성을 계산하는 규칙, 도메인 제안 우선순위, 사용자 확장 클래스의 타입 변환은 독립 조사 대상이다.
- 원본 메타모델 검사에서 확인한 것은 ID/종류 계약이며 DDL 생성·삭제 영향·UI 활성조건·사용자 업무 수용은 별도 시험이다.

## 화면 투영 계약

- `app/src/formats/exerd/view.ts`의 `projectNativeDocument(document, diagramUuid?)`는 원본 BinaryGraph를 화면용 객체로 투영한다. 코어 엔진은 형식 계층을 import하지 않으며 ReactFlow와 독립적이다.
- 매핑용 객체ID/속성/소유참조 인덱스를 문서당 한 번 만들고 immutable 문서 identity를 WeakMap으로 캐시한다. 속성 편집 후 새 문서는 새 투영을 만든다.
- 다이어그램 미지정 시 전체 의미 테이블과 관계·메모를 반환한다. 지정 시 그 다이어그램 배치를 반환하되 `allTables`, `allRelationships`, `allNotes`, `placements`에는 전체 정보를 유지한다.
- UUID가 없는 표시 객체는 `binary:<objectId>`로 식별한다. 이것은 파일 UUID를 새로 작성하는 동작이 아니다.
- 투영된 컬럼의 자료형/NULL/기본값에는 도메인 fallback을 적용한다. 실제 원본 getter의 모든 우선순위와 동등함을 주장하지 않으며 도메인 UI 편집 수용 전에 X09로 확인한다.
- `TableDiagram.ref`는 reference 표시 플래그로 취급하고 `table` 객체참조와 혼동하지 않는다. 복합FK는 membership의 `entryIndex`로 정렬한다.
- **저장 정본은 NativeExerdDocument다. 이 화면 투영을 직렬화해 원본을 대체하면 안 된다.**
- 단위/실파일 시험: `npm test -- --run app/tests/unit/native-view.test.ts` 4개 통과. 실파일 전체 수량·모든 다이어그램의 배치 개수·FK부모/자식 컬럼 대응·소스불변·캐시·복수배치·도메인상속을 검증했다. GUI재열기·선경로·DB결과 검증은 포함하지 않는다.
