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
