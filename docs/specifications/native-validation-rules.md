# 원본 모델 진단 규칙과 적용 한계

- 구현: `app/src/formats/exerd/validation.ts`의 `validateNativeDocument(document)`.
- 반환: `NativeDiagnostic[]` — code, severity, message, uuid, relatedUuids.
- **진단은 자문 결과다. 기존 파일 열기·저장을 차단하거나 모델을 자동 수정하지 않는다.** 구조 모순은 error, 설계 의도·DB 실행 확인이 필요한 항목은 warning으로 구분한다.
- UI는 UUID를 사용해 해당 객체로 이동한다. 진단 메시지에 실제 컬럼값·주석·연결정보를 복제하지 않는다.

## 원본 근거

기준 배포물: 사용자 제공 eXERD3.3.56. 원문 위치는 `.analysis/ref/3.3.56/` 아래다.

| 근거 | 확인한 내용 | 적용 |
|---|---|---|
| `com.tomato.exerd.model_3.3.56.20260820-1610/model/exerd.ecore` Schema.tables/Table.columns/Table.columnGroups | 의미 객체의 실제 포함 관계 | 테이블·컬럼·키 소속 검증 |
| 같은 Ecore Column.memberships/MembershipEntry.key,value/GroupMembership.group | 저장된 멤버십의 연결 구조 | PK/FK 구성·중복·부모/자식 컬럼 대조 |
| 같은 Ecore ColumnGroup.member,membership/GroupMembership.owner/ColumnReference.childColumn | derived/transient 계산 속성 | 원시 저장값이 없다는 이유로 누락 진단하지 않음 |
| 같은 Ecore ForeignKeyColumnGroup.parentColumnGroup/ColumnReference.parentColumn | 부모 식별키·부모 컬럼 참조 | FK 부모키 종류·길이·구성원·중복 대응 검증 |
| 같은 Ecore DomainContainer.domain/Column.domain | 도메인 소유 계층·컬럼 참조 | 순환·잘못된 대상 타입 검증, 자료형 상속 조회 |
| 같은 Ecore BusinessArea.diagrams/Diagram.diagramEntry,filteredRelations/TableDiagram.table | 표시 객체의 소유와 참조 | 다이어그램·배치·숨긴 관계의 대상 검증 |
| 같은 Ecore ExerdModel.temporaryContents | transient containment | 영속 모델에서 제외되는 임시 하위 객체는 진단 대상에서 제외 |
| `com.tomato.exerd.validator_3.3.56.20260820-1610/plugin.xml` | 이름 충돌 ERROR, 빈이름 WARN/ERROR, 타입 검사, 도메인 override WARN 등 별도 검사기 등록 | 원본도 규칙별 심각도를 구분함을 확인. 새 진단이 원본 검사기의 완전 복제라고 주장하지 않음 |

원본 검사기 클래스의 모든 내부 분기·DB별 규칙·사용자 억제 설정은 아직 재현하지 않았다. 아래 새 규칙은 관측된 저장 모델의 구조 불변식에 근거한다.

## 구현 규칙

| 영역 | 구조 오류(error) | 설계·지원 확인(warning) |
|---|---|---|
| 식별·참조 | 중복 UUID/객체ID, 누락 루트, 존재하지 않는 객체 참조, 중복 containment 소유 | 외부 proxy 사용 가능 여부 미검증 |
| 이름·소속 | 동일 스키마의 정확히 같은 테이블명, 동일 테이블의 같은 컬럼명, 잘못된 소유 객체 종류·소속 부재 | 논리/물리 이름 모두 없음, 컬럼 없는 테이블 |
| PK | 기본키 그룹 여러 개, 같은 컬럼 중복 연결, key/group 상충, 다른 테이블 컬럼, 잘못된 멤버십 종류 | 기본키 없음, 기본키 구성 컬럼 없음 |
| FK | 부모키 종류/소속, 양끝 구성 수, 부모키 밖 컬럼, 부모 컬럼 중복 대응, ColumnReference 누락 | 양끝 자료형 문자열이 다를 때 DB 호환 검증 필요 |
| 도메인 | 하위 포함 순환, domain 참조가 다른 객체 종류 | 컬럼·상위 도메인 전체에서 자료형 미확인 |
| 다이어그램 | 업무영역→다이어그램·배치→테이블·숨긴관계 참조 종류 오류, 소유 다이어그램 없는 배치 | 렌더링 품질·선 겹침·인쇄는 별도 시험 |

- 이름 비교는 정확한 문자열 충돌만 찾는다. DB별 대소문자 fold·인용된 식별자·collation을 추측해 같다고 처리하지 않는다.
- 자료형 비교는 대소문자·일반 공백만 정규화한다. `BIGINT`와 `INTEGER`, `VARCHAR(20)`과 `VARCHAR(30)` 등의 차이를 즉시 “DB에서 불가능”이라고 단정하지 않는다.
- 자료형 차이는 `FOREIGN_KEY_TYPE_UNVERIFIED`로 보고한다. 이 코드는 확인된 손상과 구분되는 **DB별 검증 공백**이며 DDL 적용/메타데이터 readback이 필요하다.
- 예약어·이름길이·사용자 정의 타입·DB 버전별 SQL 제약·표준용어 정책은 이번 진단기 범위 밖이다. 원본 모델 검사 전체를 구현했다고 집계하지 않는다.

## 실제 모델에서 교정한 잘못된 가정

- 사용자 원본에는 PK/FK의 저장된 `entryIndex` 동순위가 존재한다. 최초 조사에서 단순 unique 규칙을 적용하면 **366건**이 검출됐지만, 원본 모델 엔진이 받아들이는 자료이므로 그 규칙을 채택하지 않았다.
- `ColumnGroup.member`와 `membership`은 원본 runtime의 계산 속성이다. 키 순서를 확인하려면 저장 index만이 아니라 원본 계산 결과·컬럼 포함 순서와 함께 비교해야 한다.
- 따라서 **동일 컬럼의 실제 중복 membership은 오류**, 서로 다른 컬럼의 같은 저장 index는 이 진단기의 오류가 아니다. 이 차이를 회귀 시험에 포함했다.

## 검증 결과

- 단위 시험: `app/tests/unit/exerd-validation.test.ts`.
- 독립 fixture로 복합키·동순위·중복·다른 테이블 멤버십·FK 길이/부모 대응·고아 참조·도메인 순환·자료형 지원 공백·임시 객체 제외를 검증한다.
- 사용자 제공 609테이블·10,045컬럼 모델: 구현한 규칙의 진단 **0건**. 입력 모델과 저장 bytes가 진단 실행 전후 동일함을 검사한다.
- 이는 구현한 구조 규칙에서 문제가 발견되지 않았다는 결과다. 원본 전체 검사기 통과·실제 DB 무결성·DB별 DDL 실행·모든 설계가 올바름을 뜻하지 않는다.
- 로컬 조사 기록: `.analysis/spec/native-validation.json`. 실제 업무 이름·값은 외부로 업로드하지 않았다.
