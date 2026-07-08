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
