# DESIGN-TOOLS.md

이 문서는 [Awesome-Design-Tools](https://github.com/goabstract/Awesome-Design-Tools) 목록에서 **이 프로젝트(TicketOpenChecker — 한국 티켓 오픈 캘린더 PWA)** 에 실제로 도움이 되는 도구만 골라 정리한 큐레이션입니다. 각 항목은 URL과 "이 프로젝트에 어떻게 적용되는지" 한 줄 메모를 포함합니다.

> 출처 크레딧: 모든 도구 목록의 원 출처는 [goabstract/Awesome-Design-Tools](https://github.com/goabstract/Awesome-Design-Tools) (커뮤니티 큐레이션) 입니다.

---

## Icons (아이콘)

- **Feather Icons** — https://feathericons.com
  - 현재 툴바 아이콘(grid, list, moon, chevron-left/right, refresh-cw, x)에 실제 적용됨. MIT 라이선스, 24x24 stroke 아이콘을 인라인 SVG로 삽입해 오프라인/PWA 안전하게 사용.
- **Material Design Icons** — https://materialdesignicons.com
  - Feather에 없는 도메인 아이콘(예: 좌석/공연/알림)이 필요할 때 동일한 stroke 스타일로 보강 가능.
- **Font Awesome** — https://fontawesome.com
  - 브랜드/소셜 아이콘(공유 버튼 등)이 필요할 경우 후보. 단, CDN 대신 필요한 SVG만 인라인으로 뽑아 쓰는 것을 권장.

## Fonts (폰트)

- **Google Fonts** — https://fonts.google.com
  - 본문/숫자용 웹폰트 탐색. 캘린더 날짜 숫자 가독성을 위한 tabular-figure 폰트 선정에 활용.
- **Font Pair** — https://fontpair.co
  - 제목(Pretendard)과 본문 조합 등 폰트 페어링 아이디어 참고.
- **google-webfonts-helper** — https://gwfh.mranftl.com
  - Pretendard/Inter를 self-host 형태로 내려받아 CDN 지연을 제거(PWA 오프라인 캐싱과도 잘 맞음).

## Color (색상)

- **Coolors** — https://coolors.co
  - 라이트/다크 테마 토큰 팔레트 확장·조정 시 색 조합 실험.
- **Color Hunt** — https://colorhunt.co
  - 액센트/상태 색(대기/오픈/마감) 팔레트 영감.
- **Accessible Color Matrix** — https://toolness.github.io/accessible-color-matrix/
  - interpark/melon/ticketlink 브랜드 색이 배경 대비 WCAG AA를 만족하는지 매트릭스로 검증.

## CSS / Gradient / Animation

- **CSS Gradient** — https://cssgradient.io
  - 현재 캔버스 배경의 radial-gradient를 시각적으로 조정/생성.
- **GSAP** — https://greensock.com
  - 뷰 전환·모달 등장 등 섬세한 마이크로 인터랙션이 필요할 때(현재는 CSS transition으로 충분).
- **Lottie** — https://airbnb.io/lottie
  - "시간 미정 없음" 등 빈 상태(empty-state) 일러스트 애니메이션에 활용 가능.

## Accessibility (접근성)

- **WAVE** — https://wave.webaim.org
  - 배포된 페이지의 대비/ARIA/랜드마크 문제를 브라우저에서 즉시 점검.
- **axe** — https://www.deque.com/axe
  - 개발/CI 단계에서 자동 접근성 규칙 검사.
- **Pa11y** — https://pa11y.org
  - CI에서 캘린더 그리드(role/aria-pressed 등)를 자동 검증하는 파이프라인 구성.

## Design Systems (디자인 시스템)

- **Storybook** — https://storybook.js.org
  - 버튼/뱃지/캘린더 셀 등 UI 컴포넌트를 격리 문서화·회귀 확인.
- **Catalog** — https://www.catalog.style
  - 디자인 토큰(색/타이포/간격)과 컴포넌트를 한 페이지 리빙 스타일가이드로 정리.
