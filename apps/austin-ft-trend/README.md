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

- X-axis: Date → 原批号
- Series: each BIN
- Value: sum of 数量 for the same Date + 原批号 + BIN
- Reset Filter only resets filters and never deletes data.

## Firestore

Collection: `austinFtTrendRaw`

Publish the included `firestore.rules`. Local IndexedDB remains the primary offline-safe cumulative store when Firebase is unavailable.
