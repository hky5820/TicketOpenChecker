# TicketOpenChecker

Ticket opening calendar for NOL Ticket, Melon Ticket, and Ticketlink.

## Schedule workspace

- 공연·전시: 날짜와 예매처를 선택하고 오픈 시각순으로 확인합니다. 하루, 7일, 오늘부터 전체 일정과 검색을 함께 사용할 수 있습니다.
- 스포츠: LG 트윈스, 한화 이글스, 삼성 라이온즈, KT Wiz, KIA 타이거즈의 티켓링크 홈경기. 경기일과 티켓 오픈일을 따로 필터링하고 예매 중/오픈 예정을 구분합니다.
- 경기별 일반 예매 오픈과 선예매 시각은 별도 표시합니다. 일반 예매일 미정일 때 선예매일로 대체하지 않습니다.
- 예매 상태는 마지막 조회 기준입니다. 오픈 시간이 지난 이전 `BEFORE` 자료를 예매 중이라고 추정하지 않습니다. 잔여 좌석은 예매처에서 확인합니다.
- 내 알림: 기존 공연 알림을 유지하며 경기별 오픈 알림도 저장합니다. 푸시 서버 미연결 시 페이지가 열려 있어야 알림이 동작합니다.

스포츠 조회는 `mycode/providers/ticketlink`의 조회 방식을 따릅니다. 실제 Google Chrome의 Pixel 7 에뮬레이션과 CDP UA/Client Hints/터치 설정을 맞추고 `https://m.ticketlink.co.kr/sports/137/{teamId}`에 직접 접속합니다. 별도 `output/sports-chrome-profile`을 사용하며 로그인 상태는 가져오지 않습니다.

모바일 schedules 응답이 암호화된 경우 렌더링된 React `scheduleMatch`를 읽습니다. 원본 예매 상태를 수정하거나 예매 버튼을 누르지 않습니다. 홈팀 ID를 정확하게 대조하며, 수집 실패 시 이전 자료와 실패 표시를 유지하고 정상적인 0경기 응답은 빈 목록으로 반영합니다.

`GET /api/sports`는 스포츠만 수집하고, `GET /api/load`는 공연과 스포츠를 함께 수집합니다. 정적 배포용 `public/data.json`에 `sports.items`, `sports.teamStatus`, `sports.generatedAt`을 포함합니다. 기존 `calendar.ics`는 공연 오픈 구독을 유지합니다.

## 캘린더 자동 구독

검색창 옆 **캘린더 구독**에서 팀 또는 예매처를 고르고, 한 번만 연결하면 새 티켓 오픈 일정과 변경사항이 반영됩니다. 날짜·검색 조건과 관계없이 선택한 팀/예매처의 오픈 일정을 구독합니다. 스포츠는 홈경기의 **일반 예매 오픈 시간** 기준이며, 경기 일시와 경기장은 설명에 표시합니다. 오픈 시간 미정인 일정은 확정 후 추가합니다.

1. 앱에서 팀/예매처 선택 → **캘린더 구독 → 주소 복사**.
2. 구글: 처음 한 번 PC의 Google Calendar → **다른 캘린더 + → URL로 추가**에 붙여넣습니다. 파일 가져오기가 아닌 URL 구독을 선택해야 계속 갱신됩니다.
3. 갤럭시: 같은 구글 계정의 캘린더 동기화를 켜고 삼성 캘린더에서 해당 캘린더를 표시합니다. iPhone/Mac은 **구독 열기** 또는 캘린더 앱의 **구독 캘린더 추가**에 주소를 입력합니다.

공식 안내: [Google URL 구독](https://support.google.com/calendar/answer/37100?hl=ko), [삼성 캘린더 동기화](https://www.samsung.com/ca/support/mobile-devices/how-to-sync-your-google-calendar-on-your-samsung-galaxy-device/), [Apple 캘린더 구독](https://support.apple.com/ko-kr/102301).

공개 구독 주소는 배포 주소 아래 `calendars/`에 있습니다. 스포츠는 `sports-all.ics`와 `sports-59.ics`(LG), `sports-63.ics`(한화), `sports-57.ics`(삼성), `sports-62.ics`(KT), `sports-58.ics`(KIA). 공연은 `concert-all.ics`, `concert-interpark.ics`, `concert-melon.ics`, `concert-ticketlink.ics`입니다.

예: LG 트윈스 — `https://hky5820.github.io/TicketOpenChecker/calendars/sports-59.ics`.

하루 5회 자동 수집 후 구독 자료를 갱신합니다. 캘린더 앱의 갱신 주기에 따라 반영이 늦을 수 있으며, 즉시 반영이나 오픈 직전 알림을 보장하지 않습니다. 실제 Google/Apple 계정 구독 및 단말 동기화는 최초 사용자 설정이 필요합니다.

`calendars/state.json`은 공개 일정의 UID·수정 시각·버전을 다음 수집으로 이어 줍니다. 같은 경기의 오픈 시각 변경은 기존 UID를 갱신하고, 취소/삭제는 취소 상태로 30일 유지합니다. 수집 실패는 취소로 처리하지 않습니다. 이전 배포의 상태를 읽을 때 404 외의 오류가 발생하면 내보내기를 중단하여 버전 초기화를 방지합니다. 생성물은 Git에서 제외하며 Pages에는 함께 배포합니다.

## Verification

```bash
npm test
npm run test:ui
```

Google Chrome이 필요합니다. `npm test`는 날짜 변환, 홈팀 검증, 상태/필터, 실패 자료 유지 규칙을 검증합니다. `npm run test:ui`는 임시 로컬 서버에서 별도 테스트 자료로 기능을 검증한 뒤 실제 `public/data.json`으로 375/768/1440px 화면 및 axe 검사를 수행합니다. 결과는 `output/ui-qa/`에 저장합니다. 실제 단말 푸시 수신 검증은 포함하지 않습니다.

## Local Use

```bash
npm ci
npm start
```

Open `http://localhost:3000`.

Locally, `불러오기` opens a real Google Chrome window (mycode style: `channel: 'chrome'`
with automation flags stripped) so ticket sites don't flag it as a bot. Make sure Google
Chrome is installed. Headless/CI runs fall back to Playwright's bundled Chromium, which you
can install with `npx playwright install chromium` (only needed for `npm run export`).

## Static Export

```bash
npm run export
```

This writes:

- `public/data.json`
- `public/calendar.ics`
- `public/calendars/*.ics` (10 subscription feeds)
- `public/calendars/state.json` (public event revisions)

If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, new schedules are sent to Telegram.

## GitHub Actions Setup

1. Push this repository to GitHub.
2. In GitHub, open `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Open `Settings > Secrets and variables > Actions > Secrets`.
5. Add:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
6. Optional: open `Settings > Secrets and variables > Actions > Variables` and add:
   - `PAGE_URL=https://hky5820.github.io/TicketOpenChecker/`
7. Run `Actions > Collect ticket openings > Run workflow`.

The workflow also runs on a schedule:

- KST 09:17
- KST 12:17
- KST 15:17
- KST 18:17
- KST 21:17

After the first successful run, open:

```text
https://hky5820.github.io/TicketOpenChecker/
```

Calendar subscription URL:

```text
https://hky5820.github.io/TicketOpenChecker/calendar.ics
```
