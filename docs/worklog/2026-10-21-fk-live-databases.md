# Oracle·MariaDB·PostgreSQL·MySQL FK 실제 실행 검증

기준일: 2026-10-21(KST). 사용자가 지정한 네 DB를 검증 대상으로 확정했다. E2E 상시 허용 범위에서 화면 검사를 수행했다. 기존 DB·사용자 파일·인증 설정을 변경하지 않았으며 commit/push·배포·패키지 갱신은 수행하지 않았다.

## 결과

| DB | 실제 서버 | 독립 모델 | SQL 적용·카탈로그·동작 검사 | 결과 |
| --- | --- | ---: | ---: | --- |
| Oracle | Oracle AI Database 26ai Free, 23.26.3.0.0 | 6 | 34 | 통과 |
| MariaDB | 11.4.13 | 8 | 48 | 통과 |
| PostgreSQL | 17.11 | 15 | 87 | 통과 |
| MySQL | 8.4.11 | 8 | 48 | 통과 |
| 합계 | ARM64 로컬 컨테이너 | **37** | **217** | 실패·생략 0 |

- 전체 단위검사: **23파일 255개 통과**, 실패·생략 0, 12.21초.
- 전체 Chrome E2E: **19개 통과**, 실패·생략 0, 약 1.1분. TypeScript/Vite 빌드 성공.
- 신규 E2E 3개: Oracle·MariaDB·MySQL의 DB별 옵션 노출, SET DEFAULT 미노출, 옵션 적용·Undo/Redo·다운로드·재판독. 기존 PostgreSQL E2E와 합쳐 네 DB의 화면 경로를 확인했다.
- E2E 다운로드의 FK UUID·제약 UUID·부모키·컬럼 대응·카디널리티와 테이블/컬럼 속성을 대조했다. Oracle에는 갱신 규칙이 없고, MySQL/MariaDB에는 지연 옵션이 없다.
- 새 fixture 생성 도구의 strict TypeScript 검사 및 실행 도구의 Python 구문 검사 통과.

## 검사 방식

`createNativeDocument`로 DB별 독립 모델 생성 → `editForeignKeyOptions` → 실제 `.exerd` 저장 → 재열기 → 운영 DDL 생성기 → 새 DB에 실행 → 카탈로그·데이터 결과 대조 순서로 검사했다. SQL을 수동 보정하지 않았다. 생성 SQL의 `complete=true`와 저장 전후 SQL 동일을 확인하고, 모델/SQL SHA-256을 실행 전후 대조했다.

DB별 적용 범위:

- 공통: 2테이블·각 PK·FK 생성, 존재하지 않는 부모 참조 거부, 삭제 CASCADE·SET NULL·NO ACTION 동작.
- PostgreSQL/MySQL/MariaDB: 삭제·갱신 각각 NO ACTION·RESTRICT·CASCADE·SET NULL 동작. MySQL/MariaDB의 NO ACTION·RESTRICT는 카탈로그 비교에서 같은 차단 의미로 정규화한다.
- PostgreSQL: 삭제·갱신 SET DEFAULT, 부모 기본 행 존재, 지연 참조의 커밋 전 복구 성공·미복구 실패 및 롤백, 지연 가능한 RESTRICT의 즉시 삭제 차단, 복합키 MATCH FULL/SIMPLE의 부분 NULL 차이.
- PostgreSQL NOT VALID와 Oracle ENABLE NOVALIDATE: 생성된 FK 문장을 마지막에 적용하여 기존 잘못된 행은 유지하고 새 위반 행은 거부하는지 확인했다. 이후 검증 활성화는 기존 위반 때문에 실패해야 한다.
- Oracle: DEFERRABLE INITIALLY DEFERRED의 커밋 동작, DISABLE NOVALIDATE의 위반 행 허용, ENABLE VALIDATE 전환 시 기존 위반 거부. 기존 SYSTEM 스키마를 사용했으며 새 계정·권한을 만들지 않았다.
- 기대 실패는 오류 코드까지 대조했다. PostgreSQL `23503`, MySQL/MariaDB `1451/1452`와 `23000`, Oracle `ORA-02291/02292/02298`를 기록했다.

검사 수는 개별 SQL 적용·카탈로그 조회·데이터 동작 단위다. 전체 제품 기능 수나 독립적인 사용자 시나리오 217개라는 뜻은 아니다.

## 격리와 검사 도구 보완

- PostgreSQL·MySQL·MariaDB는 `--network none`, 호스트 포트·bind mount·기존 DB 접속 없이 실행했다. 데이터는 컨테이너 내부 tmpfs다.
- Oracle은 공식 `database/free:latest-lite` ARM 이미지를 받았다. 실제 image ID·repo digest·아키텍처는 보고서에 고정했다. 이 실행의 repo digest는 `sha256:cf540c3fa190d7cffad08c491652ac07fc70314e510f6b87890449517d565e94`다.
- Oracle은 `--network none`에서 `ORA-00600 [ksipc: no private ips avail for use]`로 기동하지 못했다. 전용 `--internal` 네트워크와 `gateway_mode_ipv4=isolated`로 비 loopback IP를 제공했다. 외부 경로·호스트 bridge 주소·포트 공개·다른 컨테이너 연결은 없다.
- 준비 완료 판정은 Oracle PDB의 `READ WRITE`까지 기다린다. 단순 `SELECT 1`은 PDB가 아직 열리지 않은 시점에도 성공해서 `ORA-01109`를 일으킬 수 있었다. 버전 조회도 제품명 문자열 대신 첫 버전 행을 읽도록 보완했다.
- PostgreSQL 내부 `char` 타입의 카탈로그 비교는 명시적 text cast로 수정했다. 앱 SQL 오류와 검사 도구 오류를 구분했다.
- 실패한 초기 실험 보고서도 보존했다. 최종 통과 보고서는 아래 경로에 명시했다. 이번에 만든 컨테이너만 정지하고 자동 폐기했으며 Oracle 전용 네트워크도 제거했다.
- **앱 제품 코드 변경은 없었다.** 이번 변경은 검증 스크립트·E2E·검증 문서다.

## 증거

- 입력 정본: `.analysis/fk-live-20261021-fixtures/manifest.json` 및 37개 모델/SQL.
- 최종 PostgreSQL: `.analysis/fk-live-20261021-postgres2/postgresql.json` — 15모델·87검사.
- 최종 MySQL/MariaDB: `.analysis/fk-live-20261021-run1/{mysql,mariadb}.json` — 각각 8모델·48검사. 같은 디렉터리의 첫 PostgreSQL 실패 보고서를 최종 결과로 사용하지 않는다.
- 최종 Oracle: `.analysis/fk-live-20261021-oracle4/oracle.json` — 6모델·34검사, 컨테이너/네트워크 정리 확인.
- 통합 SHA·결과 정본: `.analysis/fk-live-20261021-evidence/evidence.json`.
- 재현 도구: `app/scripts/database/fk-behavior-fixtures.ts`, `verify-fk-behavior.py`.
- 화면 검사: `app/tests/e2e/fk-databases.spec.ts`, 기존 `fk-options.spec.ts`.

## 재현

Node 24를 사용한다. 결과 디렉터리는 `.analysis` 아래의 새 경로만 허용한다. 실행 도구는 이미 로컬에 있는 이미지만 사용하고 다운로드하지 않는다.

```sh
node_modules/.bin/vite-node app/scripts/database/fk-behavior-fixtures.ts .analysis/NEW_FK_FIXTURES
python3 app/scripts/database/verify-fk-behavior.py \
  --fixtures .analysis/NEW_FK_FIXTURES --out .analysis/NEW_FK_RESULTS
npm test -- --reporter=dot
npm run test:e2e
```

일부 DB만 실행하려면 `--dialect oracle`, `--dialect mariadb`, `--dialect postgresql`, `--dialect mysql`을 한 개 이상 지정한다. 필요한 이미지: `postgres:17`, `mysql:8.4`, `mariadb:11.4`, `container-registry.oracle.com/database/free:latest-lite`.

## 남은 범위

- 이번 검증은 표에 적힌 서버 버전과 독립 모델의 FK 조합에 한정한다. Oracle 10g~21c 등 다른 버전, 사용자 실파일 전체의 Oracle 변환·실행, 모든 자료형·물리 속성 검증으로 확대하지 않는다.
- 원본 GUI, 최신 Electron 패키지·Windows/Linux 설치, Oracle/MySQL/MariaDB 카탈로그 역공학은 이번에 수행하지 않았다.
- FK 인덱스 플래그와 미지원 보조 메타정보는 기존 DDL 진단 범위다. 실행 검증 결과는 별도 보고서에 귀속하며 생성기의 일반 반환값 `executionVerified:false`를 전역 true로 바꾸지 않는다.

공식 참고: [Oracle 제약](https://docs.oracle.com/en/database/oracle/oracle-database/26/sqlrf/constraint.html), [Oracle 공식 컨테이너](https://www.oracle.com/database/free/get-started/), [PostgreSQL 17 CREATE TABLE](https://www.postgresql.org/docs/17/sql-createtable.html), [MySQL 8.4 FK](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html), [MariaDB FK](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/foreign-keys), [Docker 격리 네트워크](https://docs.docker.com/engine/network/port-publishing/).
