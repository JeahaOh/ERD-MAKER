# 회사 Oracle 19c 테스트

기준일: 2026-10-21. **19c는 아직 실제 실행하지 않았다.** 개발 PC의 Oracle 26ai Free 통과 기록과 구분한다. 이 문서는 사용자가 회사에서 검토 후 수행할 수용 절차다.

## 1. 준비

- Oracle **19c 전용 테스트 계정**과 테스트 테이블 생성 권한·tablespace quota가 필요하다. DBA가 제공한 기존 계정을 사용한다. 이 절차는 사용자/권한을 만들거나 바꾸지 않는다.
- 기본 키트의 계정명·스키마명은 **ERD_TEST**다. SYS/SYSTEM이나 업무 스키마에서 실행하지 않는다. 계정이 다르면 5절에서 다시 생성한다.
- SQL*Plus를 권장한다. SQL Developer는 SQL 검토·개별 실행에 사용할 수 있지만 자동 PASS 판정은 SQL*Plus의 종료·SPOOL 동작을 기준으로 한다.
- 저장소 파일은 [run.sql](oracle19/run.sql), [키트 메타정보](oracle19/kit.json)다. Node·Electron·Python 없이 이 SQL만으로 DB 부분을 검사할 수 있다.

## 2. 접속과 사전 확인

```text
sqlplus /nolog
CONNECT ERD_TEST@//HOST:1521/SERVICE_NAME
```

`HOST`·`SERVICE_NAME`은 DBA가 제공한 값으로 바꾼다. 비밀번호는 이어지는 프롬프트에 입력한다. 명령행에 비밀번호를 붙이거나 문서/Git에 저장하지 않는다. 승인된 wallet이 있으면 해당 접속 방식을 사용할 수 있다.

```sql
SELECT sys_context('USERENV','SESSION_USER') AS login_user,
       sys_context('USERENV','CURRENT_SCHEMA') AS current_schema
FROM dual;
SELECT banner_full FROM v$version WHERE ROWNUM=1;
```

로그인·현재 스키마가 모두 ERD_TEST이고 버전이 19c인지 확인한다. 스크립트 자체도 버전·계정·기존 테스트 테이블을 검사하며 맞지 않으면 DDL 전에 중단한다.

## 3. 테스트 실행

검토한 저장소 루트에서 SQL*Plus를 시작했다면 다음을 실행한다. 다른 위치면 실제 절대 경로를 지정한다.

```text
@docs/testing/oracle19/run.sql
```

- 새 테이블 12개(부모/자식 각 6개), 해당 PK/FK·키 인덱스, 테스트 행이 생성된다. 이름은 `f01_`~`f06_`으로 시작한다.
- 테스트는 생성기가 만든 DDL을 사용한다. 계정 생성·권한 부여·비밀번호 변경·기존 객체 삭제는 없다.
- 생성된 파일 `oracle-test-result.log`에서 개별 `PASS`와 마지막 **`ERD_ORACLE_TEST_PASS cases=6 assertions=22 expected_major=19`**를 확인한다.
- 예상 오류는 PL/SQL에서 잡아 코드까지 대조한다. 다른 SQL 오류, SP2 오류, 마지막 PASS 누락, 비정상 종료는 실패/미완료다.
- Oracle DDL은 자동 커밋되므로 실패해도 앞서 생성된 객체가 남을 수 있다. 자동 정리·재실행하지 말고 결과를 기록한다. 재실행에는 새 전용 테스트 스키마 또는 DBA가 확인한 명시적 정리가 필요하다.

| 사례 | 확인 내용 | 기대 결과 |
| --- | --- | --- |
| f01 NO ACTION | 잘못된 부모 참조 삽입·참조 중 부모 삭제 | ORA-02291/02292, 원래 부모 유지 |
| f02 CASCADE | 부모 삭제 | 해당 자식도 삭제 |
| f03 SET NULL | 부모 삭제 | 자식 유지, parent_id가 NULL |
| f04 지연 제약 | 자식 먼저 삽입 후 부모 삽입·커밋 / 미복구 커밋 | 복구 시 성공, 미복구 시 ORA-02291 포함 오류·전체 롤백 |
| f05 NOVALIDATE | 기존 잘못된 행·새 위반 행·검증 활성화 | 기존 행 유지, 새 행 ORA-02291, 검증 ORA-02298 |
| f06 DISABLED | 위반 행 삽입 후 ENABLE VALIDATE | 삽입 허용, 활성 검증 ORA-02298 |

각 사례는 ALL_CONSTRAINTS에서 DELETE_RULE·STATUS·VALIDATED·DEFERRABLE·DEFERRED도 대조한다. 22검증은 이 키트의 판정 수이며 기존 Docker 검증의 Oracle 34개 검사와 집계 단위가 다르다.

## 4. 앱 화면도 확인

[사용 방법](../guides/usage.md)에 따라 `npm run desktop`으로 실행한다. Oracle 새 모델 → 실제 테스트 스키마명 설정 → 테이블/컬럼·관계 편집 → FK 옵션 → 저장 → 재열기 → SQL 내보내기를 확인한다. `.exerd` 저장 파일과 SQL은 별개로 보관한다.

모델 관계의 UUID·부모/자식 대응, 자식 PK, NULL, 카디널리티가 의도한 변경 외에 달라지는지 확인한다. 전체 원본의 PostgreSQL 모델을 DB 선택만 바꾸어 Oracle로 변환하는 테스트는 지원 범위가 아니다.

## 5. 다른 테스트 계정용 키트 생성

저장소에서 Node 24·npm 의존성·Python 3.10 이상을 준비한 뒤 실행한다. `ERD_TEST`를 제공받은 **대문자 테스트 계정명**으로 바꾼다. 결과 경로는 새 경로여야 한다. 이 명령은 파일만 만들고 DB에 접속하지 않는다.

```sh
npx --no-install vite-node app/scripts/database/fk-behavior-fixtures.ts .analysis/company-oracle19-fixtures --dialect oracle --oracle-schema ERD_TEST
python3 app/scripts/database/build-oracle-test-kit.py --fixtures .analysis/company-oracle19-fixtures --out .analysis/company-oracle19-kit
```

Windows에서 `python3` 명령이 없다면 Python 3의 `py -3` 또는 `python`을 사용한다. 새 키트의 `run.sql`을 검토한 뒤 실행한다. 소스 SQL을 문자열 치환하거나 버전/스키마 사전 검사를 제거하지 않는다.

## 6. 결과 전달

[결과 양식](oracle19-result-template.md)에 커밋 SHA, OS·실행 방법, Oracle 19c 세부 버전/RU, 6사례 결과, PASS/실패 코드, UI 저장·재열기 결과를 적는다. 접속 주소·비밀번호·업무 데이터는 제외한다. `oracle-test-result.log`도 접속/업무 정보가 없는지 확인한 뒤 필요한 부분만 전달한다.

공식 기준: [Oracle 19c 제약](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/constraint.html), [SQL*Plus 접속·비밀번호 프롬프트](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqpug/starting-SQL-Plus.html).
