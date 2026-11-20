-- The original scheduler must fail the first assertion for the known defect.
-- Expectations below are literal business outcomes, not copies of enqueue SQL.
DO $tests$
DECLARE
  v_id uuid;
  v_q bigint;
  v_items jsonb;
  v_count bigint;
BEGIN
  PERFORM pg_temp.ceo_test_reset();
  PERFORM pg_temp.ceo_test_proposal(1, interval '6 days 23 hours 59 minutes');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 0 FROM pg_temp.proposal_notification_queue WHERE recipient_email = 'ceo@example.test'),
    'CEO receives no reminder before 168 hours (6d23h59m)');

  v_id := pg_temp.ceo_test_proposal(2, interval '7 days');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 AND min(recipient_email) = 'ceo@example.test'
       FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d'),
    'Exactly 168 hours qualifies for one digest');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT jsonb_array_length(digest_items) = 1 AND digest_items->0->>'proposal_id' = v_id::text
       FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d'),
    'Digest excludes the proposal one minute below threshold');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 0 FROM pg_temp.proposal_notification_queue
      WHERE step_id = 4 AND notification_type IN ('reminder_1d','reminder_3d','reminder_7d')),
    'CEO receives no individual day-one, day-three, or day-seven reminder');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue),
    'Repeated scheduler execution does not duplicate the same digest');

  PERFORM pg_temp.ceo_test_reset();
  FOR v_count IN 1..25 LOOP
    PERFORM pg_temp.ceo_test_proposal(v_count::integer, interval '8 days');
  END LOOP;
  PERFORM pg_temp.v23_enqueue_due_reminders();
  SELECT id INTO v_q FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d';
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 AND max(jsonb_array_length(digest_items)) = 25
       FROM pg_temp.proposal_notification_queue),
    '25 overdue proposals for the same CEO are grouped into one complete digest');
  UPDATE pg_temp.proposal_notification_queue SET status = 'sending' WHERE id = v_q;
  v_items := pg_temp.v2916_get_ceo_reminder_items(v_q);
  PERFORM pg_temp.ceo_test_assert(jsonb_array_length(v_items) = 25,
    'Claimed digest RPC returns every member beyond the former 20-row batch size');
  PERFORM pg_temp.ceo_test_assert(
    v_items->0 ?& ARRAY['proposal_id','proposal_no','title','department','proposer_name','actionable_at','pending_days']
    AND (v_items->0->>'pending_days')::integer = 8,
    'Digest RPC supplies the email table fields and complete elapsed days');

  -- Make its stable day key an older one: member-cycle dedupe must work independently of that key.
  UPDATE pg_temp.proposal_notification_queue
    SET status = 'pending', digest_key = 'previous-day-key', created_at = now() - interval '1 day';
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert((SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue),
    'An earlier pending digest prevents a new daily digest for the same waiting cycles');
  UPDATE pg_temp.proposal_notification_queue SET status = 'failed';
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert((SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue),
    'An earlier failed digest is retried rather than duplicated on another day');
  UPDATE pg_temp.proposal_notification_queue SET status = 'sending';
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert((SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue),
    'An in-flight digest prevents a second queue row for the same waiting cycles');
  UPDATE pg_temp.proposal_notification_queue SET status = 'sent', digest_sent_items = digest_items, sent_at = now();
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert((SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue),
    'Actually sent members are reminded only once in the same waiting cycle');
  UPDATE pg_temp.approval_records SET actionable_at = now() - interval '7 days'
    WHERE proposal_id = '00000000-0000-0000-0000-000000000001' AND step_id = 4;
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 2 AND sum(jsonb_array_length(digest_items)) = 26 FROM pg_temp.proposal_notification_queue),
    'A new actionable waiting cycle may be queued after a previous cycle was sent');

  PERFORM pg_temp.ceo_test_reset();
  PERFORM pg_temp.ceo_test_proposal(1, interval '8 days');
  PERFORM pg_temp.ceo_test_proposal(2, interval '8 days');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  UPDATE pg_temp.proposal_notification_queue
    SET status = 'sent', digest_sent_items = jsonb_build_array(digest_items->0),
      sent_at = now(), digest_key = 'previous-day-partial-send';
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 AND max(jsonb_array_length(digest_items)) = 1
       AND min(digest_items->0->>'proposal_id') = '00000000-0000-0000-0000-000000000002'
       FROM pg_temp.proposal_notification_queue WHERE status = 'pending'),
    'Candidates removed before an earlier send are not mistaken for actually sent members');

  PERFORM pg_temp.ceo_test_reset();
  FOR v_count IN 1..8 LOOP
    PERFORM pg_temp.ceo_test_proposal(v_count::integer, interval '8 days');
  END LOOP;
  PERFORM pg_temp.v23_enqueue_due_reminders();
  SELECT id INTO v_q FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d';
  UPDATE pg_temp.proposal_notification_queue SET status = 'sending' WHERE id = v_q;
  UPDATE pg_temp.approval_records SET status = '승인'
    WHERE proposal_id = '00000000-0000-0000-0000-000000000001' AND step_id = 4;
  UPDATE pg_temp.proposals SET ceo_submission_status = '미상신'
    WHERE id = '00000000-0000-0000-0000-000000000002';
  UPDATE pg_temp.approval_records SET actionable_at = now() - interval '7 days'
    WHERE proposal_id = '00000000-0000-0000-0000-000000000003' AND step_id = 4;
  UPDATE pg_temp.approval_records SET status = '대기'
    WHERE proposal_id = '00000000-0000-0000-0000-000000000004' AND step_id = 3;
  UPDATE pg_temp.approval_records SET status = '반려'
    WHERE proposal_id = '00000000-0000-0000-0000-000000000005' AND step_id = 2;
  UPDATE pg_temp.proposals SET approval_required = false
    WHERE id = '00000000-0000-0000-0000-000000000006';
  DELETE FROM pg_temp.proposals WHERE id = '00000000-0000-0000-0000-000000000007';
  v_items := pg_temp.v2916_get_ceo_reminder_items(v_q);
  PERFORM pg_temp.ceo_test_assert(
    jsonb_array_length(v_items) = 1 AND v_items->0->>'proposal_id' = '00000000-0000-0000-0000-000000000008',
    'Send-time RPC removes approved, withdrawn, stale-cycle, blocked, rejected, disabled, and deleted members');
  INSERT INTO pg_temp.approval_assignments(step_id,active,department,email,display_name)
    VALUES (4,true,NULL,'replacement@example.test','새 대표이사');
  PERFORM pg_temp.ceo_test_assert(pg_temp.v2916_get_ceo_reminder_items(v_q) = '[]'::jsonb,
    'Reassigned CEO receives none of the previous recipient digest');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 AND max(jsonb_array_length(digest_items)) = 2
       FROM pg_temp.proposal_notification_queue WHERE recipient_email = 'replacement@example.test'),
    'An earlier recipient digest does not suppress eligible items for the newly assigned CEO');
  UPDATE pg_temp.proposal_notification_queue SET status = 'cancelled' WHERE id = v_q;
  PERFORM pg_temp.ceo_test_assert(pg_temp.v2916_get_ceo_reminder_items(v_q) = '[]'::jsonb,
    'An empty or cancelled digest exposes no email data');

  PERFORM pg_temp.ceo_test_reset();
  v_id := pg_temp.ceo_test_proposal(1, interval '8 days');
  INSERT INTO pg_temp.proposal_notification_queue
    (proposal_id,step_id,recipient_email,notification_type,status,sent_at)
    VALUES (v_id,4,'ceo@example.test','reminder_7d','sent',now() - interval '1 day');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 0 FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d'),
    'A legacy seven-day notice sent in the current waiting cycle prevents a duplicate digest');
  UPDATE pg_temp.proposal_notification_queue SET sent_at = now() - interval '9 days';
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d'),
    'A legacy seven-day notice from an older waiting cycle does not suppress the new cycle');
  SELECT id INTO v_q FROM pg_temp.proposal_notification_queue WHERE notification_type = 'ceo_reminder_7d';
  UPDATE pg_temp.proposal_notification_queue SET status = 'sending' WHERE id = v_q;
  UPDATE pg_temp.proposal_notification_queue SET sent_at = now() WHERE notification_type = 'reminder_7d';
  PERFORM pg_temp.ceo_test_assert(pg_temp.v2916_get_ceo_reminder_items(v_q) = '[]'::jsonb,
    'A legacy reminder completed after enqueue is excluded again immediately before send');

  PERFORM pg_temp.ceo_test_reset();
  v_id := pg_temp.ceo_test_proposal(1, interval '8 days');
  INSERT INTO pg_temp.auth_users VALUES
    ('10000000-0000-0000-0000-000000000001','CEO@example.test'),
    ('10000000-0000-0000-0000-000000000002','audit@example.test');
  INSERT INTO pg_temp.admins SELECT id,email FROM pg_temp.auth_users;
  INSERT INTO pg_temp.proposal_notification_queue
    (proposal_id,step_id,recipient_email,notification_type,status)
    VALUES (v_id,4,'ceo@example.test','reminder_1d','pending'),
      (v_id,4,'ceo@example.test','reminder_3d','failed'),
      (v_id,4,'ceo@example.test','reminder_7d','pending'),
      (v_id,4,'ceo@example.test','admin_7d','failed');
  v_id := pg_temp.ceo_test_proposal(2, interval '2 days');
  INSERT INTO pg_temp.proposal_notification_queue
    (proposal_id,step_id,recipient_email,notification_type,status,sent_at)
    VALUES (v_id,4,'ceo@example.test','reminder_1d','sent',now() - interval '1 day');
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 4 FROM pg_temp.proposal_notification_queue WHERE status = 'cancelled'),
    'Obsolete unsent CEO day-one, day-three, day-seven and self-admin notices are cancelled');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue WHERE notification_type = 'reminder_1d' AND status = 'sent'),
    'Previously sent legacy reminders are preserved as delivery history');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 0 FROM pg_temp.proposal_notification_queue
       WHERE notification_type = 'admin_7d' AND recipient_email = 'ceo@example.test' AND status <> 'cancelled'),
    'The assigned CEO is excluded from their own administrative escalation');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue
       WHERE notification_type = 'admin_7d' AND recipient_email = 'audit@example.test' AND status = 'pending'),
    'Other administrators retain the seven-day escalation');

  PERFORM pg_temp.ceo_test_reset();
  FOR v_count IN 1..3 LOOP
    v_id := pg_temp.ceo_test_proposal(v_count::integer, NULL);
    UPDATE pg_temp.approval_records
      SET status = '대기', actionable_at = now() - CASE v_count WHEN 1 THEN interval '1 day' WHEN 2 THEN interval '3 days' ELSE interval '7 days' END
      WHERE proposal_id = v_id AND step_id = 2;
  END LOOP;
  INSERT INTO pg_temp.auth_users VALUES ('10000000-0000-0000-0000-000000000001','audit@example.test');
  INSERT INTO pg_temp.admins SELECT id,email FROM pg_temp.auth_users;
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert(
    (SELECT array_agg(notification_type ORDER BY notification_type) = ARRAY['reminder_1d','reminder_3d','reminder_7d']
       FROM pg_temp.proposal_notification_queue WHERE recipient_email = 'team@example.test'),
    'Non-CEO approvers retain individual day-one, day-three, and day-seven reminders');
  PERFORM pg_temp.ceo_test_assert(
    (SELECT count(*) = 1 FROM pg_temp.proposal_notification_queue WHERE notification_type = 'admin_7d'),
    'Non-CEO seven-day reminders retain administrator escalation');

  PERFORM pg_temp.ceo_test_reset();
  PERFORM pg_temp.ceo_test_proposal(1, interval '8 days', '연구', '미상신');
  v_id := pg_temp.ceo_test_proposal(2, interval '8 days');
  UPDATE pg_temp.proposals SET approval_required = false WHERE id = v_id;
  v_id := pg_temp.ceo_test_proposal(3, interval '8 days');
  UPDATE pg_temp.approval_records SET status = '반려' WHERE proposal_id = v_id AND step_id = 3;
  PERFORM pg_temp.ceo_test_proposal(4, NULL);
  PERFORM pg_temp.v23_enqueue_due_reminders();
  PERFORM pg_temp.ceo_test_assert((SELECT count(*) = 0 FROM pg_temp.proposal_notification_queue),
    'Unsubmitted, disabled, rejected, and not-actionable proposals are never queued');

  BEGIN
    INSERT INTO pg_temp.proposal_notification_queue(step_id,recipient_email,notification_type)
      VALUES (4,'ceo@example.test','new');
    PERFORM pg_temp.ceo_test_assert(false, 'Ordinary notifications must retain a proposal reference');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ceo_test_assert(true, 'Ordinary notifications must retain a proposal reference');
  END;
  BEGIN
    INSERT INTO pg_temp.proposal_notification_queue(step_id,recipient_email,notification_type,digest_key,digest_items)
      VALUES (4,'ceo@example.test','ceo_reminder_7d','empty-digest','[]'::jsonb);
    PERFORM pg_temp.ceo_test_assert(false, 'An empty digest cannot be inserted');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ceo_test_assert(true, 'An empty digest cannot be inserted');
  END;
  BEGIN
    INSERT INTO pg_temp.proposal_notification_queue(step_id,recipient_email,notification_type,status,digest_key,digest_items)
      VALUES (4,'ceo@example.test','ceo_reminder_7d','sent','missing-sent-members',
        jsonb_build_array(jsonb_build_object('proposal_id',v_id,'actionable_at',now() - interval '8 days')));
    PERFORM pg_temp.ceo_test_assert(false, 'A sent digest must record its actual sent members');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ceo_test_assert(true, 'A sent digest must record its actual sent members');
  END;
END;
$tests$;

SELECT count(*) AS passed, jsonb_agg(assertion ORDER BY assertion) AS assertions
FROM pg_temp.ceo_reminder_test_results;
