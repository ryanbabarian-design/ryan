# 하나금속 제안관리 V2.3.11

## 수정 내용
- V2.3.10 결재자 목록 SQL 함수 파라미터 충돌 회피: 새 RPC 이름 사용
- 결재자 목록: 활성 결재자만 최신 수정 순 조회
- 직원명단 업로드를 누적 추가에서 최신 조직도 동기화 방식으로 변경
- 사번이 있으면 사번으로 동일 직원 판별
- 사번이 없고 동명이인이 아니면 이름으로 부서 이동 처리
- 최신 명단에 없는 기존 직원은 삭제하지 않고 비활성 처리
- 기존 제안 데이터는 변경/삭제하지 않음

## 적용 순서
1. Supabase SQL Editor > New query
2. `sql/V2.3.11_결재자목록_및_직원명단동기화.sql` 전체 실행
3. 최종 결과의 `approver_list_rpc`, `employee_sync_rpc`가 모두 true인지 확인
4. GitHub에 `index.html`, `js/app.js`, `js/employee-sync.js`, `js/services/store.js` 덮어쓰기
5. 기존 `js/config.js`는 변경/삭제하지 않기
6. Commit 후 1~3분 뒤 Ctrl+F5
7. 관리자 화면에서 최신 직원명단 엑셀을 한 번 더 업로드하여 동기화
