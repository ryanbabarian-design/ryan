import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDepartmentName, filterProposals, dashboardDepartmentMonthly, departmentGoalProgress } from '../js/core.js';
import { buildAnnualReport } from '../js/reports/annual-report.js';
import { readWorkspaceFilters } from '../js/admin/workspace-core.js';

const proposal = (id, department, name, extra = {}) => ({
  id, proposal_no: `Q26-${id}`, received_date: '2026-03-02', department,
  proposer_name: name, title: '개선 제안', status: '심사완료', review_result: '채택',
  approval_required: false, award_amount: 10000, payment_status: '완료', ...extra,
});
function data() {
  return {
    year: 2026, asOf: '2026-11-19T00:00:00Z',
    employees: [
      { id: 'old', name: '직원가', department: '압연', active: false },
      { id: 'active', name: '직원가', department: '압연팀', active: true },
      { id: 'zero', name: '직원나', department: '압연팀', active: true },
      { id: 'yeoncheon', name: '직원다', department: '연천압연팀', active: true },
    ],
    proposals: [
      proposal('001', '압연', '직원가', { employee_id: 'old' }),
      proposal('002', '압연팀', '직원가', { employee_id: 'active' }),
      proposal('003', '연천압연팀', '직원다', { employee_id: 'yeoncheon' }),
    ],
    goals: [
      { year: 2026, department: '압연', annual_goal: 12 },
      { year: 2026, department: '압연팀', annual_goal: 20 },
      { year: 2026, department: '연천압연팀', annual_goal: 9 },
    ],
  };
}

test('confirmed rolling aliases share one report row with current staff, without moving Yeoncheon', () => {
  const source = data(), before = structuredClone(source);
  const report = buildAnnualReport(source);
  assert.deepEqual(report.departments.map(d => d.department), ['압연', '연천압연팀']);
  const rolling = report.departments[0];
  assert.equal(rolling.total, 2);
  assert.equal(rolling.activeEmployees, 2);
  assert.equal(rolling.participants, 1);
  assert.equal(rolling.zeroEmployees, 1);
  assert.equal(rolling.goal, 20);
  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.participants, 2);
  assert.equal(report.summary.activeEmployees, 3);
  assert.equal(report.summary.awardConfirmed, 30000);
  assert.equal(report.summary.awardPaid, 30000);
  assert.deepEqual(source, before);
});

test('old and spaced rolling labels filter both spellings across list, monthly and goal views', () => {
  const source = data();
  assert.equal(normalizeDepartmentName(' 압 연 팀 '), '압연');
  assert.equal(normalizeDepartmentName('연천압연팀'), '연천압연팀');
  assert.equal(normalizeDepartmentName('생산관리팀'), '생산관리팀');
  assert.equal(filterProposals(source.proposals, { department: '압연팀' }).length, 2);
  assert.equal(buildAnnualReport({ ...source, department: '압연팀' }).summary.total, 2);
  assert.equal(readWorkspaceFilters('#admin?department=압연팀').department, '압연');
  const monthly = dashboardDepartmentMonthly(source.proposals, '2026').departments;
  assert.equal(monthly.find(d => d.department === '압연').months[2], 2);
  assert.equal(monthly.length, 2);
  const goal = departmentGoalProgress(source.proposals, source.goals, '2026').find(d => d.department === '압연');
  assert.equal(goal.actual, 2);
  assert.equal(goal.goal, 20);
});

test('aliasing cannot merge employees with conflicting employee numbers or two active identities', () => {
  const source = data();
  source.employees[0].employee_no = 'OLD-001';
  source.employees[1].employee_no = 'NEW-002';
  const report = buildAnnualReport(source);
  const named = report.people.filter(p => p.name === '직원가');
  assert.equal(named.length, 2);
  assert.deepEqual(named.map(p => p.employeeNo).sort(), ['NEW-002', 'OLD-001']);
  assert.equal(report.summary.activeEmployees, 3);
  const ambiguous = buildAnnualReport({ ...source, employees: [
    { id: 'a', name: '동명', department: '압연', active: true },
    { id: 'b', name: '동명', department: '압연팀', active: true },
  ], proposals: [proposal('004', '압연', '동명')] });
  assert.equal(ambiguous.summary.total, 1);
  assert.equal(ambiguous.summary.unmatchedProposals, 1);
  assert.equal(ambiguous.summary.participants, 0);
});
