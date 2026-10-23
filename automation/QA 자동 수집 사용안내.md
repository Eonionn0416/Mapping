Outlook 자동 수집 / v49

Windows 로그인 시 첨부 수집기와 로컬 연결 서버가 숨김 실행됩니다.
Outlook 2016을 실행해 두세요. 받은 편지함과 하위 AUTO MAIL / PERSONAL 또는 Automail 폴더에서 최근 30일 메일을 60초마다 검사합니다. 날짜를 제외한 등록된 6가지 제목의 Excel 첨부만 수집합니다. 메일 이동·삭제·읽음 상태 변경은 하지 않습니다.

첨부 원본: C:\System project\QA System File uploader 아래 MTK 또는 Austin WIP & Yield / 보고 종류 / 수신 시각
수집 로그: 같은 폴더 collector.log
QA 상단의 Outlook 자동 가져오기 상태에서 반영 결과를 확인하세요. 페이지 열기 및 60초마다 새 파일을 처리합니다. MTK는 기존 Firestore 업로드, Austin은 기존 브라우저 이력 저장을 사용합니다. 새 브라우저/주소에서는 기존 Local 이력이 별도이므로 평소 QA 주소를 계속 사용하세요.
연결 서버: 127.0.0.1:8790 (외부 PC 접근 불가). 브라우저가 로컬 네트워크 접근 권한을 물으면 허용해야 합니다.
재시작: automation/QA-Automail-Start.vbs 실행.
중지: 시작프로그램의 QA-Automail-Start.vbs를 제거하고 실행 중인 해당 node/PowerShell 프로세스를 종료합니다. 저장한 데이터는 유지됩니다.

QA 페이지가 닫혀 있을 때는 첨부 수집만 계속됩니다. 보고서 반영은 해당 QA 페이지를 열었을 때 진행됩니다. 오래된 보고서를 늦게 받아도 Austin의 보고시각 기준 최신 상태 계산은 유지됩니다.
