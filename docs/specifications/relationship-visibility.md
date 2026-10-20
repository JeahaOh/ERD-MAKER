# 다이어그램별 관계 표시

- 화면: `모델 관리 → 관계 표시·숨김`. 특정 다이어그램을 선택한 상태에서 사용한다.
- 명령: `setRelationshipVisibility({ diagramUuid, foreignKeyUuid, visible })`.
- 저장 위치: 코어 `Diagram.filteredRelations`의 `Relation` 참조 목록이다. 외래키 그룹·제약·컬럼 대응을 삭제하거나 수정하지 않는다.

## 동작

- 해당 다이어그램에 부모·자식 테이블이 모두 배치된 관계를 목록에 표시한다.
- 숨김은 해당 `Relation` 참조를 추가하고, 표시는 해당 참조를 제거한다. 반복 숨김으로 참조를 중복 추가하지 않는다.
- Worker의 성공 응답 후 체크 상태와 관계선을 갱신한다. 처리 중에는 항목을 비활성화한다.
- 다이어그램 복제는 표시 설정도 복제하지만 동일 외래키 정의를 계속 참조한다.
- 관계를 실제 삭제하면 다른 다이어그램의 숨김 참조도 정리한다.
- 전체 모델 화면과 SQL·정의서는 전체 관계 정의를 유지한다. 개별 다이어그램 화면과 SVG/PNG는 해당 다이어그램의 숨김 설정을 반영한다.

`NativeDocumentView.diagrams[].hiddenRelationUuids`는 화면에서 사용하기 위한 표시 정보다. UUID가 없는 원본 `Relation`은 현재 그래프의 `binary:<id>` 식별자를 사용한다. 저장은 이 문자열이 아닌 실제 바이너리 객체 참조로 수행한다.

## 검증

- `exerd-mutations-extended.test.ts`: 전체 그래프 비교에서 `Diagram.filteredRelations` 한 곳만 변경, 생성 SQL 동일, 두 표현 저장·재열기, 원본 입력 불변, 복제 후 독립 설정, 삭제 시 참조 정리.
- 같은 시험에서 native 문서와 화면 투영을 전달한 SVG 모두 숨긴 관계선을 제외하는 것을 확인한다.
- `relationship-visibility.spec.ts`: 실제 브라우저의 숨김·Undo/Redo·파일 다운로드 재해석·SQL의 외래키 보존 확인.
- 독립 2테이블·1FK 숨김 모델은 원본 바이너리 reader·XML reader에서 각각 오류 0개로 복원했다. 원본 writer로 다시 저장한 파일을 앱에서 읽어도 표시 관계 0개·정의 관계 1개·생성 SQL 동일을 확인했다. 전체 비교의 원문 차이는 배치 좌표 2곳의 `Point(정수)` → `Point(소수 .0)` 표기이며 수치는 동일하다. 원문 차이를 지우거나 GUI 조작 검증으로 보고하지 않는다. 근거는 `.analysis/visibility-probe/`의 입력·원본 재저장본·`original-readback.json`이다.

원본 메타모델 근거는 `schema.generated.json`의 코어 `Diagram.filteredRelations`: `EOBJECT_LIST`, `type:#//Relation`, non-containment, persistent다. 원본 GUI의 수동 조작·선 경로·다양한 표시 옵션 전체를 복제한 것은 아니다.
