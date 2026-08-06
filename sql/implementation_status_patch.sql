-- 하나금속 제안 등록/수정 화면 실시상태 3단계 저장 패치
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 1회 실행하세요.
-- 기존 테이블과 데이터는 삭제하거나 초기화하지 않습니다.

create or replace function public.create_proposal(
  p_payload jsonb,
  p_edit_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.proposals;
  next_implementation_status text;
  next_implemented_date date;
begin
  if p_edit_pin !~ '^[0-9]{4}$' then
    raise exception '수정번호는 숫자 4자리여야 합니다.';
  end if;

  if nullif(trim(p_payload->>'proposer_name'), '') is null
     or nullif(trim(p_payload->>'department'), '') is null
     or nullif(trim(p_payload->>'title'), '') is null
     or nullif(trim(p_payload->>'current_problem'), '') is null
     or nullif(trim(p_payload->>'improvement_plan'), '') is null
     or nullif(trim(p_payload->>'expected_effect'), '') is null then
    raise exception '필수 제안 항목이 누락되었습니다.';
  end if;

  if not exists (
    select 1
    from public.employees
    where name = trim(p_payload->>'proposer_name')
      and department = trim(p_payload->>'department')
      and active = true
  ) then
    raise exception '활성 직원명단에서 제안자를 찾지 못했습니다.';
  end if;

  next_implementation_status := coalesce(
    nullif(trim(p_payload->>'implementation_status'), ''),
    '미실시'
  );

  if next_implementation_status not in ('미실시', '진행중', '완료') then
    raise exception '실시상태를 다시 선택하세요.';
  end if;

  if next_implementation_status = '완료' then
    if nullif(trim(p_payload->>'implemented_date'), '') is null then
      raise exception '완료 상태는 실시일을 입력하세요.';
    end if;
    next_implemented_date := (p_payload->>'implemented_date')::date;
  else
    next_implemented_date := null;
  end if;

  insert into public.proposals (
    proposal_no,
    received_date,
    category,
    proposer_name,
    department,
    title,
    current_problem,
    improvement_plan,
    expected_effect,
    cost_amount,
    before_images,
    after_images,
    edit_pin_hash,
    implementation_status,
    implemented_date
  )
  values (
    public.next_proposal_no(),
    current_date,
    p_payload->>'category',
    trim(p_payload->>'proposer_name'),
    trim(p_payload->>'department'),
    trim(p_payload->>'title'),
    trim(p_payload->>'current_problem'),
    trim(p_payload->>'improvement_plan'),
    trim(p_payload->>'expected_effect'),
    coalesce((nullif(p_payload->>'cost_amount', ''))::bigint, 0),
    coalesce(p_payload->'before_images', '[]'::jsonb),
    coalesce(p_payload->'after_images', '[]'::jsonb),
    encode(digest(p_edit_pin, 'sha256'), 'hex'),
    next_implementation_status,
    next_implemented_date
  )
  returning * into created;

  return to_jsonb(created) - 'edit_pin_hash' - 'reviewer_id';
end;
$$;

create or replace function public.edit_proposal_with_pin(
  p_proposal_no text,
  p_edit_pin text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.proposals;
  updated_row public.proposals;
  next_name text;
  next_department text;
  next_implementation_status text;
  next_implemented_date date;
begin
  select *
  into current_row
  from public.proposals
  where proposal_no = p_proposal_no
  for update;

  if not found then
    raise exception '접수번호를 찾지 못했습니다.';
  end if;

  if current_row.locked or current_row.status in ('심사중', '심사완료') then
    raise exception '관리자가 심사를 시작하여 수정이 잠겼습니다.';
  end if;

  if current_row.edit_pin_hash <> encode(digest(p_edit_pin, 'sha256'), 'hex') then
    raise exception '수정번호가 일치하지 않습니다.';
  end if;

  next_name := coalesce(nullif(trim(p_payload->>'proposer_name'), ''), current_row.proposer_name);
  next_department := coalesce(nullif(trim(p_payload->>'department'), ''), current_row.department);

  if not exists (
    select 1
    from public.employees
    where name = next_name
      and department = next_department
      and active = true
  ) then
    raise exception '활성 직원명단에서 제안자를 찾지 못했습니다.';
  end if;

  if p_payload ? 'implementation_status' then
    next_implementation_status := nullif(trim(p_payload->>'implementation_status'), '');
  else
    next_implementation_status := current_row.implementation_status;
  end if;

  if next_implementation_status not in ('미실시', '진행중', '완료') then
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

  update public.proposals
  set
    category = coalesce(nullif(p_payload->>'category', ''), category),
    proposer_name = next_name,
    department = next_department,
    title = coalesce(nullif(trim(p_payload->>'title'), ''), title),
    current_problem = coalesce(nullif(trim(p_payload->>'current_problem'), ''), current_problem),
    improvement_plan = coalesce(nullif(trim(p_payload->>'improvement_plan'), ''), improvement_plan),
    expected_effect = coalesce(nullif(trim(p_payload->>'expected_effect'), ''), expected_effect),
    cost_amount = coalesce((nullif(p_payload->>'cost_amount', ''))::bigint, cost_amount),
    before_images = case
      when p_payload ? 'before_images' then p_payload->'before_images'
      else before_images
    end,
    after_images = case
      when p_payload ? 'after_images' then p_payload->'after_images'
      else after_images
    end,
    implementation_status = next_implementation_status,
    implemented_date = next_implemented_date,
    updated_at = now()
  where id = current_row.id
  returning * into updated_row;

  return to_jsonb(updated_row) - 'edit_pin_hash' - 'reviewer_id';
end;
$$;

grant execute on function public.create_proposal(jsonb, text) to anon, authenticated;
grant execute on function public.edit_proposal_with_pin(text, text, jsonb) to anon, authenticated;
