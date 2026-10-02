# AI/BI Comparison v4 사용 안내

## 이번 수정
- AI No가 다르거나 괄호 안 개정 표기가 달라도 비교합니다. AI No 차이도 일반 변경 사항 및 Summary에 포함합니다. AI No가 없더라도 누락 안내와 함께 비교를 계속합니다.
- CP/BL No 누락은 빨간색 배경과 흰색 글자로 표시합니다. 원본/개정 파일과 시트별로 구분합니다.
- Gap Summary를 추가했습니다. 전체 공정 추가·삭제와 공정 내부의 값 변경·추가·삭제를 문장으로 요약합니다. CP/BL No 누락 안내는 Summary 위의 빨간색 안내 영역에만 표시합니다.
- 기존 Before / After 표와 변경 셀 강조, CSV 내보내기를 유지했습니다.

## Summary 형식
전체 공정 삭제: `438 [SAU] = STAND ALONE UV 삭제!`

전체 공정 추가: `438 [SAU] = STAND ALONE UV 추가!`

항목 변경: `025 [CCM] = CHIP CAP MOUNT 1. Component "R017-Q180X(CAP 0402 6.3V 20% 1uF auto)" 에서 "Component Change" 으로 변경`

항목 값 삭제: `025 [CCM] = CHIP CAP MOUNT 1. Component "R017-Q180X(CAP 0402 6.3V 20% 1uF auto)" 삭제!`

항목 값 추가: `025 [CCM] = CHIP CAP MOUNT 1. Component "R017-Q180X(CAP 0402 6.3V 20% 1uF auto)" 추가!`

같은 항목의 항목명과 값이 함께 추가·삭제된 경우 Summary는 한 문장으로 정리합니다. 상세 차이 건수는 기존처럼 셀 단위이므로 Summary 건수와 다를 수 있습니다. 공정 순서 변경과 기본 정보 변경도 요약합니다.

## 사용
ZIP을 압축 해제하고 wafer_strip_mapping_app/index.html → 06 AI/BI Comparison을 엽니다. 원본 하나와 개정 파일을 선택하고 비교 실행을 누릅니다. 기존 사이트에 적용할 때는 apps/ai-bi-comparison 폴더 전체를 교체합니다.

Summary는 파일·구분·검색 필터에 맞춰 표시합니다. CP/BL No 누락 안내는 Summary와 Summary 건수에 포함하지 않습니다. '표시된 Summary TXT 다운로드'는 화면에 표시된 변경 사항 요약만 저장합니다. 전체 결과 CSV는 필터와 관계없이 비교 완료 파일의 상세 차이를 포함합니다.

Excel의 모든 시트와 공정을 읽으며 공정 목록을 고정하지 않습니다. 공정 제목 코드/약어 및 반복 공정 등장 순서로 연결합니다. 이미지·도형·서식·셀 메모·매크로는 비교하지 않습니다. 수식은 수식 문자열을 비교하며 재계산하지 않습니다. 파일 내용은 브라우저에서 처리하며 Excel 라이브러리를 가져오기 위한 인터넷 연결이 필요합니다.

## 검증
AI No가 다른 문서 및 AI No가 누락된 문서의 비교 허용, CCM 값 변경/추가/삭제 문장, SAU 공정 추가/삭제 문장, CP/BL No 누락, 기존 예시 4개 회귀 비교를 확인했습니다. 브라우저에서 AI No 차이 포함 비교, 빨간색/흰색 안내, Summary 내용, 구분 필터, 변경이 없는 파일의 누락 안내를 확인했습니다. v4에서는 Summary의 중복 누락 안내를 제거했습니다.

v3의 AI/BI Comparison 폴더만 수정했으며 기존 다른 QA 도구는 유지했습니다. 실제 웹사이트 배포는 수행하지 않았습니다.
