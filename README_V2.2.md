# 하나금속 제안관리 V2.2 - 담당 자동작성 패치

## 핵심 변경

결재 흐름을 다음과 같이 변경합니다.

1. 담당: 제안 제출 순간 제안자 이름으로 자동 작성완료
2. 부서장: 해당 부서에 배정된 Supabase Auth 계정이 승인/반려
3. 공장장: 전사 결재자 계정이 승인/반려
4. 대표이사: 전사 결재자 계정이 최종 승인/반려

담당 단계에는 별도 로그인 계정이나 수동 서명이 필요하지 않습니다.

## 기존 자료 처리

V2.2 SQL 실행 시 기존 제안 전체의 담당 결재기록을 자동 보정합니다.

- 담당 이름: 각 제안의 제안자명
- 상태: 작성완료(내부 DB 상태는 승인)
- 작성일: 기존 제안 생성일/접수일
- 표시: 전자작성

기존 제안, 사진, 심사결과, 포상금 데이터는 삭제하지 않습니다.

## 적용 순서

### 1. Supabase SQL

Supabase → SQL Editor → New query 에서
`sql/V2.2_담당자동작성_실행.sql` 전체를 붙여넣고 Run 합니다.

마지막 확인 결과 예시:

- auto_author_steps = 1
- auto_author_records_completed = 현재 전체 제안건수
- auto_author_records_pending = 0
- auto_author_manual_assignments = 0
- secure_approval_rpc = true
- approval_inbox_rpc = true
- link_approver_rpc = true
- auto_author_guard = true

### 2. GitHub 업로드

저장소에서 Add file → Upload files 로 다음을 덮어씁니다.

- index.html
- css 폴더
- js 폴더

`js/config.js`는 ZIP에 포함하지 않았습니다. 기존 Supabase URL/Publishable key 파일을 삭제하지 마세요.

Commit 후 1~3분 뒤 사이트에서 Ctrl+F5 합니다.

## 결재자 계정

Supabase Authentication에서 별도 계정이 필요한 사람은 다음뿐입니다.

- 부서장
- 공장장
- 대표이사

담당 계정은 만들 필요가 없습니다.

웹 관리자 → 전자결재 설정에서:

- 부서장: 해당 부서 지정
- 공장장: 전체 부서
- 대표이사: 전체 부서

로 연결합니다.

## 보안

- 담당 자동작성 단계는 관리자 화면에서 삭제/비활성/직책변경 불가
- 담당 단계에 Auth 계정 연결 불가
- 담당 단계 수동 승인/반려 불가
- 실제 결재자는 본인에게 배정된 단계만 서명 가능
- 이전 단계 승인 전 다음 단계 서명 불가
