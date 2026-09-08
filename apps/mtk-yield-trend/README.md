MTK Assy & OS & BIN Yield Trend v27
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
   - Headers(필수): CUST_ID, PKG_ID, LEAD_ID, CUST_DEVICE, NICK_NAME, LOT_ID, CUST_RUN_ID, SUBSTRATE_VENDOR, IN_QTY, OUT_QTY, FINAL YIELD, BIN1, BIN2, BIN3, BIN4, BIN5, BIN6, BIN36
   - Headers(선택, v27+): SUBSTRATE_PART_DESC, FT_IN_TIME, FT_OUT_TIME — FT_IN_TIME이 있으면 Assy OS Trend/FT Weekly Trend의 WW를 row별 실제 시각 기준으로 계산합니다.
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

v23 Changes
-----------
- Assy OS Trend / FT (BIN) Weekly Trend를 Device × Vendor × WW 기준으로 전면 개편.
  - Device 구분: OS는 DEVICE, BIN은 CUST_DEVICE의 앞 6자리.
  - Vendor 구분: OS는 PCB_VENDOR, BIN은 SUBSTRATE_VENDOR의 마지막 4자리가 'LIST'면 LIST, 그 외에는 LGIT.
  - WW(Work Week) 기준: 일요일~토요일 (예: 9/6~9/12 = WW37), Jan 1 기준 Sunday-start 주차 번호.
  - Open Rate = Σ OPEN / Σ TEST_QTY, Short Rate = Σ SHORT / Σ TEST_QTY (Assy OS Trend).
  - FT Rate = Σ(BIN2~BIN6) / Σ IN_QTY, Bin4 Rate = Σ BIN4 / Σ IN_QTY (FT (BIN) Weekly Trend).
- Export OS Report: "MTK FT and OS Weekly update@SCK_WWxx.xlsx" 형식으로 전면 교체.
  - Device(앞 6자리)별로 Sheet 생성, 각 Sheet는 Criteria(Assy OS/FT) × Item(Open/Short, FT/Bin4 rate) × SBT(LGIT/LIST) × WW column 구조.
  - 데이터가 없는 Device × WW 조합은 '-'로 표시, 값이 있는 셀은 0.000% 형식.
- Report Upload 패널에 "전체 삭제" 버튼 추가: Firestore의 Assy/OS/BIN raw collection을 모두 삭제(확인 팝업 포함)합니다.
- Export BIN Weekly Merge(기존 Monday-start 주차, BIN1~BIN36 전체 breakdown)는 기존과 동일하게 유지됩니다.

v24 Changes
-----------
- Assy OS Trend / FT (BIN) Weekly Trend Sheet 구분 기준을 Device에서 **Lead**로 변경.
  - OS는 **LEAD**, BIN은 **LEAD_ID** 값을 그대로(자르지 않고) Sheet 기준으로 사용합니다. (기존: DEVICE/CUST_DEVICE 앞 6자리)
  - 실제 첨부 파일 기준 OS의 LEAD와 BIN의 LEAD_ID가 같은 코드 체계(예: 286, 852)를 쓰는 것을 확인했고, 이제 같은 Lead의 Assy OS 결과와 FT 결과가 같은 Sheet에 정확히 모입니다.
- WW(Work Week) 기준을 **일요일~토요일**로 재확정 (9/6~9/12 = WW37). BIN Report 날짜에 대한 별도 offset 없이, OS/BIN 모두 해당 날짜가 속한 일~토 주를 그대로 사용합니다.
- Vendor 구분 기준 명확화: PCB_VENDOR/SUBSTRATE_VENDOR 마지막 4자리가 'LIST'가 아니면 모두 **LGIT**(LG = LG Innotek)로 표시합니다. ('LG', 'LGIT' 뿐 아니라 실제 데이터의 다른 vendor 표기도 LIST가 아니면 LGIT로 집계되던 기존 로직을 그대로 유지 및 확인)
- Open/Short/FT/Bin4 Rate 표시 규칙 재확인: 물량(TEST_QTY/IN_QTY)이 있는데 Open·Short·Fail이 0건이면 **0%**로, 물량 자체가 없으면 **'-'**로 표시합니다 (기존 로직 그대로 유지, 실제 데이터 기준 검증 완료).

v25 Changes
-----------
- FT(BIN)의 SUBSTRATE_VENDOR가 비어 있으면, LOT_ID 마지막 1자리(Split/Run 문자, 예: `TPFUN46.00-1A2A` → `TPFUN46.00-1A2`)를 뗀 값으로 Assy OS List의 LOT_ID를 검색해서, 일치하는 row가 있으면 그 PCB_VENDOR를 대신 사용해 LGIT/LIST를 구분합니다. (매칭되는 값이 없으면 기존과 동일하게 처리)
- 이렇게 찾은 대체 PCB_VENDOR에도 기존과 동일한 방식(마지막 4자리 확인, 'LIST'가 아니면 LGIT=LG=LG Innotek)을 그대로 적용합니다.
- BIN Report 날짜/WW 산출을 위한 파일명 날짜 인식을 보강: 기본은 파일명에 포함된 8자리(YYYYMMDD, 예: `..._20260608`)를 사용하고, 구분자 문제 등으로 이 패턴을 못 찾는 경우 파일명 끝의 8자리 숫자를 YYYYMMDD로 다시 시도하는 fallback을 추가했습니다 (그래도 못 찾으면 기존처럼 파일 수정일 사용).

v26 Changes (답지 대조 검증 결과 반영)
-----------
사용자가 제공한 기존 답지("MT7987 FT and OS" 참고 파일, Lead 286)와 실제 업로드 파일(BIN 20260727, 4 lot)로 직접 대조 검증한 결과, 2가지 계산 오류를 발견하고 수정했습니다.
- **FT Fail Qty에 BIN36 포함**: 기존에는 FT Rate = Σ(BIN2~BIN6) / Σ IN_QTY 였으나, 답지와 대조한 결과 BIN36도 Fail Bin에 포함해야 정확히 일치함을 확인했습니다. FT Rate = Σ(BIN2~BIN6+BIN36) / Σ IN_QTY 로 수정.
- **BIN Report 파일명 날짜 -7일 보정**: BIN report 파일은 실제 데이터가 속한 일~토 주가 끝난 "다음 주 월요일" 날짜로 파일명이 찍힙니다(예: `20260727`=월요일 파일 → 실제 데이터는 직전 주 7/19~7/25=WW30). 파일명 날짜에서 7일을 뺀 날짜로 WW를 계산하도록 수정.
- 검증: BIN_20260727.xlsx(Lead 286, LGIT, 4 lot) 기준 계산 결과 IN_QTY=108,329 / FT Fail(Bin2~6+36)=1,148 / FT Rate=1.05973...% / Bin4 Qty=88 / Bin4 Rate=0.08123...% 이며, 이는 답지의 WW30 LGIT 값과 소수점 이하까지 정확히 일치합니다.
- OS(Assy OS) 쪽은 이번에 받은 OS 파일 1개(15 row)만으로는 답지의 누적 주간 합계와 완전히 일치하지 않을 수 있습니다(답지는 여러 차례 업로드된 lot들의 누적 합일 가능성). Assy OS 계산식 자체(Open/Short Rate = Σ/Σ TEST_QTY)는 변경하지 않았습니다.

v27 Changes (FT_IN_TIME 기반 WW)
-----------
IT Team이 MTK BIN INFORMATION 파일에 <b>FT_IN_TIME</b>(row별 실제 FT 투입 시각), <b>FT_OUT_TIME</b>, <b>SUBSTRATE_PART_DESC</b> column을 추가한 새 양식을 지원합니다.
- FT_IN_TIME이 있는 row는 그 날짜가 속한 일~토 주(WW)를 그대로 사용합니다 (OS의 INPUT_TIME과 동일한 방식, 파일명 기준 -7일 보정이 필요 없어짐).
- FT_IN_TIME이 없는 구버전 파일(row에 날짜가 없고 파일명에만 날짜가 있는 경우)은 기존처럼 파일명 끝 8자리(YYYYMMDD)에서 7일을 뺀 날짜로 WW를 계산합니다 (하위 호환).
- SUBSTRATE_VENDOR 값이 이제 'LG Innotek' 처럼 풀네임으로도 들어올 수 있는데, 기존 Vendor 구분 로직('LIST'로 끝나지 않으면 LGIT)이 그대로 정확히 처리합니다.
- Export BIN Weekly Merge의 raw dump에 FT_IN_TIME/FT_OUT_TIME column을 추가했습니다.
- 검증: 실제 새 양식 파일(9개 lot, FT_IN_TIME이 7/11~7/31에 걸쳐 분포)로 테스트한 결과, lot마다 실제 투입 시각에 맞춰 WW28/WW30/WW31로 정확히 나뉘어 집계되는 것을 확인했습니다.

Usage
-----
- Assy report, OS comparison report, MTK BIN INFORMATION 파일을 Drop zone에 Drag & Drop 하면 자동으로 읽고 Firebase에 upload합니다.
- 같은 report를 다시 넣으면 중복 row는 skipped 됩니다.
- 전체 삭제 버튼으로 Assy/OS/BIN raw data를 Firestore에서 한번에 삭제할 수 있습니다.
- Export Assy SOD Report: Assy SOD Trend, Assy lot raw, Defect PPM을 xlsx로 다운로드합니다.
- Export OS Report: Device × Vendor(LGIT/LIST) × WW 기준 Assy OS(Open/Short)/FT(FT rate/Bin4 rate) 표를 Device별 Sheet로 다운로드합니다.
- Export BIN Weekly Merge: 주차별(Monday-start) BIN Rate Trend와 주차별 merge raw를 xlsx로 다운로드합니다.
