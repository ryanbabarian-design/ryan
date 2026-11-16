/** V2.8.4 — purely read-only, mutually exclusive display categories.
 * The raw finalized outcome wins. Provisional 2nd-round classifications are
 * explicitly labelled so the interface never calls them final decisions.
 */
export const RESULT_STATUS = Object.freeze([
  {key:'adopted',label:'채택'},
  {key:'countOnly',label:'건수처리'},
  {key:'rejected',label:'미채택'},
  {key:'onHold',label:'보류'},
  {key:'duplicate',label:'중복제안'},
  {key:'pending',label:'심사·보완 중'},
]);
const txt=v=>String(v??'').trim();
const numeric=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);

export function proposalResultCategory(detail={}) {
  const result=txt(detail.originalResult);
  const outcome=txt(detail.outcome);
  const names={adopted:'채택',countOnly:'건수처리',rejected:'미채택',duplicate:'중복제안',onHold:'보류'};
  const known={'채택':'adopted','건수처리':'countOnly','미채택':'rejected','중복제안':'duplicate','보류':'onHold'};
  const key=known[result]||((outcome in names)?outcome:null);
  if(key)return {category:key,label:names[key],provisional:false};
  const team=numeric(detail.team);
  return {category:'pending',label:team!==null&&team>=50&&team<65?'건수처리 후보 · 3차 심사대기':'심사·보완 중',provisional:false};
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
