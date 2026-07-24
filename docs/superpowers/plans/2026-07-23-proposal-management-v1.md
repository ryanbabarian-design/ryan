# Proposal Management V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a GitHub Pages proposal intake, public search, employee edit, and authenticated administrator review application backed by Supabase with a local demo fallback.

**Architecture:** A static hash-routed single-page application separates pure business rules, UI orchestration, and a swappable storage adapter. Supabase SQL creates PostgreSQL tables, RLS, public Storage, RPCs for anonymous create/edit, and administrator authorization.

**Tech Stack:** HTML5, CSS3, browser ES modules, Supabase JavaScript v2, SheetJS, PostgreSQL, Node.js built-in test runner.

## Global Constraints

- Public users do not sign in.
- All proposal fields and images are public immediately after submission.
- Employee edits require proposal number plus a four-digit PIN and stop once review begins.
- Administrators use individual Supabase email/password accounts.
- Browser code must never contain a service-role key.
- GitHub Pages deployment requires no build step.

---

### Task 1: Pure proposal business rules

**Files:**
- Create: `js/core.js`
- Create: `tests/core.test.js`
- Create: `package.json`

**Interfaces:**
- Produces: `nextProposalNo`, `calculateAward`, `filterProposals`, `dashboardMetrics`, `isEmployeeEditable`, `toProposalCsv`.

- [x] Write failing tests for proposal numbering, award bands, multi-term search, edit locking, dashboard totals, and CSV.
- [x] Run `npm test` and verify the tests fail before implementation.
- [x] Implement the exported pure functions.
- [x] Run `npm test` and verify all tests pass.
- [x] Commit the business-rule implementation.

### Task 2: Legacy workbook seed conversion

**Files:**
- Create: `js/data/seed.js`
- Create: `sql/seed_legacy_data.sql`

**Interfaces:**
- Produces: `SEED_PROPOSALS`, `SEED_EMPLOYEES`, and one-time SQL migration data.

- [x] Read `1. 2026년 제안서 접수현황(1).xlsx` using the spreadsheet artifact API.
- [x] Map rows from `1. 개인 제안접수내역`.
- [x] Correct the second duplicate `Q26-021` to `Q26-022`.
- [x] Correct `완ㄴ료` to `완료`.
- [x] Generate browser seed and Supabase migration SQL.
- [x] Verify 22 unique proposal numbers and 13 employee records.

### Task 3: Storage adapter

**Files:**
- Create: `js/services/store.js`
- Create: `js/config.js`

**Interfaces:**
- Produces: `createStore(config)` with proposal, employee, administrator, image, import, and reset methods.
- Consumes: core rules and seed data.

- [x] Implement localStorage demo initialization and CRUD.
- [x] Hash demo edit PINs with SHA-256.
- [x] Implement Supabase public reads and anonymous RPC calls.
- [x] Implement Storage uploads and public URLs.
- [x] Implement administrator authentication and RLS-backed update/delete.
- [x] Implement employee upsert import.

### Task 4: Responsive public UI

**Files:**
- Create: `index.html`
- Create: `css/styles.css`
- Create: `js/app.js`

**Interfaces:**
- Consumes: `createStore`, business-rule exports.
- Produces: dashboard, public proposal form, search list, detail view, and PIN edit screen.

- [x] Build sticky navigation and hash routing.
- [x] Build dashboard metrics and recent proposal cards.
- [x] Build integrated search and filters.
- [x] Build employee-select proposal form with department autofill.
- [x] Build live similar-proposal search.
- [x] Build before/after photo previews and public detail view.
- [x] Build immediate submit and PIN edit flow.
- [x] Add responsive mobile layouts and image lightbox.

### Task 5: Administrator console

**Files:**
- Modify: `js/app.js`
- Modify: `css/styles.css`

**Interfaces:**
- Consumes: administrator methods from store adapter.
- Produces: login, review queue, score/award update, delete, CSV export, employee workbook import.

- [x] Build email/password login form.
- [x] Build review queue and public-detail links.
- [x] Build review form with automatic award calculation.
- [x] Lock employee editing when status becomes review-in-progress or complete.
- [x] Build employee Excel/CSV import using first-sheet header detection.
- [x] Build CSV export and demo reset controls.

### Task 6: Supabase database and security

**Files:**
- Create: `sql/supabase_setup.sql`

**Interfaces:**
- Produces: employees, admins, proposal counters, proposals, RPCs, RLS, grants, and Storage policies.

- [x] Create tables, checks, indexes, and full-text search index.
- [x] Create concurrency-safe `next_proposal_no`.
- [x] Create anonymous `create_proposal`.
- [x] Create PIN-verified `edit_proposal_with_pin`.
- [x] Create administrator checker and RLS policies.
- [x] Create public proposal image bucket with type and size restrictions.
- [x] Document administrator account registration.

### Task 7: Documentation and verification

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/specs/2026-07-23-proposal-management-design.md`
- Create: `docs/superpowers/plans/2026-07-23-proposal-management-v1.md`

- [x] Document demo deployment.
- [x] Document Supabase setup and config.
- [x] Document employee workbook columns.
- [x] Run automated tests.
- [x] Start a local static server and verify required resources return HTTP 200.
- [x] Validate unique seed proposal numbers and required file presence.
