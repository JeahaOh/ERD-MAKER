# ERD Maker 색상 규칙

정본 토큰은 `app/src/renderer/styles.css`의 첫 `:root`에 둔다. 새 화면은 임의의 HEX 색상을 추가하지 않고 아래 역할을 사용한다.

| 역할 | 토큰·값 | 적용 |
|---|---|---|
| 외곽·그래픽 | midnight `#1B262C`, canvas `#262626` | 모달 차폐·그림자·앱 외곽. 편집 캔버스에는 사용하지 않음 |
| 본문·헤더 | ink `#262626`, slate `#3A4A5A`, paper `#F9F9F9` | 본문은 paper/ink, 헤더는 slate/paper. ERD 편집 영역·목록·카드도 밝게 유지 |
| 메타 정보·구획 | muted `#565F64`, ice `#8B9FA8`, silver `#D4DCE0` | 설명·보조 문구는 muted, 입력 테두리는 ice, 구획은 silver |
| 행동·선택 | teal `#00A19B`, teal-strong `#007A76`, teal-soft `#E2F4F3` | 로고 마크, CTA, 현재 선택, 포커스. 작은 링크는 strong, 밝은 teal 배경의 글자는 ink |
| 공지·광고·시각 자료 | gold `#E2B858`, gold-strong `#8A6B25`, gold-soft `#F8F0DC` | 공지·광고·제휴·시각 자료에 제한. ERD 상태·경고·일반 메모에는 사용하지 않음 |
| 상태·경고·오류·삭제 | red `#C74B50`, red-strong `#96383C`, red-soft `#F6E7E8` | 경고·오류의 아이콘·테두리·배경, 삭제 동작. 작은 삭제 링크와 진한 삭제 버튼은 strong |

- 긴 설명·SQL·모델명은 ink 또는 muted로 표시한다. 경고 문단도 본문은 ink를 유지하고 아이콘·테두리·짧은 상태 표시에 red 계열을 쓴다. 처리 중 표시는 muted와 작은 teal 스피너로 표현한다.
- 로고 이외에서 PK·FK·테이블 종류 자체는 teal의 사용 이유가 아니다. 구조 아이콘은 slate, 선택된 항목만 teal 계열로 구분한다.
- 메모는 paper·silver·slate를 기본으로 한다. 선택할 때만 teal 테두리를 적용한다.
- hover·키보드 focus·disabled 상태를 유지한다. 헤더의 focus 테두리는 paper, 밝은 영역의 focus는 teal-strong이다.
- 그림자·차폐·옅은 구획 배경은 정본 토큰의 `color-mix`로만 만든다. 별도 색상 상수로 확장하지 않는다.
- React Flow의 선택 영역·리사이즈 핸들·연결 포트·확대 컨트롤도 `--xy-*` 토큰으로 연결한다. 라이브러리 기본 파란색을 그대로 노출하지 않는다.
- App의 SVG·그래프·미니맵 색상도 같은 역할을 사용해야 한다. 사용자 모델에 저장한 속성과 UI 팔레트는 구분한다.

대표 글자/배경 대비는 paper/slate **8.65:1**, ink/paper **14.37:1**, muted/paper **6.20:1**, ink/teal **4.74:1**, teal-strong/paper **4.93:1**, paper/red-strong **6.81:1**이다. gold-strong/gold-soft는 **4.39:1**이므로 해당 배경의 작은 글자는 ink를 사용한다. 이 수치는 해당 색상 쌍의 계산 결과이며 전체 화면의 접근성 검증을 대체하지 않는다.
