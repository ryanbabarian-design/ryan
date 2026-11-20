import { savedReviewSnapshot } from './review-snapshot.js?v=2.9.6';
import { normalizeDepartmentName } from '../core.js?v=2.9.15';
/** V2.6.8 — read-only annual reporting. No approval/award decisions are written here. */
export const REPORT_VERSION = '2.9.17';
export const REPORT_RULES = [
  '등록건수: 최초 접수일 기준. 같은 접수번호의 수정·재상신은 1건으로 집계합니다.',
  '심사 인정건수=저장된 채택+건수처리. 대표결재 대기 여부는 별도이며, 심사 인정을 대표승인·지급완료로 간주하지 않습니다.',
  '부서별 제안건수는 접수부서 기준입니다. 가공/가공팀, 압출인발/압출인발팀, 공무/공무팀, 압연/압연팀은 같은 부서로 집계합니다. 연천압연팀은 별도 부서로 유지하며, 부서 이동 이력은 접수 당시 부서 기준으로 표시합니다.',
  '참여율: 조회 가능한 현재 활성 직원명단 중 해당 연도에 1건 이상 제출한 직원 비율. 과거 연도의 재직인원 통계는 아닙니다.',
  '직원ID/사번 우선, 성명+통합부서가 유일하게 맞을 때 연결합니다. 동일 이름·부서의 비활성 중복기록은 충돌 사번이 없고 활성 직원이 한 명일 때만 통합합니다. 동명이인·상충 사번은 확인 대상으로 남깁니다.',
  '포상 확정액/지급완료액과 예상/심사확정 효과금액을 분리합니다. 지급완료액은 지급연도 실적이 아닌 해당 접수연도 제안의 현재 지급현황입니다.',
  '화면의 연도·부서·직원검색·0건 필터가 엑셀 4개 시트에 동일하게 적용됩니다. 직원검색/0건 필터 사용 시 부서목표 비교는 생략합니다.',
];
const str = v => String(v ?? '').trim();
const cash = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
const score = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const ko = (a,b) => str(a).localeCompare(str(b),'ko',{numeric:true});
const outcomeNames = {adopted:'채택',countOnly:'건수처리',rejected:'미채택',duplicate:'중복제안',onHold:'보류',pending:'심사·보완 중'};
export const AMBIGUOUS_PERSON_BASIS = '동명이인 확인 필요';
export const CONFLICTING_PERSON_BASIS = '직원정보 충돌 확인 필요';
export const reportPersonName = value => str(value).replace(/\s+/g,'');
export function reportDate(value) {
  const s = str(value).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10) === s ? s : null;
}
export function koreaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
export function classifyProposal(proposal, approvals = []) {
  return savedReviewSnapshot(proposal, approvals);
}

function blankTotals() {
  return {total:0,adopted:0,countOnly:0,rejected:0,duplicate:0,onHold:0,pending:0,recognized:0,ceoPending:0,ceoApproved:0,approvalReturned:0,finalRecognized:0,awardRecorded:0,awardConfirmed:0,awardProvisional:0,awardPaid:0,awardUnpaid:0,proposedEffect:0,confirmedEffect:0,cost:0};
}
function addDetail(target,d) {
  target.total++; target[d.outcome]++;
  for (const k of ['ceoPending','ceoApproved','approvalReturned','finalRecognized','awardRecorded','awardConfirmed','awardProvisional','awardPaid','awardUnpaid','proposedEffect','confirmedEffect','cost']) target[k]+=d[k];
  target.recognized=target.adopted+target.countOnly;
}
function dedupeProposals(proposals,warnings) {
  const groups=new Map(), aliases=new Map(); let duplicates=0;
  for (const [index,p] of proposals.entries()) {
    if (!p || p.deleted_at || p.is_deleted===true || p.status==='삭제') continue;
    const keys=[str(p.proposal_no)?`no:${str(p.proposal_no)}`:'',str(p.id)?`id:${p.id}`:''].filter(Boolean);
    const existing=keys.map(k=>aliases.get(k)).find(Boolean);
    const key=existing || keys[0] || `unknown:${index}`;
    keys.forEach(k=>aliases.set(k,key));
    if (!groups.has(key)) groups.set(key,[]); else duplicates++;
    groups.get(key).push(p);
  }
  if (duplicates) warnings.push(`중복 접수번호/ID ${duplicates}개는 최신 상태로 통합하고 최초 접수일을 유지했습니다.`);
  return [...groups.values()].map(list=>{
    const time=p=>{const n=Date.parse(p.updated_at||p.created_at||'');return Number.isFinite(n)?n:0;};
    const sorted=[...list].sort((a,b)=>time(a)-time(b));
    const dates=list.map(p=>reportDate(p.received_date)).filter(Boolean).sort();
    return {...sorted[sorted.length-1],received_date:dates[0]||list[0].received_date};
  });
}
function buildRoster(employees) {
  const rosterMap = new Map();
  const sourceRows = [];
  for (const [i, e] of employees.entries()) {
    if (!str(e?.name)) continue;
    const employeeNo = str(e.employee_no);
    const identity = employeeNo ? `no:${employeeNo}` : str(e.id) ? `id:${str(e.id)}` : `row:${i}`;
    const row = {...e, identity, name:str(e.name), department:normalizeDepartmentName(e.department), employee_no:employeeNo};
    sourceRows.push(row);
    const old = rosterMap.get(identity);
    if (!old || (old.active===false && e.active!==false)) rosterMap.set(identity,row);
  }
  const originalRoster=[...rosterMap.values()];
  const aliases=new Map(), groupMap=new Map();
  const personKey = (name, department) => JSON.stringify([reportPersonName(name),department]);
  for(const e of sourceRows){
    const key=personKey(e.name,e.department);
    if(!groupMap.has(key))groupMap.set(key,[]);groupMap.get(key).push(e);
  }
  for (const [key, group] of groupMap) {
    // A transferred employee still supplies identity evidence in the old department.
    const identities = new Set(group.map(e => e.identity));
    const canonical = [...identities].map(identity => rosterMap.get(identity));
    const active = canonical.filter(e => e.active !== false);
    const numbers = new Set(group.map(e => e.employee_no).filter(Boolean));
    if (active.length !== 1 || numbers.size > 1) continue;
    const target = active[0];
    if (personKey(target.name, target.department) !== key) continue;
    for (const employee of canonical) {
      if (employee.active === false && personKey(employee.name, employee.department) === key) {
        aliases.set(employee.identity, target.identity);
      }
    }
  }
  const roster=originalRoster.filter(e=>!aliases.has(e.identity));
  const byId = new Map(), byNumber = new Map(), byNameDepartment = new Map();
  const numbersByIdentity = new Map();
  function addLookup(index, key, employee) {
    if (!key) return;
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(employee.identity, employee);
  }
  const rosterEntries = sourceRows.map(e => {
    // Keep old receipt departments for rows sharing a verified employee number.
    const employee = rosterMap.get(aliases.get(e.identity) || e.identity);
    addLookup(byId, str(e.id), employee);
    addLookup(byNumber, e.employee_no, employee);
    addLookup(byNameDepartment, personKey(e.name, e.department), employee);
    if (e.employee_no) {
      if (!numbersByIdentity.has(employee.identity)) numbersByIdentity.set(employee.identity, new Set());
      numbersByIdentity.get(employee.identity).add(e.employee_no);
    }
    return {identity:employee.identity, name:e.name, department:e.department};
  });
  const conflicting = {employee:null, basis:CONFLICTING_PERSON_BASIS};
  function hasNumberConflict(employee, number) {
    const known = numbersByIdentity.get(employee.identity);
    return Boolean(number && known && !known.has(number));
  }
  function matches(p, department) {
    const id = str(p.employee_id) || str(p.proposer_id);
    const number = str(p.proposer_employee_no) || str(p.employee_no);
    const idMatches = byId.get(id);
    const numberMatches = byNumber.get(number);
    if (idMatches || numberMatches) {
      const candidates = [...(idMatches || numberMatches).values()].filter(employee =>
        !numberMatches || numberMatches.has(employee.identity));
      if (candidates.length !== 1 || hasNumberConflict(candidates[0], number)) return conflicting;
      return {employee:candidates[0], basis:idMatches ? '직원ID' : '사번'};
    }
    const found = byNameDepartment.get(personKey(p.proposer_name, department));
    if (found?.size === 1) {
      const employee = found.values().next().value;
      return hasNumberConflict(employee, number) ? conflicting : {employee, basis:'성명+부서'};
    }
    return {employee:null, basis:found?.size ? AMBIGUOUS_PERSON_BASIS : '직원명단 미확인'};
  }
  return {roster, rosterEntries, matches};
}

export function buildReportRecords({proposals=[],employees=[],approvals=[],year,includeSource=false}={}) {
  const warnings=[];
  const {roster, rosterEntries, matches} = buildRoster(employees);
  const peopleMap=new Map();
  function ensurePerson(employee,name,dept,basis) {
    const identity=employee?.identity || `unmatched:${name}|${dept}`;
    const key=JSON.stringify([identity,dept]);
    if(!peopleMap.has(key)) peopleMap.set(key,{...blankTotals(),key,identity,name,department:dept,employeeNo:employee?.employee_no||'',employeeId:str(employee?.id),rosterStatus:employee?(employee.active===false?'비활성':'활성'):'명단 미확인',matchBasis:basis,eligible:!!employee && employee.active!==false && employee.department===dept,months:Array(12).fill(0),details:[],personTotal:0});
    return peopleMap.get(key);
  }
  roster.filter(e=>e.active!==false).forEach(e=>ensurePerson(e,e.name,e.department,'직원명단'));
  const allDetails=[];let invalid=0;
  for(const p of dedupeProposals(proposals,warnings)) {
    const date=reportDate(p.received_date);
    if(!date) {invalid++;continue;} if(year && date.slice(0,4)!==String(year))continue;
    const name=str(p.proposer_name)||'작성자 미등록',dept=normalizeDepartmentName(p.department);
    const {employee,basis}=matches(p,dept);const person=ensurePerson(employee,name,dept,basis);
    const result=classifyProposal(p,approvals); const awarded=result.final?cash(p.award_amount):0;
    const paid=p.payment_status==='완료'?cash(p.award_amount):0;
    const d={id:str(p.id),no:str(p.proposal_no),date,name,department:dept,title:str(p.title),employeeNo:person.employeeNo,identity:person.identity,personKey:person.key,rosterStatus:person.rosterStatus,matchBasis:basis,first:score(p.first_evaluation_total),team:score(p.team_leader_evaluation_total),committee:score(p.second_evaluation_total),finalScore:result.reviewed?score(p.score):null,originalResult:str(p.review_result),outcome:result.outcome,reviewed:result.reviewed,approvalLabel:result.approvalLabel,ceoPending:result.ceoPending?1:0,ceoApproved:result.ceoApproved?1:0,approvalReturned:result.returned?1:0,finalRecognized:result.final&&['adopted','countOnly'].includes(result.outcome)?1:0,awardRecorded:result.reviewed?cash(p.award_amount):0,outcomeLabel:outcomeNames[result.outcome],stage:result.stage,ceo:str(p.ceo_submission_status),awardConfirmed:awarded,awardProvisional:result.final?0:cash(p.award_amount),awardPaid:paid,awardUnpaid:Math.max(0,awarded-paid),proposedEffect:cash(p.proposer_effect_amount),confirmedEffect:result.final?cash(p.effect_amount):0,cost:cash(p.cost_amount),paymentStatus:str(p.payment_status),implementationStatus:str(p.implementation_status)};
    if (includeSource) d.proposal = {...p, received_date:date, department:dept};
    if(paid>awarded)warnings.push(`${d.no||d.title}: 지급완료액이 포상 확정액보다 큽니다. 결재/지급 상태를 확인하세요.`);
    addDetail(person,d);person.months[Number(date.slice(5,7))-1]++;person.details.push(d);allDetails.push(d);
  }
  if(invalid)warnings.push(`접수일 누락/오류 ${invalid}건은 연도를 확정할 수 없어 제외했습니다. 원자료를 확인하세요.`);
  allDetails.sort((a,b)=>ko(b.date,a.date)||ko(b.no,a.no));
  return {roster,rosterEntries,peopleMap,allDetails,warnings};
}

export function buildAnnualReport({proposals=[],employees=[],goals=[],approvals=[],year,asOf=new Date().toISOString(),department='',query='',zeroOnly=false,mode='supabase'}={}) {
  const yearText=str(year || koreaDate(asOf).slice(0,4));
  if (!/^\d{4}$/.test(yearText) || Number(yearText)<2000 || Number(yearText)>2100) throw new Error('2000~2100년 중 조회연도를 선택하세요.');
  const {roster,peopleMap,allDetails,warnings} = buildReportRecords({proposals,employees,approvals,year:yearText});
  const identityTotals=new Map();allDetails.forEach(d=>identityTotals.set(d.identity,(identityTotals.get(d.identity)||0)+1));
  peopleMap.forEach(p=>p.personTotal=identityTotals.get(p.identity)||0);
  const q=str(query).toLocaleLowerCase('ko-KR');const dep=str(department)?normalizeDepartmentName(department):'';
  const people=[...peopleMap.values()].filter(p=>(!dep||p.department===dep)&&(!q||`${p.name} ${p.employeeNo}`.toLocaleLowerCase('ko-KR').includes(q))&&(!zeroOnly||(p.eligible&&p.personTotal===0))).sort((a,b)=>b.total-a.total||ko(a.department,b.department)||ko(a.name,b.name)||ko(a.key,b.key));
  const detailKeys=new Set(people.map(p=>p.key));
  const details=allDetails.filter(d=>detailKeys.has(d.personKey));
  const summary=blankTotals();details.forEach(d=>addDetail(summary,d));
  const activeIdentities=new Set(people.filter(p=>p.eligible).map(p=>p.identity));
  summary.activeEmployees=activeIdentities.size;
  summary.participants=[...activeIdentities].filter(id=>(identityTotals.get(id)||0)>0).length;
  summary.zeroEmployees=summary.activeEmployees-summary.participants;
  summary.participationRate=summary.activeEmployees?summary.participants/summary.activeEmployees:0;
  summary.unmatchedProposals=details.filter(d=>d.rosterStatus==='명단 미확인').length;
  summary.participationVerified=summary.unmatchedProposals===0;
  summary.unmatchedPeople=new Set(details.filter(d=>d.rosterStatus==='명단 미확인').map(d=>d.identity)).size;
  summary.months=Array.from({length:12},(_,m)=>people.reduce((s,p)=>s+p.months[m],0));
  if(summary.unmatchedProposals)warnings.push(`직원명단 미확인 제안 ${summary.unmatchedProposals}건: 총건수에는 포함되지만 참여인원에는 포함하지 않습니다. 성명·부서 또는 사번을 확인하세요.`);
  if(!roster.length)warnings.push('조회 가능한 직원명단이 없습니다. 0건 직원과 참여율을 정확히 산출할 수 없습니다.');
  if(!dep && people.some(p=>p.rosterStatus==='활성'&&!p.eligible))warnings.push('부서이동 직원의 제안은 접수부서별 행으로 표시합니다. 참여인원은 현재 직원명단 기준으로 중복 없이 집계합니다.');
  const deptMap=new Map();people.forEach(p=>{
    if(!deptMap.has(p.department))deptMap.set(p.department,{...blankTotals(),department:p.department,months:Array(12).fill(0),activeEmployees:0,participants:0,zeroEmployees:0,goal:null,goalRate:null,participationRate:0});
    const d=deptMap.get(p.department);p.details.forEach(item=>addDetail(d,item));p.months.forEach((n,i)=>d.months[i]+=n);
    if(p.eligible){d.activeEmployees++;if(p.personTotal>0)d.participants++;}
  });
  const departments=[...deptMap.values()].sort((a,b)=>ko(a.department,b.department)).map(d=>{
    const matches=goals.filter(g=>str(g.year)===yearText&&normalizeDepartmentName(g.department)===d.department);
    // Legacy duplicate goal names are aliases, not separate targets.
    d.goal=(!q&&!zeroOnly&&matches.length)?Math.max(...matches.map(g=>cash(g.annual_goal))):null;d.goalRate=d.goal>0?d.total/d.goal:null;
    d.zeroEmployees=d.activeEmployees-d.participants;d.participationRate=d.activeEmployees?d.participants/d.activeEmployees:0;return d;
  });
  const scopeText=[`${yearText}년 접수`,dep||'전체 부서',q?`직원검색: ${str(query)}`:'',zeroOnly?'활성 직원 중 올해 0건만':''].filter(Boolean).join(' · ');
  const sourceYears=[...new Set([yearText,koreaDate(asOf).slice(0,4),...proposals.map(p=>reportDate(p?.received_date)?.slice(0,4)).filter(Boolean)])].sort().reverse();
  const departmentsAvailable=[...new Set([...roster.map(e=>e.department),...allDetails.map(d=>d.department)])].sort(ko);
  return {version:REPORT_VERSION,year:Number(yearText),asOf,mode,scopeText,filters:{department:dep,query:str(query),zeroOnly:!!zeroOnly},people,details,departments,summary,warnings:[...new Set(warnings)],rules:REPORT_RULES,years:sourceYears,departmentsAvailable,monthCutoff:Number(yearText)===Number(koreaDate(asOf).slice(0,4))?Number(koreaDate(asOf).slice(5,7)):Number(yearText)<Number(koreaDate(asOf).slice(0,4))?12:0};
}
