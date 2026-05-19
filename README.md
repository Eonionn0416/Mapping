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
