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
