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

import { dashboardBreakdown } from "../js/core.js";

const analyticsProposals = [
  {
    proposal_no: "Q25-001",
    received_date: "2025-12-15",
    department: "압연",
    cost_amount: 10000,
    award_amount: 5000,
    effect_amount: 100000,
  },
  {
    proposal_no: "Q26-001",
    received_date: "2026-01-10",
    department: "압연",
    cost_amount: 20000,
    award_amount: 10000,
    effect_amount: 300000,
  },
  {
    proposal_no: "Q26-002",
    received_date: "2026-01-20",
    department: "가공",
    cost_amount: 30000,
    award_amount: 50000,
    effect_amount: 500000,
  },
  {
    proposal_no: "Q26-003",
    received_date: "2026-03-01",
    department: "가공",
    cost_amount: "invalid",
    award_amount: null,
    effect_amount: 200000,
  },
];

test("dashboardBreakdown aggregates year, month, department, and every amount", () => {
  const report = dashboardBreakdown(analyticsProposals, "2026");

  assert.deepEqual(report.years, ["2026", "2025"]);
  assert.equal(report.selectedYear, "2026");
  assert.deepEqual(report.totals, {
    count: 3,
    costTotal: 50000,
    awardTotal: 60000,
    effectTotal: 1000000,
  });

  assert.deepEqual(report.monthly[0], {
    key: "2026-01",
    label: "1월",
    count: 2,
    costTotal: 50000,
    awardTotal: 60000,
    effectTotal: 800000,
  });
  assert.equal(report.monthly.length, 12);
  assert.equal(report.monthly[1].count, 0);
  assert.equal(report.monthly[2].effectTotal, 200000);

  assert.deepEqual(report.departments, [
    {
      key: "가공",
      label: "가공",
      count: 2,
      costTotal: 30000,
      awardTotal: 50000,
      effectTotal: 700000,
    },
    {
      key: "압연",
      label: "압연",
      count: 1,
      costTotal: 20000,
      awardTotal: 10000,
      effectTotal: 300000,
    },
  ]);
});

test("dashboardBreakdown shows all-year monthly rows and yearly totals", () => {
  const report = dashboardBreakdown(analyticsProposals, "all");

  assert.equal(report.selectedYear, "all");
  assert.equal(report.totals.count, 4);
  assert.deepEqual(report.yearly, [
    {
      key: "2026",
      label: "2026년",
      count: 3,
      costTotal: 50000,
      awardTotal: 60000,
      effectTotal: 1000000,
    },
    {
      key: "2025",
      label: "2025년",
      count: 1,
      costTotal: 10000,
      awardTotal: 5000,
      effectTotal: 100000,
    },
  ]);
  assert.equal(report.monthly[0].key, "2025-12");
  assert.equal(report.monthly[1].key, "2026-01");
  assert.equal(report.monthly[2].key, "2026-03");
});

test("dashboardBreakdown defaults to the latest available year", () => {
  const report = dashboardBreakdown(analyticsProposals, "2099");
  assert.equal(report.selectedYear, "2026");
  assert.equal(report.totals.count, 3);
});
