/** Read-only composition of existing APIs. No writes and no new SQL. */
import { fetchAllPages } from '../reports/report-source.js?v=2.8.5';
import { proposalYear } from './workspace-core.js?v=2.9.5';
function aborted(signal){if(signal?.aborted)throw new DOMException('조회가 취소되었습니다.','AbortError');}
export async function loadWorkspaceSnapshot(store,{year,signal,onProgress=()=>{}}={}) {
  aborted(signal);
  onProgress('접수 자료와 대표상신 대상을 확인하고 있습니다.');
  const withSignal=q=>signal&&typeof q.abortSignal==='function'?q.abortSignal(signal):q;
  const proposalRead=store.mode==='demo'?store.getProposals():fetchAllPages((from,to)=>withSignal(store.client.rpc('get_public_proposals_v258',{}, {count:'exact'}).range(from,to)));
  const [proposals,stepRead,candidateRead]=await Promise.all([
    proposalRead,
    store.getApprovalSteps(true).then(data=>({data})).catch(error=>({error})),
    store.getCeoSubmissionCandidates().then(data=>({data})).catch(error=>({error})),
  ]);
  aborted(signal);
  if(!Array.isArray(proposals))throw new Error('접수자료를 읽지 못했습니다. 0건으로 표시하지 않습니다.');
  const steps=Array.isArray(stepRead.data)?stepRead.data:[];
  const stepsError=stepRead.error?.message||(!Array.isArray(stepRead.data)?'결재단계 조회 실패':'');
  const candidateError=candidateRead.error?.message||(!Array.isArray(candidateRead.data)?'상신대상 조회 실패':'');
  const candidateIds=candidateError?null:new Set(candidateRead.data.map(r=>String(r.proposal_id)));
  const records=new Map(),contexts=new Map(),errors=new Map();
  const scoped=proposals.filter(p=>p && (year==='all'||proposalYear(p)===String(year)) && !p.deleted_at && p.is_deleted!==true && p.status!=='삭제');
  const needs=scoped.filter(p=>p.id && !['상신완료','승인완료'].includes(p.ceo_submission_status) && p.payment_status!=='완료' && !candidateIds?.has(String(p.id)));
  let index=0,complete=0;
  await Promise.all(Array.from({length:Math.min(5,needs.length)},async()=>{
    while(index<needs.length){
      aborted(signal);const p=needs[index++],id=String(p.id);
      if(stepsError){errors.set(id,stepsError);continue;}
      try{const context=await store.getReviewApprovalContext(p.id);aborted(signal);if(!Array.isArray(context?.records))throw new Error('결재기록 응답 형식 오류');records.set(id,context.records);contexts.set(id,context);}
      catch(error){if(error.name==='AbortError')throw error;errors.set(id,error.message||'결재 조회 실패');}
      complete++;onProgress(`선택 연도의 결재 확인 ${complete} / ${needs.length}건`);
    }
  }));
  aborted(signal);
  return {proposals,steps,stepsError,candidateIds,candidateError,candidates:candidateRead.data||[],records,contexts,errors,year:String(year),asOf:new Date().toISOString()};
}
