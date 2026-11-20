# Proposal Reliability V2.9.17 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-approved reliability, recovery and workflow improvements.

**Architecture:** Extend the existing vanilla app with focused modules and transactional Postgres RPCs. Implementation owners use disjoint files; root owns app/store integration and deployment.

**Tech Stack:** JavaScript ES modules, CSS, Supabase PostgreSQL, Node test runner, local PGlite.

**Spec:** `docs/superpowers/specs/2026-11-20-proposal-reliability-design.md`

## Global Constraints

- Release V2.9.17, base deployed commit ff0517d4ca3f99d5d0dcbf0ac2179be5be90ea27; local matching base 10215561.
- No actual emails, production test proposals, or business-record edits for verification.
- Preserve historical scores, awards, payments, approvals, existing eligibility rules and V2.9.16 CEO reminder behavior.
- One owner per file; root owns js/app.js, index.html and js/services/store.js. Agents deliver modules and integration contracts.
- Never persist edit PIN in draft storage. Escape text and sanitize restored rich HTML.
- Use server checks for privileged operations; client display is not authorization.

## Review Focus

- Same-name staff and historical department transfers: identity must remain unambiguous.
- Save accepted but response lost: retries and reloads must not create duplicates.
- Shared browser, expired/changed edit source, storage quota failure: do not silently replace server data or claim unsaved work is saved.
- CEO approval concurrent with recall: one valid transaction wins; never undo approved or paid records.
- Route changes during pending requests: no previous-proposal response may overwrite current UI.

## Task 1: Personal reporting consistency

Files: new `js/reports/person-report.js`, `tests/person-report.test.js`; source report modules if strictly necessary. Root integrates app links/profile/detail.

Interface: `buildPersonPerformance(proposals, employees, {name, year, identity, department})` returns `{ambiguous, choices, identity, name, department, summary, rows}`. Summary exposes total, adopted, adoptionRate, totalScore, awardTotal, effectTotal, rank. Choices expose identity/name/department. An identity comes from the annual report; no name-only guessing when ambiguous.

- [ ] Write and run failing alias, homonym, historical transfer and all-years tests.
- [ ] Implement shared report-based identity aggregation and root integration.
- [ ] Verify profile totals/rows match report and detail; independent review.

## Task 2: Draft protection and writing UX

Files: new `js/editor/proposal-draft.js`, `css/proposal-draft.css`, tests. Root integrates form mount/route cleanup and photo callbacks.

Interface: `mountProposalDraft(form, options)` with `key`, `sourceUpdatedAt`, `syncEditors`, `restoreEditors`, `readImages`, `restoreImages`, `sanitizeHtml`; controller exposes `flush()`, `clear()`, `destroy()`, `getRequestId()`, `markSubmitted(receipt)`. DOM remains inside form plus owned preview dialog. Read exact existing image selection shape.

- [ ] Write/run failing serialization/PIN exclusion/storage/restore/progress tests.
- [ ] Implement text fallback plus IndexedDB image recovery, restore/discard, status, required progress and preview.
- [ ] Implement responsive evaluation cards using existing input controls.
- [ ] Verify source revision conflicts and storage failure display; independent review.

## Task 3: Transactional backend

Files: `sql/proposal_reliability_v2917.sql`, baseline function snapshots, `tests/sql/*v2917*`, local verification runner. Agent communicates exact RPC signatures before integration. Root alone applies migration.

Interfaces: idempotent create(request UUID,payload,PIN); atomic team evaluation+approval(proposal,step,evaluation,comment,expected update); admin selected CEO recall(ids,reason,expected revisions); safe batch workflow summary(ids); admin proposal history(proposal,limit,cursor).

- [ ] Inspect live function/trigger definitions read-only; save required baseline code.
- [ ] Write/run failing real PostgreSQL behavior tests for duplicate create, all-or-nothing save, recall permissions/state/race/history, stale reminder eligibility and query privacy.
- [ ] Implement backward-compatible RPCs with explicit grants, correct auth and row locks.
- [ ] Verify in local PostgreSQL; independent security and business-rule review.

## Task 4: Submission and detail correctness

Files: new `js/reliability/submission.js`, tests; root edits `js/app.js` and `js/services/store.js`.

- [ ] Test immediate double-call guard, accepted save/refresh failure, retry key persistence and stale detail responses.
- [ ] Integrate idempotent server create, draft request IDs, definitive receipt UI and atomic team RPC.
- [ ] Display detail lookup errors and retry; guard route identity before DOM updates.
- [ ] Verify meaningful failure paths and existing edit/resubmit behavior.

## Task 5: Recall, progress and history UI

Files: new `js/ui/workflow-progress.js`, `js/admin/proposal-history.js`, `css/proposal-workflow.css`, tests; root integrates admin workspace and app.

- [ ] Test stage/actor/wait calculations, legacy exceptions, unapproved recall selection and history filtering.
- [ ] Add selected recall with required reason and stale-state guard.
- [ ] Render current role/person/wait/next-action and separate implementation/payment; no made-up historical percentages.
- [ ] Add proposal-specific combined history with before/after/reason and loading/error states.
- [ ] Verify public and administrator views visually at desktop and mobile sizes.

## Task 6: Release verification

- [ ] Update stale baseline tests to current business behavior without dropping meaningful assertions.
- [ ] Run full JavaScript suite and focused PostgreSQL suite. Review module and integrated diffs independently.
- [ ] Snapshot prior server definitions, apply reviewed migration, verify grants and read-only behavior; deploy frontend with branch lease.
- [ ] Confirm GitHub Pages success and served file hashes; record changes and verification in release notes.
