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
$function$


CREATE OR REPLACE FUNCTION public.v23_enqueue_due_reminders()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  rec record;
  v_type text;
  v_count bigint := 0;
  v_rowcount bigint := 0;
begin
  for rec in
    select p.id proposal_id, p.department, r.step_id, r.actionable_at, a.email, a.display_name
    from public.approval_records r
    join public.proposals p on p.id = r.proposal_id and p.approval_required = true
    join public.approval_steps s on s.id = r.step_id and s.active = true and s.auto_author = false
    join lateral (
      select aa.email, aa.display_name
      from public.approval_assignments aa
      where aa.step_id = r.step_id and aa.active = true
        and public.v235_assignment_scope_matches(s.step_order, aa.department, p.department)
      order by aa.id desc limit 1
    ) a on true
    where r.status = '대기' and r.actionable_at is not null
      and not exists (
        select 1 from public.approval_steps ps
        left join public.approval_records pr on pr.proposal_id = p.id and pr.step_id = ps.id
        where ps.active = true and ps.step_order < s.step_order and coalesce(pr.status, '대기') <> '승인'
      )
      and not exists (
        select 1 from public.approval_records xr
        join public.approval_steps xs on xs.id = xr.step_id and xs.active = true
        where xr.proposal_id = p.id and xr.status = '반려'
      )
  loop
    v_type := case
      when now() - rec.actionable_at >= interval '7 days' then 'reminder_7d'
      when now() - rec.actionable_at >= interval '3 days' then 'reminder_3d'
      when now() - rec.actionable_at >= interval '1 day' then 'reminder_1d'
      else null
    end;

    if v_type is not null then
      insert into public.proposal_notification_queue(
        proposal_id, step_id, recipient_email, recipient_name, notification_type, status, available_at
      ) values (rec.proposal_id, rec.step_id, lower(rec.email), rec.display_name, v_type, 'pending', now())
      on conflict do nothing;
      get diagnostics v_rowcount = row_count;
      v_count := v_count + v_rowcount;

      if v_type = 'reminder_7d' then
        insert into public.proposal_notification_queue(
          proposal_id, step_id, recipient_email, recipient_name, notification_type, status, available_at
        )
        select rec.proposal_id, rec.step_id, lower(u.email), coalesce(ad.display_name, u.email), 'admin_7d', 'pending', now()
        from public.admins ad join auth.users u on u.id = ad.user_id
        where nullif(btrim(coalesce(u.email, '')), '') is not null
        on conflict do nothing;
        get diagnostics v_rowcount = row_count;
        v_count := v_count + v_rowcount;
      end if;
    end if;
  end loop;
  return v_count;
end;
$function$


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
$function$

