# 하나금속 제안관리 V2.3.14

## 변경사항
- 결재 요청 이메일에 수신자 본인의 `결재 아이디(회사 이메일)` 표시
- 이메일에 `최초 발급 비밀번호: 1111` 표시
- 비밀번호를 이미 변경한 경우 변경한 비밀번호를 사용하라는 안내 추가
- 관리자/결재자 로그인 후 상단 `비밀번호 변경` 메뉴 추가
- 비밀번호 변경은 선택사항이며 강제하지 않음
- 변경 시 현재 비밀번호 확인 → 새 비밀번호 → 새 비밀번호 확인
- Supabase Auth의 `updateUser`로 본인 비밀번호만 변경
- 기존 4단계 결재선, 이메일 Cron, 조직도 부서 마스터는 변경하지 않음

## 적용 순서
### 1. GitHub Pages
아래 3개 파일만 기존 파일에 덮어쓰기합니다.
- `index.html`
- `js/app.js`
- `js/services/store.js`

`js/config.js`는 삭제/수정하지 마세요.

### 2. Supabase Edge Function
Supabase Dashboard → Edge Functions → `approval-email` → Code에서 기존 `index.ts` 전체를 삭제하고
`edge-functions/approval-email/index.ts` 전체를 붙여넣은 뒤 Deploy updates 합니다.

기존 Settings의 `Verify JWT with legacy secret`는 OFF 상태를 유지합니다.
기존 Edge Function Secrets와 Cron은 수정할 필요가 없습니다.

## 이메일 표시
- 결재 아이디: 실제 수신자 이메일 주소
- 최초 발급 비밀번호: 1111
- 이미 비밀번호를 변경한 사용자는 본인이 변경한 비밀번호 사용

## 비밀번호 변경
로그인 후 화면 상단 `비밀번호 변경` 버튼을 누릅니다.
현재 비밀번호와 새 비밀번호를 입력하여 변경합니다.
변경은 선택사항이며 기존 1111을 계속 사용해도 됩니다.
