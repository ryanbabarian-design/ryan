import test from 'node:test';
import assert from 'node:assert/strict';
import { getGuideAwardSchedule } from '../js/ui/evaluation-guide.js';

test('guide groups adopted awards without losing boundary scores or the zero band', () => {
  assert.deepEqual(getGuideAwardSchedule().adopted, [
    { min: 90, max: 100, grade: 'A', amount: 100000 },
    { min: 80, max: 89, grade: 'B', amount: 50000 },
    { min: 70, max: 79, grade: 'C', amount: 30000 },
    { min: 60, max: 69, grade: 'D', amount: 10000 },
    { min: 50, max: 59, grade: '건수처리', amount: 5000 },
    { min: 0, max: 49, grade: '', amount: 0 },
  ]);
});

test('guide count-payment bands include 65 but exclude unpaid scores outside 50–65', () => {
  assert.deepEqual(getGuideAwardSchedule().count, [
    { min: 50, max: 59, grade: '건수처리', amount: 5000 },
    { min: 60, max: 65, grade: '건수처리', amount: 10000 },
  ]);
});
