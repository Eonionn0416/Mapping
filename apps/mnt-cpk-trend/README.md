# MNT CPK Trend Chart

BUMP-MNT and ASSY-MNT Monthly Report Excel files are accumulated in Firestore and visualized as CPK & PPK trend charts.

## Input Excel

### BUMP-MNT
The parser automatically searches every sheet for a header row containing:

- Product
- ITEM
- Cpk
- Ppk

Rows with blank Product inherit the previous Product row, matching the merged-cell style of the monthly report.

### ASSY-MNT
The parser automatically searches every non-chart sheet for a header row containing:

- PROCESS
- CHARACTERISTICS
- Cpk
- Ppk

Each sheet name is treated as the Device. Rows with blank Process inherit the previous Process row, matching the merged-cell style of the monthly report.

## Trend fields

Both BUMP and ASSY Trend tables include:

- Spec Limit
- Min
- Max
- Avg
- Std / DEV
- CPK
- PPK

## Firestore

Collection: `mntCpkTrendRaw`

Duplicate key:

```txt
BUMP: reportMonth + sheetName + product + item + dataType
ASSY: ASSY + reportMonth + sheetName + device + process + characteristics
```

ASSY rows also store `product = device` and `item = characteristics` for compatibility with the existing Firestore rule.

## Firebase Auth

The page uses Anonymous Auth because Firestore Rules use `request.auth != null`.
Enable it in Firebase Console:

```txt
Authentication → Sign-in method → Anonymous → Enable
```

## Changes

### v19
- Removed the raw Bump trend table (`#trendBody`) below the Bump Product/Item chart. The chart, filters, and export button stay unchanged.
- Removed the raw Assy trend table (`#assyTrendBody`) below the Assy Device/Process/Characteristics chart. The chart and filters stay unchanged.
- The Monthly Low CPK / PPK table (`#lowBody`) is now hidden by default. A new "Low CPK 항목 보기" / "Low CPK 항목 숨기기" toggle button in that panel's header shows/hides it on click.

### v20
- Reverted the v19 hide/show toggle: the Monthly Low CPK / PPK table is always visible again (no `hidden` state, no toggle button).
- Added a new clickable "Low CPK/PPK 항목" metric card at the top of the page showing the current count of Low CPK/PPK rows. Clicking it (or pressing Enter/Space on it) smooth-scrolls the page directly to the Monthly Low CPK / PPK table.

### v21
- Clicking a row in the Monthly Low CPK / PPK table now jumps the other way: it sets the Product/Device, Data type, and Start Month filters so the row's own month is in range, re-renders the trend charts, then smooth-scrolls to and briefly highlights the matching CPK & PPK Trend chart card (e.g. `TIANCHI_RCD (337) / Bump Diameter`).
- Added a floating "Low CPK/PPK 항목" summary list docked to the right side of the screen (visible on wide screens, ≥1700px) that follows scroll and stays on screen, so items can be jumped to without scrolling down to the full table. Shows only Month / Type / Item·Characteristics / Status, is collapsible via its header, and each row triggers the same jump-to-chart behavior as the full table.

### v22
- The floating "Low CPK/PPK 항목" list is now ordered by month descending (latest month's items at the top, grouped under a month header; older months are reached by scrolling down) instead of ascending.
- Jumping from a Low CPK/PPK row to its chart no longer sets Start Month to "that row's month → 1 year forward." It now sets the window to end at that row's month (1 year back → that month, e.g. clicking an Aug'26 item sets 2025-08 ~ 2026-08), so you can see whether/when the item was already trending low leading up to that month. If the resulting start month isn't already one of the Start Month dropdown's options (no report was uploaded for exactly that month), it's added on the fly.
