MTK Assy & OS & BIN Yield Trend v22
===================================

Run
---
1. 압축 해제
2. VS Code에서 폴더 열기
3. Live Server로 index.html 실행
   예: http://127.0.0.1:5500/index.html

Supported Excel reports
-----------------------
1. Assy report
   - Sheet: YIELD SUMMARY TAP
   - 중복 기준: SCK input Lot No + In Qty

2. OS comparison report
   - Sheet: MTK Assembly OS comparison
   - 중복 기준: LOT_ID + TOTAL_QTY

3. MTK BIN INFORMATION attachment
   - Sheet: MTK BIN INFORMATION 또는 아래 header 자동 감지
   - Headers: CUST_ID, PKG_ID, LEAD_ID, CUST_DEVICE, NICK_NAME, LOT_ID, CUST_RUN_ID, SUBSTRATE_VENDOR, IN_QTY, OUT_QTY, FINAL YIELD, BIN1, BIN2, BIN3, BIN4, BIN5, BIN6, BIN36
   - Report Week: 파일명에서 YYYYMMDD 형식 날짜를 우선 자동 감지하고 Monday-start 주차로 집계합니다. 정확한 날짜가 없으면 파일 modified date를 사용하며, 기존 월 단위 데이터는 Monthly fallback으로 표시합니다.
   - 중복 기준: Report Week + CUST_ID + PKG_ID + LEAD_ID + CUST_DEVICE + LOT_ID + CUST_RUN_ID + SUBSTRATE_VENDOR + IN_QTY + OUT_QTY

Firebase
--------
mtk-yield-trend.js에는 아래 Firebase project config가 입력되어 있습니다.
- projectId: mtk-os-ft-trend-analyser

Authentication
--------------
현재 Firestore Rule이 request.auth != null 조건을 사용하므로 Firebase Console에서 Anonymous Auth를 Enable 해야 합니다.

Firebase Console > Authentication > Sign-in method > Anonymous > Enable

Firestore collections
---------------------
1. yieldSummaryTapRaw
2. osComparisonRaw
3. binInformationRaw

Firestore Rule example
----------------------
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() {
      return request.auth != null;
    }

    match /yieldSummaryTapRaw/{docId} {
      allow read: if signedIn();
      allow create, update: if signedIn()
        && request.resource.data.keys().hasAll(['sod','sckInputLotNo','inQty','dedupeKey','uploadedAt'])
        && request.resource.data.dedupeKey == docId;
      allow delete: if signedIn();
    }

    match /osComparisonRaw/{docId} {
      allow read: if signedIn();
      allow create, update: if signedIn()
        && request.resource.data.keys().hasAll(['inputDate','lotId','osInQty','dedupeKey','uploadedAt'])
        && request.resource.data.dedupeKey == docId;
      allow delete: if signedIn();
    }

    match /binInformationRaw/{docId} {
      allow read: if signedIn();
      allow create, update: if signedIn()
        && request.resource.data.keys().hasAll(['reportMonth','lotId','inQty','dedupeKey','uploadedAt'])
        && request.resource.data.dedupeKey == docId;
      allow delete: if signedIn();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}

v22 Changes
-----------
- MTK BIN INFORMATION 첨부 파일 업로드/Firestore 저장 추가.
- BIN Rate Trend: 주차별(Monday-start) merge 기준 BIN1~BIN6/BIN36 Rate 표시.
- Chart Bins 옵션 추가: Fail Bins Only / All Bins / BIN1 Only.
- Export BIN Weekly Merge:
  - BIN_Weekly_Trend: 주차별 IN_QTY, OUT_QTY, FINAL YIELD, 각 BIN Qty/Rate.
  - BIN_Merged_Raw: 모든 월 raw row merge.
  - BIN_YYYY_MM_DD: 주차별 raw row sheet 별도 생성.
- Export raw에는 첨부 파일의 CUST_ID, PKG_ID, LEAD_ID, CUST_DEVICE, NICK_NAME, LOT_ID, CUST_RUN_ID, SUBSTRATE_VENDOR, IN_QTY, OUT_QTY, FINAL YIELD, BIN1, BIN2, BIN3, BIN4, BIN5, BIN6, BIN36 모두 유지.

Usage
-----
- Assy report, OS comparison report, MTK BIN INFORMATION 파일을 Drop zone에 Drag & Drop 하면 자동으로 읽고 Firebase에 upload합니다.
- 같은 report를 다시 넣으면 중복 row는 skipped 됩니다.
- Export Assy SOD Report: Assy SOD Trend, Assy lot raw, Defect PPM을 xlsx로 다운로드합니다.
- Export OS Report: OS INPUT_TIME Trend와 OS Raw를 xlsx로 다운로드합니다.
- Export BIN Weekly Merge: 주차별 BIN Rate Trend와 주차별 merge raw를 xlsx로 다운로드합니다.
