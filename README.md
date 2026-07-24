# 하나금속 제안관리 V1

기존 엑셀 접수현황을 웹으로 전환하기 위한 GitHub Pages + Supabase 기반 초안입니다.

## 현재 구현된 기능

- 로그인 없는 신규 제안 접수
- 직원명 선택 시 부서 자동입력
- 개선 전·후 사진 첨부 및 전체 공개
- 제안 제출 즉시 공개 접수현황 반영
- 제안명·내용·제안자·부서 통합검색
- 부서·제안종류·심사결과·실시상태 필터
- 접수번호 `Q26-001` 형식 자동 발급
- 4자리 수정번호를 이용한 심사 전 수정
- 관리자 이메일·비밀번호 로그인
- 관리자 심사상태·결과·점수·포상·실시·지급 관리
- 관리자 직원명단 Excel/CSV 일괄 업로드
- CSV 접수현황 다운로드
- 기존 2026년 접수현황 22건 데모 이관

## 1. 먼저 화면만 확인하기

기본값은 `demoMode: true`이므로 Supabase 없이도 브라우저 로컬 저장소로 동작합니다.

1. 이 폴더 전체를 GitHub 저장소의 루트에 업로드합니다.
2. GitHub 저장소 `Settings > Pages`에서 `main / (root)`를 선택합니다.
3. 배포 주소를 열어 화면과 업무 흐름을 확인합니다.

데모 관리자:

- 이메일: `admin@demo.local`
- 비밀번호: `admin1234`

데모에서 등록한 자료는 해당 브라우저의 `localStorage`에만 저장됩니다. 다른 PC와 공유되지 않습니다.

## 2. Supabase 실데이터 연결

### 2-1. DB와 Storage 생성

Supabase Dashboard의 SQL Editor에서 순서대로 실행합니다.

1. `sql/supabase_setup.sql`
2. 기존 엑셀자료까지 넣으려면 `sql/seed_legacy_data.sql`

`seed_legacy_data.sql`은 원본 접수번호 중복 `Q26-021`의 두 번째 행을 `Q26-022`로 보정했고, 지급상태 오타 `완ㄴ료`를 `완료`로 보정했습니다.

### 2-2. 관리자 계정 생성

1. Supabase Dashboard `Authentication > Users`에서 관리자 이메일 계정을 생성합니다.
2. SQL Editor에서 아래를 실행합니다.

```sql
insert into public.admins(user_id, display_name)
select id, '제안관리자'
from auth.users
where email = '실제관리자이메일@회사.com'
on conflict (user_id)
do update set display_name = excluded.display_name;
```

관리자별로 같은 방법으로 추가합니다.

### 2-3. 웹 설정값 입력

`js/config.js`를 열어 수정합니다.

```js
window.APP_CONFIG = {
  demoMode: false,
  supabaseUrl: "https://프로젝트REF.supabase.co",
  supabaseAnonKey: "Supabase의 Publishable 또는 anon key",
  storageBucket: "proposal-images",
  demoAdminEmail: "",
  demoAdminPassword: ""
};
```

브라우저 코드에는 `service_role` 키를 절대 넣지 마세요.

## 3. 직원명단 Excel 형식

관리자 화면에서 첫 번째 시트를 읽습니다. 다음 열 이름 중 하나씩 있으면 자동 인식합니다.

- 이름: `성명`, `이름`, `직원명`
- 부서: `부서`, `소속`, `소속부서`, `팀`
- 선택: `사번`, `직번`, `직원번호`

예:

| 사번 | 성명 | 부서 |
|---|---|---|
| 1001 | 홍길동 | 압연 |
| 1002 | 김하나 | 가공 |

## 4. 파일 구조

```text
index.html                    단일 페이지 진입점
css/styles.css                반응형 최신 UI
js/config.js                  Supabase 연결 설정
js/core.js                    검색·번호·포상 계산 순수 로직
js/app.js                     화면·이벤트·업무 흐름
js/services/store.js          데모/Supabase 저장소 교체 계층
js/data/seed.js               기존 엑셀 22건 데모 데이터
sql/supabase_setup.sql        DB/RLS/Auth/Storage 구성
sql/seed_legacy_data.sql      기존 접수현황 이관
tests/core.test.js            핵심 로직 자동 테스트
```

## 5. 테스트

Node.js 20 이상에서:

```bash
npm test
```

## 현재 V1에서 확인할 사항

- 직원명단 실제 열 이름
- 공개할 심사·포상 항목 최종 범위
- 제안서 출력 시 기존 A4 양식의 정확한 결재란
- 포상금 계산기준 최종 규정
- 회사 외부에서 접속 가능한 공개 주소를 그대로 사용할지 여부
- 스팸·장난 등록 방지 강화 필요 여부

공개 익명 제출 방식은 주소를 아는 외부인도 등록할 수 있습니다. V1에는 숨김 입력칸과 브라우저 연속 제출 제한을 넣었지만, 운영 단계에서는 Cloudflare Turnstile 또는 Supabase Edge Function 기반 서버 검증을 추가하는 것이 안전합니다.
