REL Schedule 개선판 v31 (2026-10-19)

v31: 팝업의 기존 26px 체크박스 열을 제거하고 본문/마감 정보 2열로 수정했습니다.
좁은 화면에서는 1열로 표시합니다. 일정 계산과 Excel 기능은 v30과 동일합니다.

기존 호스팅 파일을 이 패키지로 교체하고 REL Schedule 페이지를 새로고침한 뒤
2643 Excel 파일 3개를 한 번 업로드하세요. 새 화면이 안 보이면 Ctrl+F5를 누르세요.
상세 안내: apps/rel-schedule-alert/UPDATE_GUIDE_KO.md

다운로드 시 고객이 수정한 행·열·병합·서식·수식을 유지합니다.
BDR의 T1 sanity / Pre-MP SIT / T2 sanity 항목은 제거합니다.
Rel#가 없는 시트는 파일에는 보존하되 Report 발송 관리와 일정 알림에서 제외합니다.
D-Day·지연은 Pre-alert 체크와 무관하게 표시합니다. 완료·알림 OFF는 제외합니다.

BDR 원본은 정상 XLSX로 확인되었습니다. NotReadableError는 브라우저 파일 접근 오류입니다.
파일을 읽은 후 재사용하여 중복 읽기를 없앴으며 같은 파일 재선택도 가능합니다.
처음부터 읽기 권한이 거부되면 로컬 폴더에 복사하고 파일 선택으로 다시 업로드하세요.
전달한 updated.xlsx는 OneDrive 밖의 outputs 폴더에 저장되어 있습니다.

실제 운영 서버 배포 및 Firebase 연결 시험은 수행하지 않았습니다.
