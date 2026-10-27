/** V2.7.6 — deterministic, read-only Korean count/list search with explicit context.
 * Never generates SQL, infers approval outcomes, or identifies 'me' from display names.
 */
import { buildAnnualReport, koreaDate } from '../reports/annual-report.js?v=2.6.8';

export const SEARCH_HELP = '직원 이름으로 물어보세요. 기간을 생략하면 올해 등록건수를 확인합니다.';
const str = value => String(value ?? '').trim();
const compact = value => str(value).normalize('NFKC').replace(/\s+/g, '');
const clean = value => compact(value).replace(/[?!.,。？！…“”‘’"'()]/g, '');
const monthStart = (year, month) => `${year}-${String(month).padStart(2, '0')}-01`;
const monthEnd = (year, month) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const unsupported = /채택|미채택|심사|반려|평가|건수처리|승인|점수|포상|금액|효과|비용|순위|랭킹|비교|대비|보다|늘었|줄었|가장|제일|그중|중에서|빼고|제외|안된|안한|안올린|못한|미등록|삭제|수정|바꿔|저장해|비밀번호|비번|암호|명령|스크립트/;
const temporalUnsupported = /분기|상반기|하반기|월별|일별|주별|연도별|일간|주간|이번주|지난주|저번주|금주|오늘|어제|그제|내년|내일|다음달|부터|까지|[~∼<>/\\]|\d+일/;
const countHint = /몇|건수|개수|얼마나|실적|합계|총수/;
const listHint = /목록|내역|리스트|보여|보자|보겠|보고싶|찾아|뭐냈|뭘냈/;
const selfPattern = /내가|제가|저의|나의|내꺼|내거|내것|본인|^내(?=제안|실적|등록|접수|제출)|^나는|^저는|^(나|저|제)(?=실적|제안|몇|등록|접수|낸|올린|올렸)/;
// Lexical groups are composable: particles, verb stems, request endings and small talk.
// Unknown words are NOT discarded: they must trigger clarification rather than change a filter.
const words = [
 '부탁드립니다','확인부탁드립니다','알려주세요','알려주실래요','알려주실수있나요','알려줄수있어','알려줄래','알려주시겠어요','알려줘봐','알려줘','알려주라',
 '보여주세요','보여주실래요','보여줄래','보여줘봐','보여줘','보여주라','찾아주세요','찾아줘','조회해주세요','조회해줘','확인해주세요','확인해줘',
 '부탁해요','부탁해','부탁','궁금해요','궁금합니다','궁금해','어떻게돼','어때','볼수있어','볼수있나요','보고싶어','보자',
 '등록건수','접수건수','제출건수','제안건수','제안서','제안','등록','접수','작성','제출','건수','개수','실적','전체','전부','모두','총','합계','정확히',
 '올려놓은','올렸던','올렸','올리신','올리셨','올린','올려','제출하신','등록하신','작성하신','내셨','내신','냈던','냈','낸','한','된','했던',
 '목록','내역','리스트','몇건','몇개','몇','건','개','얼마나','얼마','뭐','뭘',
 '하셨는지','하셨나요','하셨나','하신','했는지','했어요','했나요','했어','했나','했냐','하였는지','했','해','인가요','인가','입니까','입니다','인지','이야','야','이니',
 '있어요','있나요','있는지','있어','있나','있냐','되나요','됐어','돼','나와',
 '과장님','차장님','부장님','상무님','이사님','팀장님','공장장님','주임님','대리님','사원님','과장','차장','부장','상무','이사','팀장','공장장','주임','대리','사원',
 '그사람','이사람','그직원','해당직원','그분','그럼','그러면','그렇다면','이번에는','다시','아니','대신','아까','방금','똑같이','동일하게',
 '내가','제가','저의','나의','내꺼','내거','내것','나는','저는','내',
 '님께서','께서','님의','씨의','님','씨','에는','에서는','에','에서','은','는','이','가','의','을','를','도','만','동안','들어','들','것','거','껀','수','요','좀','좀더','한번','주세요','는지','어','냐','다','냄','확인','조회','봐줘','알려주겠니','볼수있을까','게','꺼','나요','나','저','제','본인',
];
const lexicon = [...new Set(words)].sort((a,b)=>b.length-a.length);
function grammar(text) {
  let rest = text;
  while (rest) { const w = lexicon.find(x=>rest.startsWith(x)); if (!w) return false; rest=rest.slice(w.length); }
  return true;
}
function periodOf(year, month, today, source) {
  if (!Number.isInteger(year) || year<2000 || year>2100 || month!==null && (!Number.isInteger(month)||month<1||month>12)) throw new Error('조회 연도는 2000~2100년, 월은 1~12월로 입력하세요.');
  const from = month===null?`${year}-01-01`:monthStart(year,month);
  let to=month===null?`${year}-12-31`:monthEnd(year,month);
  if(from>today)throw new Error('미래 기간은 조회하지 않습니다. 현재 또는 과거 기간을 입력하세요.');
  if(to>today)to=today;
  return {year,month,from,to,today,source,label:month===null?`${year}년`:`${year}년 ${month}월`};
}
function inherited(options) { return options.pending?.period || options.context?.period || null; }

export function parseQuestion(question, now = new Date(), options = {}) {
  const original=str(question);
  if(!original || original.length>240)throw new Error('질문은 1~240자로 입력하세요. '+SEARCH_HELP);
  let text=clean(original);
  const protectedNames=[];
  for(const name of (options.knownNames||[])){
    const key=compact(name); if(key.length<3 || !text.includes(key))continue;
    const token='__person'+'x'.repeat(protectedNames.length+1)+'__';
    text=text.split(key).join(token);protectedNames.push([token,key]);
  }
  if(unsupported.test(text))throw new Error('지금은 직원 한 명의 등록건수·목록만 조회합니다. 평가상태·포상금·순위·비교·변경 요청은 지원하지 않습니다. 조회 조건을 줄여 다시 물어보세요.');
  if(temporalUnsupported.test(text))throw new Error('연간 또는 한 달의 등록건수·목록을 조회할 수 있습니다. 여러 기간의 비교나 주별·일별 조건은 아직 지원하지 않습니다.');
  const today=koreaDate(now), cy=Number(today.slice(0,4)), cm=Number(today.slice(5,7));
  const years=[...text.matchAll(/(?<!\d)(\d{4}|\d{2})년(?:도)?|이번년도|이번연도|이번년|올년도|금년도|금년|올해|재작년|작년도|작년|지난해|전년도|전년/g)];
  const relativeMonths=[...text.matchAll(/이번달|이달|금월|지난달|저번달|전월/g)];
  const months=[...text.matchAll(/(?<!\d)(\d{1,2})월(?:달)?/g)];
  if(years.length>1 || relativeMonths.length>1 || months.length>1 || (relativeMonths.length && months.length))throw new Error('한 번에 한 기간만 조회합니다. 조회할 연도나 월 하나를 알려주세요.');
  const previous=inherited(options);
  const followup=/^(그럼|그러면|그렇다면|그사람|그분|해당직원|이사람|그직원|아까|방금)|(?:은|는)(?:요|어때)?$/.test(text);
  const intent=listHint.test(text)&&!countHint.test(text)?'list':'count';
  let year=cy,month=null,source='default';
  if(years.length){
    const t=years[0]; text=text.replace(t[0],'');
    year=t[1]?Number(t[1])+(t[1].length===2?2000:0):t[0]==='재작년'?cy-2:/^(작년도|작년|지난해|전년도|전년)$/.test(t[0])?cy-1:cy;
    source='explicit';
  }
  if(relativeMonths.length){
    const t=relativeMonths[0];text=text.replace(t[0],'');
    const prior=/지난달|저번달|전월/.test(t[0]);
    const ry=prior&&cm===1?cy-1:cy;
    if(years.length && year!==ry)throw new Error('연도와 상대 월이 서로 다릅니다. “2025년 9월”처럼 명확한 기간을 알려주세요.');
    year=ry;month=prior?(cm===1?12:cm-1):cm;source='explicit';
  }else if(months.length){
    const t=months[0];text=text.replace(t[0],'');month=Number(t[1]);
    if(!years.length && previous){year=previous.year;source='context-year';}else source=years.length?'explicit':'default-year';
  }else if(!years.length){
    if(options.pending?.period){year=previous.year;month=previous.month;source='pending';}
    else if(previous && (followup || intent==='list')){year=previous.year;month=previous.month;source='context';}
  }
  if(/[\d]|년|월/.test(text))throw new Error('기간을 확인해 주세요. 예: “2026년 9월”, “지난달”. 사번은 동명이인 선택 화면에서 확인할 수 있습니다.');
  for(const [token,key] of protectedNames)text=text.split(token).join(key);
  return {...periodOf(year,month,today,source),original,remainder:text,intent,followup,explicitPeriod:!!(years.length||relativeMonths.length||months.length)};
}

/** Combine duplicate/current/historical employee rows without collapsing verified homonyms.
 * An active employee is preferred; older inactive rows are linked to it only
 * when there is exactly one active candidate for that name and no conflicting
 * employee numbers. Distinct active people or conflicting numbers stay separate.
 */
export function candidateGroups(report,employees) {
  const groups=new Map();
  const unique=(arr,value)=>{if(value&&!arr.includes(value))arr.push(value);};
  for(const p of report.people){
    if(!groups.has(p.identity))groups.set(p.identity,{
      identity:p.identity,name:p.name,names:[],departments:[],employeeNo:p.employeeNo,
      rosterStatus:p.rosterStatus,details:[],historicalDepartments:false
    });
    const c=groups.get(p.identity);unique(c.names,p.name);unique(c.departments,p.department);c.details.push(...p.details);
    if(p.rosterStatus==='활성')c.rosterStatus='활성';
  }
  employees.forEach((e,i)=>{
    if(!str(e.name))return;
    const identity=str(e.employee_no)?`no:${str(e.employee_no)}`:str(e.id)?`id:${str(e.id)}`:`row:${i}`;
    if(!groups.has(identity))groups.set(identity,{
      identity,name:str(e.name),names:[str(e.name)],departments:[str(e.department)||'부서 미등록'],
      employeeNo:str(e.employee_no),rosterStatus:e.active===false?'비활성':'활성',details:[],historicalDepartments:false
    });
    else {
      const c=groups.get(identity);unique(c.departments,str(e.department)||'부서 미등록');
      if(e.active!==false)c.rosterStatus='활성';
    }
  });
  const byName=new Map();
  for(const group of groups.values()){
    const name=compact(group.name);
    if(!byName.has(name))byName.set(name,[]);
    byName.get(name).push(group);
  }
  const result=[];
  for(const entries of byName.values()){
    const parts=[...entries];
    const active=g=>g.rosterStatus==='활성';
    const mismatch=(a,b)=>a.employeeNo&&b.employeeNo&&a.employeeNo!==b.employeeNo;
    const overlaps=(a,b)=>a.departments.some(dep=>b.departments.includes(dep));
    const merge=(target,source)=>{
      unique(target.names,source.name);
      source.names.forEach(n=>unique(target.names,n));
      source.departments.forEach(dep=>unique(target.departments,dep));
      if(!target.employeeNo)target.employeeNo=source.employeeNo;
      if(source.rosterStatus==='활성')target.rosterStatus='활성';
      target.details.push(...source.details);
      target.historicalDepartments ||= source.historicalDepartments || !overlaps(target,source);
      parts.splice(parts.indexOf(source),1);
    };
    // Known matching employee numbers are the strongest available identity evidence.
    for(let i=0;i<parts.length;i++){
      for(let j=i+1;j<parts.length;){
        const a=parts[i],b=parts[j];
        if(a.employeeNo&&a.employeeNo===b.employeeNo){
          const target=active(b)&&!active(a)?b:a;
          merge(target,target===a?b:a);
          if(target===b){i=-1;break;}
        }else j++;
      }
    }
    // Multiple currently active homonyms must remain separate unless numbers match.
    // If only one is active, inactive roster rows are historical aliases, not choices.
    const activeParts=parts.filter(active);
    if(activeParts.length===1){
      const current=activeParts[0];
      for(const historical of [...parts]){
        if(historical===current||active(historical)||mismatch(current,historical))continue;
        const crossDepartment=!overlaps(current,historical);
        merge(current,historical);
        if(crossDepartment)current.historicalDepartments=true;
      }
    }else if(activeParts.length===0){
      // Two old rows in the same department are one candidate unless employee numbers conflict.
      for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;){
        if(overlaps(parts[i],parts[j])&&!mismatch(parts[i],parts[j]))merge(parts[i],parts[j]);
        else j++;
      }
    }
    for(const part of parts){
      // A proposal may appear under multiple historical aliases; count a registered no once.
      const seen=new Set();
      part.details=part.details.filter(d=>{
        const key=str(d.no)?`no:${str(d.no)}`:str(d.id)?`id:${str(d.id)}`:`row:${d.date}|${d.title}`;
        if(seen.has(key))return false;
        seen.add(key);return true;
      });
      result.push(part);
    }
  }
  return result.sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.departments.join(',').localeCompare(b.departments.join(','),'ko'));
}
const clarification=(period,message,field='person')=>({kind:'clarify',field,message,period,intent:period.intent});

export function prepareQuestionResult(data, question, now = new Date(), options = {}) {
  if(!data || !Array.isArray(data.proposals)||!Array.isArray(data.employees))throw new Error('조회자료가 완전하지 않습니다. 다시 조회하세요.');
  const allNames=[...new Set([...data.employees.map(e=>str(e.name)),...data.proposals.map(p=>str(p.proposer_name))].filter(Boolean))].sort((a,b)=>compact(b).length-compact(a).length);
  const qualifiers=[...new Set([...allNames,...data.employees.map(e=>str(e.department)||'부서 미등록'),...data.proposals.map(p=>str(p.department)||'부서 미등록')])].sort((a,b)=>compact(b).length-compact(a).length);
  let period=parseQuestion(question,now,{...options,knownNames:qualifiers});
  const matched=allNames.filter(n=>period.remainder.includes(compact(n)));
  const names=matched.filter((n,i)=>!matched.slice(0,i).some(long=>compact(long).includes(compact(n))));
  // An explicit new person without a time or contrast marker starts a new annual query.
  if(names.length && !period.explicitPeriod && !period.followup && !options.pending?.period){period={...period,...periodOf(Number(period.today.slice(0,4)),null,period.today,'default')};}
  const report=buildAnnualReport({proposals:data.proposals,employees:data.employees,year:period.year,asOf:data.asOf||new Date(now).toISOString(),mode:data.mode});
  const groups=candidateGroups(report,data.employees);
  const base={kind:'choose',period,intent:period.intent,asOf:data.asOf||new Date(now).toISOString(),mode:data.mode,warnings:report.warnings.filter(w=>/접수일|중복 접수|직원명단|명단 미확인/.test(w))};
  let candidates=[],personSource='explicit';
  if(names.length>1)return clarification(period,'한 번에 한 직원의 실적을 조회합니다. 어느 직원부터 확인할까요?');
  if(names.length===1){
    const name=names[0];
    const matching=groups.filter(g=>g.names.some(n=>compact(n)===compact(name)));
    for(const g of matching){
      let rest=period.remainder.replace(compact(name),'');
      for(const dept of [...g.departments].sort((a,b)=>b.length-a.length))if(rest.includes(compact(dept))){rest=rest.replace(compact(dept),'');break;}
      if(grammar(rest))candidates.push(g);
    }
    if(!candidates.length){
      if(!matching.length)return {kind:'unknown',period,message:'해당 기간에 연결할 직원 정보를 찾지 못했습니다. 이름과 부서를 확인해 주세요. 0건으로 처리하지 않았습니다.'};
      throw new Error('이름은 확인했지만 나머지 조건을 해석하지 못했습니다. 등록건수·목록과 연도·월로 다시 물어보세요.');
    }
    // Keep a deliberately selected homonym on an explicit follow-up, never on a fresh query.
    if(candidates.length>1 && period.followup && options.context?.name===name){const chosen=candidates.find(c=>c.identity===options.context.identity);if(chosen)candidates=[chosen];}
  }else{
    let rest=period.remainder;
    const departments=[...new Set(groups.flatMap(g=>g.departments))].sort((a,b)=>b.length-a.length);
    const dept=departments.find(d=>rest.includes(compact(d)));
    if(dept)rest=rest.replace(compact(dept),'');
    if(!grammar(rest))return {kind:'unknown',period,message:'직원 이름 또는 질문 표현을 확인해 주세요. 모르는 이름을 0건으로 처리하거나, 이전 직원으로 바꿔 조회하지 않았습니다. 성명을 정확히 입력해 주세요.'};
    if(selfPattern.test(rest)){
      const self=options.selfIdentity&&groups.find(g=>g.identity===options.selfIdentity);
      if(!self)return clarification(period,'현재 로그인 정보만으로 작성자를 특정할 수 없습니다. 본인 성명을 입력해 주세요. 이름을 입력하면 방금 말씀하신 기간으로 조회합니다.','self');
      candidates=[self];personSource='self';
    }else if(dept){
      if(options.pending?.kind==='choose'){candidates=groups.filter(g=>options.pending.candidates.some(c=>c.identity===g.identity)&&g.departments.includes(dept));}
      if(!candidates.length)return clarification(period,`${dept}의 어느 직원을 조회할까요? 부서 전체가 아니라 직원 한 명의 등록건수·목록을 조회합니다.`);
    }else if(options.pending?.kind==='choose'){
      candidates=groups.filter(g=>options.pending.candidates.some(c=>c.identity===g.identity));
      if(!candidates.length)return clarification(period,'조회할 직원 이름을 다시 알려주세요.');
    }else if(options.pending && options.pending.kind!=='answer'){
      return clarification(period,options.pending.field==='self'?'본인 성명을 입력해 주세요. 이전에 조회한 사람을 본인으로 사용하지 않습니다.':'조회할 직원 이름을 입력해 주세요. 말씀하신 기간은 유지합니다.', options.pending.field==='self'?'self':'person');
    }else if(options.context?.kind==='answer'){
      const prior=groups.find(g=>g.identity===options.context.identity);
      if(!prior)return clarification(period,'이전 직원 정보를 다시 확인해야 합니다. 이름과 부서를 입력해 주세요.');
      candidates=[prior];personSource='context';
      // A bare count follow-up keeps the period just like a list follow-up.
      if(!period.explicitPeriod && !options.pending?.period)period={...period,...periodOf(options.context.period.year,options.context.period.month,period.today,'context')};
    }else return clarification(period,'어느 직원의 실적을 확인할까요? 성명을 입력해 주세요. 방금 선택한 기간은 유지합니다.');
  }
  const context={...base,period,candidates,personSource};
  if(candidates.length>1)return context;
  if(!candidates.length)return clarification(period,'직원을 선택하거나 성명을 입력해 주세요.');
  return chooseSearchPerson(context,candidates[0].identity);
}

export function chooseSearchPerson(context,identity) {
  if(context?.kind!=='choose')throw new Error('조회 대상을 다시 확인하세요.');
  const person=context.candidates.find(p=>p.identity===identity);
  if(!person)throw new Error('선택한 직원이 조회 대상에 없습니다.');
  const details=person.details.filter(d=>d.date>=context.period.from&&d.date<=context.period.to).sort((a,b)=>b.date.localeCompare(a.date)||b.no.localeCompare(a.no));
  const warnings=[...(context.warnings||[])];
  if(person.historicalDepartments)warnings.push('이름이 같은 과거 부서의 비활성 명단을 현재 직원과 함께 집계했습니다. 동명이인이 있다면 직원명단의 사번을 확인하세요.');
  return {kind:'answer',name:person.name,identity:person.identity,departments:person.departments,employeeNo:person.employeeNo,rosterStatus:person.rosterStatus,total:details.length,details,period:context.period,intent:context.intent||'count',personSource:context.personSource||'selection',asOf:context.asOf,mode:context.mode,warnings:[...new Set(warnings)]};
}

/** Follow-ups use the chosen identity, not a guessed login/display name or hard-coded employee. */
export function suggestQuestions(result,now=new Date()) {
  if(result?.kind!=='answer')return [
    {label:'올해 몇 건 냈어?',query:'올해 제안 몇 건이야?'},
    {label:'이번 달 제안 목록',query:'이번 달 낸 제안 보여줘'},
    {label:'내가 올린 제안은?',query:'내가 올해 올린 제안 몇 개야?'},
  ];
  const year=Number(koreaDate(now).slice(0,4)),month=Number(koreaDate(now).slice(5,7));
  const chips=[];
  if(result.total>0)chips.push({label:'목록도 보여줘',query:'목록도 보여줘',action:'list'});
  const earlier=result.period.year-1;
  if(earlier>=2000)chips.push({label:`${earlier}년에는?`,query:`그럼 ${earlier}년에는?`});
  if(result.period.year!==year || result.period.month!==null)chips.push({label:`${result.name} · 올해 전체`,query:`${result.name} ${year}년에는?`});
  if(chips.length<3 && (result.period.year!==year||result.period.month!==month))chips.push({label:`${result.name} · 이번 달`,query:`${result.name} 이번 달은?`});
  if(chips.length<3)chips.push({label:'지난달에는?',query:'그럼 지난달에는?'});
  return chips.slice(0,3);
}
