# Schedule workspace QA — 2026-09-28

References inspected: current Desktop/plm-desk/ui and Desktop/svace-workspace/extension. Light workspace, clear function navigation, compact filters and separated schedule rows.

- Live collection through real Chrome / Pixel 7: 23 home games across LG (5), Hanwha (4), Samsung (6), KT (4), KIA (4). 18 ON_SALE, 5 BEFORE at collection time.
- Export: 107 concert notices and sports snapshot, with per-provider and per-team collection status.
- Unit checks: 31 passed (schedule rules, Melon retries and calendar subscription generation/update/cancellation).
- Browser checks: 117 passed. Twenty-one screenshots cover lists, scrolling, date selection and desktop/mobile subscription dialogs. Functional checks use synthetic fixtures; list captures use the real exported data.
- axe WCAG A/AA checks: 0 violations at 375, 768 and 1440 CSS pixels, plus mobile cover widths 344, 360 and 384, concert and sports views and the mobile calendar dialog.
- Additional mobile emulation: 320px, no document overflow.
- Evidence: output/ui-qa/report.json, home-{375,768,1440}.png, sports-{375,768,1440}.png.

Visual review checked date/team filter visibility, text wrapping, opening versus game date hierarchy, availability labels, keyboard settings dismissal, alarm persistence and partial failure indicators. No prior screenshot baseline for pixel regression comparison. Real phone notification delivery and background push were not tested.

## Compact cover display follow-up

Mobile Chrome emulation uses touch, DPR 2.625 and 344/360/384 CSS pixel widths with a conservative 748px content height. These bracket narrow Fold cover layouts; they do not certify a specific Fold generation, Samsung Internet or Android display zoom setting. No physical phone was attached.

- At 344 × 748, the existing deployed LG view started its first game at y=627px with a 173px row: zero complete games visible.
- Initial compact layout started at y=316px with a 109px row: three complete games visible. The later logo tabs start the first game at y=340px and preserve the 109px row and three complete games. Measurements use the current real export; counts depend on titles, data and notices.
- Navigation and refresh share one row, all five team filters fit one row, large page introduction is visually hidden, and match dates/status/opening times use compact rows. Search, date basis, reminders, settings and linked game pages remain available.
- Cover touch checks exercise each team, opening date filtering, reminder registration and settings dismissal. No horizontal overflow; all source buttons visible without horizontal scrolling.
- Evidence: output/cover-before.{png,json}, output/ui-qa/cover-{home,sports}-{344,360,384}.png, output/ui-qa/report.json.

## Logo tabs, concert readability and date navigation

- Provider and team logos are local PNG assets with provenance in public/assets/logos/SOURCES.md. All eight logos decode successfully; team/vendor tabs remain a single row with visible separators.
- Mobile concert posters increase from 29 × 39 to 72 × 100px and titles from 13 to 15px. Opening time and reminder remain alongside the larger poster/title block. Sports item dimensions remain unchanged; item separators are clearer in both views.
- Concert date navigation adds previous/next day, today and a full month dialog. It reuses the existing calendar, including vendor-specific opening markers. Desktop native date input and sports date controls remain available.
- Fixture checks cover exact day selection, year rollover, vendor preservation, empty dates, today, selected-day focus, Escape cancellation and focus restoration. Existing source/date/status/search/reminder checks also pass.
- At 344 × 748, two full concert items fit; at 360/384 × 748, three fit with the sampled titles. The larger artwork and text are intentional. Screenshots: output/ui-qa/cover-calendar-344.png and cover-home-{344,360,384}.png.

## Seven-day navigation and future-only display (previous iteration)

- Both mobile views now show seven neighboring dates and per-day counts, with one-tap selection, seven-day paging and the existing month picker. Date/vendor/status/search intersections remain exact. Past calendar dates are disabled.
- Initial and reset views show upcoming items from the current instant. The date strip starts at the nearest matching future date, including dates beyond today. Concert openings already passed today are excluded; unknown times remain explicitly unknown and follow known future times.
- Sports game-date view retains open tickets for future games and drops games after their start time. Opening-date view only shows future openings. Existing compact sports item dimensions remain unchanged.
- Expired openings disappear while the page stays open. Visibility restoration re-evaluates the current time; a day selection that becomes past at KST midnight returns to upcoming without dropping vendor/search filters. Alarm lists also exclude passed opening times.
- Mobile source tabs, date buttons, control typography and poster/title blocks use consistent sizes. Concert titles reserve two lines, with full title retained in the link text/title and original notice. All sampled concert row content heights agree within one pixel; border differences are excluded from this check.
- At 344/360/384 × 748, seven date buttons are fully visible with no horizontal document overflow. Two complete concert/game items fit in the sampled viewport; the date strip makes neighboring dates directly accessible. The redundant concert status bar hides when all available items share one status.
- Clock-based browser checks cover same-day expiry and KST midnight; unit checks also cover exact timestamps, unknown dates, and retaining already-open tickets only in the future-game view.

## Opening-first sports and scrollable dates (previous iteration)

- Sports now always groups and sorts by the general ticket opening timestamp, starting with future openings. All sports date/range/basis controls are removed. Game date, time and venue are secondary metadata beneath the matchup. This supersedes the previous game-first view; already-passed openings are excluded.
- Mobile concert dates form a continuous horizontal strip, with six full 44px targets and a partly visible next date on the narrowest cover viewport. It starts at the nearest matching opening, supports native touch scrolling, and preserves the chosen date and provider while scrolling. Month labels update with the visible dates; month boundaries include the month in the day label. The full calendar remains available.
- Navy selected navigation/source/date tabs, local logo tiles, subtle row dividers and tinted date headings replace the previous flat selection treatment. Reminder buttons fill blue when enabled, with a soft highlight across the corresponding row. Large concert posters and consistent title/row dimensions are preserved.
- At 344/360/384 × 748, the sampled LG first row moved from y=412 to y=263. Sports rows remain compact at about 108px. Two future LG openings exist in the current snapshot and both are visible. Concert rows remain about 162px with two complete items visible.
- Browser coverage includes actual CDP touch swiping, exact dates across month/year boundaries, provider preservation, sports opening order against reversed game order, absence of sports date controls, reminder persistence, failed collections and live time expiry. 74 checks, 13 captures, zero axe violations and zero uncaught browser errors.
- Validation uses Chrome mobile emulation, not a physical Fold or Samsung Internet.

## Selected-day consistency and Melon collection

- Home defaults to the nearest remaining opening date. The horizontal strip, full calendar, result heading and list share that exact date. The default follows the next remaining date after expiry and resolves the nearest matching date when changing provider. Manually chosen empty dates remain selected.
- “전체 예정” is a distinct action with no selected day. Redundant day/week/all controls and duplicate list date headings are removed; the continuous date strip is also available on desktop. Subtle provider selections, a blue selected date number and aligned search/heading spacing reduce visual clutter. Sports keeps its opening-first view without date controls.
- The strip renders a bounded 61-day window, including when the source contains dates decades in the future. Selecting a distant date in the calendar shifts that window around the selection.
- Melon diagnosis: deployed `siteStatus.melon` reported `ok:true,count:0,fallback:true`, retaining 9 old entries. The HTML collector swallowed request errors and treated unmatched/error HTML as an empty success. A separate reproduced pagination bug filtered one multi-opening notice out of a ten-notice page, then stopped because only nine parsed items remained. The historical runner response was not logged, so its exact HTTP/response cause cannot be reconstructed.
- Verified the actual mobile site with Chrome and observed `tktapi.melon.com/poc/ticketOpen/list.json`. Collection now uses that public API in opening order, paginates by raw count, deduplicates overlapping pages, and expands detail schedules for presale/general/lottery rounds. The site's `23:23` unknown-time sentinel is preserved as unknown. HTTP, JSON, schema and partial-detail failures stay errors; successful empty Melon results do not revive stale snapshots.
- Live local collection read 42 unique notices over five pages and extracted 37 opening schedules. Unit coverage includes pagination, multi-opening expansion, API failures, cancellation, unknown-time markers, duplicate notices and round labels. Remote collection must also be checked after deployment.
- Validation: 19 unit tests, 77 browser checks, thirteen regular screenshots, zero axe violations and zero uncaught browser errors. Cover emulation at 344/360/384 × 748 shows matching selected day/list and two complete concert rows. Physical Fold/Samsung Internet was not tested.

## Date context while scrolling (current)

- A concert day selection keeps its existing month/day/weekday heading pinned above the list. Selecting another day updates the same heading; no duplicated floating state can drift from the list.
- Concert “전체 예정” and sports keep the current section's opening-date heading pinned. The next section pushes it away and replaces it, including when scrolling backward. “예매 오픈” explicitly distinguishes these dates from game dates. Sports date controls remain absent.
- Native sticky positioning uses `overflow:clip` on the rounded schedule panel so the document remains the scroll container. Opaque heading surfaces and a light divider/shadow separate dates from rows. Existing mobile row dimensions are preserved.
- Readability follow-up: floating dates share 17px, weight 700 type (mobile concert dates were 14px; grouped dates were 12px). The selected-day bar remains 46px tall; grouped bars grow from 34 to 40px. At 344px, dates stay on one line and two complete concert/sports items remain visible.
- Regression checks use long synthetic lists at 344px touch and 1440px desktop widths: selected-day changes, both scroll directions, non-overlapping section transitions, visible topmost date text and no horizontal overflow. Six captures: `output/ui-qa/pinned-{home,upcoming,sports}-{344,1440}.png`.
- Validation: 19 unit tests, 103 browser checks, 19 screenshots, zero axe violations and zero uncaught browser errors. Real export layouts also checked at 344/360/384, 375, 768 and 1440 CSS pixels. Mobile verification uses Chrome emulation, not physical Fold/Samsung Internet.

## Intermittent Melon API failure

- The 2026-09-28 23:35 KST export (`36437072482`) received `멜론 API HTTP 423` and retained 37 previous Melon schedules. The prior 23:01 collection (`36432629638`) returned 37 schedules successfully; the 22:50 scheduled run also returned 423. Live local collection still succeeds. The historical response body was not captured, so the reason for Melon's rejection (including possible runner-network restrictions) is unconfirmed.
- Previously one failed request ended the entire Melon collection. Transient HTTP 423/429/500/502/503/504 and connection failures now get at most three attempts with 2s/5s waits. `Retry-After` is respected; waits above 20s end collection rather than retry early. Permanent HTTP and malformed API responses remain errors.
- Retry messages identify the list page or detail notice and attempt count, and are retained in export logs. Exhausted retries still fail the entire provider and preserve the stale-data warning; partial results are never reported as fresh.
- Validation: 23 unit tests, including recovery on a later page without dropping earlier notices, persistent detail failure, bounded retries, `Retry-After` and permanent errors. Live local collection returns 37 schedules. Remote collection is checked separately after deployment.

## Automatic calendar subscriptions — 2026-09-29

- Ten public ICS feeds: each of the five sports home teams, all five teams, each concert provider and all concert providers. A compact button beside search opens the subscription dialog, preselects the current team/provider and offers URL copy, Google's official add-by-URL settings page and an Apple webcal link. No extra item controls or row height changes.
- Exports regenerate feeds after every collection. Stable event UIDs omit the opening timestamp; changed content increments SEQUENCE and LAST-MODIFIED, while identical collections preserve them. New games appear automatically, and cancellations/authoritative removals retain tombstones for 30 days. Failed/stale providers keep prior records, including cancelled records, instead of reviving or deleting them. Unknown/passed opening times are omitted.
- ICS uses UTC timestamps, Korean descriptions, escaped text, CRLF and UTF-8 folding at 75 octets. Sports starts at the general opening time; game time and venue are metadata. Events occupy 30 minutes and are transparent to free/busy.
- State is loaded from the previous public deployment before collection. A non-404 remote error stops export rather than resetting event revisions. Generated feeds/state are ignored by Git and included in Pages artifacts. Legacy concert calendar.ics remains available.
- Verified: 31 unit tests and 117 browser checks; 21 screenshots, zero axe violations and browser errors. 344px touch emulation checks source defaults, clipboard contents, feed switching, unchanged list selection, dialog fit, Escape focus return and opening-date labels. Source data produced 10 local subscription files and persisted state.
- Google requires a computer browser for initial URL subscription; phone display uses account synchronization. Client polling controls propagation timing. Official setup links are in README.md. No authenticated Google/Apple account subscription, physical Galaxy/iPhone calendar synchronization or notification delivery was exercised. Public deployment is checked separately after publishing.

## Ticket-and-clock app icon — 2026-09-29

- A cobalt ticket-and-clock mark replaces the old green launcher icon and separate header glyph. Generated source and exact prompt are saved in public/assets/brand; scripts/make-icons.js reproduces six PNG sizes with Chrome canvas. Header, manifest, touch icon, favicon and notification references use the same artwork and a new asset version.
- General icons have transparent rounded corners. Apple touch and Android maskable icons are opaque squares; white artwork reaches only 36.83% of image width from the center, inside the 40% circular safe zone. Circle, rounded-square and safe-zone previews retain the whole ticket. 16/28/32/48/64px previews were inspected on light and dark backgrounds.
- Chrome verified manifest parsing, all six PNG dimensions, alpha behavior and matching asset responses. Cover emulation at 344px keeps the header on one line, without horizontal overflow. Existing 117 browser checks and 21 captures passed with zero axe violations or browser errors; concert/sports row heights and positions are unchanged. Physical launcher installation/update behavior was not tested.
- Evidence: output/icon-contact-sheet.png, output/icon-cover-344.png, output/icon-sports-344.png, output/icons-qa.json and output/ui-qa/report.json. Public assets are verified separately after deployment.

## White icon revision — 2026-09-29

- Replaced the blue tile and tilted ticket with a warm-white tile, horizontal navy ticket and clear right-angle clock hands. The same source produces all six platform assets; header, notifications, manifest and favicon references use the new `20260929-white-icon` version.
- Inspected 16/28/32/48/64px previews on light/dark backgrounds and 344px concert/sports pages. No layout changes or horizontal overflow. Manifest parsing, image dimensions, alpha behavior and asset responses passed; navy artwork stays within 38.83% of image width from the center, inside the 40% circular safe zone.
- Evidence paths above now contain the white revision. Physical launcher behavior remains untested; deployed assets and mobile rendering are checked after publishing.
