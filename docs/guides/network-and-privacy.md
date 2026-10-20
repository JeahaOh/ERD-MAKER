# Electron 실행과 외부 전송 확인

기준일: 2026-10-21. 대상은 현재 저장소의 제품 소스와 최신 로컬 빌드다. 과거 `release/` 설치 파일 전체의 새 패킷 감사나 OS 전체 트래픽 검사는 아니다.

## 결론

- ERD Maker는 **Electron 데스크톱 앱 + 같은 화면의 브라우저 앱**이다. `npm run desktop`은 `dist/index.html`을 `file:`로 연다.
- 제품 소스에 외부 API 호출, 라이선스 키 수집/활성화/기간 검사, 사용량 분석, 오류 수집 업로드, 자동 업데이트 클라이언트가 없다.
- 모델과 용어사전은 Worker에서 로컬 처리한다. 브라우저 복구는 IndexedDB/localStorage를 사용한다. 외부 DB 접속이나 SQL 실행도 편집기 자체에서는 하지 않는다.
- **AI 테스트 지침은 개발 도구용 문서**다. 앱에 AI API나 회사 모델 자동 업로드 기능을 추가한 것이 아니다.

## 소스와 실행 근거

| 확인 | 근거 |
| --- | --- |
| Electron 진입점 | `app/desktop/main.cjs`, `loadFile(dist/index.html)` |
| HTTP/HTTPS/WS/WSS 차단 | `session.defaultSession.webRequest.onBeforeRequest`가 네 프로토콜 요청을 취소 |
| 임의 새 창·이동·webview 차단 | 같은 진입점의 windowOpenHandler/will-navigate/will-attach-webview |
| Renderer 권한 | nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity=true |
| 웹 자원 | 로컬 번들·시스템 글꼴, CSP의 self 중심 정책. 개발 모드의 localhost WebSocket은 Vite 갱신 용도 |
| 자동 업데이트/배포 | 제품 updater 없음, electron-builder `publish: null`, CI 패키징 `--publish never` |
| 실제 세션 차단 검사 | `app/scripts/desktop/smoke.mjs`: 로컬 TCP 수신기를 열고 Electron HTTP/HTTPS 요청 취소와 연결 수 0을 대조. 외부 서버·모델 데이터를 사용하지 않음 |

소스의 `http://exerd...`, `http://schemas.openxmlformats...`, `http://www.w3.org/...`는 XML 객체·형식의 이름 공간 식별자다. 해당 문자열을 포함하는 것과 그 주소로 접속하는 것은 다르다. 실제 네트워크 호출 API의 존재와 사용 경로를 별도로 확인했다.

## 구분할 사항

- `git clone/push`, `npm ci`, 최초 Electron/Playwright 설치, Docker 이미지 다운로드, GitHub Actions는 개발·설치 과정의 네트워크 작업이다. 앱의 모델/라이선스 전송과 구분한다.
- 브라우저 확장·운영체제·백신·회사 AI 개발 도구의 전송 정책은 이 앱의 통제 범위가 아니다. AI에 실제 회사 모델을 제공하는 행위는 앱 내 로컬 처리와 별개다.
- Electron main 프로세스는 Node 런타임이지만 현재 코드에 별도 HTTP 클라이언트·원격 IPC·라이선스 서버 호출이 없다. 웹 세션 차단 검사는 모든 향후 main 코드나 OS 패킷까지 영구 차단한다는 보장이 아니다.
- 최신 설치 파일이 필요하면 해당 회사 OS에서 `npm run package`로 생성한다. 코드 서명·공증과 모든 OS 설치 수용은 별도 검증 대상이다.

재확인: `npm run build` 후 `node app/scripts/desktop/smoke.mjs`. 화면을 열 수 있는 환경이 필요하며 headless Linux에서는 기존 플랫폼 문서의 xvfb와 sandbox 조건을 따른다.
