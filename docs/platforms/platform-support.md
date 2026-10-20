# 실행 및 플랫폼 검증

현재 웹 빌드·Chrome 편집/저장/복구 및 macOS Electron 로컬 renderer 실행을 확인했다. Linux ARM64·x64 에뮬레이션에서도 고정 소스 스냅샷의 웹·Electron 실행을 확인했다. Windows·Intel Mac 실제 실행, Linux AppImage 설치와 전체 기능 시험은 아직 완료하지 않았다. [현재 검증 상태](../status.md)와 [Linux 검증](linux-verification.md)을 함께 확인한다.

ERD Maker는 React/Vite의 정적 웹 앱과 그 빌드를 여는 Electron 데스크톱 앱으로 구성한다. 데스크톱 앱도 같은 `dist/index.html`을 읽는다.

## 실행

```sh
npm ci
npm run dev       # 브라우저 개발 서버
npm run build     # 타입 검사 및 정적 웹 앱 생성
npm run preview   # 빌드한 웹 앱 확인
npm run desktop   # 빌드 후 Electron 실행
npm run package   # 현재 OS용 설치 파일 생성
```

- 웹 배포: `dist/`를 정적 웹 서버에 올린다. 별도 백엔드 서버는 필요하지 않다.
- Electron 진입점: `app/desktop/main.cjs`. 패키지 산출물: `release/`.
- 파일 입출력: 브라우저의 파일 선택 및 다운로드 기능으로 `.exerd`를 연다. XML·바이너리를 함께 생성한 `.exerd`로 저장한다. 복구본은 현재 기기의 IndexedDB에 기록한다.
- 파일 경로에서 자산을 읽을 수 있도록 Vite `base`를 `./`로 설정해야 한다.

## 패키징 대상과 현재 증거

| 대상 | CI 러너 | 설치 파일 | 현재 확인 범위 |
| --- | --- | --- | --- |
| macOS Apple Silicon | `macos-15` | DMG, ZIP | 로컬 ARM DMG·ZIP 생성 및 패키지 실행·편집·실파일·sandbox 확인. 서명·공증·DMG 설치 및 원격 CI는 미검증 |
| macOS Intel | `macos-15-intel` | DMG, ZIP | 패키징 설정 작성, 원격 CI 및 설치 검증 전 |
| Linux x64 | `ubuntu-24.04` | AppImage, tar.gz | 패키징 설정 작성, 원격 CI 및 설치 검증 전 |
| Windows x64 | `windows-2022` | NSIS EXE, ZIP | 패키징 설정 작성, 원격 CI 및 설치 검증 전 |

CI는 각 OS에서 테스트와 웹 빌드를 실행한 뒤 해당 OS용 설치 파일을 만든다. Linux에서는 Xvfb 가상 화면으로 실제 Electron renderer를 열어 로컬 웹 화면과 보안 설정도 확인한다. GitHub Actions 실행 성공, 설치 파일 생성, 실제 GUI 실행과 사용자 기능 검증은 서로 다른 증거다. 설정 파일만으로 세 OS의 실행이 검증된 것은 아니다. Linux ARM64와 Windows ARM64는 현재 CI 대상에 포함하지 않는다.

로컬 데스크톱 스모크 테스트는 `npm run build` 후 `node app/scripts/desktop/smoke.mjs`로 실행한다. GUI가 있는 운영체제에서는 창이 잠시 열린 뒤 종료된다. Linux에서 화면이 없으면 `xvfb-run --auto-servernum node app/scripts/desktop/smoke.mjs`를 사용한다. CI의 Ubuntu 커널 설정은 해당 일회용 러너에서 Chromium 사용자 네임스페이스를 허용하며, 앱의 `sandbox: true`를 유지한다.

패키지를 만든 뒤에는 현재 `dist/`와 ASAR에 실제 포함된 파일을 비교한다. 로컬 macOS ARM 기본 경로에서는 다음 명령을 사용한다.

```sh
node app/scripts/desktop/verify-package.mjs
node app/scripts/desktop/smoke.mjs 'release/mac-arm64/ERD Maker.app/Contents/MacOS/ERD Maker'
```

검사기는 ASAR의 웹 파일·Electron 진입점 바이트를 현재 빌드와 SHA-256으로 비교하고, 이전 빌드 자산·REF·분석 자료·원본 JAR/EXE/EXERD·소스맵의 포함을 거부한다. `dist`가 패키징 후 바뀌면 기존 패키지는 이 검사에 실패한다. 따라서 이후 소스의 검증 결과를 이전 설치 파일의 결과로 보고하지 않는다.

코드 서명·macOS 공증·자동 업데이트는 아직 구성하지 않았다. CI의 `CSC_IDENTITY_AUTO_DISCOVERY=false`는 서명 인증서를 찾지 않도록 하는 설정이며, 배포물의 신뢰 확인을 대신하지 않는다. 인증서와 공증 자격 증명을 연결하고 각 OS에서 설치·열기·업그레이드를 검증한 뒤 일반 사용자 배포를 확정한다.

## Electron 보안 경계

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`를 사용한다.
- renderer에 Node API 또는 IPC 연결을 제공하지 않는다.
- 새 창·외부 페이지 탐색·webview·권한 요청을 차단한다.
- Electron renderer의 HTTP/HTTPS/WebSocket 요청을 차단한다. 정적 자산은 로컬 파일로 읽는다.
- 패키징 파일 목록을 웹 빌드·Electron 진입점으로 제한해 `REF/`의 eXERD 평가판·플러그인을 포함하지 않는다.

## 출시 전 수용 기준

각 OS에서 설치 파일을 내려받아 설치하고 창이 열리는지 확인한다. 테이블 편집, 관계 편집, 저장 후 다시 열기, SQL 입출력 및 이미지 내보내기를 실제 UI에서 확인한다. 비ASCII 파일명과 경로, 고해상도 화면, 확대·축소, OS 클립보드, 종료 후 재실행도 별도로 확인한다. 브라우저판은 Chromium·Firefox·Safari의 최신 안정판에서 같은 모델을 왕복 저장해 확인한다.

## 근거

- [Electron 보안 권고](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-builder 설정](https://www.electron.build/configuration.html)
- [GitHub 호스팅 러너](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
