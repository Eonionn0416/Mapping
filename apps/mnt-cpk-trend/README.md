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
