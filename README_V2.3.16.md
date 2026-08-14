# 하나금속 제안관리 V2.3.16 심사저장 권한오류 핫픽스

## 증상
관리자 심사 화면에서 `심사 저장` 클릭 시 `permission denied for table proposals` 오류가 발생.

## 원인
SupabaseStore.adminUpdateProposal()이 public.proposals 테이블을 브라우저에서 직접 UPDATE하고 있었음. 현재 DB 보안정책에서는 직접 UPDATE가 제한됨.

## 수정
- 관리자 전용 SECURITY DEFINER RPC `public.admin_update_proposal_review_v2316(uuid,jsonb)` 추가
- 클라이언트 심사 저장을 직접 UPDATE에서 RPC 호출로 변경
- RLS / 테이블 직접 UPDATE 권한은 완화하지 않음
- 서버에서 포상금 재계산: 건수처리만 5,000원, 0점/미채택/중복제안은 0원
- 기존 audit/status history trigger 유지

## 적용
1. SQL Editor에서 `sql/V2.3.16_심사저장_권한오류_복구.sql` 전체 실행
2. GitHub에 `index.html`, `js/app.js`, `js/services/store.js` 덮어쓰기
3. `js/config.js`는 변경하지 않음
4. Commit 후 Ctrl+F5
5. 관리자 심사화면에서 다시 `심사 저장` 테스트

## SQL 성공 확인
마지막 결과의 `review_save_rpc=true`, `authenticated_execute=true` 확인.
