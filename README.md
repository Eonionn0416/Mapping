# QA Page

GitHub Pages용 QA Tools 통합 구조입니다.

## Folder structure

```txt
wafer_strip_mapping_app/
├─ index.html                      # QA Page 시작 화면
├─ README.md
├─ firestore.rules
├─ shared/
│  ├─ firebase-config.js           # Firebase config 공통 관리
│  └─ common.css                   # QA Page 공통 스타일
└─ apps/
   ├─ 2did-mapping/
   │  ├─ index.html
   │  ├─ mapping-app.js
   │  ├─ mapping-style.css
   │  └─ Raw data/
   └─ mtk-yield-trend/
      ├─ index.html
      ├─ mtk-yield-trend.js
      ├─ mtk-yield-trend.css
      └─ README.md
```

## GitHub Pages URL

Root `index.html`이 QA Page입니다.

- 2DID Mapping: `./apps/2did-mapping/`
- MTK Assy & OS & FT Yield Trend: `./apps/mtk-yield-trend/`

## Firebase config

공통 config는 `shared/firebase-config.js`에 있습니다.

- `mappingFirebaseConfig`: 2DID Mapping용 Firebase project
- `mtkYieldFirebaseConfig`: MTK Yield Trend용 Firebase project

## Firestore rules

`firestore.rules`에는 두 앱에서 사용하는 collection rule 예시를 같이 넣었습니다.
실제 Firebase Console에서는 각 프로젝트에 맞는 rule을 Publish 해야 합니다.


## MNT CPK Trend Chart

Path: `apps/mnt-cpk-trend/`

BUMP-MNT monthly report Excel files are parsed from sheets containing headers like `Product`, `ITEM`, `Cpk`, and `Ppk`. Raw rows are stored in Firestore collection `mntCpkTrendRaw`. Duplicate rule: `reportMonth + sheetName + product + item + dataType`.


## v5 update
- MNT 파일 읽기 시 input file handle을 read 완료 전 초기화하지 않도록 수정했습니다.
- MNT/MTK 화면 제목 앞 번호를 제거했습니다.
- MNT/MTK CSS/JS에 cache-busting query를 붙여 GitHub Pages 이전 캐시 영향이 줄도록 했습니다.


## v8 note
- Fixed file input click bubbling issue that can cause NotReadableError in Edge/Chrome Live Server tests.


## v9 update
- MNT CPK Trend parser now ignores Excel Text Box / Shape / Drawing objects and falls back to direct XML parsing when needed.
- MNT cache version updated to v9.

## Austin FT Trend Chart

Path: `apps/austin-ft-trend/`

FT MERGE COMPLETION report의 `时间`, `原批号`, `BIN`, `数量`을 읽어 Date → 原批号 순으로 각 BIN 수량 Trend를 표시합니다. Raw rows are first stored persistently in browser IndexedDB and are restored after refresh/restart. They are also synchronized to Firestore collection `austinFtTrendRaw` when Firebase permission and network are available.

## REL Schedule Alert

Path: `apps/rel-schedule-alert/`

Reliability test plan Excel(예: `Reliability test plan for MNT_2634.xlsx`)의 **각 Sheet / 각 Criteria / 각 Rel item** 일정을 읽어
`Date out` 기준으로 알림을 띄우는 Tool입니다.

### 알림 규칙

알림 대상은 **각 Criteria에서 `Status`에 `On going`이 적힌 항목**입니다.
`Status`가 비어 있는 행(Done도 On going도 아닌 행)은 알림 mechanism에서 완전히 제외되고 표에서 표시만 됩니다.
한 Criteria 안에 `On going`이 2개 이상이면 **Date out이 있는 마지막 행 1건**만 알림 대상으로 삼습니다.
(예: Thermal Cycle에 `FT(500X) ET1`, `FT(500X) ET2`가 모두 On going이면 **ET2** 기준)

| 상태 | 조건 | 동작 |
| --- | --- | --- |
| **Delay session** | On going 항목이고 `Date out − Today < 0` | 하루마다 **Delay +1** 누적, **Done**으로 바뀔 때까지 계속 팝업 (숨기기는 최대 4시간) |
| **Pre alarm** | On going 항목이고 `2 ≥ (Date out − Today) ≥ 0` | 팝업 + 우측 배너로 예고 |
| **On going (watch)** | On going 항목이지만 그보다 먼 미래 | 표시만, 팝업 없음 |
| **Planned / Pending** | Status 미기재 행 | 표시만, 알림 없음 |
| **Done** | `Status`가 Done 계열이거나 화면에서 Done 체크 | 알림 제외 |

- **Status 병합 구간 = 단계 자동 전환**: `Status`가 세로 병합된 구간(예: `UHAST96hrs` + `SAT`, `TC500 cycles` + `SAT`)은
  구간 안에서 **Date out이 아직 지나지 않은 첫 단계**가 현재 진행 항목입니다.
  Today가 그 단계의 Date out을 넘어서면 **자동으로 다음 단계의 Date in / Date out으로 전환**되고, 거기서 다시 alarm을 계산합니다.

  | 예시 (UHAST96hrs 8/18~8/24, SAT 8/24~8/27) | 현재 항목 | 결과 |
  | --- | --- | --- |
  | Today 8/21 | UHAST96hrs (in 8/18, out 8/24) | Pre alarm D-3 |
  | Today 8/24 | UHAST96hrs | Pre alarm D-Day |
  | Today 8/25 | **SAT (in 8/24, out 8/27)** 로 자동 전환 | Pre alarm D-2 |
  | Today 8/28 | SAT | Delay session +1 |

  표와 알림에는 `UHAST96hrs 1/2 → SAT` 처럼 구간 내 현재 단계가 표시되고, 마우스를 올리면 구간 전체 기간과
  Duration / Delay 합계를 볼 수 있습니다. 구간의 모든 Date out이 지났으면 마지막 단계 기준으로 Delay session이 됩니다.
- **주말 보정**: Pre alarm 시작일(`Date out − 2일`)이 토/일이면 **직전 영업일(금요일)** 로 당겨서 알림을 시작합니다.
  (예: Date out이 화요일이면 시작일이 일요일 → 금요일부터 Pre alarm) 표의 `Alarm from` 컬럼에서 실제 시작일을 확인할 수 있습니다.
- **완료 판정**: `Status`가 Done / Complete / Pass / 완료 … 이면 완료. `Status`가 `On going`이면 Result 값이 있어도 진행 중으로 봅니다.
  화면의 **Done 체크박스**로 수동 완료 처리가 가능하며 이 상태는 Firestore에 저장됩니다.
- 알림 항목 제목은 **`Criteria · Rel item Condition`** 형태(예: `uHast · FT(uHAST96) ET2`, `HTST · T0 SAT`, `Precon · Soak MSL3`)로 표시되며,
  제목(또는 배너의 **이동** 버튼)을 클릭하면 아래 표에서 해당 항목으로 바로 이동하고 노란색으로 강조됩니다.
- 알림은 화면 진입 시 모달 팝업 + 우측 하단 배너로 표시되고, **1분 주기 재검사 / 탭 복귀 시 재검사**하며
  새 알림 항목이 생기면 스누즈 중이어도 즉시 다시 뜹니다.
- 마지막 `Date out`이 90일 이상 지난 오래된 Plan(Sheet)은 기본적으로 알림이 보류되며,
  Uploaded Plan List에서 **알림 ON/OFF** 버튼으로 언제든 변경할 수 있습니다.

### Plan Timeline (Gantt)

선택한 Plan의 Criteria &rarr; Rel item 순서로 각 단계의 `Date in ~ Date out` 구간을 가로 막대로 그립니다.

- 축은 **그 Plan의 일정 범위에만** 맞춥니다. (Chart.js bar 축이 0=1970-01-01부터 시작해 timeline이 57년으로 늘어나던 문제를 수정)
- 오늘이 일정에서 너무 멀면(과거 Plan) 축을 오늘까지 늘리지 않고 일정 구간만 표시합니다.
- 빨간 점선 = 오늘, 막대 색 = 상태, **Delay / Pre alarm 막대 끝에는 `+3d` / `D-2` 를 직접 표기**하여 색만으로 상태를 구분하지 않게 했습니다.
- 상단에 상태별 건수 legend가 표시되고, 막대에 마우스를 올리면 Date in / Date out / Duration / D-Day가 나옵니다.

### 같은 파일을 다시 넣을 때 (WW 갱신)

중복 판단 기준(dedupeKey)에 **파일명이 들어가지 않습니다**. 제목의 `WW`가 매주 바뀌어도 같은 항목으로 인식하므로,
갱신된 Plan을 그대로 다시 Drag & Drop 하면 **바뀐 row만** 갱신됩니다.

- 화면 상단에 **New / Updated / 변경 없음** 건수가 표시되고, 변경된 항목은 개발자 콘솔 로그에 `필드: 이전 → 이후` 형태로 남습니다.
- 변경이 없는 row는 Firestore에 쓰지 않습니다.

### 파일 읽기 오류(NotReadableError) 대응

Windows / Edge / OneDrive 환경에서 자주 나는 `NotReadableError`를 위해 6가지 read 방식을 순서대로 재시도합니다
(`file.arrayBuffer` → `FileReader` → chunk 분할 → DataURL → BinaryString → stream).
그래도 실패하면 Excel에서 해당 파일을 완전히 닫고 OneDrive가 아닌 로컬 폴더에 새 이름으로 저장한 뒤 다시 시도해주세요.

### Firestore 권한 오류

`Missing or insufficient permissions`가 뜨면 이 저장소의 `firestore.rules`를 Firebase Console에 **Publish** 해야 합니다
(`relScheduleRaw`, `relScheduleStatus` collection rule이 없어서 나는 오류입니다).
권한이 없어도 앱은 브라우저 localStorage에 저장된 데이터로 계속 알림을 표시합니다.

### 날짜 처리 (timezone 주의)

Excel의 날짜는 **serial 값을 그대로 읽어 UTC 기준으로 변환**합니다.
SheetJS의 `cellDates` 옵션으로 만든 Date 객체는 브라우저 timezone의 **역사적 offset**
(예: Asia/Seoul은 1899년 기준 LMT `+08:27:52`) 때문에 자정에서 약 33분 어긋나 **모든 날짜가 하루 앞당겨지는** 문제가 있습니다.
(한국 시간대에서 `2026-08-01` → `2026-07-31`로 보이던 증상) 현재는 UTC / Asia/Seoul / America/Los_Angeles 어디서든 같은 날짜가 나옵니다.
Mac 1904 date system 파일도 자동 인식합니다.

### 지원 Sheet layout

1. 표준: `Cirteria / Rel item / Condition / Assy' lot# / FT lot# / Q'ty / Date in / Duration / Delay / Date out / Result / Status / Remark / Fail mode`
2. 구형(Tianchi 계열): `Test item / (Sub item) / Duration (day) / Date in / Date out / Result Good/Total Q'ty`

`Date in`과 `Date out` header가 같이 있는 행을 자동으로 header로 인식하고, 세로 병합된 Criteria 셀은 아래 행으로 이어서 적용합니다.

### Firestore

- `relScheduleRaw`: 일정 raw data. 중복 기준(dedupeKey) = `Sheet + Criteria + Rel item + Condition + 같은 조합 내 순번`
- `relScheduleStatus`: Done 체크 상태(`kind: item`) 및 Plan 알림 ON/OFF(`kind: plan`)

Firebase 연결/권한이 없을 때도 브라우저 localStorage에 저장된 데이터로 알림이 동작합니다.
