# Austin FT Trend Chart

## Input

- Preferred sheet: `MERGE REPORT`
- Required headers: `时间`, `原批号`, `BIN`, `数量`
- Optional headers: `OSAT`, `物料编码`, `工单号`, `原Marking`, `合批Marking`, `测试程序`

The parser searches the first 30 rows of each sheet and supports common English aliases for the required fields.

## Trend rule

- X-axis: Date → 原批号
- Series: each BIN
- Value: sum of 数量 for the same Date + 原批号 + BIN
- Duplicate raw-row key: Date + report metadata + 原批号 + BIN + 数量

## Firestore

Collection: `austinFtTrendRaw`

The page uses the shared MTK Firebase project and Anonymous Authentication. Publish the included `firestore.rules` in the corresponding Firebase project. If Firebase is unavailable, uploaded files are still charted in local preview mode for the current browser session.
