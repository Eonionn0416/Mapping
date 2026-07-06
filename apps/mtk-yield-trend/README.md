MTK Assy & OS & FT Yield Trend v4
===========================

Run
---
1. 압축 해제
2. VS Code에서 폴더 열기
3. Live Server로 index.html 실행
   예: http://127.0.0.1:5500/index.html

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
   - Weekly_MTK_SCK_FC_ASSY_YIELD report의 YIELD SUMMARY TAP 시트 저장
   - 중복 기준: SCK input Lot No + In Qty

2. osComparisonRaw
   - MTK_Assembly_OS_comparison report의 MTK Assembly OS comparison 시트 저장
   - 중복 기준: LOT_ID + TOTAL_QTY

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
        && request.resource.data.keys().hasAll([
          'sod',
          'sckInputLotNo',
          'inQty',
          'dedupeKey',
          'uploadedAt'
        ])
        && request.resource.data.dedupeKey == docId;
      allow delete: if signedIn();
    }

    match /osComparisonRaw/{docId} {
      allow read: if signedIn();
      allow create, update: if signedIn()
        && request.resource.data.keys().hasAll([
          'inputDate',
          'lotId',
          'osInQty',
          'dedupeKey',
          'uploadedAt'
        ])
        && request.resource.data.dedupeKey == docId;
      allow delete: if signedIn();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}

v4 Changes
----------
- 3번 Assy SOD Trend에서 OS Open Rate / OS Short Rate / OS Rate 제거.
- Assy Export에서 OS Open Qty / OS Short Qty / OS Open Rate / OS Short Rate / OS Rate / OS In Qty 제거.
- Assy export sheet는 Assy_SOD_Trend, Assy_Lot_Raw, Defect_PPM으로 구성.
- 4번 OS Comparison Trend는 INPUT_TIME 날짜 기준으로 아래 column을 merge/trend 처리:
  TOTAL_QTY, TEST_QTY, OS_SS, TOTAL_OS_REJ, OPEN, SHORT, REJECT_RATE, OPEN_RATE, SHORT_RATE.
- OS 중복 기준을 LOT_ID + TOTAL_QTY로 변경.
- 과거 v3에서 저장된 OS row가 있어도 LOT_ID + TOTAL_QTY가 같으면 신규 upload 시 duplicate skip 처리합니다.

Usage
-----
- Assy report와 OS comparison report를 Drop zone에 Drag & Drop 하면 자동으로 읽고 Firebase에 upload합니다.
- 같은 report를 다시 넣으면 중복 row는 skipped 됩니다.
- 화면의 Uploaded File List에서 Firestore에 저장된 sourceFileName 별 row 수를 확인합니다.
- Export Assy SOD Report: Assy SOD Trend, Assy lot raw, Defect PPM을 xlsx로 다운로드합니다.
- Export OS Report: OS INPUT_TIME Trend와 OS Raw를 xlsx로 다운로드합니다.
