import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAward,
  dashboardMetrics,
  filterProposals,
  isEmployeeEditable,
  nextProposalNo,
  toProposalCsv,
} from "../js/core.js";

const proposals = [
  {
    proposal_no: "Q26-001",
    received_date: "2026-01-01",
    category: "개선",
    department: "압연",
    proposer_name: "심재원",
    title: "산처리 에어건 교체",
    current_problem: "공기 사용량 증가",
    improvement_plan: "노즐 교체",
    expected_effect: "작업시간 단축",
    status: "접수",
    review_result: "미심사",
    implementation_status: "미실시",
    award_amount: 0,
    effect_amount: 0,
    locked: false,
  },
  {
    proposal_no: "Q26-009",
    received_date: "2026-03-01",
    category: "안전",
    department: "가공",
    proposer_name: "최용재",
    title: "인양 안전장치",
    current_problem: "낙하 위험",
    improvement_plan: "고정 장치 추가",
    expected_effect: "안전 확보",
    status: "심사완료",
    review_result: "채택",
    implementation_status: "완료",
    award_amount: 10000,
    effect_amount: 500000,
    locked: true,
  },
];

test("nextProposalNo increments the current-year maximum", () => {
  assert.equal(nextProposalNo(proposals, new Date("2026-07-23")), "Q26-010");
  assert.equal(nextProposalNo(proposals, new Date("2027-01-01")), "Q27-001");
});

test("calculateAward follows configured score bands", () => {
  assert.deepEqual(calculateAward(90, "개선"), { grade: "A", amount: 100000 });
  assert.deepEqual(calculateAward(80, "개선"), { grade: "B", amount: 50000 });
  assert.deepEqual(calculateAward(70, "개선"), { grade: "C", amount: 30000 });
  assert.deepEqual(calculateAward(60, "개선"), { grade: "D", amount: 10000 });
  assert.deepEqual(calculateAward(59, "개선"), { grade: "건수처리", amount: 5000 });
  assert.deepEqual(calculateAward(59, "안전"), { grade: "건수처리", amount: 10000 });
});

test("filterProposals searches every entered term across public fields", () => {
  assert.equal(filterProposals(proposals, { query: "산처리 작업시간" }).length, 1);
  assert.equal(filterProposals(proposals, { query: "최용재 안전" }).length, 1);
  assert.equal(filterProposals(proposals, { department: "압연" }).length, 1);
  assert.equal(filterProposals(proposals, { reviewResult: "채택" }).length, 1);
});

test("employee edit locks once review begins", () => {
  assert.equal(isEmployeeEditable(proposals[0]), true);
  assert.equal(isEmployeeEditable(proposals[1]), false);
  assert.equal(isEmployeeEditable({ locked: false, status: "심사중" }), false);
});

test("dashboardMetrics returns workflow and amount totals", () => {
  assert.deepEqual(dashboardMetrics(proposals), {
    total: 2,
    pending: 1,
    adopted: 1,
    completed: 1,
    awardTotal: 10000,
    effectTotal: 500000,
  });
});

test("toProposalCsv includes BOM and escaped Korean headers", () => {
  const csv = toProposalCsv(proposals);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /"접수번호"/);
  assert.match(csv, /"Q26-001"/);
});
