/** V2.6.8 — read-only annual reporting. No approval/award decisions are written here. */
export const REPORT_VERSION = '2.6.8';
export const REPORT_RULES = [
  '등록건수: 최초 접수일 기준. 같은 접수번호의 수정·재상신은 1건으로 집계합니다.',
  '인정건수: 확정 채택 + 확정 건수처리. 반려·결재대기·보류는 인정건수에 포함하지 않습니다.',
  '개인/부서 건수는 접수부서 기준입니다. 부서이동 이력이 있으면 동일 직원이 부서별로 나뉠 수 있습니다.',
  '참여율: 조회 가능한 현재 활성 직원명단 중 해당 연도에 1건 이상 제출한 직원 비율. 과거 연도의 재직인원 통계는 아닙니다.',
  '사번/직원ID가 없는 제안은 성명+접수부서가 유일하게 일치할 때만 연결합니다. 명단 미확인 제안도 총건수에 포함됩니다.',
  '포상 확정액/지급완료액과 예상/심사확정 효과금액을 분리합니다. 지급완료액은 지급연도 실적이 아닌 해당 접수연도 제안의 현재 지급현황입니다.',
  '화면의 연도·부서·직원검색·0건 필터가 엑셀 4개 시트에 동일하게 적용됩니다. 직원검색/0건 필터 사용 시 부서목표 비교는 생략합니다.',
];
const str = v => String(v ?? '').trim();
const cash = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
const score = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const ko = (a,b) => str(a).localeCompare(str(b),'ko',{numeric:true});
const outcomeNames = {adopted:'채택',countOnly:'건수처리',rejected:'미채택',duplicate:'중복제안',onHold:'보류',pending:'심사·보완 중'};
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
  const p = proposal;
  const records = approvals.filter(a=>str(a.proposal_id)===str(p.id) && a.active !== false && !a.auto_author && a.role_name !== '담당');
  if (p.ceo_submission_status === '반려' || records.some(r=>(r.status||r.approval_status)==='반려')) return {outcome:'pending',stage:'반려 · 수정/보완 중',final:false};
  const third = score(p.second_evaluation_total);
  const team = score(p.team_leader_evaluation_total);
  const ceoApproved = p.ceo_submission_status === '승인완료' || records.some(r=>r.role_name==='대표이사' && (r.status||r.approval_status)==='승인');
  if (!ceoApproved && (p.ceo_submission_status === '상신완료' || third !== null)) return {outcome:'pending',stage:p.ceo_submission_status==='상신완료'?'대표이사 결재 대기':'3차 평가 완료 · 최종결재 대기',final:false};
  const known = {'채택':'adopted','건수처리':'countOnly','미채택':'rejected','중복제안':'duplicate','보류':'onHold'};
  if (known[p.review_result] && (p.status === '심사완료' || ceoApproved)) {
    const outcome = known[p.review_result];
    return {outcome,stage:outcomeNames[outcome],final:outcome!=='onHold'};
  }
  if (p.review_result === '보류') return {outcome:'onHold',stage:'보류',final:false};
  if (team !== null && team >=65) {
    const execDone = records.some(r=>/임원/.test(r.role_name||'') && (r.status||r.approval_status)==='승인');
    return {outcome:'pending',stage:execDone?'3차 심사위원 평가 대기':'2차 통과 · 임원/3차 평가 대기',final:false};
  }
  if (team !== null) return {outcome:'pending',stage:'2차 평가 완료 · 처리결과 확인 필요',final:false};
  if (score(p.first_evaluation_total)>=50 || p.legacy_first_evaluation_exempt===true) return {outcome:'pending',stage:'2차 팀장평가 대기',final:false};
  return {outcome:'pending',stage:'1차 자기평가 보완 필요',final:false};
}
function blankTotals() {
  return {total:0,adopted:0,countOnly:0,rejected:0,duplicate:0,onHold:0,pending:0,recognized:0,awardConfirmed:0,awardProvisional:0,awardPaid:0,awardUnpaid:0,proposedEffect:0,confirmedEffect:0,cost:0};
}
function addDetail(target,d) {
  target.total++; target[d.outcome]++;
  for (const k of ['awardConfirmed','awardProvisional','awardPaid','awardUnpaid','proposedEffect','confirmedEffect','cost']) target[k]+=d[k];
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
export function buildAnnualReport({proposals=[],employees=[],goals=[],approvals=[],year,asOf=new Date().toISOString(),department='',query='',zeroOnly=false,mode='supabase'}={}) {
  const yearText=str(year || koreaDate(asOf).slice(0,4));
  if (!/^\d{4}$/.test(yearText) || Number(yearText)<2000 || Number(yearText)>2100) throw new Error('2000~2100년 중 조회연도를 선택하세요.');
  const warnings=[];const rosterMap=new Map();
  employees.forEach((e,i)=>{
    if (!str(e.name)) return;
    const identity=str(e.employee_no)?`no:${str(e.employee_no)}`:str(e.id)?`id:${str(e.id)}`:`row:${i}`;
    const old=rosterMap.get(identity);
    if (!old || (old.active===false && e.active!==false)) rosterMap.set(identity,{...e,identity,name:str(e.name),department:str(e.department)||'부서 미등록',employee_no:str(e.employee_no)});
  });
  const roster=[...rosterMap.values()];
  const matches = p => {
    for (const [val,field] of [[p.employee_id??p.proposer_id,'id'],[p.proposer_employee_no??p.employee_no,'employee_no']]) {
      if (str(val)) { const found=roster.filter(e=>str(e[field])===str(val));if(found.length===1)return {employee:found[0],basis:field==='id'?'직원ID':'사번'}; }
    }
    const found=roster.filter(e=>e.name===str(p.proposer_name) && e.department===(str(p.department)||'부서 미등록'));
    return found.length===1 ? {employee:found[0],basis:'성명+부서'} : {employee:null,basis:found.length?'동명이인 확인 필요':'직원명단 미확인'};
  };
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
    if(!date) {invalid++;continue;} if(date.slice(0,4)!==yearText)continue;
    const name=str(p.proposer_name)||'작성자 미등록',dept=str(p.department)||'부서 미등록';
    const {employee,basis}=matches(p);const person=ensurePerson(employee,name,dept,basis);
    const result=classifyProposal(p,approvals); const awarded=result.final?cash(p.award_amount):0;
    const paid=p.payment_status==='완료'?cash(p.award_amount):0;
    const d={id:str(p.id),no:str(p.proposal_no),date,name,department:dept,title:str(p.title),employeeNo:person.employeeNo,identity:person.identity,personKey:person.key,rosterStatus:person.rosterStatus,matchBasis:basis,first:score(p.first_evaluation_total),team:score(p.team_leader_evaluation_total),committee:score(p.second_evaluation_total),finalScore:result.final?score(p.score):null,originalResult:str(p.review_result),outcome:result.outcome,outcomeLabel:outcomeNames[result.outcome],stage:result.stage,ceo:str(p.ceo_submission_status),awardConfirmed:awarded,awardProvisional:result.final?0:cash(p.award_amount),awardPaid:paid,awardUnpaid:Math.max(0,awarded-paid),proposedEffect:cash(p.proposer_effect_amount),confirmedEffect:result.final?cash(p.effect_amount):0,cost:cash(p.cost_amount),paymentStatus:str(p.payment_status),implementationStatus:str(p.implementation_status)};
    if(paid>awarded)warnings.push(`${d.no||d.title}: 지급완료액이 포상 확정액보다 큽니다. 결재/지급 상태를 확인하세요.`);
    addDetail(person,d);person.months[Number(date.slice(5,7))-1]++;person.details.push(d);allDetails.push(d);
  }
  if(invalid)warnings.push(`접수일 누락/오류 ${invalid}건은 연도를 확정할 수 없어 제외했습니다. 원자료를 확인하세요.`);
  const identityTotals=new Map();allDetails.forEach(d=>identityTotals.set(d.identity,(identityTotals.get(d.identity)||0)+1));
  peopleMap.forEach(p=>p.personTotal=identityTotals.get(p.identity)||0);
  const q=str(query).toLocaleLowerCase('ko-KR');const dep=str(department);
  const people=[...peopleMap.values()].filter(p=>(!dep||p.department===dep)&&(!q||`${p.name} ${p.employeeNo}`.toLocaleLowerCase('ko-KR').includes(q))&&(!zeroOnly||(p.eligible&&p.personTotal===0))).sort((a,b)=>b.total-a.total||ko(a.department,b.department)||ko(a.name,b.name)||ko(a.key,b.key));
  const detailKeys=new Set(people.map(p=>p.key));
  const details=allDetails.filter(d=>detailKeys.has(d.personKey)).sort((a,b)=>ko(b.date,a.date)||ko(b.no,a.no));
  const summary=blankTotals();details.forEach(d=>addDetail(summary,d));
  const activeIdentities=new Set(people.filter(p=>p.eligible).map(p=>p.identity));
  summary.activeEmployees=activeIdentities.size;
  summary.participants=[...activeIdentities].filter(id=>(identityTotals.get(id)||0)>0).length;
  summary.zeroEmployees=summary.activeEmployees-summary.participants;
  summary.participationRate=summary.activeEmployees?summary.participants/summary.activeEmployees:0;
  summary.unmatchedProposals=details.filter(d=>d.rosterStatus==='명단 미확인').length;
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
    const g=goals.find(g=>str(g.year)===yearText&&str(g.department)===d.department);
    d.goal=(!q&&!zeroOnly&&g)?cash(g.annual_goal):null;d.goalRate=d.goal>0?d.total/d.goal:null;
    d.zeroEmployees=d.activeEmployees-d.participants;d.participationRate=d.activeEmployees?d.participants/d.activeEmployees:0;return d;
  });
  const scopeText=[`${yearText}년 접수`,dep||'전체 부서',q?`직원검색: ${str(query)}`:'',zeroOnly?'활성 직원 중 올해 0건만':''].filter(Boolean).join(' · ');
  const sourceYears=[...new Set([yearText,koreaDate(asOf).slice(0,4),...proposals.map(p=>reportDate(p.received_date)?.slice(0,4)).filter(Boolean)])].sort().reverse();
  const departmentsAvailable=[...new Set([...roster.map(e=>e.department),...allDetails.map(d=>d.department)])].sort(ko);
  return {version:REPORT_VERSION,year:Number(yearText),asOf,mode,scopeText,filters:{department:dep,query:str(query),zeroOnly:!!zeroOnly},people,details,departments,summary,warnings:[...new Set(warnings)],rules:REPORT_RULES,years:sourceYears,departmentsAvailable,monthCutoff:Number(yearText)===Number(koreaDate(asOf).slice(0,4))?Number(koreaDate(asOf).slice(5,7)):Number(yearText)<Number(koreaDate(asOf).slice(0,4))?12:0};
}
