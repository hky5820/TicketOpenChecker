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
