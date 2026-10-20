# AI 개발 도구에 전달할 테스트 지침

기준일: 2026-10-21. 회사 PC에서 저장소를 읽고 명령을 실행할 수 있는 AI 개발 도구용이다. 앱 내부의 AI 기능이나 외부 AI API 호출 설정이 아니다.

## 1. 로컬 코드·브라우저 검사 프롬프트

아래 내용을 그대로 전달한다.

```text
ERD-MAKER 저장소를 검증해라. 먼저 README.md, docs/status.md,
docs/guides/usage.md, docs/guides/network-and-privacy.md를 읽어라.

1. Git branch/HEAD/status와 Node/npm/OS를 확인하고 기존 변경을 보존해라.
2. Node 24에서 npm ci, npm test -- --reporter=dot, npm run build를 실행해라.
3. npm run test:e2e를 실행해 실제 화면·다운로드 결과를 검사해라.
   로컬 기본은 Chrome이다. Chrome이 없고 브라우저 설치가 허용된 경우
   npx playwright install chromium 후 CI=1로 Chromium 검사를 실행해라.
   PowerShell은 $env:CI='1'을 설정하고 npm run test:e2e를 실행한다.
4. GUI 실행이 허용된 환경이면 node app/scripts/desktop/smoke.mjs로
   실제 Electron 생성·편집·로컬 파일 열기·Node 미노출·sandbox와
   HTTP/HTTPS 취소 및 로컬 TCP 연결 0건을 확인해라.
5. REF/와 .analysis/는 Git에 포함되지 않는다. 이 파일에 의존한 테스트가
   skip되면 검사명·이유·개수를 보고해라. skip을 통과로 계산하지 마라.
6. 실패는 원인을 분류해라: 환경/의존성/테스트 자체/제품 오류.
   제품 오류 수정이 필요하면 최소 변경 후 관련 검사와 전체 회귀를 실행해라.
7. 실제 검사 결과와 실행하지 않은 검사를 분리해서 한국어로 보고해라.

DB에는 접속하지 마라. 회사 데이터/접속정보/비밀번호를 코드·로그·Git에
저장하지 마라. 원본 REF와 기존 모델을 덮어쓰지 마라.
commit/push·패키지 배포·계정/권한 변경은 이 프롬프트의 권한 범위가 아니다.
```

회사 clone에서는 로컬에서 기록된 255개/19개와 통과 개수가 다를 수 있다. 최종 판단은 현재 실행의 passed/failed/skipped와 빠진 원본 검증 범위로 한다. Java·원본 JAR가 없다고 앱 실행이 실패해서는 안 된다.

## 2. Oracle 19c 테스트 준비 프롬프트

```text
docs/testing/oracle19.md를 읽고 Oracle 19c 검증을 준비해라.
이번 단계에서는 DB 접속·SQL 실행을 하지 마라.

- docs/testing/oracle19/run.sql의 버전 19/ERD_TEST 사용자·스키마 검사,
  기존 테스트 테이블 충돌 검사, 6개 독립 모델과 22개 기대 결과를 검토해라.
- 현재 테스트 계정명이 ERD_TEST가 아니면 문서의 생성 명령으로 새 키트를
  .analysis 아래에 만들어라. SYS/SYSTEM·운영 스키마를 대상으로 만들지 마라.
- SQL 문장을 임의로 고쳐 통과시키지 마라. 모델/생성기 문제와 서버 차이는
  원본 SQL, 오류 코드, 재현 입력으로 보고해라.
- 사용자가 검토할 SQL 파일, 접속 방식(비밀번호 제외), 예상 생성 객체,
  실행·결과 확인 순서를 정리해라. 설치/접속 권한 부족도 명확히 보고해라.
```

## 3. 사용자가 DB 실행까지 맡긴 경우의 프롬프트

```text
사용자가 지정한 Oracle 19c의 전용 테스트 계정에서만 검증해라.
접속 대상과 테스트 계정이 확정되지 않았다면 임의로 추정하지 마라.
비밀번호는 사용자가 SQL*Plus 프롬프트에 입력하거나 승인된 wallet을 사용한다.

- docs/testing/oracle19.md에 따라 현재 버전·로그인 사용자·현재 스키마를
  읽기 전용 조회로 확인한 뒤, 검토된 run.sql만 실행해라.
- 회사 정책이 허용하는 로컬 SQL 도구를 사용해라. 새 사용자·권한·방화벽·
  리스너·접속 설정을 변경하지 마라. 기존 객체를 drop하거나 재사용하지 마라.
- 6사례/22검증과 ERD_ORACLE_TEST_PASS 표시를 확인해라.
  예상한 ORA-02291/02292/02298은 스크립트가 처리한다. 처리되지 않은
  ORA/SP2 오류나 중도 종료를 통과로 보고하지 마라.
- 생성된 테스트 객체는 남겨라. 재실행 충돌 시 자동 삭제하지 말고 보고해라.
- 실제 버전/RU·커밋 SHA·검사 결과·오류 코드·남은 항목을 보고해라.
  비밀번호·접속 문자열·업무 데이터는 보고나 Git에 포함하지 마라.
```

결과는 [회사 테스트 양식](oracle19-result-template.md)에 기록한다. 실패 원인 수정·재실행, 원격 Git 반영, 설치물 배포는 각각 실제 수행 결과로 구분한다.
