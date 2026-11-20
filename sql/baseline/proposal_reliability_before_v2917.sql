-- Test baseline captured from pg_get_functiondef. Install only in the isolated fixture.
SET check_function_bodies=off;
CREATE OR REPLACE FUNCTION public.act_approval_secure(p_proposal_id uuid, p_step_id bigint, p_status text, p_comment text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, proposal_id uuid, step_id bigint, status text, assigned_name text, approver_name text, comment text, acted_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_proposal public.proposals%rowtype;
  v_step public.approval_steps%rowtype;
  v_assignment public.approval_assignments%rowtype;
  v_record public.approval_records%rowtype;
  v_auto_count integer := 0;
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if p_status not in ('승인','반려') then raise exception '승인 또는 반려만 처리할 수 있습니다.'; end if;
  select * into v_proposal from public.proposals p where p.id=p_proposal_id;
  if v_proposal.id is null then raise exception '제안을 찾을 수 없습니다.'; end if;
  if v_proposal.approval_required is not true then raise exception 'V2.3 적용 이전 제안은 전자결재 대상이 아닙니다.'; end if;

  select * into v_step from public.approval_steps s where s.id=p_step_id and s.active=true;
  if v_step.id is null then raise exception '활성 결재단계를 찾을 수 없습니다.'; end if;
  if v_step.auto_author then raise exception '담당 자동작성 단계는 별도 전자서명이 필요하지 않습니다.'; end if;
  if v_step.role_name='대표이사' and v_proposal.ceo_submission_status <> '상신완료' then
    raise exception '관리자 심사완료 후 대표이사 일괄상신된 제안만 결재할 수 있습니다.';
  end if;

  select * into v_record from public.approval_records r
  where r.proposal_id=p_proposal_id and r.step_id=p_step_id for update;
  if v_record.id is null then raise exception '결재기록을 찾을 수 없습니다.'; end if;
  if v_record.status <> '대기' then raise exception '이미 % 처리된 결재입니다.',v_record.status; end if;

  if exists (
    select 1 from public.approval_records rr
    join public.approval_steps ss on ss.id=rr.step_id and ss.active=true
    where rr.proposal_id=p_proposal_id and rr.status='반려' and rr.id<>v_record.id
  ) then raise exception '이미 반려된 결재단계가 있어 진행할 수 없습니다.'; end if;

  select * into v_assignment from public.approval_assignments a
  where a.step_id=p_step_id and a.active=true
    and public.v235_assignment_scope_matches(v_step.step_order,a.department,v_proposal.department)
  order by a.id desc limit 1;
  if v_assignment.id is null then raise exception '이 결재단계의 결재자가 지정되지 않았습니다.'; end if;
  if v_assignment.user_id <> v_uid then raise exception '본인에게 지정된 결재단계만 서명할 수 있습니다.'; end if;

  if exists (
    select 1 from public.approval_steps ps
    left join public.approval_records pr on pr.proposal_id=p_proposal_id and pr.step_id=ps.id
    where ps.active=true and ps.step_order<v_step.step_order and coalesce(pr.status,'대기')<>'승인'
  ) then raise exception '이전 결재단계 승인이 완료되어야 합니다.'; end if;

  update public.approval_records set
    status=p_status, assigned_user_id=v_assignment.user_id, assigned_name=v_assignment.display_name,
    approved_by=v_uid, approver_name=v_assignment.display_name,
    comment=nullif(btrim(coalesce(p_comment,'')),''), acted_at=now(), actionable_at=null, updated_at=now()
  where public.approval_records.id=v_record.id returning * into v_record;

  insert into public.proposal_audit_logs(proposal_id,proposal_no,action,field_name,old_value,new_value,actor_id,actor_name)
  values(v_proposal.id,v_proposal.proposal_no,'UPDATE','approval:'||v_step.role_name,to_jsonb('대기'::text),to_jsonb(p_status),v_uid,v_assignment.display_name);
  insert into public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_id,actor_name,happened_at)
  values(v_proposal.id,v_proposal.proposal_no,'전자결재 '||p_status,v_step.role_name||' · '||v_assignment.display_name||coalesce(' · '||nullif(btrim(coalesce(p_comment,'')),''),''),v_uid,v_assignment.display_name,now());

  if v_step.role_name='대표이사' then
    update public.proposals set
      ceo_submission_status=case when p_status='승인' then '승인완료' else '반려' end,
      updated_at=now()
    where public.proposals.id=v_proposal.id;
  elsif p_status='승인' then
    v_auto_count := public.v237_auto_approve_same_user_chain(v_proposal.id,v_step.step_order,v_uid,v_assignment.display_name);
    perform public.v23_queue_current_approval(v_proposal.id,'new');
  end if;

  return query select v_record.id,v_record.proposal_id,v_record.step_id,v_record.status,
    v_record.assigned_name,v_record.approver_name,v_record.comment,v_record.acted_at,v_record.created_at,v_record.updated_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.block_second_evaluation_below_first_minimum_v252()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.second_evaluation_total IS DISTINCT FROM OLD.second_evaluation_total
     OR NEW.second_evaluation IS DISTINCT FROM OLD.second_evaluation)
     AND NEW.second_evaluation_total IS NOT NULL
     AND (NEW.first_evaluation_total IS NULL OR NEW.first_evaluation_total<50) THEN
   IF NOT (NEW.first_evaluation_total IS NULL
      AND coalesce((to_jsonb(NEW)->>'legacy_first_evaluation_exempt')::boolean,false)
      AND coalesce(NEW.team_leader_evaluation_total,0)>=50) THEN
     RAISE EXCEPTION '1차 평가 기준미달 또는 미입력 상태입니다.'; END IF;
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_proposal(p_payload jsonb, p_edit_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  created public.proposals;
  next_implementation_status text;
  next_implemented_date date;
  next_proposer_effect numeric(16,0);
  v_first_eval jsonb;
  v_first_total integer;
begin
  if p_edit_pin !~ '^[0-9]{4}$' then raise exception '수정번호는 숫자 4자리여야 합니다.'; end if;

  if nullif(trim(p_payload->>'proposer_name'), '') is null
     or nullif(trim(p_payload->>'department'), '') is null
     or nullif(trim(p_payload->>'title'), '') is null
     or nullif(trim(p_payload->>'current_problem'), '') is null
     or nullif(trim(p_payload->>'improvement_plan'), '') is null
     or nullif(trim(p_payload->>'expected_effect'), '') is null then
    raise exception '필수 제안 항목이 누락되었습니다.';
  end if;

  if not exists (
    select 1 from public.employees
    where name = trim(p_payload->>'proposer_name')
      and department = trim(p_payload->>'department')
      and active = true
  ) then raise exception '활성 직원명단에서 제안자를 찾지 못했습니다.'; end if;

  v_first_eval := p_payload->'first_evaluation';
  v_first_total := public.v25_eval_total(v_first_eval);
  next_proposer_effect := greatest(0, coalesce((nullif(trim(p_payload->>'proposer_effect_amount'), ''))::numeric, 0));
  next_implementation_status := coalesce(nullif(trim(p_payload->>'implementation_status'), ''), '미실시');
  if next_implementation_status not in ('미실시','진행중','완료') then raise exception '실시상태를 다시 선택하세요.'; end if;
  if next_implementation_status = '완료' then
    if nullif(trim(p_payload->>'implemented_date'), '') is null then raise exception '완료 상태는 실시일을 입력하세요.'; end if;
    next_implemented_date := (p_payload->>'implemented_date')::date;
  else
    next_implemented_date := null;
  end if;

  insert into public.proposals (
    proposal_no, received_date, category, proposer_name, department, title,
    current_problem, improvement_plan, expected_effect, cost_amount, proposer_effect_amount,
    before_images, after_images, edit_pin_hash, implementation_status, implemented_date,
    ceo_submission_status,
    first_evaluation, first_evaluation_total, first_evaluation_completed_at
  ) values (
    public.next_proposal_no(), current_date, p_payload->>'category',
    trim(p_payload->>'proposer_name'), trim(p_payload->>'department'), trim(p_payload->>'title'),
    trim(p_payload->>'current_problem'), trim(p_payload->>'improvement_plan'), trim(p_payload->>'expected_effect'),
    coalesce((nullif(p_payload->>'cost_amount', ''))::bigint, 0), next_proposer_effect,
    coalesce(p_payload->'before_images', '[]'::jsonb), coalesce(p_payload->'after_images', '[]'::jsonb),
    encode(digest(p_edit_pin, 'sha256'), 'hex'), next_implementation_status, next_implemented_date,
    '미상신',
    v_first_eval, v_first_total, now()
  ) returning * into created;

  insert into public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_name,happened_at)
  values(created.id,created.proposal_no,'1차 평가완료','제안자 자기평가 '||v_first_total||'점 / 100점',created.proposer_name,now());

  return to_jsonb(created) - 'edit_pin_hash' - 'reviewer_id';
end;
$function$;

CREATE OR REPLACE FUNCTION public.edit_proposal_with_pin(p_proposal_no text, p_edit_pin text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  current_row public.proposals;
  updated_row public.proposals;
  next_name text;
  next_department text;
  next_implementation_status text;
  next_implemented_date date;
  v_rejected record;
  v_has_rejection boolean := false;
  v_reject_order integer := null;
  v_reject_role text := null;
begin
  select * into current_row
  from public.proposals
  where proposal_no = p_proposal_no
  for update;

  if not found then
    raise exception '접수번호를 찾지 못했습니다.';
  end if;

  select ar.*, aps.step_order, aps.role_name
    into v_rejected
  from public.approval_records ar
  join public.approval_steps aps on aps.id = ar.step_id
  where ar.proposal_id = current_row.id
    and aps.active = true
    and coalesce(aps.auto_author,false) = false
    and ar.status = '반려'
  order by aps.step_order
  limit 1;

  v_has_rejection := found;
  if v_has_rejection then
    v_reject_order := v_rejected.step_order;
    v_reject_role := v_rejected.role_name;
  end if;

  -- 일반 제안은 기존대로 심사 시작 후 수정 불가.
  -- 단, 결재 반려 건은 기존 자료도 포함해 수정·보완을 허용합니다.
  if (current_row.locked or current_row.status in ('심사중','심사완료')) and not v_has_rejection then
    raise exception '관리자가 심사를 시작하여 수정이 잠겼습니다.';
  end if;

  if p_edit_pin !~ '^[0-9]{4}$' then
    raise exception '수정번호는 숫자 4자리로 입력하세요.';
  end if;

  if current_row.edit_pin_hash <> encode(digest(p_edit_pin, 'sha256'), 'hex') then
    raise exception '수정번호가 일치하지 않습니다.';
  end if;

  next_name := coalesce(nullif(trim(p_payload->>'proposer_name'), ''), current_row.proposer_name);
  next_department := coalesce(nullif(trim(p_payload->>'department'), ''), current_row.department);

  if not exists (
    select 1 from public.employees
    where name = next_name and department = next_department and active = true
  ) then
    raise exception '활성 직원명단에서 제안자를 찾지 못했습니다.';
  end if;

  if p_payload ? 'implementation_status' then
    next_implementation_status := nullif(trim(p_payload->>'implementation_status'), '');
  else
    next_implementation_status := current_row.implementation_status;
  end if;

  if next_implementation_status not in ('미실시','진행중','완료') then
    raise exception '실시상태를 다시 선택하세요.';
  end if;

  if next_implementation_status = '완료' then
    if p_payload ? 'implemented_date' then
      if nullif(trim(p_payload->>'implemented_date'), '') is null then
        raise exception '완료 상태는 실시일을 입력하세요.';
      end if;
      next_implemented_date := (p_payload->>'implemented_date')::date;
    else
      next_implemented_date := current_row.implemented_date;
      if next_implemented_date is null then
        raise exception '완료 상태는 실시일을 입력하세요.';
      end if;
    end if;
  else
    next_implemented_date := null;
  end if;

  -- proposals_validate_first_self_evaluation_v256 트리거가
  -- 자기평가 1~10점 및 가중합계 50점 이상을 DB에서 다시 검증합니다.
  update public.proposals
  set
    category = coalesce(nullif(p_payload->>'category',''), category),
    proposer_name = next_name,
    department = next_department,
    title = coalesce(nullif(trim(p_payload->>'title'),''), title),
    current_problem = coalesce(nullif(trim(p_payload->>'current_problem'),''), current_problem),
    improvement_plan = coalesce(nullif(trim(p_payload->>'improvement_plan'),''), improvement_plan),
    expected_effect = coalesce(nullif(trim(p_payload->>'expected_effect'),''), expected_effect),
    cost_amount = coalesce((nullif(p_payload->>'cost_amount',''))::bigint, cost_amount),
    proposer_effect_amount = coalesce((nullif(p_payload->>'proposer_effect_amount',''))::bigint, proposer_effect_amount),
    first_evaluation = case when p_payload ? 'first_evaluation' then p_payload->'first_evaluation' else first_evaluation end,
    before_images = case when p_payload ? 'before_images' then p_payload->'before_images' else before_images end,
    after_images = case when p_payload ? 'after_images' then p_payload->'after_images' else after_images end,
    implementation_status = next_implementation_status,
    implemented_date = next_implemented_date,
    status = case when v_has_rejection then '접수' else status end,
    review_result = case when v_has_rejection then '미심사' else review_result end,
    locked = case when v_has_rejection then false else locked end,
    ceo_submission_status = case when v_has_rejection then '미상신' else ceo_submission_status end,
    score = case when v_has_rejection then null else score end,
    award_grade = case when v_has_rejection then null else award_grade end,
    award_amount = case when v_has_rejection then 0 else award_amount end,
    team_leader_evaluation = case when v_has_rejection and v_reject_role = '부서장' then '{}'::jsonb else team_leader_evaluation end,
    team_leader_evaluation_total = case when v_has_rejection and v_reject_role = '부서장' then null else team_leader_evaluation_total end,
    team_leader_evaluation_completed_at = case when v_has_rejection and v_reject_role = '부서장' then null else team_leader_evaluation_completed_at end,
    team_leader_evaluation_by_name = case when v_has_rejection and v_reject_role = '부서장' then null else team_leader_evaluation_by_name end,
    second_evaluation = case when v_has_rejection and v_reject_role = '부서장' then '{}'::jsonb else second_evaluation end,
    second_evaluation_total = case when v_has_rejection and v_reject_role = '부서장' then null else second_evaluation_total end,
    second_evaluation_completed_at = case when v_has_rejection and v_reject_role = '부서장' then null else second_evaluation_completed_at end,
    second_evaluation_by_name = case when v_has_rejection and v_reject_role = '부서장' then null else second_evaluation_by_name end,
    updated_at = now()
  where id = current_row.id
  returning * into updated_row;

  if v_has_rejection then
    -- 반려 당시 이력은 별도 타임라인에 보존합니다.
    insert into public.proposal_status_history(
      proposal_id, proposal_no, stage, detail, actor_name, happened_at
    ) values (
      current_row.id,
      current_row.proposal_no,
      '재상신',
      coalesce(v_reject_role,'결재') || ' 반려 후 제안자가 수정·보완하여 재상신'
        || case when nullif(trim(coalesce(v_rejected.comment,'')),'') is not null then ' · 기존 반려사유: ' || v_rejected.comment else '' end,
      current_row.proposer_name,
      now()
    );

    -- 반려 단계와 그 이후 단계는 현재 결재 건만 대기로 되돌립니다.
    -- 이전 반려 사실은 위 타임라인에 남으므로 이력은 사라지지 않습니다.
    update public.approval_records ar
    set status = '대기',
        comment = null,
        approver_name = null,
        acted_at = null,
        actionable_at = case when aps.step_order = v_reject_order then now() else null end,
        updated_at = now()
    from public.approval_steps aps
    where ar.step_id = aps.id
      and ar.proposal_id = current_row.id
      and coalesce(aps.auto_author,false) = false
      and aps.step_order >= v_reject_order;
  end if;

  return to_jsonb(updated_row) - 'edit_pin_hash' - 'reviewer_id';
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_proposal_intake_v270()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.proposal_intake_settings%ROWTYPE;
BEGIN
  -- Row SHARE lock: pause/resume UPDATE and new submission serialize until transaction end.
  SELECT * INTO s FROM public.proposal_intake_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '신규 접수 상태를 확인하지 못했습니다. 관리자에게 문의하세요.'; END IF;
  IF NOT s.is_open THEN
    RAISE EXCEPTION '신규 제안 접수가 일시 중단되었습니다. 기존 제안의 수정·보완·재상신은 가능합니다.';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.admins
    where user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.list_ceo_submission_candidates()
 RETURNS TABLE(proposal_id uuid, proposal_no text, title text, proposer_name text, department text, received_date date, review_result text, score numeric, award_amount bigint, proposer_effect_amount numeric, effect_amount bigint, executive_approved_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin() then raise exception '시스템 관리자만 조회할 수 있습니다.'; end if;
  return query
  select p.id,p.proposal_no,p.title,p.proposer_name,p.department,p.received_date,p.review_result,p.score::numeric,
    coalesce(p.award_amount,0)::bigint,p.proposer_effect_amount,coalesce(p.effect_amount,0)::bigint,
    er.acted_at
  from public.proposals p
  join public.approval_steps es on es.active=true and es.role_name='해당부서 임원'
  join public.approval_records er on er.proposal_id=p.id and er.step_id=es.id and er.status='승인'
  join public.approval_steps cs on cs.active=true and cs.role_name='대표이사'
  join public.approval_records cr on cr.proposal_id=p.id and cr.step_id=cs.id and cr.status='대기'
  where p.approval_required=true
    and p.status='심사완료'
    and p.review_result<>'미심사'
    and p.ceo_submission_status='미상신'
    and not exists (
      select 1 from public.approval_records rr
      join public.approval_steps ss on ss.id=rr.step_id and ss.active=true
      where rr.proposal_id=p.id and rr.status='반려'
    )
  order by er.acted_at,p.received_date,p.proposal_no;
end;
$function$;

CREATE OR REPLACE FUNCTION public.next_proposal_no()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  y integer := extract(year from current_date)::integer;
  n integer;
begin
  insert into public.proposal_counters(year, last_no)
  values (y, 1)
  on conflict (year)
  do update
    set last_no = public.proposal_counters.last_no + 1
  returning last_no into n;

  return 'Q' || right(y::text, 2) || '-' || lpad(n::text, 3, '0');
end;
$function$;

CREATE OR REPLACE FUNCTION public.proposal_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor_kind text;
begin
  actor_kind := case
    when auth.uid() is not null and public.is_admin() then 'admin'
    when tg_op = 'INSERT' then 'public_submit'
    else 'public_pin_edit'
  end;

  insert into public.proposal_audit_log (
    proposal_id,
    proposal_no,
    action,
    actor_id,
    actor_type,
    before_data,
    after_data
  )
  values (
    coalesce(new.id, old.id),
    coalesce(new.proposal_no, old.proposal_no),
    tg_op,
    auth.uid(),
    actor_kind,
    case when tg_op in ('UPDATE', 'DELETE')
      then to_jsonb(old) - 'edit_pin_hash'
      else null
    end,
    case when tg_op in ('INSERT', 'UPDATE')
      then to_jsonb(new) - 'edit_pin_hash'
      else null
    end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.proposal_audit_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f text;
  tracked_fields text[] := array[
    'status','review_result','implementing_department','implementation_status',
    'implemented_date','score','award_grade','award_amount','payment_status',
    'effect_amount','review_comment','title','current_problem','improvement_plan',
    'expected_effect','cost_amount'
  ];
  old_json jsonb;
  new_json jsonb;
begin
  if tg_op = 'DELETE' then
    insert into public.proposal_audit_logs(
      proposal_id, proposal_no, action, field_name, old_value, new_value,
      actor_id, actor_name
    ) values (
      old.id, old.proposal_no, 'DELETE', '__deleted__',
      to_jsonb(old) - 'edit_pin_hash', null,
      auth.uid(), public.v2_admin_name()
    );
    return old;
  end if;

  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  foreach f in array tracked_fields loop
    if old_json -> f is distinct from new_json -> f then
      insert into public.proposal_audit_logs(
        proposal_id, proposal_no, action, field_name, old_value, new_value,
        actor_id, actor_name
      ) values (
        new.id, new.proposal_no, 'UPDATE', f,
        old_json -> f, new_json -> f,
        auth.uid(), public.v2_admin_name()
      );
    end if;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.proposal_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  new.locked := new.status in ('심사중', '심사완료');

  if auth.uid() is not null and public.is_admin() then
    new.reviewer_id := auth.uid();
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.proposal_status_history_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    insert into public.proposal_status_history(
      proposal_id, proposal_no, stage, detail, actor_id, actor_name, happened_at
    ) values (
      new.id, new.proposal_no, '접수', '신규 제안 접수', auth.uid(),
      coalesce(new.proposer_name, public.v2_admin_name()), coalesce(new.created_at, now())
    );

    if new.approval_required = true then
      insert into public.proposal_status_history(
        proposal_id, proposal_no, stage, detail, actor_id, actor_name, happened_at
      ) values (
        new.id, new.proposal_no, '담당 작성완료', '제안 제출 시 제안자 자동작성', null,
        new.proposer_name, coalesce(new.created_at, now())
      );

      insert into public.approval_records(
        proposal_id, step_id, status, approved_by, approver_name, comment, acted_at, actionable_at
      )
      select
        new.id,
        s.id,
        case when s.auto_author then '승인' else '대기' end,
        null,
        case when s.auto_author then new.proposer_name else null end,
        case when s.auto_author then '제안 제출 시 자동작성' else null end,
        case when s.auto_author then coalesce(new.created_at, now()) else null end,
        null
      from public.approval_steps s
      where s.active = true
      on conflict (proposal_id, step_id) do nothing;

      perform public.v23_queue_current_approval(new.id, 'new');
    end if;

    return new;
  end if;

  if old.status is distinct from new.status and new.status = '심사중' then
    insert into public.proposal_status_history(proposal_id, proposal_no, stage, detail, actor_id, actor_name)
    values (new.id, new.proposal_no, '심사중', '관리자 심사 시작', auth.uid(), public.v2_admin_name());
  end if;

  if old.review_result is distinct from new.review_result and new.review_result <> '미심사' then
    insert into public.proposal_status_history(proposal_id, proposal_no, stage, detail, actor_id, actor_name)
    values (new.id, new.proposal_no, new.review_result, coalesce(new.review_comment, '심사결과 등록'), auth.uid(), public.v2_admin_name());
  end if;

  if old.implementation_status is distinct from new.implementation_status and new.implementation_status = '진행중' then
    insert into public.proposal_status_history(proposal_id, proposal_no, stage, detail, actor_id, actor_name)
    values (new.id, new.proposal_no, '시행중', coalesce(new.implementing_department, '시행부서') || ' 시행 진행', auth.uid(), public.v2_admin_name());
  end if;

  if old.implementation_status is distinct from new.implementation_status and new.implementation_status = '완료' then
    insert into public.proposal_status_history(proposal_id, proposal_no, stage, detail, actor_id, actor_name, happened_at)
    values (new.id, new.proposal_no, '실시완료', coalesce(new.implementing_department, '시행부서') || ' 실시 완료', auth.uid(), public.v2_admin_name(), coalesce(new.implemented_date::timestamptz, now()));
  end if;

  if old.payment_status is distinct from new.payment_status and new.payment_status = '완료' then
    insert into public.proposal_status_history(proposal_id, proposal_no, stage, detail, actor_id, actor_name)
    values (new.id, new.proposal_no, '포상지급', '포상금 지급 완료', auth.uid(), public.v2_admin_name());
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_team_leader_evaluation_v258(p_proposal_id uuid, p_evaluation jsonb)
 RETURNS SETOF proposals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE; total integer; actor text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 SELECT coalesce(a.display_name,a.email) INTO actor
 FROM public.approval_assignments a JOIN public.approval_steps s ON s.id=a.step_id
 WHERE a.user_id=auth.uid() AND a.active AND s.active AND s.role_name='부서장'
   AND (a.department=p.department OR a.department IS NULL OR btrim(a.department)='' OR a.department='전체')
 ORDER BY a.id DESC LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION '해당 부서 팀장 평가 권한이 없습니다.' USING ERRCODE='42501'; END IF;
 IF p.first_evaluation_total IS NOT NULL AND p.first_evaluation_total<50
   OR (p.first_evaluation_total IS NULL AND coalesce((to_jsonb(p)->>'legacy_first_evaluation_exempt')::boolean,false) IS NOT TRUE) THEN
   RAISE EXCEPTION '1차 평가 50점 이상 또는 확인된 기존건 면제가 필요합니다.'; END IF;
 IF p.second_evaluation_total IS NOT NULL OR p.second_evaluation_completed_at IS NOT NULL
   OR coalesce(p.ceo_submission_status,'미상신') IN('상신완료','승인완료') OR p.payment_status='완료'
   OR EXISTS(SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
     WHERE r.proposal_id=p.id AND s.role_name='대표이사' AND r.status='승인') THEN
   RAISE EXCEPTION '3차 평가·최종결재·지급 이후에는 일반 팀장평가를 수정할 수 없습니다.'; END IF;
 total:=public.v287_evaluation_total(p_evaluation);
 UPDATE public.proposals SET team_leader_evaluation=p_evaluation,team_leader_evaluation_total=total,
   team_leader_evaluation_completed_at=clock_timestamp(),team_leader_evaluation_by_name=actor,
   review_result=CASE WHEN total<50 THEN '미채택' ELSE '미심사' END,
   status=CASE WHEN total<50 THEN '심사완료' ELSE '심사중' END,
   score=CASE WHEN total<50 THEN total ELSE NULL END,award_grade=NULL,award_amount=0,locked=true,updated_at=clock_timestamp()
 WHERE id=p.id;
 RETURN QUERY SELECT * FROM public.proposals WHERE id=p.id;
END; $function$;

CREATE OR REPLACE FUNCTION public.v21_set_record_assignee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_department text;
  v_proposer_name text;
  v_proposal_time timestamptz;
  v_approval_required boolean := false;
  v_auto_author boolean := false;
  v_step_order integer;
begin
  select p.department, p.proposer_name,
         coalesce(p.created_at, p.received_date::timestamptz, now()), p.approval_required
    into v_department, v_proposer_name, v_proposal_time, v_approval_required
  from public.proposals p where p.id = new.proposal_id;

  if v_approval_required is not true then
    new.actionable_at := null; new.assigned_user_id := null; new.assigned_name := null; return new;
  end if;

  select coalesce(s.auto_author, false), s.step_order into v_auto_author, v_step_order
  from public.approval_steps s where s.id = new.step_id;

  if v_auto_author then
    new.status := '승인'; new.approved_by := null; new.assigned_user_id := null;
    new.assigned_name := v_proposer_name; new.approver_name := v_proposer_name;
    new.comment := '제안 제출 시 자동작성'; new.acted_at := v_proposal_time; new.actionable_at := null;
  else
    select a.user_id, a.display_name into new.assigned_user_id, new.assigned_name
    from public.approval_assignments a
    where a.step_id = new.step_id and a.active = true
      and public.v235_assignment_scope_matches(v_step_order, a.department, v_department)
    order by a.id desc limit 1;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v235_assignment_scope_matches(p_step_order integer, p_assignment_department text, p_proposal_department text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_step_order in (2,3)
      then nullif(btrim(coalesce(p_assignment_department, '')), '') = nullif(btrim(coalesce(p_proposal_department, '')), '')
    when p_step_order = 4
      then nullif(btrim(coalesce(p_assignment_department, '')), '') is null
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.v237_auto_approve_same_user_chain(p_proposal_id uuid, p_from_step_order integer, p_actor_id uuid, p_actor_name text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_proposal public.proposals%rowtype;
  v_cursor_order integer := p_from_step_order;
  v_next_step public.approval_steps%rowtype;
  v_next_record public.approval_records%rowtype;
  v_next_assignment public.approval_assignments%rowtype;
  v_auto_count integer := 0;
  v_auto_comment constant text := '동일 결재자 연속 단계 자동승인';
begin
  if p_actor_id is null then return 0; end if;
  select p.* into v_proposal from public.proposals p where p.id = p_proposal_id;
  if v_proposal.id is null or v_proposal.approval_required is not true then return 0; end if;
  if exists (
    select 1 from public.approval_records rr
    join public.approval_steps ss on ss.id=rr.step_id and ss.active=true
    where rr.proposal_id=p_proposal_id and rr.status='반려'
  ) then return 0; end if;

  loop
    select s.* into v_next_step from public.approval_steps s
    where s.active=true and s.auto_author=false and s.step_order>v_cursor_order
    order by s.step_order limit 1;
    exit when v_next_step.id is null;

    -- 대표이사는 관리자 일괄상신 후에만 처리 가능
    if v_next_step.role_name = '대표이사' and v_proposal.ceo_submission_status <> '상신완료' then exit; end if;

    select r.* into v_next_record from public.approval_records r
    where r.proposal_id=p_proposal_id and r.step_id=v_next_step.id for update;
    exit when v_next_record.id is null or v_next_record.status <> '대기';

    select a.* into v_next_assignment from public.approval_assignments a
    where a.step_id=v_next_step.id and a.active=true
      and public.v235_assignment_scope_matches(v_next_step.step_order,a.department,v_proposal.department)
    order by a.id desc limit 1;
    exit when v_next_assignment.id is null or v_next_assignment.user_id <> p_actor_id;

    if exists (
      select 1 from public.approval_steps ps
      left join public.approval_records pr on pr.proposal_id=p_proposal_id and pr.step_id=ps.id
      where ps.active=true and ps.step_order<v_next_step.step_order and coalesce(pr.status,'대기')<>'승인'
    ) then exit; end if;

    update public.approval_records set
      status='승인', assigned_user_id=v_next_assignment.user_id, assigned_name=v_next_assignment.display_name,
      approved_by=p_actor_id, approver_name=coalesce(nullif(btrim(p_actor_name),''),v_next_assignment.display_name),
      comment=v_auto_comment, acted_at=now(), actionable_at=null, updated_at=now()
    where id=v_next_record.id returning * into v_next_record;

    delete from public.proposal_notification_queue
    where proposal_id=p_proposal_id and step_id=v_next_step.id and status in ('pending','failed');

    insert into public.proposal_audit_logs(proposal_id,proposal_no,action,field_name,old_value,new_value,actor_id,actor_name)
    values(v_proposal.id,v_proposal.proposal_no,'UPDATE','approval:'||v_next_step.role_name,to_jsonb('대기'::text),to_jsonb('승인'::text),p_actor_id,coalesce(nullif(btrim(p_actor_name),''),v_next_assignment.display_name));
    insert into public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_id,actor_name,happened_at)
    values(v_proposal.id,v_proposal.proposal_no,'전자결재 자동승인',v_next_step.role_name||' · '||v_next_assignment.display_name||' · '||v_auto_comment,p_actor_id,coalesce(nullif(btrim(p_actor_name),''),v_next_assignment.display_name),now());

    v_auto_count := v_auto_count + 1;
    v_cursor_order := v_next_step.step_order;
  end loop;
  return v_auto_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v23_queue_current_approval(p_proposal_id uuid, p_notification_type text DEFAULT 'new'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_proposal public.proposals%rowtype;
  v_step public.approval_steps%rowtype;
  v_record public.approval_records%rowtype;
  v_assignment public.approval_assignments%rowtype;
  v_inserted bigint := 0;
begin
  select * into v_proposal from public.proposals where id=p_proposal_id;
  if v_proposal.id is null or v_proposal.approval_required is not true then return 0; end if;

  select s.* into v_step
  from public.approval_steps s
  join public.approval_records r on r.proposal_id=v_proposal.id and r.step_id=s.id
  where s.active=true and s.auto_author=false and r.status='대기'
    and not exists (
      select 1 from public.approval_steps ps
      left join public.approval_records pr on pr.proposal_id=v_proposal.id and pr.step_id=ps.id
      where ps.active=true and ps.step_order<s.step_order and coalesce(pr.status,'대기')<>'승인'
    )
  order by s.step_order limit 1;
  if v_step.id is null then return 0; end if;

  select * into v_record from public.approval_records
  where proposal_id=v_proposal.id and step_id=v_step.id for update;

  if v_step.role_name='대표이사' then
    if v_proposal.ceo_submission_status <> '상신완료' then
      update public.approval_records set actionable_at=null, updated_at=now() where id=v_record.id and actionable_at is not null;
      return 0;
    end if;
    if v_record.actionable_at is null then
      update public.approval_records set actionable_at=now(),updated_at=now() where id=v_record.id returning * into v_record;
    end if;
    -- 대표이사 최초 알림은 submit_proposals_to_ceo()가 ceo_batch 1통으로 생성
    if p_notification_type='new' then return 0; end if;
  elsif v_record.actionable_at is null then
    update public.approval_records set actionable_at=now(),updated_at=now() where id=v_record.id returning * into v_record;
  end if;

  select * into v_assignment from public.approval_assignments a
  where a.step_id=v_step.id and a.active=true and (a.department is null or a.department=v_proposal.department)
  order by case when a.department=v_proposal.department then 0 else 1 end,a.id desc limit 1;
  if v_assignment.id is null or nullif(btrim(v_assignment.email),'') is null then return 0; end if;

  insert into public.proposal_notification_queue(proposal_id,step_id,recipient_email,recipient_name,notification_type,status,available_at)
  values(v_proposal.id,v_step.id,lower(v_assignment.email),v_assignment.display_name,p_notification_type,'pending',now())
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  return v_inserted;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v25_after_approval_stage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_no text;
begin
  if new.status <> '승인' or old.status = new.status then return new; end if;
  select role_name into v_role from public.approval_steps where id=new.step_id;
  if v_role='부서장' then
    update public.proposals set locked=true, updated_at=now() where id=new.proposal_id;
  elsif v_role='해당부서 임원' then
    update public.proposals set status='심사중', locked=true, updated_at=now() where id=new.proposal_id;
    select proposal_no into v_no from public.proposals where id=new.proposal_id;
    insert into public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_name,happened_at)
    values(new.proposal_id,v_no,'2차 평가대기','부서장 및 해당부서 임원 승인 완료 · 심사위원회 2차 공동평가 대기',new.approver_name,now());
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v25_eval_total(p_eval jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return
    public.v25_eval_value(p_eval,'originality') * 2 +
    public.v25_eval_value(p_eval,'effort') * 2 +
    public.v25_eval_value(p_eval,'feasibility') +
    public.v25_eval_value(p_eval,'applicability') +
    public.v25_eval_value(p_eval,'continuity') +
    public.v25_eval_value(p_eval,'tangible_effect') * 3;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v25_eval_value(p_eval jsonb, p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_text text; v_value integer;
begin
  if p_eval is null or jsonb_typeof(p_eval) <> 'object' then
    raise exception '평가표 데이터가 올바르지 않습니다.';
  end if;
  v_text := nullif(btrim(p_eval->>p_key), '');
  if v_text is null or v_text !~ '^[0-9]+$' then
    raise exception '평가항목 % 점수를 입력하세요.', p_key;
  end if;
  v_value := v_text::integer;
  if v_value < 1 or v_value > 10 then
    raise exception '평가점수는 각 항목 1~10점으로 입력하세요.';
  end if;
  return v_value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.v274_preserve_review_on_content_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(current_setting('app.v274_content_target',true),'') = NEW.id::text THEN
    IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
      RAISE EXCEPTION '시스템 관리자만 내용을 수정할 수 있습니다.' USING ERRCODE='42501';
    END IF;
    NEW.reviewer_id := OLD.reviewer_id;
    NEW.locked := OLD.locked;
    NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  ELSIF NEW.admin_content_revision IS DISTINCT FROM OLD.admin_content_revision
     OR NEW.admin_content_updated_at IS DISTINCT FROM OLD.admin_content_updated_at THEN
    RAISE EXCEPTION '내용 변경 이력 항목은 관리자 내용 수정 기능에서만 변경할 수 있습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v280_guard_q26043_scoring()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_allowed text[] := ARRAY[
  'first_evaluation','first_evaluation_total','first_evaluation_completed_at',
  'legacy_first_evaluation_exempt','team_leader_evaluation','team_leader_evaluation_total',
  'team_leader_evaluation_completed_at','team_leader_evaluation_by_name','updated_at'
];
BEGIN
  IF current_setting('app.v280_target',true) IS DISTINCT FROM OLD.id::text
     OR OLD.proposal_no <> 'Q26-043' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION '시스템 관리자만 Q26-043을 보완할 수 있습니다.' USING ERRCODE='42501';
  END IF;
  NEW.locked := OLD.locked;
  NEW.reviewer_id := OLD.reviewer_id;
  IF to_jsonb(NEW) - v_allowed IS DISTINCT FROM to_jsonb(OLD) - v_allowed THEN
    RAISE EXCEPTION '평가점수 외 결재·심사·포상 값 변경이 감지되어 저장을 취소했습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v281_guard_admin_score_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE allowed text[] := ARRAY[
  'first_evaluation','first_evaluation_total','first_evaluation_completed_at',
  'legacy_first_evaluation_exempt','team_leader_evaluation','team_leader_evaluation_total',
  'team_leader_evaluation_completed_at','team_leader_evaluation_by_name','updated_at'
];
BEGIN
  IF current_setting('app.v281_score_proposal',true) IS DISTINCT FROM OLD.id::text THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION '시스템 관리자만 1·2차 점수를 보완할 수 있습니다.' USING ERRCODE='42501';
  END IF;
  NEW.locked:=OLD.locked;
  NEW.reviewer_id:=OLD.reviewer_id;
  IF to_jsonb(NEW) - allowed IS DISTINCT FROM to_jsonb(OLD) - allowed THEN
    RAISE EXCEPTION '평가 보완 중 결재·심사결과·포상정보 변경이 발견되어 저장하지 않았습니다.';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.v287_assert_review_allowed(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
   RAISE EXCEPTION '시스템 관리자(심사위원)만 3차 심사를 저장할 수 있습니다.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 IF coalesce(p.payment_status,'미지급')='완료' THEN RAISE EXCEPTION '지급완료 건은 일반 심사 수정이 잠겨 있습니다.'; END IF;
 IF coalesce(p.ceo_submission_status,'미상신') IN('상신완료','승인완료') OR EXISTS(
   SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.role_name='대표이사' AND r.status='승인') THEN
   RAISE EXCEPTION '대표이사 상신·승인 이후에는 3차 평가를 수정할 수 없습니다.'; END IF;
 IF p.first_evaluation_total IS NULL THEN
   IF coalesce((to_jsonb(p)->>'legacy_first_evaluation_exempt')::boolean,false) IS NOT TRUE THEN
     RAISE EXCEPTION '1차 평가를 먼저 완료하세요.'; END IF;
 ELSIF p.first_evaluation_total<50 THEN RAISE EXCEPTION '1차 평가 50점 이상이 필요합니다.'; END IF;
 IF p.team_leader_evaluation_total IS NULL OR p.team_leader_evaluation_total<50 THEN
   RAISE EXCEPTION '2차 팀장평가 50점 이상이어야 3차 심사할 수 있습니다.'; END IF;
 IF EXISTS(SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.role_name IN('부서장','해당부서 임원') AND s.active IS NOT FALSE AND r.status='반려') THEN
   RAISE EXCEPTION '반려된 결재를 보완·재상신하여 승인받은 뒤 심사하세요.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.role_name='해당부서 임원' AND s.active IS NOT FALSE AND r.status='승인') THEN
   RAISE EXCEPTION '해당부서 임원 승인 완료 후 3차 심사를 진행하세요.'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.v287_evaluation_total(p_eval jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE k text; value numeric; total integer:=0; keys text[]:=ARRAY['originality','effort','feasibility','applicability','continuity','tangible_effect'];
BEGIN
 IF jsonb_typeof(p_eval) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '평가 6개 항목을 입력하세요.'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_eval))<>6
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_eval) key WHERE NOT(key=ANY(keys))) THEN RAISE EXCEPTION '평가 6개 항목을 정확히 입력하세요.'; END IF;
 FOREACH k IN ARRAY keys LOOP
   IF jsonb_typeof(p_eval->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION '평가점수는 정수 1~10점입니다: %',k; END IF;
   value:=(p_eval->>k)::numeric;
   IF value<1 OR value>10 OR trunc(value)<>value THEN RAISE EXCEPTION '평가점수는 정수 1~10점입니다: %',k; END IF;
   total:=total+value::integer*CASE WHEN k IN('originality','effort') THEN 2 WHEN k='tangible_effect' THEN 3 ELSE 1 END;
 END LOOP;
 RETURN total;
END; $function$;

CREATE OR REPLACE FUNCTION public.v287_guard_review_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF coalesce(current_setting('app.v289_review_target',true),'')=NEW.id::text AND NEW.third_review_mode='outcome' THEN
  PERFORM public.v289_assert_review_allowed(OLD.id,'outcome');
  IF NEW.second_evaluation IS DISTINCT FROM OLD.second_evaluation
   OR NEW.second_evaluation_total IS DISTINCT FROM OLD.second_evaluation_total
   OR NEW.review_result NOT IN('건수처리','미채택','보류','중복제안')
   OR NEW.score IS NOT NULL THEN
   RAISE EXCEPTION '결과심사에서 기존 점수 변경 또는 채택 처리를 감지했습니다.';
  END IF;
  RETURN NEW;
 END IF;
 IF coalesce(current_setting('app.v287_migration_target',true),'')=NEW.id::text THEN
   NEW.reviewer_id:=OLD.reviewer_id;
   RETURN NEW;
 END IF;
 IF (NEW.second_evaluation IS DISTINCT FROM OLD.second_evaluation
   OR NEW.second_evaluation_total IS DISTINCT FROM OLD.second_evaluation_total
   OR NEW.second_evaluation_completed_at IS DISTINCT FROM OLD.second_evaluation_completed_at)
   AND NEW.second_evaluation_total IS NOT NULL THEN
   PERFORM public.v287_assert_review_allowed(OLD.id);
   IF public.v287_evaluation_total(NEW.second_evaluation) IS DISTINCT FROM NEW.second_evaluation_total THEN
      RAISE EXCEPTION '3차 항목별 점수와 합계가 다릅니다.'; END IF;
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.v287_review_snapshot(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT jsonb_build_object('first_total',p_row->'first_evaluation_total','team_total',p_row->'team_leader_evaluation_total','team_evaluation',p_row->'team_leader_evaluation',
  'third_evaluation',p_row->'second_evaluation','third_total',p_row->'second_evaluation_total',
  'third_at',p_row->'second_evaluation_completed_at','third_by',p_row->'second_evaluation_by_name',
  'review_result',p_row->'review_result','status',p_row->'status','score',p_row->'score',
  'award_grade',p_row->'award_grade','award_amount',p_row->'award_amount','payment_status',p_row->'payment_status',
  'review_comment',p_row->'review_comment','effect_amount',p_row->'effect_amount',
  'implementation_status',p_row->'implementation_status','implemented_date',p_row->'implemented_date',
  'implementing_department',p_row->'implementing_department');
$function$;

CREATE OR REPLACE FUNCTION public.v289_assert_review_allowed(p_id uuid, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE; context jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
  RAISE EXCEPTION '시스템 관리자(심사위원)만 저장할 수 있습니다.' USING ERRCODE='42501';
 END IF;
 IF p_mode IS NULL OR p_mode NOT IN('score','outcome') THEN RAISE EXCEPTION '심사방식을 확인하세요.'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 IF p.payment_status='완료' THEN RAISE EXCEPTION '지급완료 건은 일반 심사 수정이 잠겨 있습니다.'; END IF;
 IF coalesce(p.ceo_submission_status,'미상신') IN('상신완료','승인완료') OR EXISTS(
   SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.role_name='대표이사' AND r.status='승인') THEN
  RAISE EXCEPTION '대표이사 상신·승인 이후에는 3차 결과를 변경할 수 없습니다.';
 END IF;
 IF p.approval_required IS FALSE THEN
  IF coalesce(nullif(btrim(p.ceo_submission_status),''),'미상신')<>'미상신' THEN
   RAISE EXCEPTION '과거 제안의 대표결재 상태를 확인하세요. 상신·반려 이력을 자동 해제하지 않습니다.';
  END IF;
  context:=public.v293_review_context_internal(p_id);
  IF (context->>'legacy_eligible')::boolean IS NOT TRUE THEN
   RAISE EXCEPTION '실제 승인·반려·결재활성 또는 확인이 필요한 기록 %건이 있어 저장을 중단했습니다. 결재기록은 삭제하지 않습니다.',context->>'blocking_count';
  END IF;
  IF p_mode<>'outcome' THEN
   RAISE EXCEPTION '전자결재 제외 과거 건은 결과심사로 정정하세요. 점수심사·채택에는 기존 평가·결재 절차가 필요합니다.';
  END IF;
  -- v291 저장함수의 금액/사유/동시수정/변경이력/결재 보존 검사로 이어집니다.
  -- v291은 제안 FOR UPDATE 및 결재기록 FOR SHARE 잠금을 먼저 획득합니다.
  RETURN;
 END IF;
 -- 전자결재 대상인 일반 건의 기존 요건은 그대로 유지합니다.
 IF p_mode='score' THEN PERFORM public.v287_assert_review_allowed(p_id); RETURN; END IF;
 IF EXISTS (SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.active IS NOT FALSE AND s.role_name IN('부서장','해당부서 임원') AND r.status='반려') THEN
  RAISE EXCEPTION '반려된 결재를 보완·재상신하여 승인받은 뒤 심사하세요.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
   WHERE r.proposal_id=p_id AND s.active IS NOT FALSE AND s.role_name='해당부서 임원' AND r.status='승인') THEN
  RAISE EXCEPTION '해당부서 임원 승인 후 3차 결과심사를 저장하세요.';
 END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.v289_guard_review_mode()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.third_review_mode IS DISTINCT FROM OLD.third_review_mode THEN
  IF coalesce(current_setting('app.v289_review_target',true),'')<>NEW.id::text THEN
   RAISE EXCEPTION '심사방식은 3차 심사 저장 기능에서만 변경하세요.'; END IF;
  PERFORM public.v289_assert_review_allowed(OLD.id,NEW.third_review_mode);
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.v289_list_ceo_submission_candidates()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
  RAISE EXCEPTION '시스템 관리자만 상신 목록을 볼 수 있습니다.' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT to_jsonb(c)||jsonb_build_object('third_review_mode',p.third_review_mode)
 FROM public.list_ceo_submission_candidates() c JOIN public.proposals p ON p.id=c.proposal_id
 WHERE p.second_evaluation_completed_at IS NOT NULL AND coalesce(p.payment_status,'미지급')<>'완료'
   AND NOT EXISTS(SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id
     WHERE r.proposal_id=p.id AND s.active IS NOT FALSE AND r.status='반려');
END; $function$;

CREATE OR REPLACE FUNCTION public.v291_award_for(p_score numeric, p_result text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE grade text:=''; amount bigint:=0;
BEGIN
 IF p_result IN('미채택','보류','중복제안') THEN
  RETURN jsonb_build_object('ready',true,'grade','','amount',0);
 END IF;
 IF p_result IS NULL OR p_result NOT IN('채택','건수처리') OR p_score IS NULL
 OR p_score<0 OR p_score>100 OR p_score<>trunc(p_score) THEN
  RETURN jsonb_build_object('ready',false,'grade','','amount',NULL);
 END IF;
 IF p_result='건수처리' THEN
  IF p_score<50 OR p_score>65 THEN RETURN jsonb_build_object('ready',false,'grade','','amount',NULL); END IF;
  grade:='건수처리';amount:=CASE WHEN p_score>=60 THEN 10000 ELSE 5000 END;
 ELSIF p_score>=90 THEN grade:='A';amount:=100000;
 ELSIF p_score>=80 THEN grade:='B';amount:=50000;
 ELSIF p_score>=70 THEN grade:='C';amount:=30000;
 ELSIF p_score>=60 THEN grade:='D';amount:=10000;
 ELSIF p_score>=50 THEN grade:='건수처리';amount:=5000;
 END IF;
 RETURN jsonb_build_object('ready',true,'grade',grade,'amount',amount);
END; $function$;

CREATE OR REPLACE FUNCTION public.v291_save_third_review(p_proposal_id uuid, p_evaluation jsonb, p_review_patch jsonb, p_expected_updated_at timestamp with time zone, p_reason text, p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 p public.proposals%ROWTYPE; changed public.proposals%ROWTYPE; result text; total integer;
 grade text:=NULL; award bigint:=0; actor text; reason text:=btrim(coalesce(p_reason,'')); history_id bigint;
 allowed_patch text[]:=ARRAY['review_result','implementing_department','implementation_status','implemented_date','payment_status','effect_amount','review_comment'];
 mutable text[]:=ARRAY['second_evaluation','second_evaluation_total','second_evaluation_completed_at','second_evaluation_by_name',
 'review_result','status','review_comment','reviewer_id','score','award_grade','award_amount','payment_status',
 'implementing_department','implementation_status','implemented_date','effect_amount','locked','updated_at','third_review_mode'];
 award_detail jsonb; basis_score numeric; basis_label text; old_context text; before_approvals jsonb; after_approvals jsonb; amount numeric; at_time timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN
   RAISE EXCEPTION '시스템 관리자만 심사할 수 있습니다.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 PERFORM 1 FROM public.approval_records WHERE proposal_id=p.id FOR SHARE;
 PERFORM public.v289_assert_review_allowed(p.id,p_mode);
 IF p_expected_updated_at IS NULL OR p.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION '다른 사용자가 변경했거나 화면이 오래되었습니다. 내용을 보관하고 다시 조회하세요.' USING ERRCODE='40001'; END IF;
 IF length(reason) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION '심사·수정 사유를 5~1,000자로 입력하세요.'; END IF;
 IF jsonb_typeof(p_review_patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '심사 입력 형식을 확인하세요.'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_review_patch) k WHERE NOT(k=ANY(allowed_patch))) THEN
    RAISE EXCEPTION '허용하지 않은 심사 항목이 포함되어 있습니다.'; END IF;
 IF p_mode='score' THEN
  total:=public.v287_evaluation_total(p_evaluation);
 ELSE
  IF p_evaluation IS NOT NULL AND p_evaluation<>'null'::jsonb THEN RAISE EXCEPTION '결과심사에는 새 점수를 입력하지 않습니다.'; END IF;
  total:=NULL;
 END IF;
 result:=btrim(coalesce(p_review_patch->>'review_result',''));
 IF result NOT IN('채택','미채택','보류','중복제안','건수처리') THEN RAISE EXCEPTION '3차 심사결과를 선택하세요.'; END IF;
 IF p_mode='outcome' AND result='채택' THEN RAISE EXCEPTION '채택은 점수심사에서 평가점수와 함께 저장하세요.'; END IF;
 basis_score:=CASE WHEN p_mode='outcome' THEN p.team_leader_evaluation_total ELSE total END;
 basis_label:=CASE WHEN p_mode='outcome' THEN '2차 팀장평가' ELSE '3차 심사위원 평가' END;
 award_detail:=public.v291_award_for(basis_score,result);
 IF (award_detail->>'ready')::boolean IS NOT TRUE THEN
   RAISE EXCEPTION '포상 산정점수를 확인하세요. 건수처리는 50~59점 5,000원, 60~65점 10,000원입니다. 결과심사는 2차 점수를 사용합니다.';
 END IF;
 grade:=nullif(award_detail->>'grade','');
 award:=(award_detail->>'amount')::bigint;
 IF p_review_patch ? 'effect_amount' THEN
   IF jsonb_typeof(p_review_patch->'effect_amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION '효과금액은 숫자입니다.'; END IF;
   amount:=(p_review_patch->>'effect_amount')::numeric;
   IF amount<0 OR amount>9007199254740991 OR trunc(amount)<>amount THEN RAISE EXCEPTION '효과금액은 0 이상의 정수입니다.'; END IF;
 END IF;
 IF p_review_patch ? 'payment_status' AND coalesce(p_review_patch->>'payment_status','') NOT IN('미지급','예정','완료') THEN
   RAISE EXCEPTION '지급상태를 확인하세요.'; END IF;
 IF coalesce(p_review_patch->>'payment_status',p.payment_status)='완료' THEN
   RAISE EXCEPTION '심사는 지급 처리가 아닙니다. 대표이사 승인 후 별도 지급 처리하세요.'; END IF;
 IF p_review_patch ? 'implementation_status' AND coalesce(p_review_patch->>'implementation_status','') NOT IN('미실시','진행중','완료') THEN
   RAISE EXCEPTION '실시상태를 확인하세요.'; END IF;
 IF length(coalesce(p_review_patch->>'review_comment',''))>20000 THEN RAISE EXCEPTION '심사의견은 20,000자 이내입니다.'; END IF;
 SELECT coalesce(display_name,'관리자') INTO actor FROM public.admins WHERE user_id=auth.uid();
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO before_approvals FROM public.approval_records r WHERE r.proposal_id=p.id;
 at_time:=greatest(clock_timestamp(),p.updated_at+interval '1 microsecond');
 old_context:=coalesce(current_setting('app.v289_review_target',true),'');
 PERFORM set_config('app.v289_review_target',p.id::text,true);
 UPDATE public.proposals SET
   third_review_mode=p_mode,
   second_evaluation=CASE WHEN p_mode='score' THEN p_evaluation ELSE p.second_evaluation END,
   second_evaluation_total=CASE WHEN p_mode='score' THEN total ELSE p.second_evaluation_total END,second_evaluation_completed_at=at_time,second_evaluation_by_name=actor,
   review_result=result,status='심사완료',score=total,award_grade=grade,award_amount=award,locked=true,reviewer_id=auth.uid(),updated_at=at_time,
   implementing_department=CASE WHEN p_review_patch ? 'implementing_department' THEN nullif(btrim(p_review_patch->>'implementing_department'),'') ELSE implementing_department END,
   implementation_status=coalesce(p_review_patch->>'implementation_status',implementation_status),
   implemented_date=CASE WHEN p_review_patch ? 'implemented_date' THEN nullif(p_review_patch->>'implemented_date','')::date ELSE implemented_date END,
   payment_status=coalesce(p_review_patch->>'payment_status',payment_status),
   effect_amount=CASE WHEN p_review_patch ? 'effect_amount' THEN amount::bigint ELSE effect_amount END,
   review_comment=CASE WHEN p_review_patch ? 'review_comment' THEN p_review_patch->>'review_comment' ELSE review_comment END
 WHERE id=p.id;
 PERFORM set_config('app.v289_review_target',old_context,true);
 SELECT * INTO changed FROM public.proposals WHERE id=p.id;
 IF (to_jsonb(p)-mutable) IS DISTINCT FROM (to_jsonb(changed)-mutable) THEN
   RAISE EXCEPTION '1·2차 평가 또는 기존 제안·결재 관련 항목 변경이 감지되어 저장을 취소했습니다.'; END IF;
 IF changed.third_review_mode IS DISTINCT FROM p_mode
   OR changed.review_result IS DISTINCT FROM result OR changed.award_amount IS DISTINCT FROM award
   OR changed.award_grade IS DISTINCT FROM grade
   OR changed.score IS DISTINCT FROM total
   OR (p_mode='score' AND (changed.second_evaluation IS DISTINCT FROM p_evaluation OR changed.second_evaluation_total IS DISTINCT FROM total))
   OR (p_mode='outcome' AND (changed.second_evaluation IS DISTINCT FROM p.second_evaluation OR changed.second_evaluation_total IS DISTINCT FROM p.second_evaluation_total)) THEN
   RAISE EXCEPTION '심사 저장 결과가 입력값과 다릅니다. 변경을 취소합니다.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO after_approvals FROM public.approval_records r WHERE r.proposal_id=p.id;
 IF before_approvals IS DISTINCT FROM after_approvals THEN RAISE EXCEPTION '전자결재 기록 변경이 감지되어 심사를 취소했습니다.'; END IF;
 INSERT INTO public.proposal_review_history_v287(proposal_id,proposal_no,action,actor_id,actor_name,reason,before_data,after_data)
 VALUES(p.id,p.proposal_no,CASE WHEN p.second_evaluation_completed_at IS NULL THEN '3차 ' ELSE '3차 수정 ' END || CASE WHEN p_mode='outcome' THEN '결과심사' ELSE '점수심사' END,
 auth.uid(),coalesce(actor,'관리자'),reason,public.v287_review_snapshot(to_jsonb(p))||jsonb_build_object('mode',p.third_review_mode),public.v287_review_snapshot(to_jsonb(changed))||jsonb_build_object('mode',changed.third_review_mode,'award_policy','2.9.1','award_basis',basis_label,'award_basis_score',basis_score)) RETURNING id INTO history_id;
 RETURN jsonb_build_object('proposal',to_jsonb(changed)-'edit_pin_hash'-'reviewer_id','history_id',history_id);
END; $function$;

CREATE OR REPLACE FUNCTION public.v293_approval_record_kind(p_record jsonb, p_step jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 SELECT CASE
  WHEN jsonb_typeof(p_record) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_step) IS DISTINCT FROM 'object'
    OR p_step->>'id' IS NULL THEN 'blocking'
  WHEN p_record->>'status'='대기'
    AND nullif(btrim(p_record->>'approved_by'),'') IS NULL
    AND nullif(btrim(p_record->>'approver_name'),'') IS NULL
    AND nullif(btrim(p_record->>'acted_at'),'') IS NULL
    AND nullif(btrim(p_record->>'actionable_at'),'') IS NULL
    AND nullif(btrim(p_record->>'comment'),'') IS NULL THEN 'empty_pending'
  WHEN p_step->'auto_author'='true'::jsonb AND p_step->>'role_name'='담당'
    AND p_record->>'status'='승인'
    AND nullif(btrim(p_record->>'approved_by'),'') IS NULL
    AND nullif(btrim(p_record->>'actionable_at'),'') IS NULL
    AND btrim(p_record->>'comment')='제안 제출 시 자동작성' THEN 'auto_author'
  ELSE 'blocking' END;
$function$;

CREATE OR REPLACE FUNCTION public.v293_review_context_internal(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE; records jsonb; steps jsonb;
 record_count integer; auto_count integer; empty_count integer; blocking_count integer;
BEGIN
 SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id;
 IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb),
   count(*)::integer,
   count(*) FILTER(WHERE public.v293_approval_record_kind(to_jsonb(r),to_jsonb(s))='auto_author')::integer,
   count(*) FILTER(WHERE public.v293_approval_record_kind(to_jsonb(r),to_jsonb(s))='empty_pending')::integer,
   count(*) FILTER(WHERE public.v293_approval_record_kind(to_jsonb(r),to_jsonb(s))='blocking')::integer
 INTO records,record_count,auto_count,empty_count,blocking_count
 FROM public.approval_records r LEFT JOIN public.approval_steps s ON s.id=r.step_id
 WHERE r.proposal_id=p_proposal_id;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.step_order,s.id),'[]'::jsonb) INTO steps
 FROM public.approval_steps s;
 RETURN jsonb_build_object('source','v293','proposal_id',p.id,'proposal_updated_at',p.updated_at,
   'approval_required',p.approval_required,'legacy_eligible',(p.approval_required IS FALSE AND blocking_count=0),
   'record_count',record_count,'auto_author_count',auto_count,'empty_pending_count',empty_count,
   'blocking_count',blocking_count,'records',records,'steps',steps);
END; $function$;

CREATE OR REPLACE FUNCTION public.v294_preserve_paid_legacy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE allowed_fields text[]:=ARRAY['review_result','review_comment','updated_at','legacy_result_revision','legacy_result_corrected_at'];
BEGIN
 IF coalesce(current_setting('app.v294_paid_legacy_target',true),'')=OLD.id::text THEN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid())
  OR OLD.approval_required IS DISTINCT FROM false OR OLD.payment_status IS DISTINCT FROM '완료' THEN
   RAISE EXCEPTION '지급완료 과거 건 정정 권한을 확인하지 못했습니다.' USING ERRCODE='42501';
  END IF;
  NEW.reviewer_id:=OLD.reviewer_id;
  NEW.locked:=OLD.locked;
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  IF (to_jsonb(NEW)-allowed_fields) IS DISTINCT FROM (to_jsonb(OLD)-allowed_fields) THEN
   RAISE EXCEPTION '지급·점수·제안정보 변경이 감지되어 결과 정정을 취소합니다.';
  END IF;
 ELSIF NEW.legacy_result_revision IS DISTINCT FROM OLD.legacy_result_revision
    OR NEW.legacy_result_corrected_at IS DISTINCT FROM OLD.legacy_result_corrected_at THEN
  RAISE EXCEPTION '과거 결과 정정 이력은 전용 기능에서만 기록합니다.';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.v295_act_approval(p_proposal_id uuid, p_step_id bigint, p_status text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE;saved public.proposals%ROWTYPE;r public.approval_records%ROWTYPE;s public.approval_steps%ROWTYPE;a public.approval_assignments%ROWTYPE;
 old_target text;old_op text;before_r jsonb;after_r jsonb;answer jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.proposals WHERE id=p_proposal_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION '제안을 찾지 못했습니다.'; END IF;
 IF p.legacy_ceo_direct IS NOT TRUE THEN SELECT to_jsonb(x) INTO answer FROM public.act_approval_secure(p_proposal_id,p_step_id,p_status,p_comment) x;RETURN answer;END IF;
 IF p_status IS NULL OR p_status NOT IN('승인','반려') THEN RAISE EXCEPTION '승인 또는 반려를 선택하세요.'; END IF;
 IF p_status='반려' AND length(btrim(coalesce(p_comment,'')))<2 THEN RAISE EXCEPTION '반려 사유를 입력하세요.'; END IF;
 IF length(coalesce(p_comment,''))>20000 THEN RAISE EXCEPTION '결재의견은 20,000자 이내입니다.'; END IF;
 IF p.approval_required IS DISTINCT FROM false OR p.legacy_score_revision<1 OR p.legacy_score_registered_at IS NULL OR p.ceo_submission_status<>'상신완료' OR p.payment_status NOT IN('미지급','예정') THEN RAISE EXCEPTION '과거 제안의 대표결재 진행 상태를 확인하세요.'; END IF;
 SELECT * INTO s FROM public.approval_steps WHERE id=p_step_id AND active=true AND auto_author=false AND role_name='대표이사' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '대표이사 결재만 허용합니다.'; END IF;
 PERFORM 1 FROM public.approval_records WHERE proposal_id=p.id ORDER BY id FOR UPDATE;
 SELECT * INTO r FROM public.approval_records WHERE proposal_id=p.id AND step_id=p_step_id;
 IF r.id IS NULL OR r.status<>'대기' OR r.actionable_at IS NULL OR r.assigned_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '본인에게 상신된 대기 건만 결재할 수 있습니다.' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.approval_assignments WHERE step_id=s.id AND active=true AND nullif(btrim(coalesce(department,'')),'') IS NULL ORDER BY id DESC LIMIT 1 FOR SHARE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION '현재 활성 대표이사 배정을 확인하세요.' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.approval_records rr LEFT JOIN public.approval_steps ss ON ss.id=rr.step_id WHERE rr.proposal_id=p.id AND rr.step_id<>s.id AND public.v293_approval_record_kind(to_jsonb(rr),to_jsonb(ss)) NOT IN('auto_author','empty_pending')) THEN RAISE EXCEPTION '대표상신 이후 다른 실제 결재기록이 변경되어 확인이 필요합니다.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(rr) ORDER BY rr.id),'[]'::jsonb) INTO before_r FROM public.approval_records rr WHERE proposal_id=p.id AND step_id<>s.id;
 old_target:=coalesce(current_setting('app.v295_target',true),'');old_op:=coalesce(current_setting('app.v295_operation',true),'');
 PERFORM set_config('app.v295_target',p.id::text,true);PERFORM set_config('app.v295_operation','act',true);
 UPDATE public.approval_records SET status=p_status,approved_by=auth.uid(),approver_name=a.display_name,comment=nullif(btrim(coalesce(p_comment,'')),''),acted_at=clock_timestamp(),actionable_at=NULL,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 UPDATE public.proposals SET ceo_submission_status=CASE WHEN p_status='승인' THEN '승인완료' ELSE '반려' END WHERE id=p.id;
 PERFORM set_config('app.v295_target',old_target,true);PERFORM set_config('app.v295_operation',old_op,true);
 SELECT * INTO STRICT saved FROM public.proposals WHERE id=p.id;
 IF (to_jsonb(p)-ARRAY['ceo_submission_status','updated_at']) IS DISTINCT FROM (to_jsonb(saved)-ARRAY['ceo_submission_status','updated_at']) THEN RAISE EXCEPTION '심사·금액·지급기록 보존 확인에 실패했습니다.'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(rr) ORDER BY rr.id),'[]'::jsonb) INTO after_r FROM public.approval_records rr WHERE proposal_id=p.id AND step_id<>s.id;
 IF before_r IS DISTINCT FROM after_r THEN RAISE EXCEPTION '기존 부서장·임원 등 결재기록 변경을 감지했습니다.'; END IF;
 INSERT INTO public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_id,actor_name,happened_at) VALUES(p.id,p.proposal_no,'대표이사 '||p_status,'기존 확정 총점 '||p.score||'점 직접상신 결재 · '||coalesce(p_comment,''),auth.uid(),a.display_name,clock_timestamp());
 INSERT INTO public.proposal_audit_logs(proposal_id,proposal_no,action,field_name,old_value,new_value,actor_id,actor_name) VALUES(p.id,p.proposal_no,'UPDATE','approval:대표이사',to_jsonb('대기'::text),to_jsonb(p_status),auth.uid(),a.display_name);
 RETURN to_jsonb(r)-'approved_by';
END; $function$;

CREATE OR REPLACE FUNCTION public.v295_legacy_score_denial(p jsonb, c jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
BEGIN
 IF p IS NULL OR p->>'id' IS NULL OR p->>'status'='삭제' OR nullif(p->>'deleted_at','') IS NOT NULL OR p->'is_deleted'='true'::jsonb THEN RETURN '제안정보를 확인하지 못했습니다.'; END IF;
 IF p->'approval_required' IS DISTINCT FROM 'false'::jsonb THEN RETURN '전자결재 대상 건은 기존 심사를 사용하세요.'; END IF;
 IF p->>'payment_status' IS NULL OR p->>'payment_status' NOT IN('미지급','예정') THEN RETURN '미지급 과거 건 전용입니다. 지급완료 기록은 변경하지 않습니다.'; END IF;
 IF coalesce(nullif(btrim(p->>'ceo_submission_status'),''),'미상신')<>'미상신' OR p->'legacy_ceo_direct'='true'::jsonb THEN RETURN '대표이사 상신·승인·반려 기록이 있어 점수 등록을 잠갔습니다.'; END IF;
 IF nullif(p->>'second_evaluation_total','') IS NOT NULL OR (coalesce(p->'second_evaluation','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)) THEN RETURN '항목별 3차 평가가 이미 있습니다. 기존 심사절차를 사용하세요.'; END IF;
 IF c->>'source' IS DISTINCT FROM 'v293' OR c->>'proposal_id' IS DISTINCT FROM p->>'id'
 OR c->'approval_required' IS DISTINCT FROM 'false'::jsonb OR c->'legacy_eligible' IS DISTINCT FROM 'true'::jsonb OR c->'blocking_count' IS DISTINCT FROM '0'::jsonb THEN RETURN '실제 결재기록 또는 조회 상태를 확인해야 합니다. 기록을 삭제하지 마세요.'; END IF;
 IF p->>'updated_at' IS NULL OR (p->>'updated_at')::timestamptz IS DISTINCT FROM (c->>'proposal_updated_at')::timestamptz THEN RETURN '자료가 변경되었습니다. 다시 조회하세요.'; END IF;
 RETURN NULL;
END; $function$;

CREATE OR REPLACE FUNCTION public.v295_list_ceo_submission_candidates()
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE p public.proposals%ROWTYPE;c jsonb;a jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN RAISE EXCEPTION '시스템 관리자 전용입니다.' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT x||jsonb_build_object('updated_at',p0.updated_at,'legacy_direct',false) FROM public.v289_list_ceo_submission_candidates() x JOIN public.proposals p0 ON p0.id=(x->>'proposal_id')::uuid WHERE NOT p0.legacy_ceo_direct;
 FOR p IN SELECT * FROM public.proposals WHERE approval_required=false AND legacy_score_revision>0 AND legacy_score_registered_at IS NOT NULL AND legacy_ceo_direct=false AND payment_status IN('미지급','예정') AND status='심사완료' AND coalesce(nullif(ceo_submission_status,''),'미상신')='미상신' ORDER BY proposal_no LOOP
  c:=public.v293_review_context_internal(p.id);
  IF public.v295_legacy_score_denial(to_jsonb(p),c) IS NOT NULL THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.proposal_legacy_score_history_v295 h WHERE h.proposal_id=p.id AND h.revision=p.legacy_score_revision AND h.after_score=p.score AND h.after_result=p.review_result AND h.after_award=p.award_amount) THEN CONTINUE; END IF;
  a:=public.v291_award_for(p.score,p.review_result);
  IF a->'ready' IS DISTINCT FROM 'true'::jsonb OR a->>'amount' IS NULL OR p.award_amount IS DISTINCT FROM (a->>'amount')::bigint THEN CONTINUE; END IF;
  RETURN NEXT jsonb_build_object('proposal_id',p.id,'proposal_no',p.proposal_no,'title',p.title,'proposer_name',p.proposer_name,'department',p.department,'received_date',p.received_date,'review_result',p.review_result,'score',p.score,'award_amount',p.award_amount,'proposer_effect_amount',p.proposer_effect_amount,'effect_amount',p.effect_amount,'executive_approved_at',NULL,'legacy_direct',true,'updated_at',p.updated_at);
 END LOOP;
END; $function$;

CREATE OR REPLACE FUNCTION public.v295_preserve_legacy_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE op text:=coalesce(current_setting('app.v295_operation',true),''); allowed text[];
BEGIN
 IF coalesce(current_setting('app.v295_target',true),'')=OLD.id::text THEN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='42501'; END IF;
  IF op IN('register','submit') AND NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN RAISE EXCEPTION '시스템 관리자 전용입니다.' USING ERRCODE='42501'; END IF;
  NEW.reviewer_id:=OLD.reviewer_id;
  NEW.updated_at:=greatest(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  IF op='register' THEN
   allowed:=ARRAY['score','review_result','status','locked','award_grade','award_amount','updated_at','legacy_score_revision','legacy_score_registered_at','legacy_score_basis','legacy_score_recorded_by_name'];
  ELSIF op='submit' THEN
   NEW.locked:=OLD.locked;
   allowed:=ARRAY['legacy_ceo_direct','ceo_submission_status','ceo_submitted_at','ceo_submitted_by','ceo_submitted_by_name','ceo_batch_id','updated_at'];
  ELSIF op='act' THEN
   NEW.locked:=OLD.locked;allowed:=ARRAY['ceo_submission_status','updated_at'];
   IF NOT OLD.legacy_ceo_direct OR NOT EXISTS(SELECT 1 FROM public.approval_records r JOIN public.approval_steps s ON s.id=r.step_id WHERE r.proposal_id=OLD.id AND s.role_name='대표이사' AND r.approved_by=auth.uid() AND r.status IN('승인','반려')) THEN RAISE EXCEPTION '대표이사 결재 권한을 확인하지 못했습니다.' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION '기존 심사 전용 작업을 확인하지 못했습니다.'; END IF;
  IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN RAISE EXCEPTION '1·2·3차 점수·지급·제안정보 변경이 감지되어 작업을 취소했습니다.'; END IF;
 ELSIF NEW.legacy_score_revision IS DISTINCT FROM OLD.legacy_score_revision
 OR NEW.legacy_score_registered_at IS DISTINCT FROM OLD.legacy_score_registered_at
 OR NEW.legacy_score_basis IS DISTINCT FROM OLD.legacy_score_basis
 OR NEW.legacy_score_recorded_by_name IS DISTINCT FROM OLD.legacy_score_recorded_by_name
 OR NEW.legacy_ceo_direct IS DISTINCT FROM OLD.legacy_ceo_direct THEN
  RAISE EXCEPTION '기존 심사 이력은 전용 기능에서만 변경하세요.';
 ELSIF OLD.legacy_score_revision>0 AND (NEW.score IS DISTINCT FROM OLD.score OR NEW.review_result IS DISTINCT FROM OLD.review_result OR NEW.award_amount IS DISTINCT FROM OLD.award_amount OR NEW.award_grade IS DISTINCT FROM OLD.award_grade)
 AND coalesce(current_setting('app.v294_paid_legacy_target',true),'')<>OLD.id::text THEN
  RAISE EXCEPTION '등록된 과거 총점·결과·포상은 기존 심사점수 화면에서 정정하세요.';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.v295_submit_proposals_to_ceo(p_proposal_ids uuid[], p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE ids uuid[];wanted integer;valid integer;step public.approval_steps%ROWTYPE;assign public.approval_assignments%ROWTYPE;p public.proposals%ROWTYPE;saved public.proposals%ROWTYPE;
 actor text;bid uuid:=gen_random_uuid();at_time timestamptz:=clock_timestamp();old_target text;old_op text;c jsonb;a jsonb;before_r jsonb;after_r jsonb;anchor uuid;current_ceo public.approval_records%ROWTYPE;
 allowed text[]:=ARRAY['legacy_ceo_direct','ceo_submission_status','ceo_submitted_at','ceo_submitted_by','ceo_submitted_by_name','ceo_batch_id','updated_at'];
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.admins WHERE user_id=auth.uid()) THEN RAISE EXCEPTION '시스템 관리자만 상신할 수 있습니다.' USING ERRCODE='42501'; END IF;
 SELECT array_agg(DISTINCT x ORDER BY x) INTO ids FROM unnest(coalesce(p_proposal_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;wanted:=coalesce(cardinality(ids),0);
 IF wanted=0 OR wanted>200 THEN RAISE EXCEPTION '상신할 제안을 1~200건 선택하세요.'; END IF;
 IF jsonb_typeof(p_expected) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '상신목록을 다시 조회하세요.'; END IF;
 PERFORM 1 FROM public.proposals WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.approval_records WHERE proposal_id=ANY(ids) ORDER BY proposal_id,id FOR UPDATE;
 PERFORM 1 FROM public.approval_steps ORDER BY id FOR SHARE;
 SELECT count(*) INTO valid FROM public.v295_list_ceo_submission_candidates() x WHERE (x->>'proposal_id')::uuid=ANY(ids);
 IF valid<>wanted THEN RAISE EXCEPTION '선택한 제안의 심사·결재·미지급 조건이 변경되었습니다. 다시 조회하세요.'; END IF;
 IF (SELECT count(*) FROM public.approval_steps WHERE active=true AND auto_author=false AND role_name='대표이사')<>1 THEN RAISE EXCEPTION '활성 대표이사 결재단계를 한 개로 확인하세요.'; END IF;
 SELECT * INTO STRICT step FROM public.approval_steps WHERE active=true AND auto_author=false AND role_name='대표이사';
 SELECT * INTO assign FROM public.approval_assignments WHERE step_id=step.id AND active=true AND nullif(btrim(coalesce(department,'')),'') IS NULL ORDER BY id DESC LIMIT 1 FOR SHARE;
 IF assign.id IS NULL OR assign.user_id IS NULL OR nullif(btrim(assign.email),'') IS NULL THEN RAISE EXCEPTION '대표이사 결재자 계정·메일을 지정하세요.'; END IF;
 SELECT coalesce(display_name,'관리자') INTO actor FROM public.admins WHERE user_id=auth.uid();
 old_target:=coalesce(current_setting('app.v295_target',true),'');old_op:=coalesce(current_setting('app.v295_operation',true),'');
 FOR p IN SELECT * FROM public.proposals WHERE id=ANY(ids) ORDER BY id LOOP
  IF nullif(p_expected->>p.id::text,'') IS NULL OR p.updated_at IS DISTINCT FROM (p_expected->>p.id::text)::timestamptz THEN RAISE EXCEPTION '%: 목록이 변경되었습니다. 새로 조회하고 상신하세요.',p.proposal_no USING ERRCODE='40001'; END IF;
  a:=public.v291_award_for(CASE WHEN p.legacy_score_revision>0 THEN p.score WHEN p.third_review_mode='outcome' THEN p.team_leader_evaluation_total ELSE p.second_evaluation_total END,p.review_result);
  IF a->'ready' IS DISTINCT FROM 'true'::jsonb OR a->>'amount' IS NULL OR p.award_amount IS DISTINCT FROM (a->>'amount')::bigint THEN RAISE EXCEPTION '%: 저장금액과 포상기준이 다릅니다.',p.proposal_no; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO before_r FROM public.approval_records r WHERE proposal_id=p.id AND step_id<>step.id;
  SELECT * INTO current_ceo FROM public.approval_records WHERE proposal_id=p.id AND step_id=step.id;
  IF FOUND AND (current_ceo.status<>'대기' OR current_ceo.approved_by IS NOT NULL OR current_ceo.acted_at IS NOT NULL OR current_ceo.actionable_at IS NOT NULL) THEN RAISE EXCEPTION '%: 기존 대표결재가 시작되었으므로 상신을 취소합니다.',p.proposal_no; END IF;
  PERFORM set_config('app.v295_target',p.id::text,true);PERFORM set_config('app.v295_operation','submit',true);
  UPDATE public.proposals SET legacy_ceo_direct=(p.approval_required=false AND p.legacy_score_revision>0),ceo_submission_status='상신완료',ceo_submitted_at=at_time,ceo_submitted_by=auth.uid(),ceo_submitted_by_name=actor,ceo_batch_id=bid WHERE id=p.id;
  INSERT INTO public.approval_records(proposal_id,step_id,status,assigned_user_id,assigned_name,actionable_at,created_at,updated_at)
  VALUES(p.id,step.id,'대기',assign.user_id,assign.display_name,at_time,at_time,at_time)
  ON CONFLICT(proposal_id,step_id) DO UPDATE SET assigned_user_id=excluded.assigned_user_id,assigned_name=excluded.assigned_name,actionable_at=excluded.actionable_at,updated_at=excluded.updated_at;
  SELECT * INTO STRICT saved FROM public.proposals WHERE id=p.id;
  IF (to_jsonb(p)-allowed) IS DISTINCT FROM (to_jsonb(saved)-allowed) THEN RAISE EXCEPTION '상신 중 기존 심사·금액·지급 정보 변경을 감지했습니다.'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO after_r FROM public.approval_records r WHERE proposal_id=p.id AND step_id<>step.id;
  IF before_r IS DISTINCT FROM after_r THEN RAISE EXCEPTION '부서장·임원 등 기존 결재기록 변경이 감지되어 상신을 취소했습니다.'; END IF;
  INSERT INTO public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_id,actor_name,happened_at)
  VALUES(p.id,p.proposal_no,'대표이사 일괄상신',CASE WHEN saved.legacy_ceo_direct THEN '기존 확정 심사 '||p.score||'점 · 관리자 근거확인 후 대표이사 직접 상신 (부서장/임원 신규 승인 아님)' ELSE '관리자 심사완료 후 대표이사 상신' END,auth.uid(),actor,at_time);
  INSERT INTO public.proposal_audit_logs(proposal_id,proposal_no,action,field_name,old_value,new_value,actor_id,actor_name)
  VALUES(p.id,p.proposal_no,'BATCH_SUBMIT','ceo_submission_status',to_jsonb(p.ceo_submission_status),jsonb_build_object('status','상신완료','batch_id',bid,'legacy_direct',saved.legacy_ceo_direct,'score',p.score,'award_amount',p.award_amount),auth.uid(),actor);
 END LOOP;
 PERFORM set_config('app.v295_target',old_target,true);PERFORM set_config('app.v295_operation',old_op,true);
 anchor:=ids[1];
 INSERT INTO public.proposal_notification_queue(proposal_id,step_id,recipient_email,recipient_name,notification_type,status,available_at,ceo_batch_id)
 VALUES(anchor,step.id,lower(assign.email),assign.display_name,'ceo_batch','pending',at_time,bid);
 RETURN jsonb_build_object('batch_id',bid,'submitted_count',wanted);
END; $function$;

CREATE OR REPLACE FUNCTION public.v2_admin_name()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select display_name from public.admins where user_id = auth.uid()),
    case when auth.uid() is null then '시스템/제안자' else '관리자' end
  );
$function$;

CREATE OR REPLACE FUNCTION public.v2_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_first_self_evaluation_v256()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_eval jsonb;
  v_originality integer;
  v_effort integer;
  v_feasibility integer;
  v_applicability integer;
  v_continuity integer;
  v_tangible_effect integer;
  v_total integer;
begin
  if tg_op = 'UPDATE' and new.first_evaluation is not distinct from old.first_evaluation then
    return new;
  end if;

  v_eval := coalesce(new.first_evaluation, '{}'::jsonb);
  if v_eval = '{}'::jsonb then
    raise exception '1차 자기평가 6개 항목을 모두 입력하세요.';
  end if;

  begin
    v_originality := (v_eval->>'originality')::integer;
    v_effort := (v_eval->>'effort')::integer;
    v_feasibility := (v_eval->>'feasibility')::integer;
    v_applicability := (v_eval->>'applicability')::integer;
    v_continuity := (v_eval->>'continuity')::integer;
    v_tangible_effect := (v_eval->>'tangible_effect')::integer;
  exception when others then
    raise exception '1차 자기평가 6개 항목을 모두 1~10점으로 입력하세요.';
  end;

  if v_originality not between 1 and 10
     or v_effort not between 1 and 10
     or v_feasibility not between 1 and 10
     or v_applicability not between 1 and 10
     or v_continuity not between 1 and 10
     or v_tangible_effect not between 1 and 10 then
    raise exception '1차 자기평가 점수는 각 항목 1~10점만 입력할 수 있습니다.';
  end if;

  v_total := v_originality * 2
           + v_effort * 2
           + v_feasibility
           + v_applicability
           + v_continuity
           + v_tangible_effect * 3;

  if v_total < 50 then
    raise exception '1차 자기평가 총점이 %점입니다. 기준미달입니다. 50점 이상이어야 등록할 수 있습니다.', v_total;
  end if;

  new.first_evaluation_total := v_total;
  new.first_evaluation_completed_at := coalesce(new.first_evaluation_completed_at, now());
  return new;
end;
$function$;
RESET check_function_bodies;

CREATE OR REPLACE FUNCTION public.retry_proposal_notification(p_notification_id bigint)
 RETURNS proposal_notification_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row public.proposal_notification_queue;
begin
  if not public.is_admin() then raise exception '시스템 관리자만 재전송할 수 있습니다.'; end if;

  update public.proposal_notification_queue
     set status = 'pending',
         available_at = now(),
         last_error = null,
         updated_at = now()
   where id = p_notification_id
     and status = 'failed'
   returning * into v_row;

  if v_row.id is null then raise exception '재전송 가능한 실패 알림을 찾지 못했습니다.'; end if;
  return v_row;
end;
$function$;
