# 전체 기능 명세와 요구 추적표

- 기준일: 2026-10-15. 기준 배포물: 사용자 제공 eXERD `3.3.56.20260820-1610`.
- 최종 범위: [제품 재구현 계획](../plans/product-reimplementation-plan.md)의 R01~R10, F01~F24, A01~A19, G0~G6 전체. 읽기 전용 뷰어로 범위를 축소하지 않는다.
- 이 문서는 **정적 조사로 확인한 기능과 구현 계약**이다. 원본 UI 조작·원본 재열기·DB 실행은 별도 증거이며 미검증이다.
- 조사 착수 시 초안: XML 일부를 제한된 모델에 매핑하는 가져오기 코드였다. 이 초안을 전체 의미 보존·독립 바이너리 writer·완성된 편집 UI의 증거로 사용할 수 없다. 이후 병행 구현 상태는 별도 실행 보고서가 정본이다.
- 추출 재현: `python3 app/scripts/references/catalog-model.py`. [카탈로그 요약](../research/evidence/model-catalog-summary.json): 현행 Ecore 30개, 클래스 292개, 직접 선언 속성 1,194개, 한국어 목차 항목 252개, 등록 command 107개. 이는 작업량이나 완료율이 아니다.

현재 구현·검증 상태는 [상태 보고](../status.md)를 따른다. F05.2는 [FK 옵션](foreign-key-options.md), F15.1~3은 [용어사전](term-dictionary.md)에 현재 동작·검증·남은 경계를 기록했다. 정적 존재 근거를 실행 완료로 집계하지 않는다.

## 근거 위치

아래 약칭의 루트는 `.analysis/ref/3.3.56/`이며 분석 전용·Git 제외다. 배포물 원문을 제품 소스에 복사하지 않는다.

| 약칭 | 정확한 원문 경로 |
|---|---|
| M | `com.tomato.exerd.model_3.3.56.20260820-1610/model/exerd.ecore` |
| H1 | `com.tomato.exerd.help_3.3.56.20260820-1610/nl/ko/toc/tocgettingstarted.xml` |
| H2 | `com.tomato.exerd.help_3.3.56.20260820-1610/nl/ko/toc/tocfeatures.xml` |
| H3 | `com.tomato.exerd.help_3.3.56.20260820-1610/nl/ko/toc/dbmsSpecific.xml` |
| T | `com.tomato.exerd.term.model_3.3.56.20260820-1610/model/termModel.ecore` |
| P | `com.tomato.exerd.core_3.3.56.20260820-1610/plugin.xml` |
| E | `com.tomato.exerd.erwin_3.3.56.20260820-1610/plugin.xml` |
| V | `com.tomato.exerd.validator_3.3.56.20260820-1610/plugin.xml` |
| D | `com.tomato.exerd.diff_3.3.56.20260820-1610/plugin.xml` |

목차에 명시된 기능은 존재 근거다. 메뉴의 실제 활성 조건·기본값·예외·출력 정확도까지 확인했다는 뜻은 아니다. 도움말 HTML 본문은 이번 카탈로그 수집 대상에 없으므로 본문 미열람 항목을 읽은 것으로 기록하지 않는다.

## 세부 기능 계약

모든 편집은 대상 ID·명령·전후값·참조 영향·Undo/Redo·저장 후 재열기를 한 단위로 검증한다. 표의 기능은 최종 구현 요구이며, 정적 근거가 약한 항목은 별도 표시했다.

| ID | 세부 기능·입력과 출력 | 예외·보존 조건 | 존재 근거 | 시험 / 관문 |
|---|---|---|---|---|
| F01.1 | 헤더·버전·XML/바이너리 구간 읽기·쓰기 | 길이·CRC·잔여 바이트 검사, 손상 입력 거부 | 실파일·`ErdResourceImpl` 정적 추적 | A02,A14 / G1 |
| F01.2 | 양쪽 표현을 동일 편집 상태로 재직렬화 | XML만 수정하고 이전 바이너리 유지 금지 | 같은 정적 추적 | A03~A11 / G1 |
| F01.3 | 모델 형식·저장 앱 버전 구분, migration | 문자열 변경만으로 하위 호환 주장 금지 | M, `model/history/` | A02,A10,A11 / G1,G2 |
| F02.1 | UUID 기반 객체·교차 참조·순서 보존 | 이름 중복과 외부 href를 구분 | M:UUIDOwner, 실파일 | A01,A02,A14 / G1,G2 |
| F02.2 | 사용자 속성·확장 속성·임시 객체 처리 | `userDefiendProperty` 원문 철자 유지; transient는 저장 여부 분리 | M:ExerdModel | A02,A10 / G2 |
| F02.3 | 미해석 네임스페이스·속성·종류 보고 | 저장 영향 미확인 시 경고/거부; 조용한 누락 금지 | R10 요구 | A01,A14 / G2 |
| F03.1 | 문서 DB 정체성·버전·모델 종류 편집 | 모르는 DB를 PostgreSQL로 대체 금지 | M:Document | A01,A03,A11 / G2,G3 |
| F03.2 | 스키마·테이블·컬럼 논리/물리명·주석 편집 | 유도명과 명시값 구분, 동일명 충돌 진단 | M:NameOwner, H1:속성 | A03,A04 / G3 |
| F03.3 | 컬럼 타입·기본값·NULL·순서 편집 | `BooleanEnum`을 단순 boolean으로 축소 금지 | M:Column | A04,A06 / G3 |
| F03.4 | 뷰·함수·프로시저·트리거 정의문 편집 | 부모 소유와 DB별 위치 보존 | M:View/Function/Procedure/Trigger, H3 | A03,A07,A12 / G3,G4 |
| F04.1 | 단일·복합 PK/대체키 생성·재정렬 | membership와 constraint를 구분 | M:ColumnGroup, memberships | A04,A05 / G3 |
| F04.2 | FK 부모키·부모/자식 컬럼 대응 편집 | `entryIndex`·참조 방향·공유키 보존 | M:ForeignKeyColumnGroup/ColumnReference | A05 / G3 |
| F04.3 | 일반 인덱스·정렬 방향·DB별 포함 컬럼 | 키·인덱스·고유제약을 같은 것으로 합치지 않음 | M:InversionEntryColumnGroup/IndexableMembership, DB Ecore | A05,A07,A12 / G3,G4 |
| F05.1 | CHECK 표현식·고유제약·제약명 편집 | 표현식 원문·대소문자·따옴표 보존 | M:CheckConstraint/UniqueConstraint | A07 / G3 |
| F05.2 | FK delete/update·지연·검증 상태 편집 | DB별 가능 조합 검사 | DB Ecore, H3 | A07,A12 / G4 |
| F05.3 | 스토리지·파티션·테이블스페이스·DB 고유 객체 | 미인스턴스 속성도 지원 조사 대상 | DB Ecore, H3 | A07,A12 / G4 |
| F06.1 | 도메인 계층·타입·기본값·NULL 제안 | 상속값·명시 컬럼값의 우선순위 원본 실험 필요 | M:Domain/DomainContainer | A06 / G2,G3 |
| F06.2 | 도메인 연결·해제·일괄 적용·교환 | 공유 참조·예외 컬럼 유지 | H1:도메인뷰,H2:공유 작업 | A06 / G3 |
| F06.3 | 용어사전 연결 경로와 DB별 도메인 확장 | 외부 사전 누락을 빈 사전으로 덮지 않음 | M:Configuration.termFilePath, SQLServer DomainProperties | A06,A14 / G3,G4 |
| F07.1 | 업무영역·다이어그램 생성/복제/이동 | 의미 테이블과 배치 객체 분리 | M:BusinessArea/Diagram | A08,A11 / G2,G3 |
| F07.2 | 동일 테이블 복수 배치·참조표시 | 배치 삭제와 테이블 삭제 구분 | M:TableDiagram.ref, 실파일615배치 | A08 / G2,G3 |
| F07.3 | 활성 영역/스키마·열린 다이어그램 복원 | 삭제된 활성객체의 대체 정책 표시 | M:Document | A08,A15 / G3 |
| F08.1 | 좌표·테마·컬럼필터·노트/말풍선 편집 | 노트 target·색·수동 크기 유지 | M:DiagramEntry/TableDiagram/Note, H2 | A08,A09 / G3 |
| F08.2 | 표시 프리셋·셀 종류·헤더·주석·컬럼수 | 전역 preset과 다이어그램 override 구분 | M:ViewSettings, H2:다이어그램 편집기 설정 | A09 / G3 |
| F08.3 | 아이콘 공유·내장/외부 이미지·컬럼 색 태그 | 이미지 해석 실패 시 원본 값 보존 | M:SharedIcons/Icon/Column.tagColor, H2 | A09 / G3 |
| F08.4 | 관계 숨김·선 경로 수동 편집·표기 설정 | filteredRelations는 참조; 경로 영속 필드는 추가 추적 필요 | M:Diagram.filteredRelations, H2 | A08,A09 / G3 |
| F08.5 | 용지·방향·배율·여백·머리말/꼬리말 | `footter` 원문 철자 유지, 단위 실험 필요 | M:PrintSettings, H2:인쇄 | A09,A19 / G5 |
| F09.1 | 열기·저장·다른 이름 저장·충돌 탐지 | 원본 보호, 임시 기록 검증 후 교체 | R02~R05, H1:새파일 | A02,A10,A15 / G1,G2 |
| F09.2 | 명령 단위 Undo/Redo·자동저장·복구 | 취소/실패가 반쪽 변경을 남기지 않음 | 제품 요구; 원본 세부 정책 미확인 | A04,A15 / G2,G3 |
| F10.1 | 테이블/컬럼/관계/키/도메인 CRUD | 참조 의존성 미리보기·삭제 범위 표시 | H1:다이어그램 작성/속성 | A03~A07,A11 / G3 |
| F10.2 | DDL 객체·DB별 고유객체 CRUD | 물리 모델과 정의문 일관성 | H3, DB Ecore | A07,A12 / G4 |
| F11.1 | 식별·비식별·부모/자식 차수 편집 | 관계 표시와 PK/FK·NULL 의미 대조 | M:Relation/CardinalityType, H1 | A05 / G3 |
| F11.2 | 논리/물리 통합·모드 전환·명칭 표시 | 모드 전환으로 명시값 삭제 금지 | M:ModelType/InteractionMode, H1 | A03,A09 / G3 |
| F12.1 | 선택·다중선택·정렬·간격·복제 | clone UUID 재발급, 참조 재연결 | H2:자동배치/정렬/복사붙여넣기 | A04,A08 / G3 |
| F12.2 | 영역 간 복사/붙여넣기·다이어그램 이동 | 같은 모델 배치 추가와 독립 객체 복제 구분 | M:Clip, H2 | A08 / G3 |
| F13.1 | 자동 배치·테이블 겹침 회피·관계선 경로 | 잠금 위치·수동 경로 유지, 취소 가능 | H2:autoAlocation | A08,A09 / G3 |
| F13.2 | 대형 그래프 배치 성능·결과 품질 | 동일 seed 재현, 선 교차/겹침 수 별도 측정 | 계획 성능 요구 | A01,A08 / G3,G6 |
| F14.1 | 모델/도메인/팔레트/썸네일 탐색 | 선택동기화·객체 위치 이동 | H1:에디터와 뷰 | A01,A08 / G3 |
| F14.2 | 찾기·전체 모델 검색·조건 필터 | 이름/주석/타입 범위·한글검색 명시 | H2:find/search, search Ecore | A01 / G3 |
| F14.3 | 단축키·컨텐트 어시스트·솔루션 대화상자 | IME·OS command/control 구분 | H2:userConvenience | A16 / G3,G6 |
| F15.1 | 용어/약어/동의어/태그 사전 편집 | 논리/물리 사전값·구분자·외부연결 보존 | T, H2:terms | A06 / G3 |
| F15.2 | 물리명 제안·명명정책 검사·일괄적용 | 미리보기·충돌·전체 Undo | H2:assist/validating/apply-term-policy | A06 / G3 |
| F15.3 | 사전 역공학·Excel 교환 | 형식/시트/인코딩/중복 처리 실험 필요 | H2:apply-term-reverse/excelImpEmp | A06,A19 / G3,G5 |
| F16.1 | 모델/DB별 검사·위치이동·선택수정 | 심각도·규칙ID·対象객체·근거를 반환 | H2:modelValidator, V | A07,A12 / G3,G4 |
| F16.2 | 검사기 설정·억제·일괄수정 | 무시를 성공으로 집계하지 않음 | H2:config_validator/additional_options | A07 / G3 |
| F17.1 | 8DB DDL 생성·옵션·선택 객체·순서 | 생성SQL과DB readback 구분 | H1:forward,H3 | A12 / G4 |
| F17.2 | DB연결·드라이버·스키마 선택·역공학 | 연결취소·권한·오류·인코딩 처리 | H1:reverse/jdbc,H3 | A12 / G4 |
| F17.3 | SQL 입력 파싱·모델 생성 | 계획요구; 원본 SQL 가져오기 범위 별도 조사 | F17 요구 | A12 / G4 |
| F18.1 | 파일/이전버전/DB 비교·전략·뷰어 | UUID/이름기반 identity·rename 판정 명시 | H2:compare,D | A13 / G4 |
| F18.2 | 선택 병합·의존순 변경SQL·보고서 | 삭제/추가 오판·미선택 객체 변경 금지 | 계획요구 + H2:compare-report | A13 / G4,G5 |
| F19.1 | 모델/테이블정보·템플릿 산출물 | 지원 포맷·DB속성·한글·페이지 검증 | H2:modelExport/export/model | A19 / G5 |
| F19.2 | SVG/PNG/PDF·HTML/XML/CSV·정의서·인쇄 | 계획 전체 출력 형식; 원본 세부 포맷은 추가 조사 | H2:문서활용/인쇄 + 계획요구 | A09,A19 / G5 |
| F20.1 | ERwin XML 가져오기·손실 보고 | 이진 .erwin 지원으로 확대 주장 금지 | E:command.name=ERwin XML,H1,H2 | A19 / G5 |
| F20.2 | ERwin 버전·DB별 변형 fixture | 실제 지원 버전/인코딩 미확인 | H2/Hfaq 존재만 확인 | A19 / G5 |
| F21.1 | XScript 파일/편집/정의스크립트/뷰 | 원본 JS API 호환 수준 별도 정의 | H2:xscript | A18 / G5 |
| F21.2 | 모델탐색·속성변경·진행/취소·파일출력 | 샌드박스·허용경로·트랜잭션·Undo | H2:XScript API | A18 / G5 |
| F22.1 | 변경기록·스냅샷·이전버전 비교·복구 | 참조/형식 migration 손실 회귀 | H2:compare-revision + 계획요구 | A10,A15 / G2,G5 |
| F23.1 | 테마·글꼴·고해상도·한글IME | 측정된 화면/키보드 시나리오 필요 | H2:themaAndTag/preferences + 계획요구 | A16 / G6 |
| F23.2 | 키보드 접근·읽기순서·확대·포커스 | 접근성은 추가 제품 요구, 원본동등만으로 생략 금지 | 계획요구 | A16 / G6 |
| F24.1 | 4 desktop CPU/OS·8 browser 조합 배포 | 실제 실행·설치·업데이트·서명 독립 검증 | 계획요구 | A16 / G6 |
| F24.2 | 로컬 무계정·활성화없음·오프라인 재실행 | 첫설치/빈설정/네트워크차단 편집·저장 | R08 | A17 / G6 |

## 요구·수용 시험 연결

| 요구 | 기능 | 수용 시험 | 완료 근거 |
|---|---|---|---|
| R01 | F01~F08,F14 | A01 | 실파일 모든 객체·속성·참조·38다이어그램 객체별 비교 |
| R02 | F01,F02,F09 | A02,A14 | 재직렬화 의미차이0 + 원본 실제 열기 |
| R03 | F03~F13,F15,F16 | A03~A09 | 명령별 기대차이만 발생, 원본 표시/값 대조 |
| R04 | F01,F02,F09,F22 | A10 | 원본↔신규앱 10회 교차 저장 diff |
| R05 | F01,F03~F08,F10 | A11 | 원본 사본 없이 신규문서 생성·원본 재열기 |
| R06 | F03~F23 | A03~A13,A18,A19 | 모든 세부 기능 상태별 수용 |
| R07 | F01,F09,F17,F23,F24 | A16 | OS/browser 교차 파일의 의미 동일 |
| R08 | F09,F24 | A17 | 빈환경·오프라인 로컬 편집·저장 |
| R09 | F09,F13,F14,F22 | A01,A15,A16 | 시간·메모리·복구·1시간 편집 실측 |
| R10 | F01,F02,F17,F20 | A01,A14,A19 | 지원차이/알수없는값 명시와 저장보호 |

## 관문 판정과 남은 조사

| 관문 | 범위 | 지금 증명된 내용 | 추가로 필요한 근거 |
|---|---|---|---|
| G0 | 전체 기능·환경·실험 명세 | 도움말/메타모델/등록명령 관측·추적표 | 원본 실행환경 확보·메뉴 활성조건·본문 세부동작 확인 |
| G1 | F01,F02, 신규모델 | XML/바이너리 둘다 필요하다는 정적 경로 | 독립writer·신규/수정 실파일 원본 재열기 |
| G2 | 전체 모델·영속화·명령 | 객체/참조/확장/배치 계약 조사 | 모든값 보존·복구·교대저장10회 |
| G3 | F03~F16 | 본문 세부 계약·실험 항목 | 실제 UI 편집·명령·성능 비교 |
| G4 | F17,F18 및 DB고유 기능 | 8DB 메타모델·목차 존재 | 실제 DB버전·드라이버·DDL·역공학·병합 검증 |
| G5 | F19~F23,전체회귀 | XScript/ERwin XML/출력 기능 존재 | 형식별 파일·API·취소·인쇄 결과 |
| G6 | R01~R10,F01~F24 | 목표 플랫폼/성능/오프라인 명세 | 각 플랫폼 설치·실행·서명·사용자 수용 |

- **일반판 기준 확정:** 모델·다이어그램·도메인·사전·비교·DDL·역공학·ERwin XML·스크립트·출력.
- **SAM 구분:** 제공 일반판 목차/명령 카탈로그만으로 SAM 서버·계정·공유 저장소·다중사용자 잠금 지원을 확정할 수 없다. 협업은 별도 조사 영역이며 로컬 편집의 로그인 선행조건으로 도입하지 않는다.
- **삭제된 기능:** H2 XML 주석의 `공유 작업/모델 가져오기`는 “배포 되었다가 삭제”로 명시됐다. 현행 기본 기능 존재 근거로 쓰지 않는다. 현재 `도메인 가져오기/내보내기`와 혼동하지 않는다.
- **미확인:** 원본 메뉴별 전체 표시명/활성조건, relation line bendpoint 저장 위치, 도메인 유도 우선순위, 외부사전 경로기준, ERwin 지원버전, SQL import의 원본동등범위, 각 DB지원버전, 과거리비전 저장원천.
- 기준 미확인 항목은 삭제하지 않고 [원본 실험표](original-behavior-experiments.md)에서 차례로 판정한다.
