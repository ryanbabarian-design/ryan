-- CEO reminder policy: one bundled notice after 168 elapsed hours, once per
-- proposal/step/recipient/actionable_at cycle. Execute this file atomically.
-- The existing daily cron schedule and initial ceo_batch notices are unchanged.

ALTER TABLE public.proposal_notification_queue
  ADD COLUMN IF NOT EXISTS digest_items jsonb,
  ADD COLUMN IF NOT EXISTS digest_sent_items jsonb,
  ADD COLUMN IF NOT EXISTS digest_key text,
  ALTER COLUMN proposal_id DROP NOT NULL;

ALTER TABLE public.proposal_notification_queue
  DROP CONSTRAINT IF EXISTS proposal_notification_queue_notification_type_check,
  DROP CONSTRAINT IF EXISTS proposal_notification_queue_status_check,
  DROP CONSTRAINT IF EXISTS proposal_notification_queue_digest_check,
  DROP CONSTRAINT IF EXISTS proposal_notification_queue_digest_sent_check;

ALTER TABLE public.proposal_notification_queue
  ADD CONSTRAINT proposal_notification_queue_notification_type_check
    CHECK (notification_type IN ('new','reminder_1d','reminder_3d','reminder_7d','admin_7d','ceo_batch','ceo_reminder_7d')),
  ADD CONSTRAINT proposal_notification_queue_status_check
    CHECK (status IN ('pending','sending','sent','failed','cancelled')),
  ADD CONSTRAINT proposal_notification_queue_digest_check CHECK (
    CASE WHEN notification_type = 'ceo_reminder_7d' THEN
      proposal_id IS NULL AND step_id IS NOT NULL
      AND digest_key IS NOT NULL AND btrim(digest_key) <> ''
      AND CASE WHEN jsonb_typeof(digest_items) = 'array'
        THEN jsonb_array_length(digest_items) > 0 ELSE false END
      AND (digest_sent_items IS NULL OR jsonb_typeof(digest_sent_items) = 'array')
    ELSE
      proposal_id IS NOT NULL AND digest_key IS NULL
      AND digest_items IS NULL AND digest_sent_items IS NULL
    END
  ),
  ADD CONSTRAINT proposal_notification_queue_digest_sent_check CHECK (
    notification_type <> 'ceo_reminder_7d' OR status <> 'sent'
    OR CASE WHEN jsonb_typeof(digest_sent_items) = 'array'
      THEN jsonb_array_length(digest_sent_items) > 0 ELSE false END
  );

CREATE UNIQUE INDEX IF NOT EXISTS proposal_notification_queue_digest_key_uidx
  ON public.proposal_notification_queue(digest_key) WHERE digest_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS proposal_notification_queue_ceo_digest_lookup_idx
  ON public.proposal_notification_queue(step_id, lower(btrim(recipient_email)), status)
  WHERE notification_type = 'ceo_reminder_7d';

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
    SELECT p.id AS proposal_id, r.step_id, r.actionable_at,
           lower(btrim(a.email)) AS recipient_email, a.display_name
    FROM public.approval_records r
    JOIN public.proposals p ON p.id = r.proposal_id
      AND p.approval_required = true AND p.ceo_submission_status = '상신완료'
    JOIN public.approval_steps s ON s.id = r.step_id
      AND s.active = true AND s.auto_author = false AND s.role_name = '대표이사'
    JOIN LATERAL (
      SELECT aa.email, aa.display_name
      FROM public.approval_assignments aa
      WHERE aa.step_id = r.step_id AND aa.active = true
        AND public.v235_assignment_scope_matches(s.step_order, aa.department, p.department)
      ORDER BY aa.id DESC LIMIT 1
    ) a ON true
    WHERE r.status = '대기' AND r.actionable_at <= now() - interval '168 hours'
      AND nullif(btrim(a.email), '') IS NOT NULL
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
      AND NOT EXISTS (
        SELECT 1 FROM public.proposal_notification_queue old
        WHERE old.proposal_id = p.id AND old.step_id = r.step_id
          AND lower(btrim(old.recipient_email)) = lower(btrim(a.email))
          AND old.notification_type = 'reminder_7d' AND old.status = 'sent'
          AND old.sent_at >= r.actionable_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.proposal_notification_queue old
        CROSS JOIN LATERAL jsonb_to_recordset(
          CASE WHEN old.status = 'sent' THEN coalesce(old.digest_sent_items,'[]'::jsonb)
            ELSE coalesce(old.digest_items,'[]'::jsonb) END
        ) handled(proposal_id uuid, actionable_at timestamptz)
        WHERE old.notification_type = 'ceo_reminder_7d'
          AND old.step_id = r.step_id
          AND lower(btrim(old.recipient_email)) = lower(btrim(a.email))
          AND old.status IN ('pending','sending','failed','sent')
          AND handled.proposal_id = p.id AND handled.actionable_at = r.actionable_at
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

-- A scalar JSON aggregate deliberately avoids PostgREST's row-count limit.
-- Only a claimed row is readable, and every member is checked again at send time.
CREATE OR REPLACE FUNCTION public.v2916_get_ceo_reminder_items(p_notification_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'proposal_id',p.id,
    'proposal_no',p.proposal_no,
    'title',p.title,
    'department',p.department,
    'proposer_name',p.proposer_name,
    'actionable_at',r.actionable_at,
    'pending_days',floor(extract(epoch FROM (now() - r.actionable_at))/86400)::integer
  ) ORDER BY r.actionable_at,p.proposal_no,p.id), '[]'::jsonb)
  FROM public.proposal_notification_queue q
  CROSS JOIN LATERAL jsonb_to_recordset(coalesce(q.digest_items,'[]'::jsonb))
    member(proposal_id uuid, actionable_at timestamptz)
  JOIN public.proposals p ON p.id = member.proposal_id
    AND p.approval_required = true AND p.ceo_submission_status = '상신완료'
  JOIN public.approval_steps s ON s.id = q.step_id
    AND s.active = true AND s.auto_author = false AND s.role_name = '대표이사'
  JOIN public.approval_records r ON r.proposal_id = p.id AND r.step_id = s.id
    AND r.status = '대기' AND r.actionable_at = member.actionable_at
    AND r.actionable_at <= now() - interval '168 hours'
  JOIN LATERAL (
    SELECT aa.email FROM public.approval_assignments aa
    WHERE aa.step_id = s.id AND aa.active = true
      AND public.v235_assignment_scope_matches(s.step_order,aa.department,p.department)
    ORDER BY aa.id DESC LIMIT 1
  ) a ON lower(btrim(a.email)) = lower(btrim(q.recipient_email))
  WHERE q.id = p_notification_id AND q.notification_type = 'ceo_reminder_7d' AND q.status = 'sending'
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
    AND NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old
      WHERE old.proposal_id = p.id AND old.step_id = r.step_id
        AND lower(btrim(old.recipient_email)) = lower(btrim(q.recipient_email))
        AND old.notification_type = 'reminder_7d' AND old.status = 'sent'
        AND old.sent_at >= r.actionable_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.proposal_notification_queue old
      CROSS JOIN LATERAL jsonb_to_recordset(coalesce(old.digest_sent_items,'[]'::jsonb))
        handled(proposal_id uuid, actionable_at timestamptz)
      WHERE old.id <> q.id AND old.notification_type = 'ceo_reminder_7d'
        AND old.step_id = r.step_id AND old.status = 'sent'
        AND lower(btrim(old.recipient_email)) = lower(btrim(q.recipient_email))
        AND handled.proposal_id = p.id AND handled.actionable_at = r.actionable_at
    );
$function$;

-- BEGIN DEPLOYMENT ACL
REVOKE ALL ON FUNCTION public.v2916_get_ceo_reminder_items(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v2916_get_ceo_reminder_items(bigint) TO service_role;
REVOKE ALL ON FUNCTION public.v23_enqueue_due_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.v23_enqueue_due_reminders() TO service_role, postgres;
-- END DEPLOYMENT ACL

-- Cancel already queued obsolete rows immediately, without invoking enqueue.
-- Sent history is deliberately retained; the worker also rejects legacy CEO rows.
UPDATE public.proposal_notification_queue q
   SET status = 'cancelled', updated_at = now(),
       last_error = '대표이사 알림은 대기 7일 이후 묶음 알림으로 통합되었습니다.'
  FROM public.approval_steps s
 WHERE s.id = q.step_id AND s.role_name = '대표이사'
   AND q.status IN ('pending','failed')
   AND (
     q.notification_type IN ('reminder_1d','reminder_3d','reminder_7d')
     OR (q.notification_type = 'admin_7d' AND EXISTS (
       SELECT 1 FROM public.proposals p
       JOIN LATERAL (
         SELECT aa.email FROM public.approval_assignments aa
         WHERE aa.step_id = s.id AND aa.active = true
           AND public.v235_assignment_scope_matches(s.step_order,aa.department,p.department)
         ORDER BY aa.id DESC LIMIT 1
       ) a ON true
       WHERE p.id = q.proposal_id
         AND lower(btrim(a.email)) = lower(btrim(q.recipient_email))
     ))
   );

-- BEGIN DEPLOYMENT NOTIFY
NOTIFY pgrst, 'reload schema';
-- END DEPLOYMENT NOTIFY
