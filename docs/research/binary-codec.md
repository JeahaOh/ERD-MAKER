# eXERD BinaryIO 독립 구현과 검증

## 구현 범위

- `app/src/formats/exerd/binary.ts`: Java 및 Node 내장 모듈 없이 실행되는 TypeScript reader/writer.
- 파일 컨테이너 내부 `binary-content`를 일반 객체 그래프로 읽고, 수정한 그래프를 새 바이트열로 인코딩한다.
- 입력 바이트 재사용이나 문자열 치환 방식이 아니다. 메모리 그래프에서 모든 값을 인코딩한다.
- 공급사 구현·JAR는 제품 모듈에 포함하지 않는다. REF 원본은 변경하지 않는다.

## 관측한 규약

- 서명: `89 65 6d 66 0a 0d 1a 0a`, 버전 ordinal `0`.
- 압축 정수: 첫 바이트 상위 2비트가 후속 바이트 수(0~3), 하위 6비트와 후속 바이트를 big-endian 결합하고 1을 뺀다. `0` 바이트는 `-1`(null), `1` 바이트는 `0`.
- 문자열: UTF-16 code unit 수를 기록한다. 처음에는 바이트 문자, `0` 마커 이후 남은 code unit 전체를 UTF-16 big-endian으로 기록한다.
- 원본 reader의 narrow 문자열 바이트는 signed Java byte를 char로 변환한다. 따라서 새 Latin-1 문자는 wide 방식으로 기록해야 값이 변형되지 않는다.
- 객체·패키지·클래스·URI에 stream-local ID를 부여한다. 재참조는 ID만 기록한다.
- 클래스·feature 이름은 최초 등장 시 기록하지만 feature의 값 종류는 쓰지 않는다. 읽기에는 별도 호환 메타데이터(registry)가 필수다.
- 객체 feature 토큰 `0`은 종료, `-1`은 proxy URI, 나머지는 feature ID + 1.
- 기존에 관측한 feature ID·이름·값 종류·순서, 객체 참조·목록 순서, URI base/fragment를 보존한다.
- enum과 사용자 데이터형은 원본 lexical string으로 보존하며 임의의 JavaScript 숫자·객체로 변환하지 않는다.
- `LONG`은 bigint로 64비트를 보존한다. 원본 Java reader의 저위 32비트 sign extension 동작은 버그 가능성이 있어 별도 관측이 필요하다. 현재 사용자 fixture에는 LONG 값이 없다.

## 공개 API

```ts
readBinary(bytes: Uint8Array, registry: BinaryRegistry): BinaryGraph
writeBinary(graph: BinaryGraph): Uint8Array
```

`BinaryGraph`는 roots, objects, packages, version, consumedBytes를 가진다. 객체의 feature는 `{ id, name, kind, value }`, 참조는 `{ ref: number }`이다. registry는 `{ packages: [{ namespaceURI, classes: [{ name, features }] }] }` 형식이다.

## 실제 사용자 파일 검증 (2026-10-15)

| 항목 | 관측 결과 |
|---|---:|
| 바이너리 payload | 2,371,391 bytes |
| 소비한 바이트 | 2,371,391 bytes, 잔여 0 |
| 전체 객체 | 36,057 |
| 테이블 / 컬럼 | 609 / 10,045 |
| 독립 writer 무편집 출력 | 원본 payload와 byte-for-byte 동일 |
| 단일 테이블 논리명 편집 | 한글 접두어를 추가한 새 payload 재읽기 성공 |
| 원본 Java reader 교차 확인 | 객체 36,057개 읽기 성공, persisted graph 차이 정확히 1개 논리명 |

원본 reader 결과는 `.analysis/oracle/output/edited-diff.json`, codec probe는 `.analysis/codec/probe.mjs`, payload는 `.analysis/codec/`에 있다. 사용자 자료와 공급사 바이너리는 Git 배포 대상이 아니다. 이 결과는 원본 저장/로드 엔진과의 교차 검증이며, 원본 GUI에서 열어 육안 확인한 결과와 구분한다. 원본 엔진 재저장 결과를 독립 TypeScript reader로 다시 읽어 36,057개 객체와 수정한 논리명 보존도 확인했다(2,371,407 bytes 전량 소비).

## 검사와 제한

- 단위 검사: 정수 경계의 독립 byte vector, Unicode/Latin-1/서로게이트/NUL/null, 순환 참조·proxy·목록 순서, 편집 후 재읽기, 손상·unknown schema·후행 바이트·중복 ID·도달 불가능한 객체 거부.
- 로컬 사용자 수용 검사: REF와 registry가 있을 때만 실행한다. 자료가 없는 checkout에서는 해당 검사 1개가 명시적으로 skip된다.
- 임의의 미관측 규약을 추측해서 읽지 않는다. unknown feature kind/schema는 오류로 중단한다.
- 중첩 객체 정의 깊이는 512로 제한한다. 현재 실파일은 통과했다. 더 깊은 정상 모델이 확인되면 반복 스택 방식으로 확장한다.
- 실파일의 저장된 feature 133,013개에서 feature ID·이름·kind가 배포 registry와 모두 일치했다. registry의 feature 902개는 원본 런타임 메타모델의 이름·ID·타입과 교차 검수했고 차이가 없었다. 나머지 클래스 및 다른 DB 제품의 신규 feature 생성은 별도 검증이 필요하다. 저장된 파일에서 읽은 feature ID는 그대로 보존한다.
- 전체 eXERD 버전·8개 DB 제품·모든 feature 종류의 호환성은 아직 증명되지 않았다. 현재 검증은 제공된 3.x PostgreSQL 업무 모델과 독립 합성 fixture에 해당한다.

## 독립 신규 모델 생성

- `createNativeDocument(name?)`는 사용자/공급사 모델 파일을 읽거나 복사하지 않고 새 그래프·XML·컨테이너를 만든다.
- Document, DatabaseModel, public Schema, 기본 업무영역/Diagram, Configuration/DomainDefinition, ViewSettings, RelationManager, SharedIcons를 생성한다.
- 첫 Table에는 `id BIGINT NOT NULL` 컬럼, PrimaryKeyColumnGroup, PrimaryKeyMembership/MembershipEntry, PrimaryKeyConstraint, TableDiagram을 연결한다. Diagram에는 독립적으로 생성한 PrintSettings도 포함한다.
- `appendNativeTable(document, options)`는 원본을 변경하지 않고 table/column/PK/placement 7개 객체를 추가한 새 문서를 반환한다.
- UUID는 클래스 이름과 `crypto.randomUUID()`의 새 난수로 발급한다. 기존 UUID나 자료를 제품에 내장하지 않는다.
- 신규·구조 편집은 XML을 registry의 containment와 UUID 참조 규약으로 다시 생성한다. 문자열 속성 편집의 source-span 보존 정책과는 저장 표현이 다르다.
- 외부 proxy 또는 FeatureMap이 필요한 XML 구조 쓰기는 미지원 오류로 중단한다. 해당 형식을 무시하고 저장하지 않는다.
- 원본 Point converter가 실수를 정수로 절삭하는 것을 javap로 확인했다. 새 좌표도 `Math.trunc`로 정규화하며 32비트 좌표 범위를 넘으면 거부한다.

- 신규 XML은 XML 1.1을 선언하며, 허용 제어문자는 숫자 참조로 보존한다(NUL은 거부). DATA_LIST는 원본 XMI처럼 반복 텍스트 요소로 저장하여 값 내부 공백·빈 값·null을 구분한다. 원본 실파일 및 로컬 Eclipse EMF XMLSaveImpl.saveDataTypeMany 바이트코드를 대조했다.

### 신규/구조 편집 원본 엔진 교차 검수

2026-10-15 v2 고정 파일 4개를 원본 `ErdResourceImpl` 바이너리 reader와 원본 `ERDXResourceImpl` XML reader로 각각 읽었다. 입력 원본을 snapshot으로 고정한 뒤 두 persisted graph를 비교했다.

| 사례 | 객체 수 | 바이너리/XML 차이 |
|---|---:|---:|
| 독립 신규 문서 | 18 | 0 |
| 신규 문서에 테이블 추가 | 25 | 0 |
| 사용자 업무 모델에 테이블 추가 | 36,064 | 0 |
| XML 1.1 제어문자 포함 신규 이름 | 18 | 0 |

원본 PK getter에서도 생성한 그룹과 해당 id 컬럼의 membership 연결을 확인했다. 근거는 `.analysis/oracle/output/*-v2-binary-xml.json`, `*.semantics.json`이다. 원본 reader가 자동 생성하던 PrimaryKeyConstraint/PrintSettings를 독립 구현이 명시적으로 생성하도록 교정한 이후 결과다.

신규 PostgreSQL 객체의 physicalProperties는 아직 명시하지 않는다. 원본 `getPhysicalProperties()`는 UI가 주입하는 DB provider에 의존하므로 standalone 엔진에서 이를 호출한 결과만으로 GUI의 동작을 판단할 수 없다. DB별 물리 속성 편집과 원본 GUI 수용은 별도 검증 대상이다.
