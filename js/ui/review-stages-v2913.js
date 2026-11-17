/** Committee identity is independent of the account that entered scores. */
import {reviewStages as originalStages, createReviewSource as originalSource} from './review-stages.js?v=2.9.12-original';
const text=v=>String(v??'').trim();
export function committeeText(c, hasReview=false){
  if(c?.state==='error')return '심사위원: 조회 실패 · 다시 조회';
  const names=Array.isArray(c?.members)?c.members.map(m=>text(m.name)+(text(m.department)?` (${text(m.department)})`:'')).filter(Boolean):[];
  if(!names.length)return hasReview?'심사위원: 미확인':'심사위원: 미지정';
  if(c.state==='confirmed')return `심사위원: ${names.join(', ')}\n실제 심사자 확인`;
  if(c.state==='reconfirm')return `지정 심사위원: ${names.join(', ')}\n평가 변경 · 실제 심사자 재확인 필요`;
  return `지정 심사위원: ${names.join(', ')}\n실제 심사자 미확인`;
}
export function reviewStages(p={}){
  const model=originalStages(p), third=model.stages[2];
  const recorded=Boolean(p.second_evaluation_completed_at||p.second_evaluation_total!=null||p.legacy_score_registered_at||p.legacy_result_corrected_at||(p.approval_required===false&&p.score!=null));
  const inputter=text(p.review_committee?.inputter||p.second_evaluation_by_name);
  third.by=committeeText(p.review_committee,recorded)+(inputter?`\n입력자: ${inputter}`:recorded?'\n입력자: 미기록':'');
  if(third.dateLabel==='평가일')third.dateLabel='입력일';
  return model;
}
export function createReviewSource(options={}){
  const base=originalSource(options), requests=new Set();let disposed=false;
  const config=options.config??globalThis.window?.APP_CONFIG, fetcher=options.fetcher??globalThis.fetch;
  const live=!!(config&&!config.demoMode&&config.supabaseUrl&&!config.supabaseUrl.includes('YOUR_PROJECT_REF')&&config.supabaseAnonKey&&!config.supabaseAnonKey.includes('YOUR_'));
  async function metadata(numbers){
    if(!live){
      const rows=options.readDemo?options.readDemo():JSON.parse(globalThis.localStorage?.getItem('proposal-system:v1:proposals')||'[]');
      return new Map(rows.filter(p=>numbers.includes(p.proposal_no)).map(p=>[p.proposal_no,{state:'unassigned',...p.review_committee,inputter:p.second_evaluation_by_name||p.legacy_score_recorded_by_name||''}]));
    }
    const url=new URL('/rest/v1/rpc/v2913_review_committee_public',config.supabaseUrl);
    if(url.protocol!=='https:')throw Error('심사위원 조회 주소 오류');
    const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetcher(url.href,{method:'POST',headers:{apikey:config.supabaseAnonKey,Authorization:`Bearer ${config.supabaseAnonKey}`,'Content-Type':'application/json'},body:JSON.stringify({p_proposal_numbers:numbers}),signal:controller.signal});
      if(!response.ok)throw Error('심사위원 조회 실패');
      const rows=await response.json();if(disposed||!Array.isArray(rows)||rows.length>numbers.length)throw Error('심사위원 응답 확인 필요');
      const map=new Map();
      for(const row of rows){
        if(!numbers.includes(row?.proposal_no)||map.has(row.proposal_no)||!['unassigned','assigned','confirmed','reconfirm'].includes(row.state)||!Array.isArray(row.members)||row.members.length>10||row.members.some(m=>!m||typeof m.name!=='string'||!m.name.trim()))throw Error('심사위원 자료 불일치');
        map.set(row.proposal_no,{state:row.state,members:row.members.map(m=>({name:m.name,department:text(m.department)})),inputter:text(row.inputter)});
      }
      return map;
    }finally{clearTimeout(timer);requests.delete(controller);}
  }
  return {
    async load(numbers){
      const ids=[...new Set(numbers.map(text).filter(Boolean))];if(ids.length>100)throw Error('한 번에 100건까지 조회하세요.');
      const [rows,meta]=await Promise.all([base.load(ids),metadata(ids).catch(()=>null)]);
      if(disposed)throw Error('목록 조회가 종료되었습니다.');
      return new Map([...rows].map(([no,p])=>[no,{...p,review_committee:meta?.get(no)||{state:'error'}}]));
    },
    dispose(){disposed=true;base.dispose();for(const c of requests)c.abort();requests.clear();}
  };
}
