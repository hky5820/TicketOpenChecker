# TicketOpenChecker

Ticket opening calendar for NOL Ticket, Melon Ticket, and Ticketlink.

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
