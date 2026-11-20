# CEO seven-day reminder implementation plan

## Authorized design
The user requested one bundled CEO reminder only after seven days, replacing CEO day-one/day-three reminders. Keep first-submission summary emails and other approval roles unchanged. One notice per proposal/CEO waiting period. Daily check remains 09:00 Asia/Seoul. Do not send test email to real recipients.

## Implementation
- [x] Add a CEO digest queue type, digest key, JSON members (proposal_id and actionable_at), nullable proposal_id for digests, cancelled status; keep legacy records intact.
- [x] Update scheduled enqueue: skip individual CEO reminders; collect all current seven-day CEO items per recipient into one queue row, deduplicate existing seven-day notices and waiting periods. Cancel obsolete unsent CEO reminders.
- [x] Add a service-role-only read RPC `v2916_get_ceo_reminder_items(p_notification_id bigint)` returning a JSON array of freshly eligible rows: proposal_id, proposal_no, title, department, proposer_name, actionable_at, pending_days. Check current assignment, waiting-period timestamp, seven-day age, submission, predecessor approvals, and rejection.
- [x] Update approval-email worker with bundled subject/table; atomic queue claim and queue-ID idempotency; cancel obsolete individual CEO reminders. Keep batch and non-CEO paths.
- [x] Show digest counts/types and cancelled records in the existing admin mail log.
- [x] Prove threshold, grouping beyond 20 items, idempotency, recipient change, approval/withdrawal, stale cycle, and empty-group behavior without external mail.
- [x] Independent review, controlled migration/function deployment, inspect active code/cron/queue and preserve rollback evidence in git.

## Scope decisions
CEO administrative escalation retains its existing seven-day behavior for system admins, except the current CEO recipient must not receive duplicate admin_7d email in addition to the digest. Other roles retain current policy.

## Verification / release
Use mocked outbound HTTP for worker tests. Use transactional database regression fixtures with rollback; never persist test proposals or test notifications. Existing UI baseline has four known unrelated failing tests, which will be compared and reported if still present. Local checkout content hashes must match corresponding production blobs for edited files. Preserve original deployed Edge Function in history before implementation. No credentials in source or logs.

