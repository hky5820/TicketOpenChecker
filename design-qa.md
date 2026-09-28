# Schedule workspace QA — 2026-09-28

References inspected: current Desktop/plm-desk/ui and Desktop/svace-workspace/extension. Light workspace, clear function navigation, compact filters and separated schedule rows.

- Live collection through real Chrome / Pixel 7: 23 home games across LG (5), Hanwha (4), Samsung (6), KT (4), KIA (4). 18 ON_SALE, 5 BEFORE at collection time.
- Export: 107 concert notices and sports snapshot, with per-provider and per-team collection status.
- Unit checks: 13 passed (KST, date basis, ownership, sale status, failed/empty collections, alarm keys, current-time boundaries and unknown times).
- Browser checks: 69 passed. Functional checks use synthetic fixtures; twelve list captures use the real exported data, and a calendar capture uses the fixture.
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

## Seven-day navigation and future-only display

- Both mobile views now show seven neighboring dates and per-day counts, with one-tap selection, seven-day paging and the existing month picker. Date/vendor/status/search intersections remain exact. Past calendar dates are disabled.
- Initial and reset views show upcoming items from the current instant. The date strip starts at the nearest matching future date, including dates beyond today. Concert openings already passed today are excluded; unknown times remain explicitly unknown and follow known future times.
- Sports game-date view retains open tickets for future games and drops games after their start time. Opening-date view only shows future openings. Existing compact sports item dimensions remain unchanged.
- Expired openings disappear while the page stays open. Visibility restoration re-evaluates the current time; a day selection that becomes past at KST midnight returns to upcoming without dropping vendor/search filters. Alarm lists also exclude passed opening times.
- Mobile source tabs, date buttons, control typography and poster/title blocks use consistent sizes. Concert titles reserve two lines, with full title retained in the link text/title and original notice. All sampled concert row content heights agree within one pixel; border differences are excluded from this check.
- At 344/360/384 × 748, seven date buttons are fully visible with no horizontal document overflow. Two complete concert/game items fit in the sampled viewport; the date strip makes neighboring dates directly accessible. The redundant concert status bar hides when all available items share one status.
- Clock-based browser checks cover same-day expiry and KST midnight; unit checks also cover exact timestamps, unknown dates, and retaining already-open tickets only in the future-game view.
