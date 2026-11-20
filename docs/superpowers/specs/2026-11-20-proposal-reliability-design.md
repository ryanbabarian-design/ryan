# Proposal reliability and workflow V2.9.17

Approved by the user on 2026-11-20: implement the preceding audit recommendations and deploy.

## Outcome

Employees see consistent personal results, retain unfinished writing, and submit once with a definite receipt. Administrators can recall selected unapproved CEO submissions for reevaluation, see who owns the next action and how long it has waited, and inspect a proposal's complete change history.

## Scope

1. Reuse the annual report's employee identity and department alias rules in personal profiles and detail summaries. Preserve receipt department history. Disambiguate same-name employees rather than guessing.
2. Lock submission before asynchronous work. Give each draft a durable random request ID; server retries create at most one proposal. Once a receipt exists, later refresh failure must not re-enable submission. Store approval and team evaluation in one transaction.
3. Autosave draft text and image selections in this browser, expose storage failures, offer restore/discard, and never persist the edit PIN. Show seven required groups completed, link missing fields, and offer a sanitized preview. Preserve source revision for edited drafts. Make mobile evaluation inputs readable without horizontal travel.
4. System administrators may recall selected CEO submissions only while CEO approval is pending and payment is incomplete. Require a reason and expected revision. Preserve earlier approvals and all change history; clear CEO actionability and invalidate pending reminders for recalled proposals. Reevaluation and resubmission use existing business rules. Do not perform any actual recalls while testing.
5. Show applicable stages, current responsible person, current-stage waiting time and next action in public/admin proposal views. Calculate elapsed time from actionable stage time, never invent historical completion. Keep implementation/payment separate; legacy exceptions remain explicit.
6. Provide proposal-scoped admin history with date/type filtering and pagination or incremental loading, combining status, score/content corrections, review and identity changes with before/after and reasons.
7. Detail async failures remain explicit errors with retry, never fabricated pending states. Responses for a previous route must not overwrite a new proposal.

## Implementation decisions

- Extend the existing vanilla JavaScript app and PostgreSQL functions; no framework migration.
- New feature modules own identity reporting, draft UX, submission control, workflow display and history. Root app integration has one owner.
- Keep the CEO reminder policy from V2.9.16: first submission digest preserved; after seven full days one digest, once per waiting cycle.
- Preserve historical review scores, awarded amounts, payment status, existing approvals and current eligibility rules.
- No actual emails, production test proposals, or business-record edits for verification. Tests use fixtures and local PostgreSQL.
- Publish only after source review, meaningful regression checks, visual checks, and production read-only verification.

## Approaches

Chosen: incremental modules and narrow transactional RPCs. This keeps existing workflows and allows focused regression checks. A full rewrite or database renaming is unnecessary for the approved outcome and adds migration risk.

## Success checks

Alias-split personal data agrees across report/profile/detail; same-name staff are not mixed. Double-click, uncertain response and refresh-failure retries cannot duplicate a submission. Draft recovery excludes PIN and handles unavailable storage. Recall rejects approved/paid/stale selections, preserves unrelated records, and safely excludes recalled items from email. Progress and history handle missing data and failed requests explicitly.
