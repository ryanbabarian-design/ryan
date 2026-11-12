/** V2.8.4 — purely read-only, mutually exclusive display categories.
 * The raw finalized outcome wins. Provisional 2nd-round classifications are
 * explicitly labelled so the interface never calls them final decisions.
 */
export const RESULT_STATUS = Object.freeze([
  {key:'adopted',label:'채택'},
  {key:'countOnly',label:'건수처리'},
  {key:'rejected',label:'미채택·기준미달'},
  {key:'onHold',label:'보류'},
  {key:'duplicate',label:'중복제안'},
  {key:'pending',label:'심사·보완 중'},
]);
const txt=v=>String(v??'').trim();
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);

export function proposalResultCategory(detail={}) {
  const result=txt(detail.originalResult);
  const outcome=txt(detail.outcome);
  const team=numeric(detail.team);
  // Confirmed accepted is shown only when the reporting engine classifies
  // the result as final; a preliminary '채택' without CEO approval is pending.
  if(outcome==='adopted')return {category:'adopted',label:'채택',provisional:false};
  if(outcome==='countOnly'||result==='건수처리')return {category:'countOnly',label:'건수처리',provisional:outcome!=='countOnly'};
  if(outcome==='rejected'||result==='미채택')return {category:'rejected',label:'미채택',provisional:outcome!=='rejected'};
  if(outcome==='duplicate'||result==='중복제안')return {category:'duplicate',label:'중복제안',provisional:outcome!=='duplicate'};
  if(outcome==='onHold'||result==='보류')return {category:'onHold',label:'보류',provisional:false};
  if(team!==null && team<50)return {category:'rejected',label:'기준미달(2차)',provisional:true};
  if(team!==null && team>=50 && team<65)return {category:'pending',label:'건수처리 후보 · 3차 심사대기',provisional:true};
  return {category:'pending',label:'심사·보완 중',provisional:false};
}

export function summarizeProposalResults(details=[]) {
  const counts=Object.fromEntries(RESULT_STATUS.map(x=>[x.key,0]));
  let provisional=0;
  for(const detail of details){
    const classification=proposalResultCategory(detail);
    counts[classification.category]++;
    if(classification.provisional)provisional++;
  }
  return {total:details.length,counts,provisional};
}
