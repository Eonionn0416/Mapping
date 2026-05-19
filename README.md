# Wafer & Strip Mapping V5 - Firestore 적용

## 실행
1. VS Code에서 이 폴더 열기
2. Live Server로 `index.html` 실행
3. 2DID Excel 업로드
4. Mapping Page에서 Title / FT Step / Fail Bin / Comment 입력 후 Save
5. Result History에서 저장 List 클릭 시 Firestore에 저장된 Row까지 다시 불러와 Mapping 상태 복원

## Firestore 구조

```text
mappingHistories/{historyId}
  title
  ft
  bins
  comment
  snapshot
  createdAt
  createdAtText
  rowCount
  rowChunkSize
  rowChunkCount

mappingHistories/{historyId}/rowChunks/{00000...}
  index
  rows[]
```

2DID 전체 row는 Firestore 문서 1MB 제한을 피하기 위해 `rowChunks` 서브컬렉션으로 나누어 저장합니다.

## Firebase Rules

현재 Firebase Console에 아래처럼 되어 있으면 앱에서 저장/조회가 전부 막힙니다.

```js
allow read, write: if false;
```

빠른 테스트용으로는 이 폴더의 `firestore.rules` 내용을 Firebase Console > Firestore Database > Rules에 붙여넣고 Publish 하세요.

주의: 테스트 Rules는 공개 읽기/쓰기입니다. GitHub Pages에 올리면 URL을 아는 사람이 데이터를 볼 수 있습니다. 운영용은 Firebase Auth 로그인 후 uid 기준 제한으로 바꾸는 걸 권장합니다.

## GitHub Pages

이 프로젝트는 정적 HTML/CSS/JS라서 GitHub Pages에 그대로 올릴 수 있습니다.
단, Firestore Rules가 막혀 있으면 GitHub Pages에서도 Permission Denied가 발생합니다.

## V7 - Excel Report Export

Mapping Page의 **Export Excel Report** 버튼으로 현재 화면의 Strip/Wafer Mapping 결과를 `.xlsx`로 추출할 수 있습니다.

생성 Sheet:
- `2DID Information`: Title, FT Step, Fail Bin, Comment, Summary, Filter, X/Y 기준 정보
- `Wafer_MERGE` 또는 `Strip_MERGE` 등 Mapping Sheet: B2부터 Map 시작, Row 1은 X축, Column A는 Y축
- `2DID Information Detail`: 현재 Filter 포함 여부(Y/N)를 붙인 2DID 정보
- `Raw Uploaded 2DID`: 업로드 또는 Firestore History에서 불러온 원본 2DID 정보

Mapping Sheet 규칙:
- B2가 첫 Mapping Cell입니다.
- 2DID가 있는 위치는 `1`로 표시됩니다.
- Merge 상태에서 같은 좌표에 여러 Unit이 겹치면 겹친 수량으로 표시됩니다.
- Fail이 포함된 좌표는 빨간색으로 Highlight됩니다.
- 2DID가 없는 위치는 Blank로 둡니다.
