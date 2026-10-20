# 원본 eXERD 직렬화기 독립 검증

작성일: 2026-10-15. 범위: 원본 프로그램의 **파일 읽기·저장 코드** 실행. 원본 GUI의 파일 열기·수정 논리명 표시·다른 이름으로 저장까지 별도로 관찰했다. 전체 기능의 동등성 검증은 아니다.

## 확인 결과

| 항목 | 결과 | 직접 근거 |
|---|---|---|
| 사용자 제공 파일 원본 reader로 읽기 | 성공, 오류 0 | `ErdResourceImpl.load` → 원본 `EObjectInputStream.loadResource` |
| 포함 객체 | 36,057개 | 원본 EMF 객체의 containment 순회 |
| 주요 객체 | 테이블 609, 컬럼 10,045, FK 561, 다이어그램 38 | 원본 객체 클래스별 개수 |
| 원본 reader → 원본 writer → 원본 reader | 성공 | `vendor-roundtrip.exerd` 및 비교 보고서 |
| 위 왕복의 저장 속성 차이 | 1건 | `Document.version`이 3.3.52에서 3.3.56으로 갱신됨. 다른 수집 속성 동일 |
| TypeScript codec가 편집한 binary 원본 reader로 읽기 | 성공 | `.analysis/codec/edited.bin`을 원본 reader의 헤더 없는 파일 지원 경로로 정상 읽음 |
| 편집 binary의 전체 객체 비교 | 객체 개수 동일, 저장 속성 차이 1건 | 지정 테이블의 `logicalName` 변경만 확인 |
| 편집 binary 원본 writer로 저장 | 성공 | `ts-edited-vendor-save.exerd` 생성 |
| 원본 재저장 파일을 TypeScript codec로 읽기 | 성공 | 36,057객체, 테이블 609개, 수정한 논리명 보존. `.analysis/codec/check-vendor.mjs` |
| 원본 GUI에서 편집 파일 재열기·다이어그램 표시 | 성공 | 격리된 Eclipse workbench에서 CUA로 eXERD 툴바·실테이블·관계선·다이어그램 표시 관찰 |
| 원본 GUI에서 수정 논리명 확인·재저장 | 성공 | 모델 검색 결과 1개 → 모델뷰에서 변경명 표시 → `OracleReview/gui-resaved.exerd` 다른 이름으로 저장 |
| 신규 모델 GUI 재열기 | v3 성공 | v2에서 발견한 루트 QName 조건을 구현에서 수정한 뒤, 새로 만든 2테이블 모델을 원본 GUI에서 PK·BIGINT·다이어그램과 함께 정상 표시 |
| 신규 모델 원본 GUI 재저장 | 성공 | `OracleReview/new-model-gui-resaved.exerd` 다른 이름으로 저장 |

검증 과정에서 원본 JAR를 패치하거나 대체 클래스로 덮어쓰지 않았다. 원본 코드가 제공하는 standalone 실행 경로를 사용했다. 라이선스 또는 로그인 검사를 제거하거나 우회하지 않았다. 독립 reader와 이번 격리 GUI 세션의 파일 열기·저장 과정에서는 라이선스·로그인 요구를 관찰하지 않았다. 이것으로 다른 환경·버전의 실행 조건이나 제품 사용권을 판단하지 않는다.

## 실행 구조

- `app/scripts/compatibility/original_oracle.py`: 원본 JAR 추출, 컴파일, 실행, 입력 해시·원본 JAR 해시 기록.
- `OracleBootstrap.java`: 별도 URLClassLoader에서 원본 클래스·의존성을 읽는다. 원본 standalone 리소스 조회 코드가 URLClassLoader를 요구하므로 JDK 21 기본 앱 로더와 분리한다.
- `OriginalExerdOracle.java`: 원본 모델 package를 등록하고 원본 `ErdResourceImpl.load/save`를 실행한다. 메타모델과 저장 속성을 JSON으로 출력한다.
- `compare_oracle_graphs.py`: 원본 reader가 만든 두 JSON의 객체 ID·타입·속성·참조·순서를 비교한다.

**원본 JAR는 `.analysis/oracle/lib`에만 보관하며, 앱 런타임·Electron 패키지에 포함하지 않는다.**

## 재현 명령

프로젝트 루트에서 실행한다. JDK 21 및 Eclipse 의존성 JAR가 필요하다. 현재 검증 환경은 macOS ARM64, IBM Semeru JDK 21.0.10.1, 설치되어 있던 DBeaver의 Eclipse plugins 디렉터리이다. 원본 serializer 버전은 `3.3.56.20260820-1610`이다.

```bash
python3 app/scripts/compatibility/original_oracle.py \
  REF/S2B_DA_D00_ERD_20260922_V1.0.exerd
```

새 위치로 원본 저장기를 실행한다. 입력 파일 덮어쓰기, `REF/` 아래 저장, 기존 파일 덮어쓰기는 거부한다.

```bash
python3 app/scripts/compatibility/original_oracle.py \
  REF/S2B_DA_D00_ERD_20260922_V1.0.exerd \
  --save .analysis/oracle/output/new-vendor-save.exerd

python3 app/scripts/compatibility/original_oracle.py \
  .analysis/oracle/output/new-vendor-save.exerd
```

다른 Eclipse 설치를 사용할 때는 `--plugins /absolute/path/to/plugins`로 지정한다. Windows/Linux에서 이 독립 도구 실행은 아직 검증하지 않았다. 앱의 플랫폼 지원과 이 도구의 실행 조건은 서로 다른 항목이다.

TypeScript 출력에 대한 검증은 다음과 같다.

```bash
python3 app/scripts/compatibility/original_oracle.py .analysis/codec/edited.bin

python3 app/scripts/compatibility/compare_oracle_graphs.py \
  .analysis/oracle/output/S2B_DA_D00_ERD_20260922_V1.0.exerd.graph.json \
  .analysis/oracle/output/edited.bin.graph.json \
  --expected-changes 1 \
  --report .analysis/oracle/output/ts-edit-comparison.json
```

`--expected-changes`는 차이 **개수**만 검사한다. 성공 판정 전 private 비교 보고서에서 변경된 객체·필드·값이 의도와 일치하는지도 확인해야 한다. 이름을 stdout JSON에 선택 출력하려면 `--select-uuid <객체UUID>`를 추가한다.

## 근거 파일과 판정 범위

다음 파일은 사용자 모델 내용을 포함할 수 있어 `.analysis/oracle/output/`에만 둔다.

- `<입력파일명>.report.json`: 입력 SHA-256 전후, 원본 serializer 및 추출 JAR SHA-256, headless/UI 검증 여부.
- `<입력파일명>.graph.json`: 원본이 복원한 객체별 저장 속성과 참조.
- `<입력파일명>.log`: 실행 결과 및 진단.
- `metamodel.json`: ExerdPackage와 PostgreSQLPackage의 클래스·속성·타입·원본 binary feature kind.
- `ts-edit-comparison.json`: TypeScript 편집물의 원본 reader 비교.
- `vendor-save-comparison.json`: 원본 reader/writer 왕복 비교.

JSON 그래프는 containment로 도달 가능한 모든 객체의 `eIsSet`, 비 transient·비 derived 속성을 기록한다. 참조는 원본 URI fragment, 사용자 정의 데이터 타입은 원본 factory의 문자열 변환을 사용한다. 따라서 여기서 말하는 '속성 동일'은 이 수집 범위의 동일이다. 다음 항목을 증명하지 않는다.

- 원본 GUI에서의 화면 표시·관계선 배치·드래그·인쇄 등 동작.
- 파생 속성·transient 상태·외부 리소스 처리·DB 연결·DDL 생성 결과.
- 다른 DB 제품별 물리 모델이나 eXERD 전 버전의 호환성.
- 아래 검증한 fixture 외의 신규 객체·삭제·관계 변경 시나리오와 모든 업무 조합.

입력 실파일은 실행 전후 SHA-256을 비교한다. 원본 업데이트 사이트에서 추출한 JAR의 SHA-256을 보고서에 남겨 재현 시 원본 파일의 드리프트를 확인한다.

## 원본 GUI 실행과 추가 발견

`prepare_original_ui.py`가 `.analysis/oracle/ui/`에 원본 플러그인 51개와 별도 OSGi configuration/workspace를 준비한다. DBeaver의 애플리케이션·DB 연결 번들은 제외하고 Eclipse 의존성만 읽기 전용 경로로 참조한다. Maven Central에서 EMF edit 2.23.0, ecore.edit 2.15.0, javax.inject 2.5.0-b62, ICU4J 74.2를 추가하며 URL·해시는 `preparation.json`에 기록한다. 원본 JAR와 설치된 DBeaver는 수정하지 않는다.

실제 GUI 확인에는 Java 직접 실행 대신 기존 DBeaver의 네이티브 실행기를 사용해야 CUA가 창에 연결할 수 있었다. 다음 명령은 기존 DBeaver 작업공간 대신 검증 전용 경로를 명시한다.

```bash
python3 app/scripts/compatibility/prepare_original_ui.py

/Applications/DBeaver.app/Contents/MacOS/dbeaver \
  -startup /Applications/DBeaver.app/Contents/Eclipse/plugins/org.eclipse.equinox.launcher_1.7.100.v20251111-0406.jar \
  -install "$PWD/.analysis/oracle/ui" \
  -configuration "$PWD/.analysis/oracle/ui/configuration" \
  -data "$PWD/.analysis/oracle/ui/workspace" \
  -application org.eclipse.ui.ide.workbench -clean -showlocation
```

관찰 근거는 CUA 도구 실행 결과의 AX 상태·스크린샷 및 `.analysis/oracle/ui/gui-verification.json`이다. 스크린샷 파일을 저장했다고 주장하지 않는다. 원본 GUI 저장물은 `.analysis/oracle/ui/workspace/OracleReview/gui-resaved.exerd`에 있다. 저장물의 TypeScript 재읽기는 별도 검증 항목이다.

원본 `ExerdContentDescriber`는 SAX `qName`이 `e:Document`인지 비교한다. 따라서 XML metamodel loader 통과만으로 GUI 열기 성공을 판단할 수 없다. `--describe` 옵션으로 이 원본 사전 인식기까지 독립 실행할 수 있다. v2 신규 모델의 원본 binary/XML reader 통과와 GUI 인식기 실패를 직접 재현했고, 그 결과를 구현 담당자에게 전달했다.

```bash
python3 app/scripts/compatibility/original_oracle.py MODEL.exerd --describe
python3 app/scripts/compatibility/original_oracle.py MODEL.exerd --xml
```

새 모델 v2 18객체, 테이블 추가 v2 25객체, 사용자 모델에 테이블 추가 v2 36,064객체, 제어 문자(U+0001·TAB·LF) 포함 모델 v2 18객체를 원본 binary reader와 원본 XML reader로 각각 읽었다. 각 쌍에서 저장 속성 그래프 차이는 0건이었다. 단, v2 신규 모델은 위 GUI 인식기 조건을 통과하지 않으므로 GUI 호환 완료로 판정하지 않는다.

`<파일명>.semantics.json`은 원본 `Table.getPrimaryKeyColumnGroup()` 및 `getMember()`의 결과를 별도로 기록한다. 물리 속성이 없는 새 테이블에서 직접 `getPhysicalProperties()`를 호출하면 standalone 문서에 provider가 없어 NPE가 발생하는 것을 관찰했다. 원본 GUI의 `LoadJob`은 DB 제품에 맞는 provider를 주입하므로, 이 standalone 조건만으로 파일 불량이나 물리 속성 필수 여부를 결론 내리지 않는다.

### 신규 모델 GUI 조건 수정과 구조 변경 검증

루트 prefix를 `e:Document`로 고정한 v3를 원본 GUI에서 다시 열었다. 신규 두 테이블, 각 테이블의 PK 키 아이콘·BIGINT 식별자, 업무영역·다이어그램 및 PostgreSQL 제품명이 표시됐고 읽기 전용 상태가 아니었다. 다른 이름으로 저장도 완료했다. GUI 저장물은 `OracleReview/new-model-gui-resaved.exerd`이며 사용자 모델에서 복사한 파일이 아니다. v2의 실패 로그는 발견 근거로 보존한다.

원본 content describer + binary reader + XML reader 검증 결과:

| 고정 fixture | 원본 복원 객체 | binary/XML 저장 속성 차이 | 범위 |
|---|---:|---:|---|
| new-native-v3 | 18 | 0 | 신규 문서·테이블·PK·다이어그램 |
| new-appended-v3 | 25 | 0 | 테이블 추가 |
| mutation-related-v1 | 39 | 0 | 복합 PK·FK·식별 관계 |
| mutation-reordered-v1 | 39 | 0 | 컬럼 순서 변경과 키 매핑 |
| mutation-domain-diagram-v1 | 50 | 0 | 도메인과 추가 다이어그램 |
| mutation-removed-column-v1 | 39 | 0 | 컬럼 및 관련 객체 제거 |
| mutation-removed-table-v1 | 30 | 0 | 테이블과 배치 제거 |

파일은 `.analysis/codec/`, 비교 보고서는 `.analysis/oracle/output/<fixture>-binary-xml.json`에 있다. 구조 fixture의 원본 reader 수용과 두 표현의 일치가 모든 편집 의미의 정확성을 단독 증명하지는 않는다. PK는 `<파일명>.semantics.json`, FK는 `<파일명>.foreign-keys.json`에 원본 getter 결과를 기록하여 생성 의도와 대조한다.

브라우저 E2E 저장물 `browser-edited.exerd` 역시 원본 content describer·binary reader·XML reader를 통과했고 binary/XML 그래프 차이 0건이다. 브라우저 조작 자체의 수용 증거는 해당 E2E 검사에서 별도로 관리한다.

### 브라우저 구조 편집물·원본 DDL 검증

`browser-structure.exerd`는 38객체이며 원본 content describer·binary/XML reader를 통과하고 두 그래프의 저장 속성 차이는 0건이다. 원본 GUI에서 테이블 2개·컬럼 3개·FK 관계선·다이어그램 2개를 표시했다. 저장 위치의 겹침도 생성 파일에 기록된 좌표 그대로 보였다.

원본 GUI `eXERD → 포워드 엔지니어링 → 기본 생성 옵션 → 모델 선택 → DDL 결과 → DDL 저장` 경로를 실행했다. 첫 옵션 페이지의 미리보기는 예시 모델이므로, 실제 SQL 근거로 사용하지 않았다. 결과 페이지에서 저장한 파일은 다음과 같다.

- `.analysis/oracle/ui/input/browser-structure-original-pg.sql`: 초기 브라우저 구조 모델의 원본 출력. PK/FK 실제 Constraint 객체에 이름이 없어 빈 FK 이름과 PK 이름 없음 표시가 나타나는 구현 결함을 발견한 근거.
- `.analysis/oracle/ui/input/mutation-groups-check-v2-original-pg.sql`: 이름 동기화 수정 후 원본 출력. PK·UNIQUE·FK·CHECK 이름, 복합 키, ASC/DESC, NULLS LAST 및 CHECK 표현식 정상 출력 확인.
- `.analysis/oracle/ui/ddl-evidence.json`: 입력·SQL SHA-256, 원본 옵션, DB 미실행 및 이름 결함 수정 전후 판정.

두 출력은 PostgreSQL 9.0, 생성 기본 설정, 소유주 표시, 이중 따옴표, 코멘트 생성, 테이블·인덱스·제약사항 물리 속성 옵션 해제 조건이다. DB 연결/실행 단계에 진입하지 않았다. 원본 SQL 생성 사실과 DB 실행 성공은 구분한다.

제약 그룹과 실제 Constraint의 이름은 별도 저장 속성이다. 그룹 이름만 설정하면 원본 GUI에서 모델을 표시할 수 있어도 DDL 결과의 이름이 비어 버린다. 생성 경로의 PK/FK/UNIQUE 이름 동기화 수정을 담당자에게 전달하고, 수정 v2를 원본 GUI의 실제 DDL 결과로 재검증했다.

### 실업무 모델의 구조 보존 비교

`source-reordered-v2.exerd` 36,057객체 및 `source-removed-fk-v2.exerd` 36,048객체를 원본 content describer와 두 reader로 읽었고 binary/XML 쌍의 그래프 차이는 각각 0건이다. 원본의 1,272개 키·인덱스 그룹에서 `getMembership()`이 반환하는 컬럼 UUID 순서는 재배열 전후 모두 보존됐다. 물리 테이블 컬럼 순서를 따라가는 `getMember()`의 순서는 예상대로 두 그룹에서 바뀌었다.

FK 삭제 후 UUID 없는 RelationEntry/Relation의 배열 경로가 당겨지면서 URI fragment 기반 비교에는 1,123건의 위치 차이가 생긴다. `normalize_relation_paths.py`는 FK key를 관계의 안정 식별자로 사용하고 모든 참조에 같은 치환을 적용한다. 다른 값과 배열 순서를 생략하지 않으며 중복 key는 거부한다. 이렇게 비교한 FK 삭제 결과는 객체 9개 삭제 + 참조 배열 3개 변경으로, 의도한 12건 외 차이는 없다.

컬럼 재배열은 컬럼 순서만 바뀌는 것과 별도로, 기존 동률/미설정 entryIndex를 보정하여 키의 독립 순서를 보존할 수 있다. 따라서 무조건 원시 필드 1건 차이만 허용하는 시험으로 정상 여부를 판단하지 않는다. 원본 getter의 순서 결과와 원시 차이를 함께 본다.

### 그룹 이름과 실제 Constraint 이름의 독립성

2026-10-16 조사. 생성 시 유효한 두 이름을 설정하는 것과, 편집 시 두 객체의 이름을 항상 동기화하는 것은 다른 동작이다. 같은 문자열이라는 이유만으로 사용자가 지정한 이름을 덮어쓰지 않는다.

원본 정적 근거:

- `NameOwnerImpl.setPhysicalName(String)`은 `setPhysicalName(value, false)`를 호출한다. 논리명도 같은 방식이다. 즉 직접 이름을 편집하면 그 모드의 derived 플래그를 false로 바꾼다.
- `SetNameSwitch`는 Column만 특수 처리하며 그룹·Constraint는 선택 객체를 변경하는 `SimpleSetNameCommand`로 처리한다.
- `DSetNameCommand.applyNamingPolicy`는 affected target 중 해당 모드의 derived 플래그가 true인 객체만 자동 이름 재생성 명령에 넣는다. 문자열 동등성만으로 자동 이름인지 판정하지 않는다.
- model.ui `plugin.xml`에서 PK/FK의 전파 방향은 **Constraint → 부모 그룹**이다. 그룹은 Constraint 이름을 참조하는 기본 표기를 갖지만, 그룹 이름 변경이 자식 Constraint로 전파되는 규칙은 없다.
- AK 그룹과 UNIQUE Constraint는 각각 `UIX_...`와 `UK_...` 형태의 독립 정책이다. 둘 사이의 상호 이름 복사 규칙은 없다.

따라서 일반 그룹 속성 편집의 안전한 원본 호환 규칙은 **그룹 이름을 수정하고 해당 derived 플래그를 false로 바꾸되, 실제 Constraint 이름·플래그는 보존**하는 것이다. Constraint 이름을 편집할 때 PK/FK 그룹의 자동 이름을 재생성하는 경로는 별도 정책 기능이다. `groupName == constraintName` 조건만으로 묶여 있다고 가정하는 것은 원본 규칙으로 확인되지 않았다.

원본 모델 setter 동적 검증은 다음과 같다.

```bash
python3 app/scripts/compatibility/name_setter_probe.py
```

원본 oracle로 JAR를 준비한 후 실행한다. PK/FK/UNIQUE × Constraint derived false/true의 6개 경우 모두, 그룹의 논리·물리명 직접 변경이 Constraint 이름/플래그를 바꾸지 않았다. 변경한 그룹의 derived 플래그만 false가 됐다. 근거는 `.analysis/oracle/output/name-setter-probe.jsonl`이다. 이 실험은 원본 모델 setter 검증이고 UI 명명 정책 실행 실험은 아니다. UI 정책은 위 registry·명령 bytecode로 구분하여 확인했다.

정적 근거 파일은 `.analysis/oracle/output/model-ui-plugin.xml`, `DSetNameCommand.javap.txt`, `SimpleSetNameCommand.javap.txt`에 보관한다. 원본 PK 전용 이름 편집기에는 별도의 조건 분기가 있으므로 모든 전용 UI 동작을 일반 속성 편집과 동일하다고 단정하지 않는다.

### 자동배치 최종 v2 독립 확인

- `.analysis/layout/largest-source-diagram-v2.exerd`: 원본 content describer·binary reader·XML reader 성공, 36,057객체, resourceErrors 0. 두 표현의 persisted graph 차이 0.
- `.analysis/layout/all609-v2.exerd`: 동일 원본 경로 성공, 36,669객체, Table 609 / TableDiagram 1,224 / Diagram 39. 두 표현의 persisted graph 차이 0.
- 증거: `.analysis/oracle/output/{largest-source-diagram-v2,all609-v2}.binary.report.json`, `.xml.report.json`, `.binary-xml.diff.json`.
- 이번 확인은 원본 엔진의 파일 해석·표현 일치 증거다. 609개 테이블 전체를 원본 GUI로 표시하거나 겹침을 시각 검수했다는 증거는 아니다.

### PostgreSQL 카탈로그 역공학의 원본 엔진 독립 검증

- PostgreSQL 17.11에서 조회한 독립 fixture: 2테이블·5컬럼 → 신규 native 57객체. 원본 describe/binary/XML reader 오류 0, binary/XML graph 차이 0.
- 사용자 모델을 격리 DB에 적용하고 조회한 카탈로그: 609테이블·10,045컬럼·PK609·FK561·UNIQUE8·CHECK492·인덱스711(제약 소유 포함)·시퀀스11 → 신규 native 21,970객체. 원본 binary/XML reader 오류 0, 두 표현 차이 0.
- 카탈로그와 원본이 읽은 저장 속성 비교: fixture 60항목·사용자 50,593항목 차이 0. 자료형은 PostgreSQL `format_type`, 기본식·CHECK는 서버 `pg_get_expr` 결과와 비교했으며 SQL 원문 문자열 복원을 주장하지 않는다.
- 원본 `computeColumnReferences` getter로 FK561개 컬럼 대응을 별도 확인했다. 대응 오류 0. 27개는 부모키 컬럼 순열을 참조하는 FK이며 원본 getter가 부모키 순서로 정규화한다. 명시적 parentColumn 대응 및 앱 SQL의 FK 지정 순서는 보존한다.
- 원본 Sequence의 숫자 옵션은 원래 필드에 저장한다. 자료형·영속성·OWNED BY는 원본 지원 CORE PropertyEntry 확장 `erd-maker.postgresql.sequence.v1`에 저장한다. 확장 11개와 전체 그래프는 원본 reader→writer→reader에서 차이 0으로 보존됐다.
- 원본 프로그램의 포워드 엔진이 이 앱 전용 확장 의미를 SQL로 변환한다는 증거는 없다. AS 자료형·OWNED BY SQL은 앱 엔진의 기능이며 실제 PostgreSQL 재적용 증거와 구분한다.
- 파일: `.analysis/catalog/{fixture,user}.exerd`, `.sql`, `.ddl.json`, `.report.json`, `.metadata-comparison.json`, `.binary-xml.diff.json`, `original-fk-semantics.json`, `user.vendor-save.diff.json`.
- 입력 카탈로그: `.analysis/database/postgres-1792097906-db2503c5/catalog.json`, `.analysis/database/postgres-1792097906-bcb87e19/catalog.json`.

### DB 재적용 뒤 CHECK 문자열 차이의 독립 계산

- 원본/역공학 재적용 DB 카탈로그의 278,352필드 중 원문 문자열 차이는 980개다. 490 CHECK의 expression/definition에서 동일한 배열 원소 캐스트 분배 형태가 관측됐으며 다른 필드는 일치한다. 원문 차이 자체는 보존한다.
- 공식 PG17 배열 생성자 캐스트 규칙과 관측된 단일 컬럼 varchar 리터럴 enum ANY 형태만 제한적으로 대조했다.
- 독립 PG17.11 컨테이너의 읽기 전용 트랜잭션에서 동일한 typed VALUES에 원문/재표현을 각각 평가했다. 490 CHECK·9,828회 비교 불일치 0. 모든 CHECK에서 TRUE/FALSE/NULL을 관측했다.
- TRUE 2,936 / FALSE 6,402 / NULL 490. 입력은 허용 리터럴 전부 및 NULL·빈 문자열·비허용값·공백·대소문자·한글 등이다. 이는 해당 구문과 후보값의 실행 근거이며 임의 SQL의 일반 논리 동등성 증명은 아니다.
- 조회 생성 명령: `python3 app/scripts/compatibility/prepare_check_cast_evaluation.py BEFORE_CATALOG AFTER_CATALOG --output .analysis/NEW_OUTPUT`.
- 실행 증거: `.analysis/catalog/check-evaluation/execution-report.json`, `plan.json`, `evaluate.sql`. 컨테이너 네트워크 none·호스트 포트 없음·사용자 DB 접속 없음·실행 후 제거 완료. 최초 시작 감지 경쟁 실패 보고도 별도 보존했다.

### 8개 DB 제품 계열의 최소 파일 왕복

- 원본 실행 의존 JAR과 EPackage 등록을 PostgreSQL·MySQL·Oracle·SQL Server·DB2·CUBRID10·MariaDB·Tibero로 확장했다.
- `OriginalDatabaseFixture.java`는 각 원본 EPackage/EFactory로 독립 문서를 생성한다. PG 문서의 제품 표시만 바꾸는 방식은 사용하지 않는다. 각 문서는 2테이블·3컬럼·PK2·FK1과 해당 제품의 실제 물리 속성 객체를 가진다. 가능할 때 비기본 테이블/컬럼 물리 값도 포함한다.
- 검증된 provider 저장 문자열을 확보하지 못해 `databaseVersion`은 원본 Document factory 기본값 null/unset을 유지했다. 표시 버전이나 실제 DB 실행 버전으로 추정하지 않는다.
- 생성 명령: `python3 app/scripts/compatibility/original_oracle.py --generate-fixtures .analysis/NEW_FACTORY_DIRECTORY`. 기존 디렉터리·입력 덮어쓰기는 거부한다.
- 생성 파일: `.analysis/db-matrix/original-generated/*-original-factory.exerd`. `provenance.json`에 파일·원본 JAR SHA-256, 생성 방식, DB/GUI 미검증을 기록한다.
- 객체 수: PostgreSQL44 / MySQL42 / Oracle43 / SQL Server44 / DB2 36 / CUBRID10 42 / MariaDB41 / Tibero38.
- 원본 생성 8파일은 원본 binary reader와 writer로 재해석·저장했다. TS codec의 roundtrip/단일 테이블 논리명 편집 16파일은 원본 content describer·binary/XML reader **32검사 전부 통과**했다.
- 원본이 읽은 binary/XML graph 16쌍은 차이0. 원본 생성↔TS roundtrip 8쌍은 차이0. 원본 생성↔TS edited 8쌍은 각각 정확히 logicalName 1개만 바뀌었다.
- 원본 writer가 다시 저장한 16파일을 TS로 역읽기해 DB 식별·객체·속성·참조·순서의 의미 차이0을 확인했다. 원본 writer는 명시적 `derivedLogicalName=false`를 EMF 기본값으로 생략하므로 원문 missing/false 차이는 남는다. 검증된 BOOLEAN 기본값만 정규화한 결과와 원문 차이를 구분한다.
- 증거: `.analysis/db-matrix/run-eight-1/original-oracle/{batch.json,graph-checks.json}`, `reverse-read.json`.
- 이 결과는 8개 제품 계열의 해당 최소 모델 파일 호환 근거다. 비PG 제품의 DB 실제 실행·원본 GUI 수용·모든 물리 속성·모든 제품 버전·DDL/역공학 구현 완료를 의미하지 않는다. CUBRID9는 이번 factory fixture로 검사하지 않았다.

### 내장 역사 Oracle 1.3 샘플의 미지원

- 원본 배포 JAR의 내장 `143_oracle_example.erd`는 버전1.3.0.qualifier이다. 현재 TS schema와 원본 `ErdResourceImpl` 모두 obsolete Oracle 제약 클래스를 읽지 못한다.
- 추가로 `--transform` 옵션에서 원본 정상 `ITransformService.INSTANCE.getTransformedContents`를 호출하고 표준 EMF EcoreResourceFactory 등록을 제공했다. 이 경로는 변환 XML을 생성했으나 현재 원본 XML reader가 `o10g:PrimaryKeyConstraint` / `o10g:ForeignKeyConstraint` physicalProperties를 ClassNotFound로 거부했다.
- 일부 객체가 만들어졌어도 resourceErrors가 있어 실패 처리하고 재저장하지 않았다. 직접 클래스 별칭이나 수동 의미 변환으로 성공 처리하지 않는다.
- 실행: `python3 app/scripts/compatibility/original_oracle.py HISTORICAL_INPUT --transform --save NEW_OUTPUT`. `--transform`은 원본 binary reader 성공으로 보고하지 않고 `original-transform-then-xml`로 구분한다.
- 증거: `.analysis/oracle/output/embedded-0-143_oracle_example.erd.exerd.transformed.{report.json,xml}`. 현재 factory 8개 계열 성공과 역사 포맷 지원을 합산하지 않는다.

### 앱의 독립 신규 모델 생성 9제품 식별자 검증

- 앱 코드가 템플릿 모델 복사 없이 생성한 PG·Oracle·SQL Server·DB2·MySQL·Tibero·MariaDB·CUBRID9/10의 9파일을 검증했다. 원본 factory 생성 8파일 검증과 출처를 구분한다.
- 원본 content describer·binary/XML reader **18검사 전부 통과**, productId 9개 모두 예상값과 일치, binary/XML 저장 그래프 차이 각각0.
- 객체 수: PG42 / Oracle41 / SQL Server42 / DB2 35 / MySQL40 / Tibero37 / MariaDB39 / CUBRID9·10 각40.
- 원본 writer 재저장 9파일의 TS 역읽기도 완료했다. 제품 식별·객체 수·속성·참조·순서의 의미 차이0이다. EMF schema 기본값 생략 및 Point 정수/실수 문자열 표기 차이 등 **90개 정규화 항목**을 별도로 기록했다. 작성 도구 버전 제외와 함께 원문 차이 없는 결과로 표현하지 않는다. 증거: `independent-created/reverse-read.json`.
- 입력 `.analysis/db-matrix/independent-created/manifest.json`, 증거 `original-oracle/{batch.json,graph-checks.json}`.
- 이 단계는 최소 신규 모델 파일의 제품 식별·객체 구조·저장 호환 근거다. 제품별 실제 DB 실행·전체 물리 속성·원본 GUI 수용을 대신하지 않는다.

## Oracle/Tibero 독립 DDL 모델 GUI 확인 (2026-10-16)

- 고정 입력·SHA-256·옵션·결과: `.analysis/oracle/ui/input/enterprise-comparison-v1/gui-evidence.json`.
- 두 독립 모델 모두 원본 eXERD 편집기에서 열렸다. Tibero는 실제 모델의 포워드 엔지니어링 SQL을 `tibero-original-forward.sql`로 저장했다. 테이블·제약 물리 속성과 스키마 한정명, 저장된 설명만 사용했다. DB 연결 단계 전에 마법사를 취소했다.
- Tibero 원본 기본 생성 설정은 PK2개·UK1개의 별도 UNIQUE INDEX3개도 생성했다. 앱의 제약을 통한 암시적 인덱스 생성과 원문 동일하다고 주장하지 않는다. TABLESPACE USERS·복합 FK 대응·DESC/ASC 순서·한글 설명·명시 NONE 삭제 규칙을 원본 출력에서 확인했다. 서버 실행은 수행하지 않았다.
- Oracle 입력은 원본 reader/writer와 GUI 열기를 통과해도 포워드 마법사가 `SchemaSequenceFolder.getSequences()`에서 `sequenceGroup == null`로 실패했다. 로그 시각은 2026-10-16 06:45:06이며 별도 초기화 보완 대상이다. 이 사례 때문에 파일 표현 호환, 편집기 열기, 원본 DDL 생성 성공을 독립 판정한다.

### Oracle 초기화 보완 및 원본 DDL API

- 신규 Oracle SchemaProperties에 빈 SequenceGroup을 초기화한 고정 입력 `oracle-independent-ddl-sequence-v2.exerd`는 원본 binary/XML reader 모두 66객체·오류0·저장 그래프 차이0이다. GUI에서도 포워드 마법사와 실제 테이블 선택 목록이 열려 앞선 null 예외가 해소됐다.
- GUI 호스트는 모델 선택 다음 단계 직전 CoreFoundation `__CF_IS_OBJC`의 native SIGSEGV로 종료됐다. 기존 Java25/HotSpot 세션82550과 재실행 Java21/OpenJ9 세션85254에서 관찰했다. JVM이 자동 생성한 crash dump는 `/Applications/DBeaver.app/Contents/MacOS/hs_err_pid15722.log` 및 `javacore.20261016.191142.91017.0002.txt` 등이다. 원본 JAR·라이선스·사용자 DB 설정을 수정한 것이 아니며 GUI SQL 저장 성공으로 기록하지 않는다.
- 텍스트 crash 로그는 `.analysis/oracle/crashes/`에 보존했다. JVM이 설치 경로에 자동 생성한 11.1GB core를 포함한 정확한 신규 파일5개만 escalation 승인 후 정리했다. 경로·크기·시각·텍스트 해시·삭제 확인은 `crashes/generated-files.json`에 기록했다. 기존 앱 파일·설정·사용자 DB는 정리 대상이 아니다.
- 대체 경로에서 원본 `OracleForwardFactory`로 ForwardRequest를 구성하고 원본 `DDLGenerator.generateDDLWithSeparator`를 정상 호출해 실제 2테이블 SQL을 생성했다. 원본 코드를 수정하거나 대체 클래스를 삽입하지 않았다. GUI·서버 실행과 구분되는 **headless 원본 DDL API 검증**이다.
- 최종 SQL·입력/출력·실행 소스·의존 JAR SHA-256·옵션·결과는 `.analysis/oracle/ui/input/enterprise-comparison-v1/oracle-original-headless-forward-v3.{sql,report.json,log}`에 있다. 2테이블·2,125문자이며 구분자는 `;\n\n`을 요청했다. API 반환 원문을 그대로 보존했으며 마지막 공백을 제외하면 세미콜론으로 끝난다.

```sh
python3 app/scripts/compatibility/original_oracle_ddl.py \
  .analysis/oracle/ui/input/enterprise-comparison-v1/oracle-independent-ddl-sequence-v2.exerd \
  .analysis/oracle/ui/input/enterprise-comparison-v1/oracle-original-headless-forward-new.sql
```

출력은 새 `.analysis` 파일만 허용하며 입력 SHA-256 불변을 확인한다. 이 도구는 앞서 준비한 원본 reader classes와 격리 GUI plugins를 요구한다. 컴파일은 runtime 플러그인의 annotation processor를 실행하지 않는 `javac -proc:none`으로 수행한다. 원본 라이선스·인증 로직의 변경이나 회피는 하지 않는다.

같은 도구의 `--enterprise` 옵션은 SQL Server/Db2/CUBRID9·10을 제품 ID로 분기하고 원본 ForwardConfiguration/ForwardContext를 사용한다. 실제 실행은 SQL Server·Db2·CUBRID10 각각 성공했다. 최초 SQL Server/CUBRID10 NPE로 발견한 신규 모델 필수 빈 객체 초기화는 별도 소스로 보완한 뒤 재실행했다. `.analysis/oracle/output/enterprise-forward-comparison.json`과 `docs/specifications/enterprise-ddl.md`에 입력·출력·원문 차이·실제 서버 미검증 범위를 기록한다. CUBRID9는 이 API 실행 묶음에 포함되지 않았다.
