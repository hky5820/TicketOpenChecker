# Schedule workspace QA — 2026-09-28

References inspected: current Desktop/plm-desk/ui and Desktop/svace-workspace/extension. Light workspace, clear function navigation, compact filters and separated schedule rows.

- Live collection through real Chrome / Pixel 7: 23 home games across LG (5), Hanwha (4), Samsung (6), KT (4), KIA (4). 18 ON_SALE, 5 BEFORE at collection time.
- Export: 107 concert notices and sports snapshot, with per-provider and per-team collection status.
- Unit checks: 10 passed (KST, date basis, ownership, sale status, failed/empty collections, alarm keys).
- Browser checks: 38 passed. Functional checks use synthetic fixtures; twelve visual captures use the real exported data.
- axe WCAG A/AA checks: 0 violations at 375, 768 and 1440 CSS pixels, plus mobile cover widths 344, 360 and 384, concert and sports views.
- Additional mobile emulation: 320px, no document overflow.
- Evidence: output/ui-qa/report.json, home-{375,768,1440}.png, sports-{375,768,1440}.png.

Visual review checked date/team filter visibility, text wrapping, opening versus game date hierarchy, availability labels, keyboard settings dismissal, alarm persistence and partial failure indicators. No prior screenshot baseline for pixel regression comparison. Real phone notification delivery and background push were not tested.

## Compact cover display follow-up

Mobile Chrome emulation uses touch, DPR 2.625 and 344/360/384 CSS pixel widths with a conservative 748px content height. These bracket narrow Fold cover layouts; they do not certify a specific Fold generation, Samsung Internet or Android display zoom setting. No physical phone was attached.

- At 344 × 748, the existing deployed LG view started its first game at y=627px with a 173px row: zero complete games visible.
- Compact layout starts at y=316px with a 109px row: three complete games visible. Concert view shows four complete notices. Measurements use the current real export; counts depend on titles, data and notices.
- Navigation and refresh share one row, all five team filters fit one row, large page introduction is visually hidden, and match dates/status/opening times use compact rows. Search, date basis, reminders, settings and linked game pages remain available.
- Cover touch checks exercise each team, opening date filtering, reminder registration and settings dismissal. No horizontal overflow; all source buttons visible without horizontal scrolling.
- Evidence: output/cover-before.{png,json}, output/ui-qa/cover-{home,sports}-{344,360,384}.png, output/ui-qa/report.json.
