import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintModel, PRINT_APPROVAL_ROLES } from '../js/print.js';

test('buildPrintModel maps proposal fields into printable labels', () => {
  const model = buildPrintModel({
    proposal_no: 'Q26-023',
    received_date: '2026-07-25',
    title: '에어건 개선',
    proposer_name: '장영훈',
    department: '생산관리',
    category: '개선',
    status: '심사완료',
    review_result: '채택',
    implementing_department: '가공',
    implementation_status: '완료',
    implemented_date: '2026-07-28',
    score: 88,
    cost_amount: 5000,
    award_amount: 50000,
    effect_amount: 1200000,
    before_images: [{ path: 'before/a.png', url: 'https://example.com/a.png' }],
    after_images: ['https://example.com/b.png'],
  });

  assert.equal(model.proposalNo, 'Q26-023');
  assert.equal(model.proposalDate, '2026. 07. 25.');
  assert.equal(model.categoryImprovement, true);
  assert.equal(model.categorySafety, false);
  assert.equal(model.scoreText, '88점');
  assert.equal(model.costText, '5,000원');
  assert.deepEqual(model.beforeImages, ['https://example.com/a.png']);
  assert.deepEqual(model.afterImages, ['https://example.com/b.png']);
});

test('print approval roles follow the attached proposal form', () => {
  assert.deepEqual(PRINT_APPROVAL_ROLES, ['담당', '팀장', '임원', '주관부서', '대표이사']);
});

test('buildPrintModel provides blank-safe display values', () => {
  const model = buildPrintModel({ category: '안전' });
  assert.equal(model.categoryImprovement, false);
  assert.equal(model.categorySafety, true);
  assert.equal(model.scoreText, '-');
  assert.equal(model.reviewResult, '미심사');
  assert.equal(model.implementationStatus, '미실시');
});
