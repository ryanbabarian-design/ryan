# V2.9.15 Report and Guide Implementation Plan

> **For agentic workers:** Use the assigned independent file ownership; root integrates and runs a fresh review before deployment.

**Goal:** Fix landscape Excel export and split department reporting; make evaluation guidance accessible without losing form work.

**Architecture:** Retain the static ES module app, shared department normalizer and custom OOXML writer. Add a read-only accessible guide dialog; cache versions change together at the entry point.

**Tech Stack:** JavaScript ES modules, native dialog, Node test runner, custom OOXML ZIP writer.

**Spec:** ../specs/2026-11-19-report-and-guide-design.md

## Global Constraints

- Do not mutate production proposal, employee, score, approval or payment records.
- Only confirmed department aliases are joined; keep 연천압연팀 separate.
- Preserve existing identity safeguards, current roster denominator and duplicate-goal maximum.
- Keep all 4 export sheets, cached formulas and proper sheet references.
- No new CDN dependencies; preserve existing committee/CEO overrides and draft state.

## Review Focus

- Inactive and active employees with matching names but conflicting numbers must stay separate.
- Old department filter URLs must select the same department displayed in results.
- Large department counts must not omit rows or shrink the entire report unreadably.
- Guide must restore keyboard focus and must not submit/reset the proposal form.
- Cached module versions must apply the same normalizer to every reporting consumer.

## Tasks

- [x] Reproduce alias error with independent fixtures in tests/department-report.test.js; update js/core.js and report/filter metadata; verify source arrays unchanged and financial totals conserved.
- [x] Reproduce portrait first-sheet XML; update js/reports/report-xlsx.js layout and any necessary writer metadata; verify four sheet settings, all departments and formulas.
- [x] Add js/ui/evaluation-guide.js and css/evaluation-guide.css using current policy; verify keyboard/mobile/draft behavior.
- [x] Integrate nav/dashboard/form entry points in index.html, js/app.js, workspace-v2912.js; update cache versions and report export copy.
- [x] Generate current-year live workbook from a read-only snapshot; verify cached values, formulas, sheet layout and independent totals. Run full existing suite and distinguish baseline failures.
- [ ] Obtain fresh code review, deploy with expected main SHA lease, verify Pages build/deploy and deliver updated workbook.

## Verification before deployment

- New focused tests: 11 passed. Full suite: 56 passed / 4 pre-existing failures (brand stylesheet, dashboard hook, old calculateAward default, old print role chain).
- Native spreadsheet recalculation: all 3,293 cached formula values match. Actual summary renders as one A4 landscape page; details retain A3 landscape.
- Independent review: no outstanding Critical or Important findings.
- Scope refinement: the affected department table labeled recorded awards as confirmed; now confirmed, provisional and paid amounts are displayed separately without changing aggregation.
- Live browser confirmation remains a release gate after Pages deployment.
