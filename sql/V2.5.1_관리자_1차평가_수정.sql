-- 하나금속 제안관리 V2.5.1
-- 심사대기 제안의 1차 평가를 시스템 관리자만 입력/수정할 수 있도록 하는 RPC

alter table public.proposals add column if not exists first_evaluation jsonb not null default '{}'::jsonb;
alter table public.proposals add column if not exists first_evaluation_total integer;
alter table public.proposals add column if not exists first_evaluation_completed_at timestamptz;

create or replace function public.admin_save_first_evaluation_v251(
  p_proposal_id uuid,
  p_evaluation jsonb
)
returns setof public.proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
  v_originality integer;
  v_effort integer;
  v_feasibility integer;
  v_applicability integer;
  v_continuity integer;
  v_tangible_effect integer;
  v_proposal public.proposals%rowtype;
begin
  if v_user is null or not exists (
    select 1 from public.admins a where a.user_id = v_user
  ) then
    raise exception '시스템 관리자만 1차 평가를 수정할 수 있습니다.';
  end if;

  select * into v_proposal
  from public.proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception '제안을 찾지 못했습니다.';
  end if;

  if coalesce(v_proposal.review_result, '미심사') <> '미심사'
     or v_proposal.second_evaluation_total is not null
     or coalesce(v_proposal.ceo_submission_status, '미상신') in ('상신완료','승인완료') then
    raise exception '심사대기 중인 제안만 1차 평가를 수정할 수 있습니다.';
  end if;

  v_originality := (p_evaluation->>'originality')::integer;
  v_effort := (p_evaluation->>'effort')::integer;
  v_feasibility := (p_evaluation->>'feasibility')::integer;
  v_applicability := (p_evaluation->>'applicability')::integer;
  v_continuity := (p_evaluation->>'continuity')::integer;
  v_tangible_effect := (p_evaluation->>'tangible_effect')::integer;

  if v_originality not between 1 and 10
     or v_effort not between 1 and 10
     or v_feasibility not between 1 and 10
     or v_applicability not between 1 and 10
     or v_continuity not between 1 and 10
     or v_tangible_effect not between 1 and 10 then
    raise exception '평가점수는 각 항목 1~10점으로 입력하세요.';
  end if;

  v_total := v_originality * 2
           + v_effort * 2
           + v_feasibility
           + v_applicability
           + v_continuity
           + v_tangible_effect * 3;

  update public.proposals
  set first_evaluation = p_evaluation,
      first_evaluation_total = v_total,
      first_evaluation_completed_at = now(),
      updated_at = now()
  where id = p_proposal_id;

  return query select * from public.proposals where id = p_proposal_id;
end;
$$;

revoke all on function public.admin_save_first_evaluation_v251(uuid,jsonb) from public;
grant execute on function public.admin_save_first_evaluation_v251(uuid,jsonb) to authenticated;
