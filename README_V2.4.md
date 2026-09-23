# 하나금속 제안관리 V2.4 AI 효과분석 시범판

## 기능
- 관리자 심사 화면에서 `AI 효과분석` 버튼을 눌렀을 때만 실행
- 제안 텍스트 + 개선 전/후 사진(각 최대 4장) 멀티모달 분석
- 제안자 예상 효과금액 / AI 추정 효과금액 / 심사 최종 확정 효과금액 비교
- 근거 부족 시 금액을 억지로 산출하지 않고 `추가정보 필요` 표시
- AI 결과 이력 DB 저장 및 재분석
- 제안 내용/사진이 분석 후 변경되면 `재분석 권장` 표시
- 부서장/해당부서 임원/대표이사는 저장된 AI 결과만 읽기 전용 열람
- 대표이사 일괄상신 목록에 AI 효과유형/추정금액/신뢰도 요약 표시
- AI 결과는 심사결과·점수·포상금·심사 확정 효과금액을 자동 수정하지 않음

## 1. Supabase SQL
SQL Editor → New query에서 아래 파일 전체 실행:

`sql/V2.4_AI효과분석_시범판_실행.sql`

마지막 결과의 세 값이 모두 true인지 확인:
- ai_analysis_table
- latest_analysis_rpc
- summary_rpc

## 2. OpenAI API Secret
ChatGPT 구독과 OpenAI API 사용료는 별도입니다. OpenAI API에서 API Key를 만든 뒤 Supabase에만 저장하세요.

Supabase → Edge Functions → Secrets에 추가:
- `OPENAI_API_KEY` = 발급한 OpenAI API Key
- `AI_MODEL` = `gpt-5.6-luna` (선택. 없으면 이 값이 기본값)

API Key를 GitHub/config.js/채팅에 공개하지 마세요.

## 3. Edge Function 배포
Supabase → Edge Functions → Deploy a new function → Via Editor

Function name:
`analyze-proposal-effect`

기존 기본 코드를 모두 지우고 아래 파일 전체를 붙여넣은 뒤 Deploy:
`edge-functions/analyze-proposal-effect/index.ts`

이 함수는 내부에서 Supabase Auth의 사용자 토큰을 다시 확인하고 `admins` 테이블에서 시스템 관리자 여부를 검사합니다.
Dashboard의 `Verify JWT with legacy secret`은 OFF로 두어도 함수 자체 검증이 수행됩니다.

## 4. GitHub 업로드
아래 3개만 기존 파일에 덮어쓰기:
- `index.html`
- `js/app.js`
- `js/services/store.js`

`js/config.js`는 절대 삭제하거나 덮어쓰지 마세요.

Commit 후 1~3분 기다린 뒤 `Ctrl + F5`.

## 5. 테스트
1. 시스템 관리자 로그인
2. 관리자 → 제안 심사 → 제안 1건 열기
3. `AI 효과분석` 클릭
4. 분석 완료 후 아래 확인
   - 효과유형
   - AI 요약
   - AI 추정 연간 효과금액 또는 추가정보 필요
   - 산출근거
   - 정량/정성효과
   - 개선 전/후 사진 분석
   - 추가 확인 필요사항
   - 신뢰도
5. 심사 확정 효과금액이 AI 결과로 자동 변경되지 않는지 확인
6. `AI 재분석`으로 새 분석 이력이 생성되는지 확인

## 운영 원칙
AI 분석은 심사 참고자료입니다. 최종 효과금액 및 심사결과는 심사위원이 결정합니다.
