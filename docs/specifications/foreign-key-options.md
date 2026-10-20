# 외래키 옵션 편집

기준일: 2026-10-20. 대상은 제공된 3.3.56 메타모델의 FK 물리 속성과 그룹의 `useIndexing`이다. 파일 편집·보존과 실제 DB 실행은 별도 판정한다.

## 사용과 저장

- 관계선 선택 → 속성 패널의 `외래키 물리 옵션` → `FK 옵션 적용`으로 저장한다.
- 명령: `editForeignKeyOptions({ foreignKeyUuid, values })`. 실제 바뀐 필드만 전달하며 Worker의 한 트랜잭션으로 반영한다.
- `null`은 속성을 지정하지 않은 원본 기본 상태로 되돌린다. 빈 문자열인 NONE과 구분한다. 화면에는 메타모델의 기본값을 함께 표시한다.
- FK 그룹·제약·대응 객체 UUID와 카디널리티를 보존한다. 자식 PK·NULL·기본값을 옵션에 맞춰 자동 변경하지 않는다.
- 물리 속성 객체가 없는 기존 모델은 제품별 편집 항목을 투영하고, 명령 적용 시 해당 DB의 속성 객체를 만든다. 다른 DB의 속성을 섞지 않는다.
- 미해석 확장 값과 사용자가 지정하지 않은 필드는 유지한다. Undo/Redo 및 바이너리/XML 저장·재열기에 반영한다.

## DB별 항목

| DB 계열 | 편집 항목 |
| --- | --- |
| PostgreSQL | 삭제·갱신 동작, DEFERRABLE, INITIALLY DEFERRED, NOT VALID, MATCH SIMPLE/FULL |
| MySQL | 삭제·갱신 동작. 서버에서 적용하지 못하는 SET DEFAULT는 새로 지정하지 않는다. 기존 MATCH는 보존하거나 해제할 수 있다 |
| MariaDB | 원본 열거형의 삭제·갱신 동작 |
| Oracle | 삭제 동작, enabled·validated·deferrable·deferred·generated, 참조 소유자/테이블/제약 메타정보 |
| SQL Server | 삭제·갱신 동작, enable·notForReplication·systemGeneratedName |
| Db2 | 원본 열거형의 삭제·갱신 동작. 갱신 CASCADE처럼 원본이 제공하지 않는 값은 거부 |
| CUBRID 9/10 | 각 원본 열거형의 삭제·갱신 동작 |
| Tibero | 삭제 동작과 원본 `status` 상태 플래그. Oracle의 enabled와 같은 의미로 추정하지 않는다 |

모든 계열에서 그룹의 FK 인덱스 사용 플래그를 편집·보존한다. 플래그나 DB별 보조 메타정보를 SQL 생성기가 해석하지 못하면 기존 DDL 진단에 남긴다. 저장 성공을 모든 옵션의 SQL 구현·실제 서버 적용 성공으로 표시하지 않는다.

## 입력 검사

- DB·필드·열거형 값 및 Boolean 문자열을 확인한다. 임의의 그룹명·UUID를 옵션 명령에 섞어 변경할 수 없다.
- 처음부터 지연하려면 지연 가능 옵션이 켜져 있어야 한다.
- SET NULL은 대응 자식 컬럼이 PK 또는 NOT NULL이면 거부한다. 도메인 상속의 NOT NULL도 확인한다.
- SET DEFAULT는 대응 자식 컬럼에 기본값이 있어야 한다. 그 값에 해당하는 부모 행의 존재 등 데이터 조건은 실제 DB에서 확인해야 한다.
- 실패는 전체 명령을 거부하며 입력 문서를 바꾸지 않는다.
- PostgreSQL의 원본 `validated=true`는 기존 생성기의 NOT VALID 의미로 표시한다. Oracle의 같은 이름은 VALIDATE 의미다.

## 검증

- `foreign-key-options.test.ts`: 9개 제품 ID의 필드 변경·FK 식별/대응 보존, PG SQL 연결, 미지정 복귀, 잘못된 조합·지원하지 않는 필드·NULL/기본값 충돌의 원자적 거부.
- `fk-options.spec.ts`: 실제 Chrome 선택·지연 옵션 검사·Undo/Redo·다운로드 재해석·SQL·자식 PK/NULL 보존.
- 8개 DB 계열·9개 제품 ID의 독립 fixture를 원본 바이너리/XML reader로 각각 읽고 원본 writer로 저장했다. 두 표현과 원본 재저장 전후의 원본 저장 그래프 차이는 모두 0이다.
- 원본 재저장본 9개를 앱에서 역판독해 FK 관계·옵션과 SQL 동일을 확인했다. 좌표의 정수/실수 문자열 표기 차이만 따로 기록한다.
- 이 과정에서 원본 writer가 기본 ASC를 생략하면 MySQL/MariaDB SQL이 달라지는 문제를 수정했다. 누락된 방향도 ASC로 출력하며 DESC는 유지한다. 회귀검사 2개를 추가했다.
- 근거: `.analysis/fk-terms-20261020/matrix{,-oracle}/`, [구현 기록](../worklog/2026-10-20-fk-terms.md).

2026-10-21에는 Oracle·MariaDB·PostgreSQL·MySQL의 독립 모델 37개·SQL 적용/카탈로그/동작 217검사가 실제 서버에서 통과했다. PG/Oracle의 지연 검사·기존 행 검증 생략, Oracle의 비활성 제약도 포함한다. 네 DB의 Chrome 옵션 편집·저장 경로도 통과했다. [검증 버전·재현·제한](../worklog/2026-10-21-fk-live-databases.md)을 따른다. 다른 DB 계열·모든 물리 옵션·원본 GUI 수용·전체 버전 조합 검증은 남아 있다.
