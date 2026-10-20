# eXERD 배포물 정적 분석

- 조사일: 2026-10-15. 사용자 제공 `REF/` 원본 3개를 읽기만 했다.
- 근거: `docs/research/evidence/reference-inventory.json`에 원본·내부 JAR·샘플·압축 해제한 XML SHA-256, 크기, 정확한 아카이브 경로를 기록했다.
- 재실행: `python3 app/scripts/references/inventory.py`. 선택한 리소스와 샘플은 Git 제외 대상 `.analysis/ref/`에 생성한다. 원본 배포물을 제품의 `public/`에 포함하지 않는다.
- 현재 분석은 ZIP/JAR 메타데이터, Eclipse 등록 XML, EMF(Eclipse 모델 표현 규격) 스키마, 한국어 도움말 목차, 동봉 샘플의 파일 구조에 근거한다. 원본 Java 구현 코드를 제품 코드에 복사하지 않았다.
- Windows 설치 프로그램 실행, eXERD 런타임 조작, 원본 DB 연결, eXERD로 재저장한 파일과의 비교는 하지 않았다. 정적 분석의 관측 결과가 원본 프로그램의 모든 동작을 증명하지는 않는다.

## 원본과 버전

| 파일 | 바이트 | SHA-256 | 관측 결과 |
|---|---:|---|---|
| `REF/eXERD_Installer_v3.3.56.20260820-1610_x64.exe` | 412,784,128 | `61fad0efec6125d333524d967c318cc9b94a566b0d06c9d25b1af3ddf7853a0a` | MZ 실행 파일. 실행하지 않음 |
| `REF/updateSite.zip` | 165,814,869 | `daedb252b7e4644e7484dd9d1d22d93083c71fc61c63142c8b811d3a9906841d` | 3.3.56.20260820-1610, ZIP 멤버 56, 내부 JAR 54 |
| `REF/updateSite (1).zip` | 123,025,418 | `9262e03d7ca17b9c365164cd6f235a8751e78f1a1fd6bc7b7342f85d806d9156` | 2.5.17.20220110-1118, ZIP 멤버 44, 내부 JAR 42 |

- 3.3.56 내부 `.class` 10,834개, 2.5.17 내부 `.class` 6,971개. 제3자 라이브러리를 포함한 배포물 전체 수치이며 제품 자체 구현 규모와 같지 않다.
- 3.3.56에는 2.5.17 대비 CUBRID 플러그인 2개, MariaDB 플러그인, Guava·Guice, Tomato Draw2D·GEF, Eclipse databinding·Xtend·Xbase 라이브러리 등이 추가됐다. JAR 식별자 기준 12개 추가, 제거 없음. 파일 등록 여부와 기능 차이의 전체 검증을 구분해야 한다.
- `plugins/com.tomato.exerd.model_3.3.56.20260820-1610.jar!/model/exerd.ecore` 및 `model/history/`에는 모델 형식 마이그레이션의 버전 이력이 있다. 모든 과거 형식의 호환성은 아직 구현하지 않았다.

## 기능 카탈로그와 관측 근거

경로 앞의 `help.jar`는 해당 버전의 `plugins/com.tomato.exerd.help_<version>.jar`를 뜻한다. `core.jar`, `model.jar`도 같은 규칙이다.

| 기능군 | 확인한 리소스 | 제품 구현 시 검증할 행동 |
|---|---|---|
| 논리/물리 모델 편집 | `model.jar!/model/exerd.ecore`, `help.jar!/nl/ko/toc/tocgettingstarted.xml` | 테이블·컬럼·PK·FK·논리명/물리명·스키마·주석 편집 및 저장 |
| 업무영역·다중 다이어그램 | 같은 모델 스키마의 `BusinessArea`, `Diagram`, `TableDiagram`; 실제 POS XML | 하나의 테이블을 여러 영역/다이어그램에 배치하고 각 좌표 보존 |
| 속성·DBMS 확장 | `com.tomato.exerd.product.*` JAR, DB별 `.ecore`; `help.jar!/nl/ko/toc/dbmsSpecific.xml` | Oracle, SQL Server, DB2, MySQL, PostgreSQL, Tibero, CUBRID, MariaDB 고유 속성 |
| DDL 생성 | `com.tomato.exerd.forward` 및 DB별 forward 플러그인; gettingstarted 목차 | PK/FK/인덱스/NULL/기본값/주석/DB별 옵션을 포함한 SQL 생성 |
| DB 역공학 | `com.tomato.exerd.reverse` 및 DB별 reverse mapper 리소스; gettingstarted 목차 | 실제 DB 메타데이터로 모델 생성, 연결 권한과 데이터 접근 범위 관리 |
| 표시 설정·테마 | `help.jar!/nl/ko/toc/tocfeatures.xml` | 논리/물리 동시 표시, 표시 프리셋, 테이블 헤더·컬럼 태그·테마 |
| 모델 검사 | 같은 features 목차의 `modelValidator` | 이름·자료형·관계·DB별 무결성 검사와 수정 위치 연결 |
| 자동 배치·정렬·검색 | 같은 features 목차의 `userConvenience` | 실제 그래프의 배치 품질, 관계선 겹침, 모델 검색, 키보드 조작 |
| 용어사전·도메인 | `com.tomato.exerd.term.*`, `model.jar!/model/termModel.ecore`, 실제 `.xdic` | 논리명-물리명 정책, 자동 제안, 용어사전 가져오기/내보내기, 도메인 자료형 |
| 모델 비교 | `com.tomato.exerd.diff`, features 목차의 `compare` | 파일/과거 버전/DB 비교, 비교 전략, HTML 보고서 |
| 외부 형식 | `com.tomato.exerd.erwin`, `com.tomato.exerd.export.model`, features 목차 | ERwin 가져오기 및 산출물 내보내기의 실제 지원 형식/정보 보존 |
| 스크립트 | `com.tomato.exerd.xscript`, features 목차의 `xscript` | 모델 탐색·속성 변경·일괄 실행·실행 취소·파일 출력의 확장 API |
| 인쇄·문서 활용 | features 목차의 `printing`, `inOtherDocuments` | 페이지 나눔, 방향/여백, 벡터/이미지 내보내기, 문서 산출물 |

도움말 목차의 항목은 기능의 존재를 조사하는 근거다. UI의 세부 동작·성능·예외 처리가 확인됐다는 뜻은 아니다. `공유 작업/모델 가져오기` 항목은 도움말 XML 주석에 “배포 되었다가 삭제 된 기능”으로 표시되어 있으므로 현행 기능으로 집계하지 않았다.

## 실제 `.exerd` 파일 형식

- 샘플 위치: 각 update-site ZIP의 `plugins/com.tomato.exerd.intro_<version>.jar!/nl/ko/examples/pos.zip!/pos.exerd`, `.../study.zip!/study.exerd`. 영어·일본어 변형도 있다.
- `public.zip`에는 `public.xdic`만 있고 `.exerd`는 없다. `.xdic`는 일반 UTF-8 XML 용어사전이다.
- `.exerd`의 첫 10바이트는 ASCII `eXERD File`.
- 뒤에는 big-endian 버전 정수 3개, qualifier 문자열의 바이트 길이와 문자열, 첫 ZIP 엔트리 길이가 기록된다. 관측한 3.0.0.20190111-1604 헤더 길이는 47바이트다.
- 이후 `xml-content.xml` ZIP local entry와 `binary-content` ZIP local entry가 이어진다. 압축 방법 8(raw DEFLATE), 데이터 서술자에 CRC-32·압축 크기·원본 크기가 있다. 관측 샘플에는 ZIP 중앙 디렉터리가 없으므로 일반 `zipfile.ZipFile`로 `.exerd` 자체를 열면 실패한다.
- 첫 XML은 XML 1.1 XMI, 루트 `{http://exerd.tomato.com/model}Document`. `UUID` 참조로 테이블·컬럼·컬럼 그룹·관계를 연결한다. 관계의 방향은 FK 컬럼의 `ColumnReference.parentColumn`과 `ForeignKeyColumnGroup.parentColumnGroup`으로 복원한다.
- 자료형은 컬럼 `dataType` 또는 연결된 도메인의 `suggestedDataType`에 있다. PK는 컬럼의 `memberships/value xsi:type="e:PrimaryKeyMembership"`에 기록된다. FK 컬럼 순서는 `entryIndex`다.
- 좌표는 `businessAreas/diagrams/diagramEntry location="Point(x, y)" table="UUID"`로 기록된다. 원본은 업무영역별 여러 다이어그램을 허용한다.
- `binary-content`의 의미와 모든 내부 자료는 조사하지 않았다. 제품 importer는 첫 XML만 매핑하며 원본 바이너리를 저장/재생성하지 않는다.

| 원본 버전 / 한국어 샘플 | 테이블 | 컬럼 | FK 그룹 | 샘플 SHA-256 |
|---|---:|---:|---:|---|
| 3.3.56 / POS | 9 | 42 | 8 | `a705795b3a3474a868b9b4801e6dafb7aad17d3afddc75059af69aa6b328fff0` |
| 2.5.17 / POS | 9 | 42 | 8 | `26cf3b13f8e2d2e2c75a5f97fa4302ec5991e00823246381f30293f6b8b3a0e9` |
| 양쪽 / STUDY | 14 | 41 | 16 | `d62540542f62250a7ed3d597a671951f18042e5756a7b205380fd7db9147c594` |

배포 버전과 동봉 샘플 내부 모델 버전은 다르다. 3.3.56 배포물의 STUDY XML은 `version="2.2.0.20121130-1853"`이며 POS XML은 `version="3.3.5.qualifier"`, `modelVersion="3.0.0.20190111-1604"`다. “3.3.56가 만든 모든 파일을 지원한다”고 확대 해석하면 안 된다.

## 이번 호환 구현의 계약과 한계

- `app/src/formats/exerd/import.ts`의 `importExerd(text)`는 추출 XML, `importExerdFile(bytes)`는 관측한 바이너리 컨테이너 또는 XML 파일을 받는다. 반환값은 `{ model, warnings }`, 실패는 예외다.
- 테이블/컬럼 ID·논리/물리명·스키마·주석·자료형·기본값·NULL·PK, 업무영역, 선택 다이어그램의 좌표, FK 방향·복합 FK 컬럼 대응·관계 식별 여부를 매핑한다. 대체 키와 일반 인덱스는 모델에 대응 가능한 속성만 가져온다.
- 파일 최대 64 MiB, XML 최대 32 MiB, DTD/사용자 정의 엔티티 거부, 바이너리 압축 방식/길이/CRC 검사. 임의 파일 전체의 보안 감사나 모든 악성 입력에 대한 보증은 아니다.
- 지원하지 않는 원본 DBMS는 PostgreSQL을 임시 지정하고 경고한다. 원본 타입 문자열을 유지하므로 해당 SQL을 그대로 실행해도 된다는 뜻이 아니다.
- DBMS 고유 물리 속성·삭제/갱신 참조 동작·CHECK·도메인 계층·외부 용어사전·다이어그램별 다중 좌표·메모·테마·관계선 경로·변경 이력을 보존하지 않는다. 경고를 UI에 노출하고 원본을 별도 보관해야 한다.
- `.exerd`로 다시 저장하는 기능, eXERD/ERwin과의 왕복 호환, 최신 eXERD에서 새로 생성한 파일, SQLite `.exerd` 원본, DB별 모든 확장 데이터는 미검증이다.
- `app/tests/unit/exerd.test.ts`는 독립 작성 XML fixture로 오류/참조/좌표 매핑을 검증하고, `REF`가 존재하면 실제 두 배포물의 언어별 POS/STUDY 샘플 및 압축 CRC 손상 사례를 직접 검증한다. REF가 없는 환경에서는 실제 샘플 검증이 skip됨을 구분해야 한다.
