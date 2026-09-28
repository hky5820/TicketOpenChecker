# Schedule workspace QA — 2026-09-28

References inspected: current Desktop/plm-desk/ui and Desktop/svace-workspace/extension. Light workspace, clear function navigation, compact filters and separated schedule rows.

- Live collection through real Chrome / Pixel 7: 23 home games across LG (5), Hanwha (4), Samsung (6), KT (4), KIA (4). 18 ON_SALE, 5 BEFORE at collection time.
- Export: 107 concert notices and sports snapshot, with per-provider and per-team collection status.
- Unit checks: 10 passed (KST, date basis, ownership, sale status, failed/empty collections, alarm keys).
- Browser checks: 24 passed. Functional checks use synthetic fixtures; six visual captures use the real exported data.
- axe WCAG A/AA checks: 0 violations at 375, 768 and 1440 CSS pixels, concert and sports views.
- Additional mobile emulation: 320px, no document overflow.
- Evidence: output/ui-qa/report.json, home-{375,768,1440}.png, sports-{375,768,1440}.png.

Visual review checked date/team filter visibility, text wrapping, opening versus game date hierarchy, availability labels, keyboard settings dismissal, alarm persistence and partial failure indicators. No prior screenshot baseline for pixel regression comparison. Real phone notification delivery and background push were not tested.
