/** Read-only CEO decision model. Authorization always comes from the existing server inbox. */
const text=v=>String(v??'').trim();
const amount=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0?null:Number(v);
const score=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function buildCeoRows(inbox=[],proposals=[]) {
 const byId=new Map(proposals.map(p=>[text(p.id),p]));const seen=new Set();const rows=[];
 for(const r of inbox){
  if(r.role_name!=='대표이사'||seen.has(text(r.proposal_id)))continue;
  seen.add(text(r.proposal_id));const p=byId.get(text(r.proposal_id));
  const result=text(p?.review_result),cash=amount(p?.award_amount);
  const resultKnown=['채택','건수처리','미채택','보류','중복제안'].includes(result);
  const missing=!p||cash===null||!resultKnown;
  const entered=text(p?.received_date||r.received_date).slice(0,10);
  const direct=Number(p?.legacy_score_revision||0)>0||p?.third_review_mode==='legacy';
  rows.push({id:text(r.proposal_id),no:text(p?.proposal_no||r.proposal_no),title:text(p?.title||r.title),name:text(p?.proposer_name||r.proposer_name),department:text(p?.department||r.department),date:entered,year:/^\d{4}-\d{2}-\d{2}$/.test(entered)?entered.slice(0,4):'unknown',result:resultKnown?result:'확인 필요',amount:cash,score:p?.third_review_mode==='outcome'?null:score(p?.score),scoreLabel:p?.third_review_mode==='outcome'?'점수 없이 결과심사':direct?'기존 심사':'3차 심사',team:score(p?.team_leader_evaluation_total),updatedAt:text(p?.updated_at),approval:text(r.approval_status||r.status||'대기'),selectable:r.can_act===true&&!missing,missing,reason:missing?'심사결과·금액 원자료를 확인하세요.':text(r.block_reason),pendingDays:Math.max(0,Number(r.pending_days)||0),submittedAt:text(r.actionable_at||p?.ceo_submitted_at),actedAt:text(r.acted_at),effect:amount(p?.effect_amount)});
 }
 return rows;
}
export function filterCeoRows(rows,{year='all',query='',department='',result=''}={}) {
 const q=text(query).toLocaleLowerCase('ko');
 return rows.filter(r=>(year==='all'||r.year===String(year))&&(!department||r.department===department)&&(!result||r.result===result)&&(!q||`${r.no} ${r.title} ${r.name}`.toLocaleLowerCase('ko').includes(q)))
  .sort((a,b)=>b.pendingDays-a.pendingDays||b.date.localeCompare(a.date)||b.no.localeCompare(a.no));
}
export function ceoSelection(rows,ids=[]) {
 const unique=[...new Set(ids)],map=new Map(rows.map(r=>[r.id,r]));const selected=unique.map(id=>map.get(id));
 if(selected.some(r=>!r?.selectable))throw new Error('선택한 제안의 권한·결과·금액을 다시 확인하세요.');
 const results={};let total=0;for(const r of selected){results[r.result]=(results[r.result]||0)+1;total+=r.amount;}
 return {count:selected.length,amount:total,results,rows:selected};
}
export function assertCeoUnchanged(before,after,ids){
 const old=ceoSelection(before,ids),fresh=ceoSelection(after,ids);
 for(let i=0;i<old.rows.length;i++)for(const k of ['result','amount','score','updatedAt'])if(old.rows[i][k]!==fresh.rows[i][k])throw new Error('선택한 제안의 심사결과 또는 금액이 변경되었습니다. 새로 조회한 내용을 확인하고 다시 선택하세요.');
 return fresh;
}
export function ceoConfirmation(selection){
 return `대표이사 승인: ${selection.count}건 / 합계 ${selection.amount.toLocaleString('ko-KR')}원\n${Object.entries(selection.results).map(([k,n])=>`${k} ${n}건`).join(' · ')}\n\n${selection.rows.map(r=>`${r.no} · ${r.name} · ${r.result} · ${r.amount.toLocaleString('ko-KR')}원`).join('\n')}\n\n승인 후에도 실제 지급은 별도로 처리합니다. 선택한 건을 승인하시겠습니까?`;
}
