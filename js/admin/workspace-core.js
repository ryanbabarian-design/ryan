import { hasLegacyScore } from "../review/legacy-score-policy.js?v=2.9.5";
/** V2.9.0 — read-only admin-list view model. Saving/approval rules stay in V2.8.9. */
import { normalizeDepartmentName } from '../core.js?v=2.8.7';
import { thirdReviewDecision, hasThirdReview, isLegacyCountCandidate, FINAL_RESULTS, isLegacyOutcomeReview } from '../review/third-review-policy.js?v=2.9.3';

const str = v => String(v ?? '').trim();
const numeric = v => v == null || str(v)==='' || !Number.isFinite(Number(v)) ? null : Number(v);
const safeAmount = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
export const WORKSPACE_VERSION = '2.9.5';
export const QUEUES = Object.freeze([
  {key:'open',label:'처리할 제안'}, {key:'review',label:'3차 심사대기'},
  {key:'reviewed',label:'심사완료 · 상신 전'}, {key:'submitted',label:'대표결재 중'},
  {key:'closed',label:'승인·지급 완료'}, {key:'all',label:'전체 제안'},
]);
export const RESULT_LABELS = Object.freeze({미심사:'미심사',채택:'채택',건수처리:'건수처리 인정',미채택:'미채택',보류:'보류',중복제안:'중복제안'});
const validQueues=new Set([...QUEUES.map(x=>x.key),'waiting','check','archived']);
export function currentKoreaYear(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric'}).format(new Date(now));
}
export function proposalDate(p) {
  const s=str(p?.received_date).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
  const n=new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(n.valueOf()) && n.toISOString().slice(0,10)===s ? s : null;
}
export const proposalYear=p=>proposalDate(p)?.slice(0,4)||'unknown';
export function readWorkspaceFilters(hash='',now=new Date()) {
  const params=new URLSearchParams(String(hash).includes('?')?String(hash).split('?').slice(1).join('?'):String(hash).replace(/^#admin(?:\/ceo-submit)?$/,''));
  const y=params.get('year'),q=params.get('queue'),sort=params.get('sort'),size=Number(params.get('size'));
  return {
    year:y==='all'||y==='unknown'||/^(?:19|20|21)\d{2}$/.test(y||'')?y:currentKoreaYear(now),
    q:str(params.get('q')).slice(0,160),department:str(params.get('department'))?normalizeDepartmentName(params.get('department')):'',
    queue:validQueues.has(q)?q:'open', result:Object.hasOwn(RESULT_LABELS,params.get('result')||'')?params.get('result'):'',
    sort:['newest','oldest','name'].includes(sort)?sort:'newest',
    page:Math.max(1,Math.min(100000,Math.trunc(Number(params.get('page'))||1))),size:[20,25,50].includes(size)?size:20,
  };
}
export function workspaceRoute(filters={},base='admin') {
  const p=new URLSearchParams();
  for(const k of ['year','queue','q','department','result','sort','page','size']){
    const v=filters[k];if(v!==undefined && v!==null && v!=='')p.set(k,String(v));
  }
  return `${base}${p.size?'?'+p.toString():''}`;
}
const firstCell = p => numeric(p.first_evaluation_total)!==null
  ? {text:`${Number(p.first_evaluation_total)}점`,tone:Number(p.first_evaluation_total)<50?'danger':'ok'}
  : p.legacy_first_evaluation_exempt===true?{text:'기존건 면제',tone:'muted'}:{text:'미입력',tone:'warn'};
const teamCell=p=>numeric(p.team_leader_evaluation_total)===null?{text:'미입력',tone:'warn'}:{text:`${Number(p.team_leader_evaluation_total)}점`,tone:Number(p.team_leader_evaluation_total)<50?'danger':'ok'};
export function classifyWork(p,meta={}) {
  const id=str(p.id),steps=meta.steps||[],records=meta.records?.get(id),context=meta.contexts?.get(id);
  const scoped=(records||[]).filter(r=>!r.proposal_id||str(r.proposal_id)===id);
  const roleHas=(role,status)=>scoped.some(r=>r.status===status && steps.some(s=>s.active!==false && str(s.id)===str(r.step_id) && s.role_name===role));
  const thirdDone=hasThirdReview(p),savedResult=FINAL_RESULTS.includes(p.review_result),isCandidate=isLegacyCountCandidate(p);
  const result=p.review_result||'미심사';
  const third = (hasLegacyScore(p)||(p.approval_required===false&&numeric(p.score)!==null&&!thirdDone))?{text:`기존 심사 ${Number(p.score)}점`,tone:'ok'}:thirdDone
    ? p.third_review_mode==='outcome'?{text:'결과심사',tone:'ok'}:numeric(p.second_evaluation_total)!==null?{text:`${Number(p.second_evaluation_total)}점`,tone:'ok'}:{text:'심사기록 있음',tone:'muted'}
    : {text:'미심사',tone:'warn'};
  const base={first:firstCell(p),team:teamCell(p),third,result,resultLabel:RESULT_LABELS[result]||result,
    candidate:isCandidate||(!thirdDone && numeric(p.team_leader_evaluation_total)>=50 && numeric(p.team_leader_evaluation_total)<65),
    amount:thirdDone&&savedResult?safeAmount(p.award_amount):null,
    canSubmit:false,primary:'심사내용 확인',route:`admin/edit/${encodeURIComponent(id)}`,protected:false};
  const done=(group,label,note='',more={})=>({...base,group,label,note,...more});
  if(p.payment_status==='완료') {
    const legacy=p.approval_required===false;
    const corrected=Number(p.legacy_result_revision||0)>0;
    const oldThird=corrected?{text:'과거 결과 정정',tone:'ok'}:thirdDone?third:
      {text:numeric(p.score)!==null?`기존 심사 ${Number(p.score)}점`:'과거 심사결과',tone:'muted'};
    return done('closed','지급 완료',legacy?'기존 지급액 보존 · 결과 정정은 별도 이력':'지급 완료된 자료입니다.',{
      amount:safeAmount(p.award_amount),protected:true,canSubmit:false,
      ...(legacy?{third:oldThird,candidate:false,primary:'과거 결과 정정',route:`admin/paid-legacy/${encodeURIComponent(id)}`}:{})});
  }
  if(p.ceo_submission_status==='승인완료'||roleHas('대표이사','승인'))return done('closed','대표이사 승인',safeAmount(p.award_amount)>0?'승인 완료 · 지급상태 별도 확인':'승인 완료 · 지급 예정액 0원',{amount:safeAmount(p.award_amount),protected:true});
  if(p.ceo_submission_status==='상신완료')return done('submitted','대표이사 결재 중','상신 완료 · 심사 수정 잠금',{amount:safeAmount(p.award_amount),protected:true});
  if(hasLegacyScore(p) && meta.candidateIds?.has(id))return done('reviewed','대표상신 가능','기존 확정 총점 확인 완료 · 부서장/임원 승인 임의 생성 없음',{canSubmit:true,primary:'기존 심사 확인',amount:safeAmount(p.award_amount),route:`admin/legacy-score/${encodeURIComponent(id)}`});
  if(!id)return done('check','접수정보 확인','제안 ID가 없어 상세화면을 연결할 수 없습니다.',{route:'',primary:'자료 확인'});
  if(meta.errors?.has(id)||meta.stepsError)return done('check','결재 조회 확인','결재기록을 읽지 못했습니다. 새로고침 후 다시 확인하세요.');
  if(p.ceo_submission_status==='반려'||scoped.some(r=>r.status==='반려'&&steps.some(s=>str(s.id)===str(r.step_id)&&s.active!==false)))return done('waiting','반려 · 보완 필요','기존 결재의 반려 내용을 확인하세요.');
  if(p.approval_required===false) {
    const legacyDecision=thirdReviewDecision(p,steps,records,true,'outcome',context);
    if(!legacyDecision.allowed)return done('check','과거 제안 상태 확인',legacyDecision.reason);
    if(thirdDone && savedResult && p.third_review_mode==='outcome' && p.status==='심사완료')return done('archived','과거건 결과 정리완료','전자결재 제외 · 관리자 결과심사 저장 완료. 대표상신 완료를 뜻하지 않습니다.',{primary:'결과 확인',canSubmit:false,amount:safeAmount(p.award_amount)});
    if(hasLegacyScore(p))return done('reviewed','기존 심사 등록완료','대표상신 목록에서 자격을 다시 확인하세요.',{primary:'기존 심사 확인',route:`admin/legacy-score/${encodeURIComponent(id)}`,amount:safeAmount(p.award_amount)});
    return done('review','과거건 결과 확인','전자결재 제외 과거 제안 · 점수/승인기록을 만들지 않고 결과를 정정합니다.',{primary:'결과심사',mode:'outcome',amount:null});
  }
  if(meta.candidateIds?.has(id))return done('reviewed','대표상신 가능','서버의 상신대기 목록에서 확인한 제안입니다.',{canSubmit:true,primary:'결과 확인',amount:safeAmount(p.award_amount)});
  if(thirdDone && savedResult)return done('reviewed','3차 심사완료',meta.candidateIds===null?'상신대상 조회 실패 · 일괄상신 화면에서 확인':'상신요건 확인 필요 · 임원/대표 결재 상태 확인',{canSubmit:meta.candidateIds===null?null:false,primary:'결과 확인'});
  if(!thirdDone && p.status==='심사완료'&&savedResult&&!isCandidate)return done('check','기존 심사기록 확인','3차 평가기록 없이 저장된 과거 결과입니다. 자동으로 다시 심사하지 않습니다.',{third:{text:'기존 결과',tone:'muted'},amount:null});
  if(!Array.isArray(records))return done('check','결재 상태 확인','결재기록을 확인한 뒤 처리단계를 표시합니다.');
  const outcome=thirdReviewDecision(p,steps,records,true,'outcome',context);
  const score=thirdReviewDecision(p,steps,records,true,'score',context);
  if(outcome.allowed || score.allowed)return done('review','3차 심사대기',score.allowed?(base.candidate?'건수처리 후보 · 최종 결과는 3차에서 결정':'점수심사 또는 결과심사 선택 가능'):'결과심사 가능 · 1·2차 보완은 별도',{primary:score.allowed?'3차 심사':'결과심사',mode:score.allowed?'score':'outcome',amount:null,result:'미심사',resultLabel:isCandidate?'건수처리 후보':'미심사'});
  if(numeric(p.first_evaluation_total)===null&&p.legacy_first_evaluation_exempt!==true)return done('waiting','1차 평가 확인','기존 점수 누락 여부를 확인하세요.',{primary:'1·2차 확인',route:`admin/score/${encodeURIComponent(id)}`});
  if(numeric(p.first_evaluation_total)!==null&&Number(p.first_evaluation_total)<50)return done('waiting','1차 기준미달','1차 기준미달 상태를 확인하세요.',{primary:'1·2차 확인',route:`admin/score/${encodeURIComponent(id)}`});
  if(numeric(p.team_leader_evaluation_total)===null)return done('waiting','2차 팀장평가 대기','팀장평가와 부서장 결재를 확인하세요.',{primary:'1·2차 확인',route:`admin/score/${encodeURIComponent(id)}`});
  if(!roleHas('해당부서 임원','승인'))return done('waiting','임원 결재 대기',outcome.reason,{primary:'결재 확인',route:`admin/review/${encodeURIComponent(id)}`});
  return done('check','진행상태 확인',outcome.reason);
}
function alive(p){return p && !p.deleted_at && p.is_deleted!==true && p.status!=='삭제';}
export function buildWorkspace(proposals=[],filters={},meta={},now=new Date()) {
  const f={...readWorkspaceFilters(workspaceRoute(filters),now)};
  const all=proposals.filter(alive),yearNow=currentKoreaYear(now);
  const years=[...new Set([yearNow,...all.map(proposalYear).filter(y=>y!=='unknown')])].sort((a,b)=>b.localeCompare(a));
  const annual=all.filter(p=>f.year==='all'||proposalYear(p)===f.year);
  const departments=[...new Set(annual.map(p=>normalizeDepartmentName(p.department)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  const needle=f.q.toLocaleLowerCase('ko').replace(/\s+/g,'');
  const source=annual.filter(p=>(!f.department||normalizeDepartmentName(p.department)===f.department) && (!needle||[p.proposal_no,p.title,p.proposer_name,p.department,normalizeDepartmentName(p.department)].some(x=>str(x).toLocaleLowerCase('ko').replace(/\s+/g,'').includes(needle))));
  const items=source.map(proposal=>({proposal,...classifyWork(proposal,meta)})).filter(row=>!f.result||row.result===f.result);
  const counts={all:items.length,open:0,waiting:0,review:0,reviewed:0,submitted:0,closed:0,check:0,archived:0,canSubmit:0};
  for(const row of items){counts[row.group]++;if(!['submitted','closed','archived'].includes(row.group))counts.open++;if(row.canSubmit===true)counts.canSubmit++;}
  let filtered=items.filter(r=>f.queue==='all'||(f.queue==='open'?!['submitted','closed','archived'].includes(r.group):r.group===f.queue));
  filtered.sort((a,b)=>{
    const ap=a.proposal,bp=b.proposal;
    const ad=proposalDate(ap)||'',bd=proposalDate(bp)||'';
    if(f.sort==='name')return str(ap.proposer_name).localeCompare(str(bp.proposer_name),'ko')||bd.localeCompare(ad)||str(bp.proposal_no).localeCompare(str(ap.proposal_no),'ko',{numeric:true});
    return (f.sort==='oldest'?ad.localeCompare(bd):bd.localeCompare(ad))||str(bp.proposal_no).localeCompare(str(ap.proposal_no),'ko',{numeric:true});
  });
  const pages=Math.max(1,Math.ceil(filtered.length/f.size));f.page=Math.min(f.page,pages);
  const start=(f.page-1)*f.size,rows=filtered.slice(start,start+f.size);
  return {filters:f,counts,years,departments,annualCount:annual.length,filtered,rows,pages,start,
    hiddenPast:all.filter(p=>proposalYear(p)!=='unknown'&&proposalYear(p)<yearNow).length,
    unknownDates:all.filter(p=>proposalYear(p)==='unknown').length,
    amount:items.filter(r=>r.amount!==null&&!r.protected).reduce((n,r)=>n+r.amount,0)};
}
export function workspaceCsv(rows) {
  const headers=['접수번호','최초접수일','제안명','제안자','접수부서','1차 본인평가','2차 팀장평가','3차 심사','심사결과','현재 진행단계','상태 안내','지급 예정액(원)','지급상태','대표결재상태'];
  const cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  const data=rows.map(r=>{const p=r.proposal;return [p.proposal_no,proposalDate(p)||'접수일 미확인',p.title,p.proposer_name,normalizeDepartmentName(p.department),r.first.text,r.team.text,r.third.text,r.resultLabel,r.label,r.note,r.amount===null?'미확정':r.amount,p.payment_status||'미지급',p.ceo_submission_status||'미상신'];});
  return '\ufeff'+[headers,...data].map(row=>row.map(cell).join(',')).join('\r\n');
}

/** Filter only confirmed server candidates; never manufacture submission eligibility. */
export function scopeSubmissionCandidates(rows=[],proposals=[],filters={}) {
  const byId=new Map(proposals.map(p=>[str(p.id),p]));
  const needle=str(filters.q).toLocaleLowerCase('ko').replace(/\s+/g,'');
  return rows.filter(row=>{
    const p={...byId.get(str(row.proposal_id)),...row};
    return (filters.year==='all'||proposalYear(p)===String(filters.year))
      && (!filters.department||normalizeDepartmentName(p.department)===normalizeDepartmentName(filters.department))
      && (!filters.result||p.review_result===filters.result)
      && (!needle||[p.proposal_no,p.title,p.proposer_name,p.department,normalizeDepartmentName(p.department)].some(v=>str(v).toLocaleLowerCase('ko').replace(/\s+/g,'').includes(needle)));
  });
}
