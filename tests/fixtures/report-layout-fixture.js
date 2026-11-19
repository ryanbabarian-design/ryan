import { buildAnnualReport } from '../../js/reports/annual-report.js';

export function makeLayoutReport(departmentCount = 19) {
  const departments = Array.from({ length: departmentCount }, (_, i) => `제조${String(i + 1).padStart(2, '0')}부`);
  const employees = departments.flatMap((department, i) => [
    { id: `participant-${i}`, employee_no: `P${i}`, name: `참여자${i + 1}`, department, active: true },
    { id: `nonparticipant-${i}`, employee_no: `N${i}`, name: `미참여자${i + 1}`, department, active: true },
  ]);
  const outcomes = ['채택', '건수처리', '미채택', '중복제안', '보류', '미심사'];
  const proposals = departments.map((department, i) => ({
    id: `proposal-${i}`,
    proposal_no: `2026-${String(i + 1).padStart(3, '0')}`,
    received_date: `2026-${String(i % 12 + 1).padStart(2, '0')}-15`,
    employee_id: `participant-${i}`,
    proposer_name: `참여자${i + 1}`,
    department,
    title: `${department} 작업 개선`,
    review_result: outcomes[i % 6],
    status: i % 6 === 5 ? '접수' : '심사완료',
    approval_required: false,
    score: i % 6 === 0 ? 80 : 0,
    award_amount: i % 6 === 0 ? (i + 1) * 10000 : i % 6 === 4 ? (i + 1) * 900 : 0,
    payment_status: i % 12 === 0 ? '완료' : '미지급',
    effect_amount: i % 6 === 0 ? (i + 1) * 1000000 : 0,
    proposer_effect_amount: (i + 1) * 1000000,
    cost_amount: (i + 1) * 1000,
    implementation_status: '미실시',
  }));
  return buildAnnualReport({
    year: 2026,
    asOf: '2026-11-19T00:00:00.000Z',
    mode: 'demo',
    employees,
    proposals,
  });
}
