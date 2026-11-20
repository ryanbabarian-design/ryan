-- V2.9.17. Apply atomically. Installation does not create proposals, enqueue mail or change business records.
CREATE SCHEMA proposal_private_v2917;
REVOKE ALL ON SCHEMA proposal_private_v2917 FROM PUBLIC, anon, authenticated;
CREATE TABLE proposal_private_v2917.requests (
  request_id uuid PRIMARY KEY,
  payload_hash bytea NOT NULL,
  pin_verifier text NOT NULL,
  receipt jsonb NOT NULL
);
ALTER TABLE proposal_private_v2917.requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON proposal_private_v2917.requests FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.v2917_create_proposal(p_request_id uuid,p_payload jsonb,p_edit_pin text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous proposal_private_v2917.requests%ROWTYPE;
  fingerprint bytea; created_row jsonb; receipt jsonb;
BEGIN
  IF p_request_id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '접수 요청 번호와 제안 내용을 확인하세요.';
  END IF;
  IF p_edit_pin IS NULL OR p_edit_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION '수정번호는 숫자 4자리입니다.'; END IF;
  -- Hash the complete body, including ordered photo metadata. Serialize concurrent first attempts.
  fingerprint := sha256(convert_to(p_payload::text,'UTF8'));
  PERFORM pg_advisory_xact_lock(2917,hashtext(p_request_id::text));
  SELECT * INTO previous FROM proposal_private_v2917.requests WHERE request_id=p_request_id;
  IF FOUND THEN
    IF previous.payload_hash IS DISTINCT FROM fingerprint OR
       extensions.crypt(p_edit_pin,previous.pin_verifier) IS DISTINCT FROM previous.pin_verifier THEN
      RAISE EXCEPTION '같은 접수 요청의 제안 내용 또는 수정번호가 다릅니다.' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('proposal',previous.receipt,'created',false);
  END IF;
  created_row := public.create_proposal(p_payload,p_edit_pin);
  receipt := jsonb_build_object('id',created_row->'id','proposal_no',created_row->'proposal_no','received_date',created_row->'received_date');
  INSERT INTO proposal_private_v2917.requests(request_id,payload_hash,pin_verifier,receipt)
    VALUES(p_request_id,fingerprint,extensions.crypt(p_edit_pin,extensions.gen_salt('bf',8)),receipt);
  RETURN jsonb_build_object('proposal',receipt,'created',true);
END $$;

-- Existing 3-valued PIN comparisons must never receive a NULL PIN.
ALTER FUNCTION public.edit_proposal_with_pin(text,text,jsonb) RETURNS NULL ON NULL INPUT;
CREATE FUNCTION public.v2917_edit_proposal(p_proposal_no text,p_edit_pin text,p_payload jsonb,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE revision timestamptz; edited jsonb;
BEGIN
  IF p_edit_pin IS NULL OR p_edit_pin !~ '^[0-9]{4}$' THEN RAISE EXCEPTION '수정번호는 숫자 4자리입니다.'; END IF;
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '수정 내용을 확인하세요.'; END IF;
  SELECT updated_at INTO revision FROM public.proposals WHERE proposal_no=p_proposal_no FOR UPDATE;
  IF NOT FOUND OR p_expected_updated_at IS NULL OR revision IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '원본이 변경되었거나 접수번호가 없습니다. 제안을 다시 조회하세요.' USING ERRCODE='40001';
  END IF;
  edited := public.edit_proposal_with_pin(p_proposal_no,p_edit_pin,p_payload);
  RETURN jsonb_build_object('id',edited->'id','proposal_no',edited->'proposal_no','received_date',edited->'received_date','updated_at',edited->'updated_at');
END $$;

CREATE FUNCTION public.v2917_approve_team(p_proposal_id uuid,p_step_id bigint,p_evaluation jsonb,p_comment text,p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE revision timestamptz; result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='42501'; END IF;
  SELECT updated_at INTO revision FROM public.proposals WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND OR p_expected_updated_at IS NULL OR revision IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '제안이 변경되었습니다. 다시 조회하세요.' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.approval_steps WHERE id=p_step_id AND active AND NOT auto_author AND role_name='부서장' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '부서장 결재단계만 평가와 함께 승인할 수 있습니다.'; END IF;
  PERFORM public.save_team_leader_evaluation_v258(p_proposal_id,p_evaluation);
  result := public.v295_act_approval(p_proposal_id,p_step_id,'승인',p_comment);
  IF result->>'status' IS DISTINCT FROM '승인' THEN RAISE EXCEPTION '승인 결과를 확인하지 못했습니다.'; END IF;
  RETURN jsonb_build_object('proposal_id',p_proposal_id,'step_id',p_step_id,'status','승인');
END $$;

-- Scope only CEO batch notices by their actual submission cycle. Retain historical deduplication for all other types.
CREATE UNIQUE INDEX proposal_notification_cycle_dedupe_v2917 ON public.proposal_notification_queue
  (proposal_id,coalesce(step_id,0),lower(recipient_email),notification_type,
   (coalesce(CASE WHEN notification_type='ceo_batch' THEN ceo_batch_id END,'00000000-0000-0000-0000-000000000000'::uuid)));
DROP INDEX public.proposal_notification_dedupe_uq;

-- Existing assignment-on-insert clears all non-electronic records before v295's upsert.
-- Restore the authorized direct CEO assignment only inside the established v295 submit transaction.
CREATE FUNCTION proposal_private_v2917.direct_ceo_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE submitted_at timestamptz;
BEGIN
  IF current_setting('app.v295_operation',true) IS DISTINCT FROM 'submit' OR
     current_setting('app.v295_target',true) IS DISTINCT FROM NEW.proposal_id::text THEN RETURN NEW; END IF;
  SELECT p.ceo_submitted_at INTO submitted_at FROM public.proposals p JOIN public.approval_steps s ON s.id=NEW.step_id
   WHERE p.id=NEW.proposal_id AND NOT p.approval_required AND p.legacy_ceo_direct AND p.legacy_score_revision>0
     AND p.ceo_submission_status='상신완료' AND s.active AND NOT s.auto_author AND s.role_name='대표이사';
  IF FOUND THEN
    IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION '시스템 관리자 전용입니다.' USING ERRCODE='42501'; END IF;
    SELECT a.user_id,a.display_name INTO STRICT NEW.assigned_user_id,NEW.assigned_name
      FROM public.approval_assignments a WHERE a.step_id=NEW.step_id AND a.active AND nullif(btrim(a.department),'') IS NULL
      ORDER BY a.id DESC LIMIT 1 FOR SHARE;
    NEW.actionable_at:=submitted_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER z_v2917_direct_ceo_assignment BEFORE INSERT ON public.approval_records
  FOR EACH ROW EXECUTE FUNCTION proposal_private_v2917.direct_ceo_assignment();

-- Old single-sign RPCs can read the proposal before taking the record lock. Recheck its state under a lock at signing.
CREATE FUNCTION proposal_private_v2917.check_ceo_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status='대기' AND NEW.status IN ('승인','반려') AND EXISTS(
     SELECT 1 FROM public.approval_steps WHERE id=NEW.step_id AND role_name='대표이사') THEN
    PERFORM 1 FROM public.proposals WHERE id=NEW.proposal_id AND ceo_submission_status='상신완료' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '상신 상태가 변경되었습니다. 다시 조회하세요.' USING ERRCODE='40001'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER v2917_check_ceo_signature BEFORE UPDATE OF status ON public.approval_records
  FOR EACH ROW EXECUTE FUNCTION proposal_private_v2917.check_ceo_signature();

-- Older initial-batch workers stored both provider rejections and transport uncertainty as failed.
-- Keep evidence until an administrator reconciles the provider outcome of an attempted ambiguous delivery.
CREATE FUNCTION proposal_private_v2917.uncertain_failed_batch(p_type text,p_status text,p_attempts integer,p_error text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_type='ceo_batch' AND p_status='failed' AND (
    starts_with(coalesce(p_error,''),'발송 확인 필요:') OR (coalesce(p_attempts,0)>0 AND NOT (
      starts_with(coalesce(p_error,''),'발송 전 확인 실패: ') OR coalesce(p_error,'') ~ '^Resend (400|401|403|404|422|429):' OR
      coalesce(p_error,'') IN ('대표이사 결재자 배정이 변경되어 발송을 중단했습니다.','현재 대표이사 상신대상 제안이 없습니다.')
    )));
$$;
CREATE OR REPLACE FUNCTION public.retry_proposal_notification(p_notification_id bigint)
RETURNS public.proposal_notification_queue LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE row_to_retry public.proposal_notification_queue%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION '시스템 관리자만 재전송할 수 있습니다.'; END IF;
  SELECT * INTO row_to_retry FROM public.proposal_notification_queue WHERE id=p_notification_id AND status='failed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '재전송 가능한 실패 알림을 찾지 못했습니다.'; END IF;
  IF proposal_private_v2917.uncertain_failed_batch(row_to_retry.notification_type,row_to_retry.status,row_to_retry.attempts,row_to_retry.last_error) THEN
    RAISE EXCEPTION '기존 대표상신 메일의 발송 결과를 먼저 확인하세요.' USING ERRCODE='55000'; END IF;
  UPDATE public.proposal_notification_queue SET status='pending',available_at=now(),last_error=NULL,updated_at=now()
    WHERE id=p_notification_id RETURNING * INTO row_to_retry;
  RETURN row_to_retry;
END $$;

CREATE FUNCTION public.v2917_recall_ceo(p_proposal_ids uuid[],p_reason text,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ids uuid[]; batch_ids uuid[]; ceo bigint; p public.proposals%ROWTYPE; r public.approval_records%ROWTYPE;
  q public.proposal_notification_queue%ROWTYPE; remaining jsonb; anchor uuid;
  actor text; reason text:=btrim(p_reason); old_target text; old_op text;
BEGIN
  SELECT display_name INTO actor FROM public.admins WHERE user_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION '시스템 관리자만 상신을 회수할 수 있습니다.' USING ERRCODE='42501'; END IF;
  IF reason IS NULL OR length(reason) NOT BETWEEN 5 AND 1000 THEN RAISE EXCEPTION '회수 사유를 5~1,000자로 입력하세요.'; END IF;
  IF coalesce(cardinality(p_proposal_ids),0) NOT BETWEEN 1 AND 200 OR array_position(p_proposal_ids,NULL) IS NOT NULL
     OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '회수 목록을 다시 조회하세요.'; END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO ids FROM unnest(p_proposal_ids) id;
  -- The 2.9.16 scheduler uses the same transaction lock before reading eligibility or writing queue rows.
  PERFORM pg_advisory_xact_lock(2916,7);
  PERFORM 1 FROM public.proposals WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.proposals WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION '상신 목록이 변경되었습니다. 다시 조회하세요.'; END IF;
  PERFORM 1 FROM public.approval_records WHERE proposal_id=ANY(ids) ORDER BY proposal_id,id FOR UPDATE;
  PERFORM 1 FROM public.approval_steps ORDER BY id FOR SHARE;
  SELECT min(id) INTO ceo FROM public.approval_steps WHERE active AND NOT auto_author AND role_name='대표이사' HAVING count(*)=1;
  IF ceo IS NULL THEN RAISE EXCEPTION '활성 대표이사 결재단계를 확인하세요.'; END IF;
  SELECT array_agg(DISTINCT ceo_batch_id) FILTER(WHERE ceo_batch_id IS NOT NULL) INTO batch_ids FROM public.proposals WHERE id=ANY(ids);
  old_target:=coalesce(current_setting('app.v295_target',true),''); old_op:=coalesce(current_setting('app.v295_operation',true),'');
  FOR p IN SELECT * FROM public.proposals WHERE id=ANY(ids) ORDER BY id LOOP
    IF (p_expected->>p.id::text)::timestamptz IS DISTINCT FROM p.updated_at THEN
      RAISE EXCEPTION '%: 목록이 변경되었습니다. 다시 조회하세요.',p.proposal_no USING ERRCODE='40001'; END IF;
    SELECT * INTO r FROM public.approval_records WHERE proposal_id=p.id AND step_id=ceo;
    IF p.ceo_submission_status IS DISTINCT FROM '상신완료' OR p.payment_status NOT IN ('미지급','예정')
       OR r.id IS NULL OR r.status IS DISTINCT FROM '대기' OR r.approved_by IS NOT NULL OR r.acted_at IS NOT NULL
       OR nullif(btrim(r.approver_name),'') IS NOT NULL OR nullif(btrim(r.comment),'') IS NOT NULL
       OR EXISTS(SELECT 1 FROM public.approval_records a JOIN public.approval_steps s ON s.id=a.step_id
         WHERE a.proposal_id=p.id AND s.role_name='대표이사' AND a.id<>r.id
           AND public.v293_approval_record_kind(to_jsonb(a),to_jsonb(s))<>'empty_pending') THEN
      RAISE EXCEPTION '%: 지급 전 대표이사 승인 대기 건만 회수할 수 있습니다.',p.proposal_no;
    END IF;
    -- The existing submit guard admits precisely these fields and preserves reviewer_id, locked, scores and payment.
    PERFORM set_config('app.v295_target',p.id::text,true); PERFORM set_config('app.v295_operation','submit',true);
    UPDATE public.proposals SET legacy_ceo_direct=false,ceo_submission_status='미상신',ceo_submitted_at=NULL,
      ceo_submitted_by=NULL,ceo_submitted_by_name=NULL,ceo_batch_id=NULL WHERE id=p.id;
    UPDATE public.approval_records SET actionable_at=NULL WHERE id=r.id AND actionable_at IS NOT NULL;
    INSERT INTO public.proposal_review_history_v287(proposal_id,proposal_no,action,actor_id,actor_name,reason,before_data,after_data)
      VALUES(p.id,p.proposal_no,'대표이사 상신 회수',auth.uid(),actor,reason,
        jsonb_build_object('ceo_submission_status',p.ceo_submission_status,'ceo_submitted_at',p.ceo_submitted_at,'ceo_batch_id',p.ceo_batch_id,'legacy_ceo_direct',p.legacy_ceo_direct,'actionable_at',r.actionable_at),
        jsonb_build_object('ceo_submission_status','미상신','ceo_submitted_at',NULL,'ceo_batch_id',NULL,'legacy_ceo_direct',false,'actionable_at',NULL));
    INSERT INTO public.proposal_status_history(proposal_id,proposal_no,stage,detail,actor_id,actor_name,happened_at)
      VALUES(p.id,p.proposal_no,'대표이사 상신 회수','관리자가 대표이사 상신을 회수했습니다.',auth.uid(),actor,clock_timestamp());
  END LOOP;
  PERFORM set_config('app.v295_target',old_target,true); PERFORM set_config('app.v295_operation',old_op,true);
  FOR q IN SELECT n.* FROM public.proposal_notification_queue n JOIN public.approval_steps s ON s.id=n.step_id AND s.role_name='대표이사'
    WHERE n.status IN('pending','failed','sending') AND (
    (n.notification_type='ceo_batch' AND n.ceo_batch_id=ANY(batch_ids)) OR
    (n.notification_type='ceo_reminder_7d' AND EXISTS(SELECT 1 FROM jsonb_array_elements(n.digest_items) m WHERE (m->>'proposal_id')::uuid=ANY(ids))) OR
    (n.notification_type NOT IN('ceo_batch','ceo_reminder_7d') AND n.proposal_id=ANY(ids))) ORDER BY n.id FOR UPDATE OF n LOOP
    IF q.status='sending' OR proposal_private_v2917.uncertain_failed_batch(q.notification_type,q.status,q.attempts,q.last_error) THEN RAISE EXCEPTION '선택한 제안의 메일 발송 결과 확인 후 다시 회수하세요.' USING ERRCODE='55000'; END IF;
    IF q.notification_type='ceo_batch' THEN
      SELECT id INTO anchor FROM public.proposals WHERE ceo_batch_id=q.ceo_batch_id AND ceo_submission_status='상신완료' ORDER BY id LIMIT 1;
      IF anchor IS NOT NULL THEN
        UPDATE public.proposal_notification_queue SET proposal_id=anchor,updated_at=clock_timestamp() WHERE id=q.id AND proposal_id=ANY(ids);
        CONTINUE;
      END IF;
    ELSIF q.notification_type='ceo_reminder_7d' THEN
      SELECT jsonb_agg(item ORDER BY pos) INTO remaining FROM jsonb_array_elements(q.digest_items) WITH ORDINALITY AS d(item,pos)
        WHERE NOT ((item->>'proposal_id')::uuid=ANY(ids));
      IF remaining IS NOT NULL THEN
        UPDATE public.proposal_notification_queue SET digest_items=remaining,updated_at=clock_timestamp() WHERE id=q.id;
        CONTINUE;
      END IF;
    END IF;
    -- Canceled singleton digests retain their original items for audit, outside the pending/sending set.
    UPDATE public.proposal_notification_queue SET status='cancelled',last_error='대표이사 상신 회수',updated_at=clock_timestamp() WHERE id=q.id;
  END LOOP;
  RETURN jsonb_build_object('recalled_count',cardinality(ids),'proposal_ids',to_jsonb(ids));
END $$;

-- The scheduler and claimed-row reader use identical evidence for normal and direct CEO routes.
-- V2.9.16 recipient/cycle deduplication remains separate: a claimed row is validated against sent history.
CREATE VIEW proposal_private_v2917.due_ceo_reminders WITH (security_invoker=true) AS
SELECT p.id AS proposal_id,p.proposal_no,p.title,p.department,p.proposer_name,r.step_id,r.actionable_at,
       lower(btrim(a.email)) AS recipient_email,a.display_name
FROM public.approval_records r
JOIN public.proposals p ON p.id=r.proposal_id AND p.ceo_submission_status='상신완료'
JOIN public.approval_steps s ON s.id=r.step_id AND s.active AND NOT s.auto_author AND s.role_name='대표이사'
JOIN LATERAL (
  SELECT aa.user_id,aa.email,aa.display_name FROM public.approval_assignments aa
  WHERE aa.step_id=s.id AND aa.active AND CASE WHEN p.approval_required THEN
    public.v235_assignment_scope_matches(s.step_order,aa.department,p.department)
    ELSE nullif(btrim(aa.department),'') IS NULL END
  ORDER BY aa.id DESC LIMIT 1
) a ON nullif(btrim(a.email),'') IS NOT NULL
WHERE r.status='대기' AND r.actionable_at<=now()-interval '168 hours' AND (
  (p.approval_required AND NOT EXISTS (
    SELECT 1 FROM public.approval_steps ps LEFT JOIN public.approval_records pr ON pr.proposal_id=p.id AND pr.step_id=ps.id
    WHERE ps.active AND ps.step_order<s.step_order AND coalesce(pr.status,'대기')<>'승인'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.approval_records xr JOIN public.approval_steps xs ON xs.id=xr.step_id AND xs.active
    WHERE xr.proposal_id=p.id AND xr.status='반려'
  )) OR
  (NOT p.approval_required AND p.legacy_ceo_direct AND p.legacy_score_revision>0 AND p.legacy_score_registered_at IS NOT NULL
    AND p.payment_status IN('미지급','예정') AND r.assigned_user_id=a.user_id
    AND r.approved_by IS NULL AND r.acted_at IS NULL AND nullif(btrim(r.approver_name),'') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.approval_records other LEFT JOIN public.approval_steps os ON os.id=other.step_id
      WHERE other.proposal_id=p.id AND other.step_id<>s.id
        AND public.v293_approval_record_kind(to_jsonb(other),to_jsonb(os)) NOT IN('auto_author','empty_pending')
    ))
);
REVOKE ALL ON proposal_private_v2917.due_ceo_reminders FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA proposal_private_v2917 TO service_role;
GRANT SELECT ON proposal_private_v2917.due_ceo_reminders TO service_role;

CREATE OR REPLACE FUNCTION public.v23_enqueue_due_reminders()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  rec record;
  v_type text;
  v_count bigint := 0;
  v_rowcount bigint := 0;
BEGIN
  -- Serializes concurrent scheduler calls across their eligibility/dedupe reads.
  PERFORM pg_advisory_xact_lock(2916, 7);

  UPDATE public.proposal_notification_queue q
     SET status = 'cancelled', updated_at = now(),
         last_error = '대표이사 알림은 대기 7일 이후 묶음 알림으로 통합되었습니다.'
    FROM public.approval_steps s
   WHERE s.id = q.step_id AND s.role_name = '대표이사'
     AND q.status IN ('pending','failed')
     AND (
       q.notification_type IN ('reminder_1d','reminder_3d','reminder_7d')
       OR (q.notification_type = 'admin_7d' AND EXISTS (
         SELECT 1
         FROM public.proposals p
         JOIN LATERAL (
           SELECT aa.email FROM public.approval_assignments aa
           WHERE aa.step_id = s.id AND aa.active = true
             AND public.v235_assignment_scope_matches(s.step_order, aa.department, p.department)
           ORDER BY aa.id DESC LIMIT 1
         ) a ON true
         WHERE p.id = q.proposal_id
           AND lower(btrim(a.email)) = lower(btrim(q.recipient_email))
       ))
     );

  -- Preserve other approvers' existing day-one/day-three/day-seven behavior,
  -- plus administrator escalation. CEO delivery itself is aggregated below.
  FOR rec IN
    SELECT p.id AS proposal_id, p.department, r.step_id, r.actionable_at,
           s.role_name, a.email, a.display_name
    FROM public.approval_records r
    JOIN public.proposals p ON p.id = r.proposal_id AND p.approval_required = true
    JOIN public.approval_steps s ON s.id = r.step_id AND s.active = true AND s.auto_author = false
    JOIN LATERAL (
      SELECT aa.email, aa.display_name
      FROM public.approval_assignments aa
      WHERE aa.step_id = r.step_id AND aa.active = true
        AND public.v235_assignment_scope_matches(s.step_order, aa.department, p.department)
      ORDER BY aa.id DESC LIMIT 1
    ) a ON true
    WHERE r.status = '대기' AND r.actionable_at IS NOT NULL
      AND (s.role_name IS DISTINCT FROM '대표이사' OR p.ceo_submission_status = '상신완료')
      AND NOT EXISTS (
        SELECT 1 FROM public.approval_steps ps
        LEFT JOIN public.approval_records pr ON pr.proposal_id = p.id AND pr.step_id = ps.id
        WHERE ps.active = true AND ps.step_order < s.step_order AND coalesce(pr.status,'대기') <> '승인'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.approval_records xr
        JOIN public.approval_steps xs ON xs.id = xr.step_id AND xs.active = true
        WHERE xr.proposal_id = p.id AND xr.status = '반려'
      )
  LOOP
    v_type := CASE
      WHEN now() - rec.actionable_at >= interval '7 days' THEN 'reminder_7d'
      WHEN now() - rec.actionable_at >= interval '3 days' THEN 'reminder_3d'
      WHEN now() - rec.actionable_at >= interval '1 day' THEN 'reminder_1d'
      ELSE NULL
    END;

    IF v_type IS NOT NULL THEN
      IF rec.role_name IS DISTINCT FROM '대표이사' THEN
        INSERT INTO public.proposal_notification_queue(
          proposal_id,step_id,recipient_email,recipient_name,notification_type,status,available_at
        ) VALUES (rec.proposal_id,rec.step_id,lower(rec.email),rec.display_name,v_type,'pending',now())
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
        v_count := v_count + v_rowcount;
      END IF;

      IF v_type = 'reminder_7d' THEN
        INSERT INTO public.proposal_notification_queue(
          proposal_id,step_id,recipient_email,recipient_name,notification_type,status,available_at
        )
        SELECT rec.proposal_id,rec.step_id,lower(u.email),coalesce(ad.display_name,u.email),'admin_7d','pending',now()
        FROM public.admins ad JOIN auth.users u ON u.id = ad.user_id
        WHERE nullif(btrim(coalesce(u.email,'')), '') IS NOT NULL
          AND (rec.role_name IS DISTINCT FROM '대표이사'
               OR lower(btrim(u.email)) IS DISTINCT FROM lower(btrim(rec.email)))
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_rowcount = ROW_COUNT;
        v_count := v_count + v_rowcount;
      END IF;
    END IF;
  END LOOP;

  WITH eligible AS (
    SELECT e.* FROM proposal_private_v2917.due_ceo_reminders e
    WHERE NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old
      WHERE old.proposal_id=e.proposal_id AND old.step_id=e.step_id AND lower(btrim(old.recipient_email))=e.recipient_email
        AND old.notification_type='reminder_7d' AND old.status='sent' AND old.sent_at>=e.actionable_at
    ) AND NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old
      CROSS JOIN LATERAL jsonb_to_recordset(CASE WHEN old.status='sent' THEN coalesce(old.digest_sent_items,'[]'::jsonb)
        ELSE coalesce(old.digest_items,'[]'::jsonb) END) handled(proposal_id uuid,actionable_at timestamptz)
      WHERE old.notification_type='ceo_reminder_7d' AND old.step_id=e.step_id AND lower(btrim(old.recipient_email))=e.recipient_email
        AND old.status IN ('pending','sending','failed','sent') AND handled.proposal_id=e.proposal_id AND handled.actionable_at=e.actionable_at
    )
  )
  INSERT INTO public.proposal_notification_queue(
    proposal_id,step_id,recipient_email,recipient_name,notification_type,status,available_at,digest_key,digest_items
  )
  SELECT NULL,e.step_id,e.recipient_email,max(e.display_name),'ceo_reminder_7d','pending',now(),
    'ceo-reminder-7d:' || (now() AT TIME ZONE 'Asia/Seoul')::date::text || ':' || e.step_id::text || ':' || e.recipient_email,
    jsonb_agg(jsonb_build_object('proposal_id',e.proposal_id,'actionable_at',e.actionable_at)
      ORDER BY e.actionable_at,e.proposal_id)
  FROM eligible e
  GROUP BY e.step_id,e.recipient_email
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RETURN v_count + v_rowcount;
END;
$function$;

CREATE OR REPLACE FUNCTION public.v2916_get_ceo_reminder_items(p_notification_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = 'pg_catalog' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('proposal_id',e.proposal_id,'proposal_no',e.proposal_no,
    'title',e.title,'department',e.department,'proposer_name',e.proposer_name,'actionable_at',e.actionable_at,
    'pending_days',floor(extract(epoch FROM (now()-e.actionable_at))/86400)::integer)
    ORDER BY e.actionable_at,e.proposal_no,e.proposal_id),'[]'::jsonb)
  FROM public.proposal_notification_queue q
  CROSS JOIN LATERAL jsonb_to_recordset(coalesce(q.digest_items,'[]'::jsonb)) member(proposal_id uuid,actionable_at timestamptz)
  JOIN proposal_private_v2917.due_ceo_reminders e ON e.proposal_id=member.proposal_id AND e.actionable_at=member.actionable_at
    AND e.step_id=q.step_id AND e.recipient_email=lower(btrim(q.recipient_email))
  WHERE q.id=p_notification_id AND q.notification_type='ceo_reminder_7d' AND q.status='sending'
    AND NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old WHERE old.proposal_id=e.proposal_id AND old.step_id=e.step_id
        AND lower(btrim(old.recipient_email))=e.recipient_email AND old.notification_type='reminder_7d' AND old.status='sent'
        AND old.sent_at>=e.actionable_at
    ) AND NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old
      CROSS JOIN LATERAL jsonb_to_recordset(coalesce(old.digest_sent_items,'[]'::jsonb)) handled(proposal_id uuid,actionable_at timestamptz)
      WHERE old.id<>q.id AND old.notification_type='ceo_reminder_7d' AND old.step_id=e.step_id AND old.status='sent'
        AND lower(btrim(old.recipient_email))=e.recipient_email AND handled.proposal_id=e.proposal_id AND handled.actionable_at=e.actionable_at
    );
$$;
REVOKE ALL ON FUNCTION public.v2916_get_ceo_reminder_items(bigint),public.v23_enqueue_due_reminders() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.v2916_get_ceo_reminder_items(bigint),public.v23_enqueue_due_reminders() TO service_role;

CREATE FUNCTION proposal_private_v2917.display_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT CASE WHEN p_name !~ '@' AND p_name !~* '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' THEN nullif(btrim(p_name),'') END;
$$;
CREATE FUNCTION public.v2917_workflow_summary(p_proposal_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF cardinality(p_proposal_ids)>500 THEN RAISE EXCEPTION '제안 진행 요약은 한 번에 500건까지 조회하세요.'; END IF;
  WITH selected AS MATERIALIZED (SELECT * FROM public.proposals WHERE id=ANY(p_proposal_ids)),
  steps AS MATERIALIZED (
    SELECT p.id AS proposal_id,s.id AS step_id,s.step_order,s.role_name,r.status,
      (NOT p.legacy_ceo_direct OR (r.assigned_user_id=a.user_id AND r.actionable_at IS NOT NULL)) IS TRUE AS direct_signer_current,
      proposal_private_v2917.display_name(CASE WHEN r.status='대기' AND p.legacy_ceo_direct AND
        (r.assigned_user_id IS DISTINCT FROM a.user_id OR r.actionable_at IS NULL) THEN NULL
        WHEN r.status='대기' THEN a.display_name ELSE r.assigned_name END) AS assigned_name,
      proposal_private_v2917.display_name(r.approver_name) AS approver_name,r.acted_at,r.actionable_at
    FROM selected p JOIN public.approval_steps s ON s.active AND (p.approval_required OR (p.legacy_ceo_direct AND s.role_name='대표이사'))
    LEFT JOIN public.approval_records r ON r.proposal_id=p.id AND r.step_id=s.id
    LEFT JOIN LATERAL (SELECT x.display_name,x.user_id FROM public.approval_assignments x WHERE x.active AND x.step_id=s.id
      AND CASE WHEN p.legacy_ceo_direct THEN nullif(btrim(x.department),'') IS NULL
        ELSE public.v235_assignment_scope_matches(s.step_order,x.department,p.department) END ORDER BY x.id DESC LIMIT 1) a ON true
  ), facts AS (
    SELECT p.*,pending.role_name AS waiting_role,pending.status AS waiting_status,pending.assigned_name AS waiting_name,
      pending.actionable_at AS waiting_at,ceo.status AS ceo_status,ceo.assigned_name AS ceo_name,ceo.actionable_at AS ceo_at,ceo.direct_signer_current,
      (SELECT max(i.acted_at) FROM steps i WHERE i.proposal_id=p.id AND i.role_name='해당부서 임원' AND i.status='승인') AS executive_at,
      (SELECT bool_or(i.status='반려') FROM steps i WHERE i.proposal_id=p.id) AS rejected,
      (SELECT max(h.happened_at) FROM public.proposal_status_history h WHERE h.proposal_id=p.id AND h.stage='대표이사 상신 회수') AS recalled_at,
      (SELECT jsonb_agg(to_jsonb(i)-ARRAY['proposal_id','direct_signer_current'] ORDER BY i.step_order,i.step_id) FROM steps i WHERE i.proposal_id=p.id) AS records
    FROM selected p
    LEFT JOIN LATERAL (SELECT i.* FROM steps i WHERE i.proposal_id=p.id AND i.status IS DISTINCT FROM '승인' ORDER BY i.step_order,i.step_id LIMIT 1) pending ON true
    LEFT JOIN LATERAL (SELECT i.* FROM steps i WHERE i.proposal_id=p.id AND i.role_name='대표이사' ORDER BY i.step_order,i.step_id LIMIT 1) ceo ON true
  ), classified AS (
    SELECT f.*,CASE
      WHEN payment_status='완료' THEN 'paid'
      WHEN ceo_submission_status='승인완료' OR ceo_status='승인' THEN 'approved'
      WHEN ceo_submission_status='반려' OR rejected THEN 'rejected'
      WHEN ceo_submission_status='상신완료' AND ceo_status='대기' THEN 'ceo'
      WHEN ceo_submission_status='상신완료' THEN 'check'
      WHEN approval_required=false AND legacy_score_revision>0 AND legacy_score_registered_at IS NOT NULL THEN 'submission'
      WHEN approval_required=false THEN 'legacy'
      WHEN (first_evaluation_total<50 OR team_leader_evaluation_total<50) AND second_evaluation_completed_at IS NULL AND status='심사완료' AND review_result='미채택' THEN 'below_threshold'
      WHEN waiting_status='대기' AND waiting_role='부서장' THEN 'team'
      WHEN waiting_status='대기' AND waiting_role='해당부서 임원' THEN 'executive'
      WHEN waiting_status='대기' AND waiting_role='대표이사' AND second_evaluation_completed_at IS NOT NULL AND review_result<>'미심사' THEN 'submission'
      WHEN waiting_status='대기' AND waiting_role='대표이사' AND EXISTS(SELECT 1 FROM steps x WHERE x.proposal_id=f.id AND x.role_name='해당부서 임원' AND x.status='승인') THEN 'review'
      ELSE 'check' END AS stage_key FROM facts f
  ), model AS (
    SELECT c.*,
      CASE stage_key WHEN 'ceo' THEN ceo_at WHEN 'team' THEN waiting_at WHEN 'executive' THEN waiting_at WHEN 'review' THEN executive_at
        WHEN 'submission' THEN greatest(recalled_at,CASE WHEN approval_required THEN second_evaluation_completed_at ELSE legacy_score_registered_at END) END pending_since,
      CASE stage_key WHEN 'ceo' THEN ceo_name WHEN 'team' THEN waiting_name WHEN 'executive' THEN waiting_name END AS assignee_name
    FROM classified c
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('proposal_id',m.id,'stage_key',m.stage_key,'current_stage',l.stage,'current_role',l.role,
    'assignee_name',m.assignee_name,'actionable_at',m.pending_since,'pending_days',CASE WHEN m.pending_since IS NOT NULL THEN greatest(0,floor(extract(epoch FROM (now()-m.pending_since))/86400)) END,
    'next_action',CASE WHEN m.stage_key='ceo' AND m.legacy_ceo_direct AND NOT m.direct_signer_current
      THEN '관리자 배정 확인 및 회수·재상신' ELSE l.action END,'legacy_direct',m.legacy_ceo_direct,'records',coalesce(m.records,'[]'::jsonb)) ORDER BY m.id),'[]'::jsonb) INTO result
  FROM model m JOIN (VALUES
    ('paid','지급 완료',NULL,'지급 기록 확인'),('approved','대표이사 승인 완료',NULL,'지급 상태 확인'),
    ('rejected','반려','제안자','반려 사유 확인 및 보완'),('ceo','대표이사 결재 대기','대표이사','대표이사 결재'),
    ('legacy','과거 제안','관리자','기존 심사기록 확인'),('submission','대표이사 상신 검토','관리자','상신 요건 확인'),
    ('review','3차 심사 대기','심사위원회','3차 심사'),('team','2차 팀장평가·결재 대기','부서장','팀장평가 및 결재'),
    ('executive','임원 결재 대기','해당부서 임원','임원 결재'),('check','진행 상태 확인',NULL,'결재기록 확인'),
    ('below_threshold','기준미달 · 미채택',NULL,'평가 결과 확인')) l(key,stage,role,action) ON l.key=m.stage_key;
  RETURN result;
END $$;

-- Scope history lookups to the selected proposal even in the original full-row audit.
CREATE INDEX proposal_audit_log_proposal_time_v2917 ON public.proposal_audit_log(proposal_id,created_at DESC);
CREATE INDEX proposal_v272_audit_proposal_time_v2917 ON public.proposal_v272_audit(proposal_id,happened_at DESC);

-- Private, read-only projection. Source-qualified event IDs disambiguate timestamp ties across all audit tables.
CREATE VIEW proposal_private_v2917.history WITH (security_invoker=true) AS
SELECT h.proposal_id,'status/'||h.id AS id,h.happened_at,h.actor_name,'status'::text AS category,h.stage AS field_name,h.detail,
  NULL::text AS reason,NULL::jsonb AS before,NULL::jsonb AS after FROM public.proposal_status_history h
UNION ALL SELECT h.proposal_id,'field/'||h.id,h.created_at,h.actor_name,
  CASE WHEN starts_with(h.field_name,'approval:') THEN 'approval' WHEN h.field_name='payment_status' THEN 'payment' ELSE 'audit' END,
  h.field_name,h.action,NULL,h.old_value,h.new_value FROM public.proposal_audit_logs h
UNION ALL SELECT h.proposal_id,'content/'||h.id,h.created_at,h.actor_name,'content','제안 내용','관리자 내용 수정',h.reason,h.before_content,h.after_content
  FROM public.proposal_admin_content_history_v274 h
UNION ALL SELECT h.proposal_id,'score/'||h.id,h.corrected_at,h.actor_name,'score','평가 점수','관리자 점수 정정',h.reason,h.before_scores,h.after_scores
  FROM public.proposal_admin_score_history_v281 h
UNION ALL SELECT h.proposal_id,'original-score/'||h.proposal_id,h.corrected_at,h.actor_name,'score','평가 점수','기존 점수 정정',h.reason,h.before_scores,h.after_scores
  FROM public.proposal_q26043_score_correction_v280 h
UNION ALL SELECT h.proposal_id,'review/'||h.id,h.happened_at,h.actor_name,CASE WHEN h.action='대표이사 상신 회수' THEN 'recall' ELSE 'review' END,
  h.action,h.action,h.reason,h.before_data,h.after_data FROM public.proposal_review_history_v287 h
UNION ALL SELECT h.proposal_id,'legacy-score/'||h.id,h.created_at,h.actor_name,'score','기존 심사점수',h.basis,h.reason,
  jsonb_build_object('score',h.before_score,'review_result',h.before_result,'award_amount',h.before_award),
  jsonb_build_object('score',h.after_score,'review_result',h.after_result,'award_amount',h.after_award) FROM public.proposal_legacy_score_history_v295 h
UNION ALL SELECT h.proposal_id,'legacy-result/'||h.id,h.created_at,h.actor_name,'payment','지급완료 과거 심사결과','기존 지급 기록 보존',h.reason,
  jsonb_build_object('review_result',h.before_result,'review_comment',h.before_comment,'paid_amount',h.paid_amount),
  jsonb_build_object('review_result',h.after_result,'review_comment',h.after_comment,'paid_amount',h.paid_amount) FROM public.proposal_paid_legacy_history_v294 h
UNION ALL SELECT h.proposal_id,'account/'||h.id,h.happened_at,a.display_name,'audit',h.action,h.action,NULL,h.before_data,h.after_data
  FROM public.proposal_v272_audit h LEFT JOIN public.admins a ON a.user_id=h.actor_id
UNION ALL SELECT h.proposal_id,'committee/'||h.id,h.created_at,h.actor_name,'committee','심사위원','심사위원 확인·변경',h.reason,h.before_data,h.after_data
  FROM review_committee_private_v2913.history h
-- The original full-row audit is the only historical source for ordinary PIN edits to identity, images and some evaluation fields.
-- Expand just the fields that changed and retain both exact values. Omit secrets and actor account identifiers.
UNION ALL SELECT h.proposal_id,'snapshot/'||h.id||'/'||d.field,h.created_at,coalesce(a.display_name,CASE h.actor_type WHEN 'public_submit' THEN h.after_data->>'proposer_name' WHEN 'public_pin_edit' THEN '수정번호 사용자' END),
  CASE WHEN d.field IN('proposer_name','department') THEN 'identity' ELSE 'audit' END,d.field,h.action,NULL,h.before_data->d.field,h.after_data->d.field
  FROM public.proposal_audit_log h LEFT JOIN public.admins a ON a.user_id=h.actor_id CROSS JOIN LATERAL (
    SELECT k AS field FROM jsonb_object_keys(coalesce(h.before_data,'{}')||coalesce(h.after_data,'{}')) k
    WHERE k<>ALL(ARRAY['edit_pin','edit_pin_hash','reviewer_id','second_evaluation_by','ceo_submitted_by','id','created_at','updated_at'])
      AND h.before_data->k IS DISTINCT FROM h.after_data->k
    ) d WHERE h.action='UPDATE' AND NOT EXISTS(
    SELECT 1 FROM public.proposal_audit_logs f WHERE f.proposal_id=h.proposal_id AND f.created_at=h.created_at
      AND f.field_name=d.field AND f.old_value IS NOT DISTINCT FROM h.before_data->d.field
      AND f.new_value IS NOT DISTINCT FROM h.after_data->d.field);
REVOKE ALL ON proposal_private_v2917.history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.v2917_proposal_history(p_proposal_id uuid,p_limit integer DEFAULT 50,p_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE page_size integer:=least(100,greatest(1,coalesce(p_limit,50))); cursor_time timestamptz; cursor_id text; page jsonb; next_cursor text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN RAISE EXCEPTION '시스템 관리자만 이력을 조회할 수 있습니다.' USING ERRCODE='42501'; END IF;
  IF p_cursor IS NOT NULL THEN
    IF length(p_cursor)>1000 THEN RAISE EXCEPTION '이력 페이지 번호를 다시 확인하세요.'; END IF;
    cursor_time:=(p_cursor::jsonb->>'time')::timestamptz; cursor_id:=p_cursor::jsonb->>'id';
    IF cursor_time IS NULL OR cursor_id IS NULL OR p_cursor::jsonb->>'proposal' IS DISTINCT FROM p_proposal_id::text THEN RAISE EXCEPTION '이력 페이지 번호를 다시 확인하세요.'; END IF;
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT * FROM proposal_private_v2917.history h WHERE h.proposal_id=p_proposal_id
      AND (p_cursor IS NULL OR (h.happened_at,h.id)<(cursor_time,cursor_id))
    ORDER BY h.happened_at DESC,h.id DESC LIMIT page_size+1
  ), listed AS (SELECT * FROM candidates ORDER BY happened_at DESC,id DESC LIMIT page_size)
  SELECT coalesce(jsonb_agg(to_jsonb(l)-'proposal_id' ORDER BY l.happened_at DESC,l.id DESC),'[]'::jsonb),
   CASE WHEN (SELECT count(*) FROM candidates)>page_size THEN (SELECT jsonb_build_object('time',x.happened_at,'id',x.id,'proposal',p_proposal_id)::text FROM listed x ORDER BY x.happened_at,x.id LIMIT 1) END
  INTO page,next_cursor FROM listed l;
  RETURN jsonb_build_object('items',page,'next_cursor',next_cursor);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA proposal_private_v2917 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v2917_create_proposal(uuid,jsonb,text),public.v2917_edit_proposal(text,text,jsonb,timestamptz),
 public.v2917_workflow_summary(uuid[]),public.v2917_approve_team(uuid,bigint,jsonb,text,timestamptz),public.v2917_recall_ceo(uuid[],text,jsonb),
 public.v2917_proposal_history(uuid,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2917_create_proposal(uuid,jsonb,text),public.v2917_edit_proposal(text,text,jsonb,timestamptz),public.v2917_workflow_summary(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2917_approve_team(uuid,bigint,jsonb,text,timestamptz),public.v2917_recall_ceo(uuid[],text,jsonb),public.v2917_proposal_history(uuid,integer,text) TO authenticated;
NOTIFY pgrst,'reload schema';
