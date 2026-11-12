/**
 * V2.8.3 — use exactly the person identity grouping that the read-only
 * question search uses, rather than the dashboard's historic name+department
 * split. The top proposer is a person, not a person/department pair.
 * No writes, API calls, or permission changes.
 */
import { buildAnnualReport, reportDate } from './annual-report.js?v=2.8.5';
import { candidateGroups } from '../search/question-core.js?v=2.8.7';
import { proposalResultCategory } from './proposal-status-summary.js?v=2.8.7';

const text = value => String(value ?? '').trim();
const numericScore = value => value === null || value === undefined || value === '' ? 0 : Number.isFinite(Number(value)) ? Number(value) : 0;

export function dashboardTopPeople(proposals = [], employees = [], selectedYear = 'all') {
  const source = Array.isArray(proposals) ? proposals : [];
  const roster = Array.isArray(employees) ? employees : [];
  const requested = text(selectedYear) || 'all';
  const years = requested === 'all'
    ? [...new Set(source.map(p => reportDate(p?.received_date)?.slice(0, 4)).filter(Boolean))].sort()
    : /^\d{4}$/.test(requested) ? [requested] : [];
  if (!years.length) return {topSubmitted:null,topAdopted:null};

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
        if (proposalResultCategory(d).category === 'adopted') candidate.adoptedCount++;
        const original = originalByNo.get(text(d.no) || text(d.id));
        candidate.totalScore += numericScore(original?.score);
      }
      people.set(key, candidate);
    }
  }
  const rows=[...people.values()];
  const bySubmission=[...rows].sort((a,b)=>b.count-a.count||b.adoptedCount-a.adoptedCount||b.totalScore-a.totalScore||a.name.localeCompare(b.name,'ko'));
  const byAdoption=[...rows].filter(p=>p.adoptedCount>0).sort((a,b)=>b.adoptedCount-a.adoptedCount||b.count-a.count||b.totalScore-a.totalScore||a.name.localeCompare(b.name,'ko'));
  const publicView = person => person ? {name:person.name,department:person.department,count:person.count,adoptedCount:person.adoptedCount,totalScore:person.totalScore} : null;
  return {topSubmitted:publicView(bySubmission[0]),topAdopted:publicView(byAdoption[0])};
}

/** Backward-compatible: this function still means most submissions. */
export function dashboardTopPerson(proposals=[],employees=[],selectedYear='all') {
  return dashboardTopPeople(proposals,employees,selectedYear).topSubmitted;
}
