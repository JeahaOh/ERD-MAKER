# 회사 테스트 인계와 초기 Git 반영 준비

기준일: 2026-10-21. 사용자 요청: 완성도 설명, commit/push, 사용법·AI 테스트 방법, 회사 Oracle 19c 테스트 준비. 후속으로 Electron 여부와 API/라이선스 전송 유무를 확인했다.

## 변경

- [완성도](../readiness.md): 전체 제품 범위 약 60%(55~65%)의 개발 추정. 영역별 근거와 남은 수용 범위를 명시했다. 테스트 통과율이나 원본 동등률이 아니다.
- [사용법](../guides/usage.md): 회사 clone·Node 24·Electron/브라우저 실행, 편집·관계·FK·용어사전·저장·SQL 내보내기.
- [AI 테스트](../testing/ai-testing.md): 로컬 검사, DB 실행 전 준비, 명시적으로 DB 실행을 맡긴 경우를 구분한 프롬프트.
- [Oracle 19c](../testing/oracle19.md): 실행 SQL과 결과 양식. 계정/스키마 ERD_TEST·버전 19·기존 테이블 충돌 사전 검사. 비밀번호·접속 설정·자동 삭제 없음.
- 독립 fixture 생성기에 `--dialect`와 `--oracle-schema`를 추가했다. 기존 기본값은 보존한다. `.analysis` 아래 새 경로에만 쓴다.
- `build-oracle-test-kit.py`는 6개 Oracle 모델의 해시 검증 후 22개 판정이 있는 SQL*Plus 스크립트를 만든다. DB에 연결하지 않는다. 회사용 기본 출력은 SYS/SYSTEM을 거부하며 로그인 계정까지 대조한다.
- [외부 전송 확인](../guides/network-and-privacy.md): 제품 소스 검색과 실제 Electron 세션 정책 검사를 구분했다. AI 테스트는 제품 내 AI API 기능이 아니다.

## 추가 검증

- 인계 전 최종 전체 회귀: 단위 23파일·255개 통과(14.50초), Chrome E2E 19개 통과(약 1.0분), 실패·생략 0. TypeScript/Vite 빌드 성공.

- 회사 SQL 키트 해시·대상 스키마·버전·로그인 가드, 관리자 대상 출력 전 거부, 새 문서 로컬 링크 검사 통과.
- 동일 키트 로직을 별도로 생성한 로컬 major23/SYSTEM 입력에서 실행해 6사례·22판정을 통과했다. 기존 Oracle FK 검사 34개도 함께 통과했다. 추가 키트 실행 1건을 포함한 runner 결과는 35개 검사다. `.analysis/oracle-kit-proof-results/oracle.json` 참조.
- 이 결과는 **키트의 로컬 26ai Free 실행 증거**다. 회사용 major19/ERD_TEST 출력의 실제 19c 실행은 미검증이며 `kit.json`의 `executedOnOracle19=false`를 유지한다.
- Electron 최신 로컬 빌드에서 모델 생성·편집·실파일 열기·sandbox·Node API 미노출 검사 통과. HTTP/HTTPS 요청은 `ERR_BLOCKED_BY_CLIENT`로 취소됐고 로컬 TCP 수신기 연결은 **0건**이었다. 외부 서버에 요청을 보내 검사하지 않았다.
- 검사 도구의 첫 Electron dynamic import가 평가 컨텍스트에서 실패해 TCP 수신기를 테스트 프로세스로 옮겼다. 제품의 네트워크 차단 코드는 수정하지 않았고 재실행에서 통과했다.
- 새 TS helper strict 검사, Python 구문 검사 통과. 제품 소스의 외부 API/라이선스/분석/updater 클라이언트는 발견하지 않았다. XML namespace URL은 통신 호출과 구분했다.

## Git 범위

- 사용자 지정 원격: `git@github.com:JeahaOh/ERD-MAKER.git`.
- 원격 main의 초기 README 커밋 `f0612b0052580752cbf55fbf989b83b1fda8973a`를 보존한다. 로컬은 최초 커밋 전 상태였으므로 작업 파일을 덮어쓰지 않고 해당 커밋을 부모 기준으로 연결했다. 강제 push·reset·clean을 사용하지 않는다.
- 포함: 독립 앱 코드·검사·개발 도구·설계/사용/검증 문서·의존성 lock·CI 설정.
- 제외: REF 원본·추출 JAR/EXE·.analysis·캐시·node_modules·dist·기존 release·회사 DB 카탈로그/생성 모델·비밀번호/환경 설정.
- commit/push 성공 여부와 원격 SHA는 실제 명령 결과로 확인한다. 이 문서만으로 원격 반영·CI·배포 성공을 주장하지 않는다.

후속 DBeaver ERD 요청의 원본 카탈로그·생성 모델은 로컬 분석 경로에 보관하고 이 Git 인계에 포함하지 않는다.
