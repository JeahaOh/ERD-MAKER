# Linux 실행 검증

- 작업 범위: Linux 컨테이너 안에서 독립 설치·정적 빌드·브라우저 기능 검사·Electron 실행을 확인한다. macOS 호스트 실행 결과를 Linux 결과로 간주하지 않는다.
- Linux ARM64와 Linux x64를 구분한다. Apple Silicon Docker의 x64 실행은 CPU 에뮬레이션이므로 실제 x64 머신의 성능·드라이버·배포 수용을 대체하지 않는다.
- 결과는 `.analysis/platforms/Linux/<실행명>/source-manifest.json`의 소스 SHA-256에 귀속된다. 검증 중 바뀐 작업 디렉토리 전체가 검증되었다고 주장하지 않는다.

## 격리 방식

- 허용 목록: `package.json`, `package-lock.json`, `index.html`, TypeScript/Vite/Vitest/Playwright/Electron Builder 설정, `app/`, 존재할 경우 `public/`.
- 제외: `REF`, `.analysis`, `.git`, `node_modules`, `release`, `dist`, 심볼릭 링크. 원본 평가판·플러그인·사용자 모델을 컨테이너에 전달하지 않는다.
- 스냅샷 도구는 파일 내용을 읽고 tar를 만든 뒤 작업 디렉토리를 다시 읽는다. 캡처 도중 변경이 있으면 실패하며 새 경로에 다시 캡처해야 한다.
- 전체 프로젝트를 마운트하지 않는다. `docker cp`로 tar만 전달하고, UID 1001의 `pwuser`가 소유한 4GiB `/workspace` tmpfs에서 풀어 실행한다. 호스트 포트를 공개하지 않는다.
- Playwright 공식 seccomp 프로필을 적용하고 비관리자 계정으로 실행한다. 브라우저는 `chromiumSandbox:true`, Electron은 기존 `sandbox:true`를 유지하고 `--enable-sandbox`로 실행한다. `--no-sandbox`, `--disable-setuid-sandbox`, `--privileged`를 우회 수단으로 사용하지 않는다.
- 생성한 컨테이너만 종료·제거한다. 기존 컨테이너·이미지·볼륨은 정리하지 않는다.

## 버전과 디스크 기준

- 프로젝트 lock: `@playwright/test 1.64.1`, Electron `39.8.10`.
- 최초 캐시: `mcr.microsoft.com/playwright:v1.63.0-noble`, **linux/arm64**, Chromium revision **1243**.
- 프로젝트 요구: Chromium/headless revision **1248**, ffmpeg **1013**. 캐시 브라우저와 실제로 다르므로 해당 버전을 내려받아야 한다.
- `verify-linux.sh`는 패키지 설치 후 요구 브라우저 revision을 확인한다. 이미지가 같은 revision을 모두 갖고 있을 때만 `/ms-playwright`를 사용하며, 다르면 격리된 작업 디렉토리에 정확한 버전을 설치한다.
- 최초 확인 공간: 호스트 볼륨 **389GiB**, Docker VM 파일시스템 **931GiB** 여유. x64 이미지 추가와 설치·브라우저 산출물에 **3~5GiB**를 배정할 수 있어 별도 x64 검증을 진행한다. 실제 사용량은 이미지 정보와 실행 로그로 남긴다.
- 실행 후 이미지 저장량은 **18.01GB → 20.62GB**, 증가 **2.61GB**였다. 신규 x64 이미지 표시 크기는 **3.59GB**이며 공유 레이어 때문에 전체 이미지 저장량 증가와 다르다. 기존 컨테이너 수 **8개**, 볼륨 수 **37개**, 빌드 캐시 **2.394GB**는 유지됐다.

## 재현

- 호스트 도구: Python 3.12 이상, Docker CLI, 공식 Playwright 이미지. 이미지 아키텍처는 요청 플랫폼과 같아야 한다.

```sh
mkdir -p .analysis/platforms/Linux
curl -fsSL \
  https://raw.githubusercontent.com/microsoft/playwright/v1.64.1/utils/docker/seccomp_profile.json \
  -o .analysis/platforms/Linux/seccomp_profile.json
docker pull --platform linux/amd64 mcr.microsoft.com/playwright:v1.64.1-noble
python3 app/scripts/platforms/run-linux.py \
  --platform linux/amd64 \
  --image mcr.microsoft.com/playwright:v1.64.1-noble \
  --seccomp .analysis/platforms/Linux/seccomp_profile.json
```

- ARM64 실행은 해당 아키텍처 이미지를 받은 뒤 `--platform linux/arm64`로 바꾼다. 도구는 로컬 이미지 아키텍처가 요청과 다르면 실패한다.
- 단계별 로그: `artifacts/{npm-ci,browser-install,build,unit,browser,electron}.log`.
- 실행 결과: `artifacts/status.tsv`, `browser-results.json`, `electron-security.json`, 스크린샷, `dist-sha256.txt`, `artifact-sha256.txt`.
- `run-summary.json`은 최종 종료 코드, 소스 tar 해시, 검증 후 작업 디렉토리와 달라진 파일 목록을 기록한다. 변경된 최신 소스를 검증하려면 새 스냅샷으로 재실행한다.

## 결과 및 한계

- 검증일: **2026-10-16 KST**. 두 아키텍처 모두 Ubuntu 24.04 Noble 컨테이너에서 실행했다.

| 항목 | Linux ARM64 | Linux x64 |
|---|---|---|
| CPU 실행 | Apple Silicon에서 ARM64 직접 실행 | Apple Silicon Docker에서 x64 에뮬레이션 |
| 이미지 | Playwright 1.63.0 Noble ARM64 + 정확한 1.64.1 브라우저 설치 | Playwright 1.64.1 Noble AMD64 |
| 빌드용 Node | 24.20.0 | 24.21.0 |
| `npm ci` / production build | 통과 | 통과 |
| 단위 테스트 | **146 통과 / 16 생략** | **146 통과 / 16 생략** |
| 브라우저 E2E | **4 통과 / 1 생략**, 7.2초 | **4 통과 / 1 생략**, 30.2초 |
| Electron | **39.8.10 실행·신규 모델 생성 통과** | **39.8.10 실행·신규 모델 생성 통과** |
| renderer 권한 | sandbox·contextIsolation·webSecurity `true`, nodeIntegration `false` | 동일 |
| 샌드박스 해제 스위치 | `no-sandbox:false`, `disable-setuid-sandbox:false` | 동일 |
| renderer 전역 | `require`, `process` 모두 `undefined` | 동일 |
| 모델 원본 파일 | 미포함 | 미포함 |

- 최종 x64 실행의 6단계 종료 코드가 모두 **0**이며 캡처 전후·실행 후 작업 디렉토리 대조에서 변경 파일 **0개**였다.
- x64 소스: **97개 파일**, tar **1,761,280바이트**, SHA-256 `d6575114b5bfcb53c1c0c3ed0f04f01ae4db0c3427ae1e401fbb64c4e6a3808c`.
- x64 근거: `.analysis/platforms/Linux/erd-maker-linux-amd64-20261015t211936z/`. `source-manifest.json`, `run-summary.json`, `artifacts/status.tsv`, `browser-results.json`, `electron-security.json`, 빌드·산출물 해시를 보존했다.
- x64 Electron 스크린샷 SHA-256: `dba17179eeb1c88d992c356b1ecc35a54b132a3736df689067be564d54a0473a`. ARM64·x64 스크린샷을 직접 열어 한글 모델·테이블·컬럼이 렌더링되는 것을 확인했다.
- ARM64 근거: `.analysis/platforms/Linux/arm64-20261016-01/`. 소스 SHA-256 `2329cb847a28e87d319d64a811ba457e31b887511684024aa4b4532594a90c91`. x64보다 앞선 소스 캡처이며 최신 x64 결과와 동일한 소스라고 취급하지 않는다.
- 생성한 Linux 컨테이너는 모두 종료·제거했다. 새 AMD64 이미지는 재현용으로 남겼으며 기존 이미지·컨테이너·볼륨은 삭제하지 않았다.
- 원본 사용자 파일이 없어서 생략된 테스트 수를 별도 기록한다. 이 실행은 사용자 609테이블 파일의 Linux 읽기·저장·호환성을 검증하지 않는다.
- 배포 패키지 설치·서명·데스크톱 통합과 다양한 Linux 배포판·그래픽 드라이버는 별도 수용 검증이다. 컨테이너의 Electron 실행만으로 AppImage 설치가 완료되었다고 판단하지 않는다.

### 검증 도구에서 발견해 교정한 문제

- Playwright Electron 자동화는 Linux에서 기본적으로 `--no-sandbox`를 추가한다. 최초 ARM64의 엄격 검사가 이를 실패로 검출했다. `electron.launch({chromiumSandbox:true})`를 명시한 뒤 실제 스위치 부재와 renderer 격리를 재확인했다. 제품의 `main.cjs`는 변경하지 않았다.
- ARM64의 보완 실행은 `platform-artifacts/electron-smoke-fixed.mjs`에 별도로 남겼다. 보완 도구 SHA-256 `8c5755d90b872536b485541f35e7313b64b1f9361bf031562aaf99d5a4e4b95d`, 결과는 `electron-final.log`와 `electron-security.json`이다. 최초 실패 로그도 유지했다.
- Docker의 파일 복사는 이 환경에서 tmpfs 내부 결과를 읽지 못했다. 최초 x64 실행은 테스트가 통과했지만 최종 증거 복사에 실패했으므로 최종 수용 근거로 쓰지 않았다. `docker exec tar`로 결과를 스트리밍하도록 고친 뒤 최신 소스를 다시 캡처해 전체 실행을 반복했고 최종 증거 해시도 대조했다.

## 근거

- [Playwright Docker 공식 문서](https://playwright.dev/docs/docker): 패키지와 이미지 버전 일치, 비관리자 계정·seccomp, 이미지에 포함된 브라우저와 프로젝트 패키지의 구분.
- [Playwright 공식 seccomp 프로필](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json): 사용자 네임스페이스 생성에 필요한 정책.
- [Electron 프로세스 샌드박스](https://www.electronjs.org/docs/latest/tutorial/sandbox), [BrowserWindow 설정](https://www.electronjs.org/docs/latest/api/browser-window): renderer sandbox·Node 권한 격리의 의미.
