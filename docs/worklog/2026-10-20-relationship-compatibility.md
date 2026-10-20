# 관계 편집본의 원본 왕복 호환성

기준일: 2026-10-20. 앞선 관계 편집 E2E가 다운로드한 독립 2테이블·4컬럼·1FK 모델을 검증했다. 사용자 제공 대형 모델 전체나 eXERD 전체 기능의 동등성 검사로 확대하지 않는다.

## 확인 결과

| 항목 | 결과 |
| --- | --- |
| 원본 GUI 파일 인식기 | 모델 버전·PostgreSQL 제품 식별 수용 |
| 원본 바이너리 reader | 58객체, 오류 0 |
| 원본 XML reader | 58객체, 오류 0 |
| 두 표현의 원본 그래프 비교 | 저장 속성 차이 0 |
| 원본 writer 저장 → 원본 reader | 58객체, 저장 속성 차이 0 |
| 원본 writer 저장 → 앱 역판독 | 관계 속성·FK 그룹/제약 UUID·대응/PK 구성 UUID·SQL 동일 |
| 앱 원문 그래프 비교 | 좌표 2곳의 `Point(정수)` → `Point(소수 .0)` 표기 차이, 숫자는 동일. 다른 차이 0 |
| 새 검사 도구의 실패 판정 | 카디널리티를 의도적으로 바꾼 파일에서 SQL이 같아도 차이 1건 감지·실패 처리 |
| 원본 GUI 화면 재열기 | 미검증. 아래 실행 환경 문제 참조 |

보존 항목에는 부모 고유키·자식 컬럼 대응·그룹명과 제약명 분리·식별 해제 상태·자식 복합 PK·카디널리티·`useIndexing`·`onDeleteRule=CASCADE`·`deferrable`이 포함된다. 원본 reader가 해석한 저장 속성과 앱 재읽기 결과를 검사했으며 파생 속성·외부 사전·DB 실행 동등성을 의미하지 않는다.

## 재현 명령

첫 저장 명령은 새 출력 경로가 필요하다. 기존 결과 파일 덮어쓰기는 거부한다. 실행 JAR은 분석 전용 경로에서만 사용하며 앱에 포함하지 않는다.

```sh
python3 app/scripts/compatibility/original_oracle.py \
  .analysis/compatibility/browser-relationship-edited.exerd --describe \
  --save .analysis/NEW_RUN/original-resaved.exerd

python3 app/scripts/compatibility/original_oracle.py \
  .analysis/compatibility/browser-relationship-edited.exerd --xml

python3 app/scripts/compatibility/original_oracle.py \
  .analysis/NEW_RUN/original-resaved.exerd --describe

PATH=/Users/zeaha/.nvm/versions/node/v24.18.0/bin:$PATH \
  node_modules/.bin/vite-node app/scripts/compatibility/relationship-readback.ts \
  .analysis/compatibility/browser-relationship-edited.exerd \
  .analysis/NEW_RUN/original-resaved.exerd .analysis/NEW_RUN/app-readback.json
```

- 실행 결과 위치: `.analysis/relationship-compatibility-20261020/`.
- `binary-xml-comparison.json`, `original-save-comparison.json`: 원본 reader의 그래프 비교.
- `app-readback.json`: 앱의 원문 차이·좌표 수치 확인·관계·구성 UUID·SQL 대조.
- `intentional-change-report.json`: 의도적 카디널리티 변경에 대한 예상 실패 보고서. 정상 결과와 합산하지 않는다.
- `evidence.json`: 입력·소스·보고서 해시와 범위.
- `original-reader-evidence/`: 원본 reader/writer 실행의 그래프·로그·보고서 사본.

## 검증 도구 보완

- `relationship-readback.ts`를 추가했다. 새 `.analysis` 보고서만 생성하며 원문 전체 비교에서 실제 수치가 같은 `TableDiagram.location`의 표기 차이만 허용한다. 관계·UUID·SQL 중 하나라도 달라지면 실패한다. 객체 ID 재번호에 따라 달라지는 임시 `binary:<id>` 관계 locator는 영구 UUID와 구분한다.
- `prepare_original_ui.py`에 `--output`·`--plugins` 옵션을 추가했다. `--output`은 `.analysis` 아래 새 디렉터리만 허용하며 기존 설정/작업공간을 보존한다. 호스트 필수 번들은 각각 1개인지 사전 검사하고 Maven 의존성은 기존 분석 캐시를 재사용한다.
- Python 구문 검사 통과. REF 출력 경로·기존 출력 경로·없는 호스트 경로의 거부 3건을 확인했다.
- 새 TypeScript 도구의 strict 타입 검사와 실제 원본 왕복 성공/의도적 변경 실패를 확인했다.
- 이후 전체 단위검사 21파일 225개 통과(10.96초), TypeScript/Vite 빌드 통과. 제품 UI/엔진은 변경하지 않아 Chrome E2E는 앞선 동일 소스의 13개 통과(41.7초) 결과를 유지하며 이번 후속 단계에서 다시 실행하지 않았다.

## 원본 GUI 실행 환경 문제

- 기존 기록은 Eclipse launcher `1.7.100.v20251111-0406`·OSGi `3.24.200.v20260515-1403`를 참조하지만 현재 설치본에는 launcher `1.8.0.v20260804-1928`·OSGi `3.24.300.v20260721-1251`이 있다. 기존 OSGi 참조 경로는 존재하지 않는다.
- 고정된 옛 실행 명령은 종료 코드 254/1로 실패했다. 실제 Java 경로로 바꾼 실행에서도 Cocoa 주 스레드 옵션 경고를 관찰했다. 이 경고만을 유일한 원인으로 결론 내리지 않는다.
- 새 디렉터리 `ui/`에 현재 호스트를 참조하는 249번들 설정과 빈 검증 작업공간을 준비했다. 기존 분석 캐시의 공식 의존성 4개를 재사용했으며 새 외부 다운로드는 없었다.
- 새 작업공간 실행은 종료 코드 0으로 끝났지만 창에서 해당 모델을 열지 못했다. `.metadata/.log`에는 `org.eclipse.ui.intro`와 SLF4J 서비스 제공자 관련 번들 미해결 오류가 기록됐다. 프로세스 종료 코드를 GUI 수용 성공으로 처리하지 않는다.
- 이번 파일을 원본 화면에서 열거나 GUI로 재저장한 성공 증거는 없다. 호스트 의존성 복구와 모델 화면 검증은 남은 작업이다. 원본 JAR·설치 앱·라이선스·인증 설정은 수정하지 않았다.

기존 소스 변경을 되돌리거나 새 작업자를 만들지 않았다. commit/push·배포·패키지 갱신·삭제·인증 변경은 수행하지 않았다. 이번 후속 작업으로 전체 제품 완료를 선언하지 않는다.
