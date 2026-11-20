import { normalizeDepartmentName } from '../core.js?v=2.9.15';
import { AMBIGUOUS_PERSON_BASIS, CONFLICTING_PERSON_BASIS, buildReportRecords, reportPersonName } from './annual-report.js?v=2.9.17';

const text = value => String(value ?? '').trim();
const compareText = (a, b) => a.localeCompare(b, 'ko', { numeric: true });
const comparePeople = (a, b) => compareText(a.name, b.name) || compareText(a.department, b.department)
  || compareText(a.employeeNo, b.employeeNo) || compareText(a.identity, b.identity);

function indexPeople(roster, rosterEntries, details) {
  const people = new Map();
  for (const employee of roster) {
    const { identity, name, department, employee_no: employeeNo, id } = employee;
    people.set(identity, { identity, name, department, employeeNo, employeeId: text(id), aliases: [], rows: [], unresolved: false });
  }
  for (const entry of rosterEntries) people.get(entry.identity).aliases.push(entry);
  for (const row of details) {
    const { identity, name, department, employeeNo } = row;
    if (!people.has(identity)) {
      people.set(identity, { identity, name, department, employeeNo, employeeId: '', aliases: [], rows: [], unresolved: false });
    }
    const person = people.get(identity);
    person.aliases.push({ name, department });
    person.rows.push(row);
    person.unresolved ||= row.matchBasis === AMBIGUOUS_PERSON_BASIS || row.matchBasis === CONFLICTING_PERSON_BASIS;
  }
  return people;
}

function nameMatches(people, name, department) {
  const key = reportPersonName(name);
  if (!key) return [];
  return [...people.values()].filter(person => person.aliases.some(alias =>
    reportPersonName(alias.name) === key && (!department || alias.department === department)));
}

function choice({ identity, name, department, employeeNo, employeeId }) {
  return { identity, name, department, employeeNo, employeeId };
}

function summarize(rows) {
  const summary = { total: rows.length, adopted: 0, adoptionRate: 0, totalScore: 0, awardTotal: 0, effectTotal: 0, rank: null };
  for (const row of rows) {
    if (row.outcome === 'adopted') summary.adopted++;
    summary.totalScore += row.finalScore ?? 0;
    summary.awardTotal += row.awardRecorded;
    summary.effectTotal += row.confirmedEffect;
  }
  if (summary.total) summary.adoptionRate = Math.round((summary.adopted / summary.total) * 1000) / 10;
  return summary;
}

/** Read-only personal view of the same receipt, review, and identity records as the annual report. */
export function buildPersonPerformance(proposals = [], employees = [], options = {}) {
  const { name = '', year = 'all', identity, department, proposalId, proposalNo, approvals = [] } = options;
  const departmentHint = text(department) ? normalizeDepartmentName(department) : '';
  const { roster, rosterEntries, allDetails } = buildReportRecords({ proposals, employees, approvals, includeSource: true });
  const people = indexPeople(roster, rosterEntries, allDetails);
  const exact = text(identity);
  const number = text(proposalNo);
  const id = text(proposalId);
  const selectedRow = !exact && (number || id)
    ? allDetails.find(row => number ? row.no === number : row.id === id)
    : undefined;
  const candidates = exact || number || id
    ? [people.get(exact || selectedRow?.identity)].filter(Boolean)
    : nameMatches(people, name, departmentHint);
  const selected = candidates.length === 1 ? candidates[0] : null;
  const ambiguous = candidates.length > 1 || selected?.unresolved === true;
  if (ambiguous || !selected) {
    const alternatives = selected?.unresolved ? nameMatches(people, selected.name, selected.department) : candidates;
    return {
      ambiguous,
      choices: alternatives.filter(person => !person.unresolved).sort(comparePeople).map(choice),
      identity: '',
      name: text(name) || selected?.name || '',
      department: departmentHint || selected?.department || '',
      summary: null,
      rows: [],
    };
  }

  const period = text(year) || 'all';
  const inPeriod = row => period === 'all' || row.date.slice(0, 4) === period;
  const rows = selected.rows.filter(inPeriod);
  const summary = summarize(rows);
  if (rows.length) {
    const ranking = [...people.values()].filter(person => !person.unresolved).flatMap(person => {
      const totals = person === selected ? summary : summarize(person.rows.filter(inPeriod));
      return totals.total ? [{ person, totals }] : [];
    }).sort((a, b) => b.totals.total - a.totals.total || b.totals.adopted - a.totals.adopted
      || b.totals.totalScore - a.totals.totalScore || comparePeople(a.person, b.person));
    summary.rank = ranking.findIndex(entry => entry.person === selected) + 1;
  }
  return { ambiguous: false, choices: [], identity: selected.identity, name: selected.name, department: selected.department, summary, rows };
}
