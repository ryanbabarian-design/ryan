# 대표이사 미결재 알림 변경

## 변경 내용

- 대표이사 미결재 안내는 해당 결재 대기 시작 후 168시간이 지난 건만 대상으로 한다.
- 매일 오전 9시(Asia/Seoul) 대상 제안을 수신자별 묶음메일 한 통으로 예약한다.
- 같은 제안·결재단계·수신자·대기 시작 시각에는 한 번만 안내한다.
- 최초 일괄상신 메일, 다른 결재 단계의 알림, 다른 관리자에 대한 지연 안내는 유지한다.
- 대표이사 본인에게 중복되는 관리자 지연 안내는 제외한다.
- 발송 직전 결재 여부, 상신 회수, 현재 배정, 대기 기간, 선행 승인과 반려 여부를 다시 확인한다.
- 메일서버가 접수했거나 결과가 불분명한 경우 재발송을 막고 '발송 확인 필요'로 표시한다.
- 관리자 메일 기록에서 후보 건수와 실제 발송 건수를 구분하고, 묶음메일은 한 행으로 표시한다.

## 검증

- 실제 발송 함수를 실행하는 격리 테스트: 21개 통과. HTTP와 DB 경계는 테스트 더블이며 실제 메일은 보내지 않았다.
- PostgreSQL 동작 검증: PGlite 0.5.17에서 기존 동작 RED 재현 및 수정 동작 31개 통과. 테스트 데이터는 pg_temp로 한정하고 롤백한다.
- 25건을 한 행·한 통으로 묶기, 168시간 경계, 반복 실행, 대기 주기 변경, 부분 승인, 상신 회수, 담당 변경, 이전 발송, 불확실한 전송 상태를 포함한다.
- 운영의 기존 범위 매칭 함수와 대상 테이블에 대한 service_role 권한을 확인했다. 새 읽기 RPC는 service_role만 실행할 수 있다.
- 운영 예약 주기는 유지하며, 실제 메일을 강제로 발송하는 검증은 하지 않는다.

## 재현 명령

```sh
node --test tests/approval-email.test.js
node tools/verify-ceo-reminder.mjs /path/to/pglite/dist/index.js
```

## 기존 전체 테스트 상태

전체 JavaScript 테스트 81개 중 77개 통과. 변경 전 60개 중 56개 통과 시점부터 존재하던 다음 네 실패는 이번 변경 범위 밖이며 그대로 남아 있다.

1. `header loads the supplied HANA METAL logo through the brand stylesheet`
2. `dashboard keeps the approved brand, analytics, navigation, image, and print hooks`
3. `calculateAward follows configured score bands`
4. `print approval roles follow the attached proposal form`

## 배포 구성

- SQL: `sql/ceo_reminder_7d.sql`
- Edge Function: `supabase/functions/approval-email/index.ts`
- 화면: `js/app.js`, `js/services/store.js`, `index.html`
- 기존 SQL은 `sql/baseline/approval_reminders_before_2916.sql`, 기존 메일 함수는 변경 전 커밋에서 확인한다.
- SQL을 적용한 뒤 메일 함수를 배포한다. SQL 적용은 신규 알림을 즉시 예약하지 않는다.
