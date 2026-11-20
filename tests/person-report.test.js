import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAnnualReport } from '../js/reports/annual-report.js';
import { buildPersonPerformance } from '../js/reports/person-report.js';

const proposal = (number, name, department, fields = {}) => ({
  id: `proposal-${number}`,
  proposal_no: number,
  proposer_name: name,
  department,
  received_date: '2026-03-02',
  title: `제안 ${number}`,
  status: '심사완료',
  review_result: '채택',
  approval_required: false,
  score: 45,
  award_amount: 10000,
  effect_amount: 100000,
  ...fields,
});

test('personal totals use the annual roster aliases and saved review amounts', () => {
  const employees = [
    { id: 'rolling-old', name: '공 제안', department: '압연', active: false },
    { id: 'rolling-current', name: '공제안', department: '압연팀', employee_no: 'R1', active: true },
    { id: 'yeoncheon', name: '오제안', department: '연천압연팀', employee_no: 'Y1', active: true },
  ];
  const proposals = [
    proposal('A', '공 제안', '압연', { employee_id: 'rolling-old' }),
    proposal('B', '공제안', ' 압 연 팀 ', {
      employee_id: 'rolling-current',
      received_date: '2026-04-12',
      review_result: '건수처리',
      ceo_submission_status: '상신완료',
      score: 35,
      effect_amount: 200000,
    }),
    proposal('C', '오제안', '연천압연팀'),
  ];
  const before = structuredClone({ proposals, employees });
  const report = buildPersonPerformance(proposals, employees, { name: '공 제안', year: 2026 });
  const annual = buildAnnualReport({ proposals, employees, year: 2026 });
  const annualPerson = annual.people.find(person => person.identity === 'no:R1');

  assert.equal(report.identity, 'no:R1');
  assert.equal(report.name, '공제안');
  assert.equal(report.department, '압연');
  assert.deepEqual(report.summary, {
    total: 2, adopted: 1, adoptionRate: 50, totalScore: 80, awardTotal: 20000, effectTotal: 100000, rank: 1,
  });
  assert.equal(report.summary.awardTotal, annualPerson.awardRecorded);
  assert.equal(report.summary.effectTotal, annualPerson.confirmedEffect);
  assert.deepEqual(report.rows.map(row => [row.no, row.department, row.proposal.department]), [
    ['B', '압연', '압연'], ['A', '압연', '압연'],
  ]);
  assert.deepEqual({ proposals, employees }, before);
});

test('the current year cannot silently pick between verified homonyms', () => {
  const employees = [
    { id: 'rolling', name: '김동명', department: '압연팀', employee_no: 'R1' },
    { id: 'yeoncheon', name: '김동명', department: '연천압연팀', employee_no: 'Y1' },
  ];
  const proposals = [
    proposal('A', '김동명', '압연'),
    proposal('B', '김동명', '연천압연팀', { received_date: '2025-04-13' }),
  ];

  const ambiguous = buildPersonPerformance(proposals, employees, { name: '김동명', year: '2026' });
  assert.equal(ambiguous.ambiguous, true);
  assert.deepEqual(ambiguous.choices.map(choice => choice.identity).sort(), ['no:R1', 'no:Y1']);
  assert.equal(ambiguous.summary, null);
  assert.deepEqual(ambiguous.rows, []);

  const rolling = buildPersonPerformance(proposals, employees, { name: '김동명', department: '압 연 팀 ', year: 'all' });
  assert.equal(rolling.identity, 'no:R1');
  assert.deepEqual(rolling.rows.map(row => row.no), ['A']);

  const yeoncheon = buildPersonPerformance(proposals, employees, { proposalNo: 'B', year: 'all' });
  assert.equal(yeoncheon.identity, 'no:Y1');
  assert.deepEqual(yeoncheon.rows.map(row => row.no), ['B']);
});

test('same-department homonyms with no proposal identity evidence stay unresolved', () => {
  const employees = [
    { id: 'r1', name: '김동명', department: '압연', employee_no: 'R1' },
    { id: 'r2', name: '김동명', department: '압연팀', employee_no: 'R2' },
  ];
  const proposals = [
    proposal('A', '김동명', '압연팀', { proposer_id: 'r1' }),
    proposal('B', '김동명', '압연', { proposer_employee_no: 'R2' }),
    proposal('C', '김동명', '압연팀'),
  ];

  const unresolved = buildPersonPerformance(proposals, employees, { proposalId: 'proposal-C', year: 2026 });
  assert.equal(unresolved.ambiguous, true);
  assert.deepEqual(unresolved.choices.map(choice => [choice.identity, choice.employeeNo]), [['no:R1', 'R1'], ['no:R2', 'R2']]);
  assert.deepEqual(unresolved.rows, []);
  assert.equal(unresolved.summary, null);

  for (const [identity, number] of [['no:R1', 'A'], ['no:R2', 'B']]) {
    const person = buildPersonPerformance(proposals, employees, { identity, year: 2026 });
    assert.deepEqual(person.rows.map(row => row.no), [number]);
  }
});

test('a receipt with conflicting verified employee identifiers belongs to neither employee', () => {
  const employees = [
    { id: 'dept-a', name: '이동명', department: '가공팀', employee_no: 'A' },
    { id: 'dept-b', name: '이동명', department: '가공', employee_no: 'B' },
  ];
  const proposals = [proposal('P', '이동명', '가공팀', { employee_id: 'dept-a', proposer_employee_no: 'B' })];
  const annual = buildAnnualReport({ proposals, employees, year: 2026 });
  const profile = buildPersonPerformance(proposals, employees, { proposalNo: 'P' });

  assert.equal(annual.summary.unmatchedProposals, 1);
  assert.equal(annual.summary.participants, 0);
  assert.equal(profile.ambiguous, true);
  assert.deepEqual(profile.choices.map(person => person.identity), ['no:A', 'no:B']);
  assert.equal(profile.summary, null);
  for (const identity of ['no:A', 'no:B']) {
    assert.equal(buildPersonPerformance(proposals, employees, { identity }).summary.total, 0);
  }
});

test('an unknown supplied employee number blocks fallback to a different known number', () => {
  const employees = [{ id: 'dept-a', name: '이동명', department: '가공팀', employee_no: 'A' }];
  const proposals = [
    proposal('P', '이동명', '가공팀', { proposer_employee_no: 'retired-number' }),
    proposal('Q', '이동명', '가공'),
  ];
  const annual = buildAnnualReport({ proposals, employees, year: 2026 });
  const profile = buildPersonPerformance(proposals, employees, { proposalNo: 'P' });

  assert.equal(annual.summary.unmatchedProposals, 1);
  assert.equal(annual.people.find(person => person.identity === 'no:A').total, 1);
  assert.equal(profile.ambiguous, true);
  assert.equal(profile.summary, null);
  assert.deepEqual(buildPersonPerformance(proposals, employees, { identity: 'no:A' }).rows.map(row => row.no), ['Q']);

  const numberedAlias = { ...employees[0], active: false };
  const unnumberedCurrent = { id: 'current-a', name: '이동명', department: '가공' };
  const aliasRoster = [numberedAlias, unnumberedCurrent];
  const direct = [proposal('P', '이동명', '가공팀', { employee_id: 'current-a', proposer_employee_no: 'retired-number' })];
  assert.equal(buildPersonPerformance(direct, aliasRoster, { proposalNo: 'P' }).ambiguous, true);
});

test('a transferred roster row still vetoes merging an unnumbered past employee into a replacement', () => {
  const employees = [
    { id: 'past-numbered', name: '이동명', department: '가공', employee_no: 'T1', active: false },
    { id: 'current-transfer', name: '이동명', department: '공무', employee_no: 'T1' },
    { id: 'current-replacement', name: '이동명', department: '가공팀', employee_no: 'T2' },
    { id: 'past-unknown', name: '이동명', department: '가공', active: false },
  ];
  const proposals = [
    proposal('P', '이동명', '가공팀', { employee_id: 'past-unknown' }),
    proposal('Q', '이동명', '가공팀'),
  ];
  const annual = buildAnnualReport({ proposals, employees, year: 2026 });
  const profile = buildPersonPerformance(proposals, employees, { proposalNo: 'P' });

  assert.equal(annual.details.find(row => row.no === 'P').identity, 'id:past-unknown');
  assert.equal(annual.people.find(person => person.identity === 'no:T2').total, 0);
  assert.equal(annual.summary.unmatchedProposals, 1);
  assert.equal(profile.identity, 'id:past-unknown');
  assert.deepEqual(profile.rows.map(row => row.no), ['P']);
  assert.equal(buildPersonPerformance(proposals, employees, { proposalNo: 'Q' }).ambiguous, true);
});

test('historical receipt departments stay on rows when employee number establishes a transfer', () => {
  const employees = [
    { id: 'past', name: '김공정', department: '가공팀', employee_no: 'T1', active: false },
    { id: 'present', name: '김공정', department: '공무팀', employee_no: 'T1', active: true },
    { id: 'different-past', name: '정동명', department: '가공팀', employee_no: 'T2', active: false },
    { id: 'different-present', name: '정동명', department: '공무팀', employee_no: 'T3', active: true },
  ];
  const proposals = [
    proposal('A', '김공정', '가공팀', { employee_id: 'past', received_date: '2026-01-12' }),
    proposal('B', '김공정', '공무', { employee_id: 'present' }),
    proposal('C', '김공정', '가공팀', { received_date: '2025-02-01' }),
    proposal('D', '정동명', '가공팀'),
    proposal('E', '정동명', '공무팀'),
  ];

  const annual = buildAnnualReport({ proposals, employees, year: 2026 });
  assert.deepEqual(annual.details.filter(row => row.identity === 'no:T1').map(row => [row.no, row.department]), [
    ['B', '공무'], ['A', '가공'],
  ]);
  const profile = buildPersonPerformance(proposals, employees, { identity: 'no:T1', year: 'all' });
  const detail = buildPersonPerformance(proposals, employees, { proposalNo: 'A', year: 'all' });
  assert.deepEqual(detail, profile);
  assert.equal(profile.department, '공무');
  assert.deepEqual(profile.rows.map(row => [row.no, row.department]), [['B', '공무'], ['A', '가공'], ['C', '가공']]);

  const unrelated = buildPersonPerformance(proposals, employees, { proposalNo: 'D', year: 'all' });
  assert.equal(unrelated.identity, 'no:T2');
  assert.deepEqual(unrelated.rows.map(row => row.no), ['D']);
});

test('all years use the first receipt date and latest saved revision once', () => {
  const employees = [{ id: 'one', name: '윤접수', department: '가공' }];
  const proposals = [
    proposal('A', '윤접수', '가공팀', { received_date: '2024-12-30', updated_at: '2024-12-30', score: 32 }),
    proposal('A', '윤접수', '가공팀', {
      received_date: '2025-01-02', updated_at: '2025-01-02', score: 56, title: '수정 제안',
      approval_required: true, award_amount: 30000, effect_amount: 800000,
    }),
    proposal('B', '윤접수', '가공', { received_date: '2025-05-02', score: 45 }),
    proposal('C', '윤접수', '가공', { received_date: '2025-02-30', score: 80 }),
    proposal('D', '윤접수', '가공', { received_date: '2025-01-02', is_deleted: true }),
  ];
  const approvals = [{ proposal_id: 'proposal-A', role_name: '대표이사', status: '승인' }];
  const all = buildPersonPerformance(proposals, employees, { name: '윤접수', year: 'all', approvals });
  const firstYear = buildPersonPerformance(proposals, employees, { identity: 'id:one', year: '2024', approvals });
  const nextYear = buildPersonPerformance(proposals, employees, { identity: 'id:one', year: '2025', approvals });

  assert.deepEqual(all.rows.map(row => [row.no, row.date]), [['B', '2025-05-02'], ['A', '2024-12-30']]);
  assert.equal(all.summary.total, 2);
  assert.equal(all.summary.totalScore, 101);
  assert.equal(all.summary.awardTotal, 40000);
  assert.equal(all.summary.effectTotal, 900000);
  assert.equal(firstYear.rows[0].proposal.received_date, '2024-12-30');
  assert.equal(firstYear.rows[0].proposal.title, '수정 제안');
  assert.deepEqual(nextYear.rows.map(row => row.no), ['B']);
});

test('an explicit missing identity cannot select a different person by name', () => {
  const employees = [{ id: 'one', name: '윤접수', department: '가공' }];
  const proposals = [proposal('A', '윤접수', '가공')];
  const missing = buildPersonPerformance(proposals, employees, { name: '윤접수', identity: 'id:missing', year: 2026 });
  const zero = buildPersonPerformance(proposals, employees, { identity: 'id:one', year: 2025 });

  assert.equal(missing.summary, null);
  assert.deepEqual(missing.rows, []);
  assert.equal(zero.summary.total, 0);
  assert.equal(zero.summary.rank, null);
});
