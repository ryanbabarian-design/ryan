/**
 * V2.8.3 — use exactly the person identity grouping that the read-only
 * question search uses, rather than the dashboard's historic name+department
 * split. The top proposer is a person, not a person/department pair.
 * No writes, API calls, or permission changes.
 */
import { buildAnnualReport, reportDate } from './annual-report.js?v=2.6.8';
import { candidateGroups } from '../search/question-core.js?v=2.7.8';

const text = value => String(value ?? '').trim();
const numericScore = value => value === null || value === undefined || value === '' ? 0 : Number.isFinite(Number(value)) ? Number(value) : 0;

export function dashboardTopPerson(proposals = [], employees = [], selectedYear = 'all') {
  const source = Array.isArray(proposals) ? proposals : [];
  const roster = Array.isArray(employees) ? employees : [];
  const requested = text(selectedYear) || 'all';
  const years = requested === 'all'
    ? [...new Set(source.map(p => reportDate(p?.received_date)?.slice(0, 4)).filter(Boolean))].sort()
    : /^\d{4}$/.test(requested) ? [requested] : [];
  if (!years.length) return null;

  // Keep original scores for the dashboard's existing secondary tie-break.
  const originalByNo = new Map();
  for (const p of source) {
    const key = text(p?.proposal_no) || text(p?.id);
    if (key) originalByNo.set(key, p);
  }
  const people = new Map();
  for (const year of years) {
    const annual = buildAnnualReport({ proposals: source, employees: roster, year });
    const groups = candidateGroups(annual, roster);
    for (const group of groups) {
      if (!group.details?.length) continue;
      const key = group.identity;
      // Prefer stable employee number / ID over a bare name, particularly for
      // different currently active employees who happen to share a name.
      const current = roster.find(e => e.active !== false && (
        (text(e.employee_no) && group.identity === `no:${text(e.employee_no)}`) ||
        (text(e.id) && group.identity === `id:${text(e.id)}`)
      )) || roster.find(e =>
        text(e.name) === text(group.name) && e.active !== false &&
        text(group.employeeNo) && text(e.employee_no) === text(group.employeeNo)
      );
      const candidate = people.get(key) || {
        name: text(group.name) || '작성자 미등록',
        department: text(current?.department) || text(group.departments?.[0]) || '미지정',
        count: 0,
        adoptedCount: 0,
        totalScore: 0,
        numbers: new Set(),
      };
      for (const d of group.details) {
        const id = text(d.no) ? `no:${text(d.no)}` : text(d.id) ? `id:${text(d.id)}` : `fallback:${d.date}|${d.title}`;
        if (candidate.numbers.has(id)) continue;
        candidate.numbers.add(id);
        candidate.count++;
        if (d.originalResult === '채택') candidate.adoptedCount++;
        const original = originalByNo.get(text(d.no) || text(d.id));
        candidate.totalScore += numericScore(original?.score);
      }
      people.set(key, candidate);
    }
  }
  const top = [...people.values()].sort((a, b) =>
    b.count - a.count || b.adoptedCount - a.adoptedCount ||
    b.totalScore - a.totalScore || a.name.localeCompare(b.name, 'ko')
  )[0];
  return top ? {
    name: top.name, department: top.department, count: top.count,
    adoptedCount: top.adoptedCount, totalScore: top.totalScore,
  } : null;
}
