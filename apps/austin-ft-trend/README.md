# Austin FT Trend Chart

## Input

- Preferred sheet: `MERGE REPORT`
- Required headers: `时间`, `原批号`, `BIN`, `数量`
- Optional headers: `OSAT`, `物料编码`, `工单号`, `原Marking`, `合批Marking`, `测试程序`

## Cumulative storage rule (v26)

- Every new attachment is **appended to the existing history**. Previous dates are never cleared.
- Stable row key: Date + report metadata + 原批号 + BIN (数量 and filename excluded).
- New stable key: Insert.
- Existing stable key with changed 数量: Update the previous value.
- Existing stable key with the same content: Skip as duplicate.
- IndexedDB restores the complete accumulated history after refresh/browser restart.
- Firestore uses the same cumulative upsert key and synchronizes local history when available.

## Trend rule

- Chart view mode toggle (`Weekly Trend` / `Date · 原批号`), default **Weekly Trend**:
  - Weekly: X-axis is the Monday-start week bucket (`getWeekStartDateKey`, same convention as `mtk-yield-trend`); each point sums 数量 per BIN for that week.
  - Date · 原批号: X-axis is Date → 原批号 (the original granular per-lot view); each point sums 数量 per BIN for the same Date/原批号.
- Series: each BIN
- Reset Filter only resets filters and never deletes data.

## Changelog

- v27: Removed the "Filtered Detail" raw table section (low-readability, chart-less duplicate of the chart/export data). Added a Weekly / Date·原批号 toggle above "BIN 数量 Trend" and made **Weekly Trend the default view** to reduce point-count clutter on the trend chart; the per-date/lot granular view remains available via the toggle.
- v28: Removed the "Process Log" panel at the bottom of the page. Status messages that used to print there now go to the browser console only (functionality unaffected).

## Firestore

Collection: `austinFtTrendRaw`

Publish the included `firestore.rules`. Local IndexedDB remains the primary offline-safe cumulative store when Firebase is unavailable.
