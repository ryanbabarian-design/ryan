/** V2.7.7 — one input for staff counts and literal proposal-content search.
 * Read-only: no generated SQL, no external model, no approval inference.
 */
import {prepareQuestionResult, parseQuestion, suggestQuestions} from './question-core.js?v=2.7.6';
import {koreaDate, reportDate} from '../reports/annual-report.js?v=2.6.8';

const text = value => String(value ?? '').normalize('NFKC').trim();
const compact = value => text(value).replace(/\s+/g,'').toLocaleLowerCase('ko-KR');
const timeTokens = /(?<!\d)(?:\d{4}|\d{2})\s*년(?:도)?|이번\s*(?:년도|연도|년)|올년도|금년도|금년|올해|재작년|작년도|작년|지난해|전년도|전년|이번\s*달|이달|금월|지난\s*달|저번\s*달|전월|(?<!\d)\d{1,2}\s*월(?:달)?/g;
const statsSignal = /실적|몇(?:건|개|껀|번)?|건수|개수|얼마나/;
const selfSignal = /^(?:내가|제가|저의|나의|내꺼|내거|내것|나는|저는|내실적|내제안|본인)/;
const forbiddenAction = /(?:삭제|수정|승인|저장|변경|재설정)(?:해|하자|하라|해주세요|해줘)|비밀번호|비번|암호|스크립트|명령어/;
const unsupportedFilter = /(?:미채택|채택|심사|반려|평가|승인)(?:된|중|완료|대기|인것|건만|만|건수)|포상금.*(?:얼마|합계|총)|순위|랭킹|가장많|제일많|비교|대비|그중|중에서|제외|빼고/;
const unsupportedTime = /분기|상반기|하반기|월별|주별|일별|이번주|지난주|오늘|어제|내년|내일|다음달|부터|까지|[~∼]|\d+일/;

/** Plain text only: attributes, scripts and styling are not search terms. */
export function proposalText(value) {
  return text(value).replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi,entity=>{
      const map={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '};
      if(map[entity.toLowerCase()])return map[entity.toLowerCase()];
      const n=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));
      return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';
    }).replace(/\s+/g,' ').trim();
}

function stripRequest(value) {
  let out=text(value).replace(/^[“"']|[”"']$/g,'').replace(/[?!。？！]+$/g,'')
    .replace(/^(?:그럼|그러면|그렇다면)\s*/,'').replace(/^(?:키워드|검색어)\s*[:：]\s*/,'');
  for(let i=0;i<9;i++){
    const before=out;
    out=out.replace(/\s*(?:찾아(?:줘봐|주세요|줘|주라)|검색(?:해주세요|해줘|해봐|해|하기)?|보여(?:줘봐|주세요|줘|주라)|알려(?:주세요|줘)|조회(?:해주세요|해줘|해))\s*$/,'')
      .replace(/\s*(?:좀|한번|부탁해요|부탁해|부탁드립니다)\s*$/,'')
      .replace(/\s*(?:목록|내역|리스트)(?:도|만|을|를)?\s*$/,'')
      .replace(/\s*(?:제안서|제안|아이디어)(?:들)?(?:을|를|도)?\s*$/,'')
      .replace(/\s*(?:관련된|관련|에\s*대한|에\s*관한)\s*$/,'')
      .replace(/\s*몇\s*(?:건|개)(?:이야|야|인가요|인지|이니|있어|있나요|입니까)?\s*$/,'').trim();
    if(out===before)break;
  }
  if(/^(?:은|는|에는|에|도|그럼|그러면|전체|전체연도|모든연도|로|전부|모두|목록|내역)*$/.test(compact(out)))return '';
  return out.replace(/[“”"']/g,'').trim();
}

function keywordResult(data, question, now, options) {
  const prior=options.context?.kind==='ideas'?options.context:null;
  const norm=compact(question);
  if(unsupportedTime.test(norm))throw new Error('내용 검색은 전체 연도, 특정 연도 또는 한 달로 조회할 수 있습니다. 비교·일별·분기 조건은 아직 지원하지 않습니다.');
  const dates=[...text(question).matchAll(timeTokens)].map(m=>m[0]);
  const allYears=/전체\s*연도|모든\s*연도/.test(question);
  if(allYears&&dates.length)throw new Error('전체 연도와 특정 기간 중 하나를 선택해 주세요.');
  let query=stripRequest(text(question).replace(timeTokens,'').replace(/전체\s*연도|모든\s*연도/g,''));
  let period=null;
  if(dates.length)period=parseQuestion(dates.join(' ')+' 제안 몇 건?',now,{context:prior?.period?prior:null});
  // A pure follow-up uses the previous keyword, not a prior employee search.
  if(!query){
    if(!prior)return {kind:'search-clarify',message:'어떤 제안을 찾을까요? 설비명·개선 내용 등 검색어를 입력해 주세요.'};
    query=prior.query;
    if(!dates.length&&!allYears)period=prior.period;
  }
  const terms=[...new Set(query.split(/[\s,，]+/).map(text).filter(Boolean))];
  if(!terms.length)throw new Error('찾을 제안의 검색어를 입력하세요.');
  const rows=new Map(),aliases=new Map();let duplicate=0,invalid=0;
  for(const [i,p] of data.proposals.entries()){
    if(!p||p.deleted_at||p.is_deleted===true||p.status==='삭제')continue;
    const keys=[p.proposal_no?`no:${text(p.proposal_no)}`:'',p.id?`id:${p.id}`:''].filter(Boolean);
    const key=keys.map(k=>aliases.get(k)).find(Boolean)||keys[0]||`row:${i}`;
    keys.forEach(k=>aliases.set(k,key));
    const old=rows.get(key),date=reportDate(p.received_date);
    if(old){
      duplicate++;
      const newer=(Date.parse(p.updated_at||p.created_at)||0)>=(Date.parse(old.p.updated_at||old.p.created_at)||0);
      rows.set(key,{p:newer?p:old.p,date:[old.date,date].filter(Boolean).sort()[0]||null});
    }else rows.set(key,{p,date});
  }
  const details=[];
  for(const {p,date} of rows.values()){
    const fields=[p.proposal_no,p.title,p.current_problem,p.improvement_plan,p.expected_effect,p.proposer_name,p.department,p.category].map(proposalText);
    const haystack=fields.map(compact).join(' ');
    if(!terms.every(t=>haystack.includes(compact(t))))continue;
    if(!date)invalid++;
    if(period&&(!date||date<period.from||date>period.to))continue;
    const body=[p.current_problem,p.improvement_plan,p.expected_effect].map(proposalText).join(' · ');
    const first=terms.map(t=>body.toLowerCase().indexOf(t.toLowerCase())).find(i=>i>=0)??0;
    const start=Math.max(0,first-30);
    details.push({no:text(p.proposal_no),date:date||'',title:proposalText(p.title)||'(제목 없음)',name:text(p.proposer_name),department:text(p.department),snippet:(start?'…':'')+body.slice(start,start+155)+(body.length>start+155?'…':'')});
  }
  details.sort((a,b)=>b.date.localeCompare(a.date)||b.no.localeCompare(a.no));
  const warnings=[];
  if(duplicate)warnings.push(`중복 접수번호/ID ${duplicate}개를 최신 내용으로 합치고 최초 접수일을 유지했습니다.`);
  if(invalid)warnings.push(`검색어가 일치하지만 접수일이 없거나 잘못된 자료 ${invalid}건이 있습니다.${period?' 기간을 확인할 수 없어 이번 결과에서는 제외했습니다.':' 전체 연도 결과에는 포함했습니다.'}`);
  return {kind:'ideas',query,terms,period,total:details.length,details,asOf:data.asOf||new Date(now).toISOString(),mode:data.mode,warnings,intent:'list'};
}

// Stricter than the old short-syllable grammar: "에어건" must never be consumed
// as the particles "에 + 어 + 건" in an employee question.
function staffOnlyWords(question, data, names) {
  let rest=compact(text(question).replace(timeTokens,'').replace(/[?!.,。？！…“”‘’"'()]/g,''));
  const labels=[...names,...data.employees.map(e=>text(e.department)),...data.proposals.map(p=>text(p.department))].filter(Boolean).sort((a,b)=>b.length-a.length);
  for(const label of labels)rest=rest.split(compact(label)).join('');
  const particles=['님께서','님의','씨의','께서','에서는','에는','동안','에서','으로','에게','의','이','가','은','는','을','를','도','에','만','게','거','것','들','요'];
  const endings=['볼수있을까','알려줄수있어','알려주실수있나요','알려주실래요','알려주시겠어요','알려줄래','알려주겠니','알려주세요','알려줘봐','알려주라','알려줘','보여줄래','보여주세요','보여줘봐','보여주라','보여줘','찾아주세요','찾아줘','조회해주세요','조회해줘','확인부탁드립니다','확인해주세요','확인해줘','부탁드립니다','부탁해요','부탁해','궁금합니다','궁금해요','궁금해','볼수있나요','볼수있어','보고싶어','어떻게돼','어때','보자','봐줘','입니까','입니다','인가요','인가','이야','인지','이니','야','나요','냐','어','다'];
  const stems=['등록건수','접수건수','제출건수','제안건수','제안서','제안','등록','접수','작성','제출','건수','개수','실적','목록','내역','리스트','몇건','몇개','몇껀','몇','얼마나','얼마','뭐냈','뭘냈','전체','전부','모두','정확히','합계','총수','총','올려놓은','올렸던','올리신','올리셨','올렸','올린','올려','제출하신','등록하신','작성하신','내셨','내신','냈던','냈','낸','하셨는지','하셨나요','하셨나','하신','했는지','했어요','했나요','했어','했나','했냐','하였는지','했던','했','해','한','된','있어요','있나요','있는지','있어','있나','있냐','되나요','됐어','돼','나와','과장님','차장님','부장님','상무님','이사님','팀장님','공장장님','주임님','대리님','사원님','과장','차장','부장','상무','이사','팀장','공장장','주임','대리','사원','그사람','이사람','그직원','해당직원','그분','그럼','그러면','그렇다면','이번에는','다시','아까','방금','동일하게','똑같이','좀더','좀','한번','확인','조회','수','부탁'].sort((a,b)=>b.length-a.length);
  if(!rest)return true;
  const prefix=particles.find(p=>rest.startsWith(p));if(prefix)rest=rest.slice(prefix.length);
  while(rest){
    if(endings.includes(rest)||particles.includes(rest))return true;
    const stem=stems.find(w=>rest.startsWith(w));
    if(!stem)return false;
    rest=rest.slice(stem.length);
    const particle=particles.find(w=>rest.startsWith(w));if(particle)rest=rest.slice(particle.length);
  }
  return true;
}

export function prepareUnifiedResult(data, question, now=new Date(), options={}) {
  const q=text(question),c=compact(q);
  if(!q||q.length>240)throw new Error('검색어 또는 질문은 1~240자로 입력하세요.');
  if(!data||!Array.isArray(data.proposals)||!Array.isArray(data.employees))throw new Error('조회자료가 완전하지 않습니다. 다시 조회하세요.');
  const names=[...new Set([...data.employees.map(e=>text(e.name)),...data.proposals.map(p=>text(p.proposer_name))].filter(Boolean))];
  let protectedQuery=c;
  for(const name of [...names].sort((a,b)=>b.length-a.length))protectedQuery=protectedQuery.split(compact(name)).join('__person__');
  if(forbiddenAction.test(protectedQuery))throw new Error('통합 검색은 조회 전용입니다. 변경·삭제·승인이나 비밀번호 요청을 실행하지 않습니다.');
  if(unsupportedFilter.test(protectedQuery))throw new Error('평가상태·포상·순위·비교 조건은 아직 지원하지 않습니다. 조건을 무시한 건수로 답하지 않습니다. 실적·엑셀 또는 접수현황을 이용하세요.');
  const hasName=names.some(n=>c.includes(compact(n)));
  const explicitKeyword=/^(?:키워드|검색어)\s*[:：]|관련|에\s*대한|에\s*관한|아이디어|[“”"']/.test(q);
  const staffOptions={...options,context:options.context?.kind==='answer'?options.context:null,pending:['choose','clarify','unknown'].includes(options.pending?.kind)?options.pending:null};
  if(options.mode==='keywords'||(!hasName&&explicitKeyword))return keywordResult(data,q,now,options);
  if(hasName||statsSignal.test(c)||selfSignal.test(c)||staffOptions.pending){
    // Preserve all staff filters. Never silently throw away an unrecognised condition.
    try {
      const result=prepareQuestionResult(data,q,now,staffOptions);
      if(hasName&&!staffOnlyWords(q,data,names))return {kind:'search-choice',query:q,message:'직원 이름과 내용 키워드가 함께 있습니다. 입력한 단어로 제안 내용을 검색할까요? 실적 조회라면 이름·연도·월과 건수만 물어보세요.'};
      return result;
    }
    catch(error) {
      if(hasName && /나머지 조건을 해석하지 못/.test(error.message))return {kind:'search-choice',query:q,message:'직원 이름과 내용 키워드가 함께 있습니다. 입력한 단어로 제안 내용을 검색할까요? 실적 조회라면 이름·연도·월과 건수만 물어보세요.'};
      throw error;
    }
  }
  const leftover=stripRequest(q.replace(timeTokens,'').replace(/전체\s*연도|모든\s*연도/g,''));
  if(!leftover){
    if(options.context?.kind==='ideas')return keywordResult(data,q,now,options);
    return prepareQuestionResult(data,q,now,staffOptions);
  }
  return keywordResult(data,q,now,options);
}

export function unifiedSuggestions(result,now=new Date()) {
  if(result?.kind==='answer')return suggestQuestions(result,now);
  if(result?.kind==='ideas'){
    const y=Number(koreaDate(now).slice(0,4));
    const chips=[];
    if(result.period)chips.push({label:'같은 검색어 · 전체 연도',query:`전체 연도 ${result.query} 제안 찾아줘`,mode:'keywords'});
    if(!result.period||result.period.year!==y)chips.push({label:'같은 검색어 · 올해',query:`${y}년 ${result.query} 제안 찾아줘`,mode:'keywords'});
    chips.push({label:'같은 검색어 · 작년',query:`${y-1}년 ${result.query} 제안 찾아줘`,mode:'keywords'});
    return chips.slice(0,3);
  }
  return [{label:'올해 직원 실적',query:'올해 몇 건 제안했어?'},{label:'에어건 관련 제안',query:'에어건 관련 제안 찾아줘',mode:'keywords'},{label:'작업시간 단축',query:'작업시간 단축 제안 찾아줘',mode:'keywords'}];
}
