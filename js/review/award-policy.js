/** V2.9.1. Monetary rules only; never mark a review or approval complete.
 * A scored review uses its 3rd-stage total. An unscored count decision uses the
 * stored team-leader total. Prior 3rd scores are historical in outcome mode.
 */
export const AWARD_POLICY_VERSION = '2.9.1';
export function validAwardScore(value) {
  if(value===null||value===undefined||typeof value==='boolean'||String(value).trim()==='')return null;
  const n=Number(value);
  return Number.isInteger(n)&&n>=0&&n<=100?n:null;
}
export function awardForScore(value,result='미심사') {
  const score=validAwardScore(value);
  if(result==='건수처리') {
    if(score===null||score<50||score>65)return {grade:'',amount:0};
    return {grade:'건수처리',amount:score>=60?10000:5000};
  }
  if(result!=='채택'||score===null||score<50)return {grade:'',amount:0};
  if(score>=90)return {grade:'A',amount:100000};
  if(score>=80)return {grade:'B',amount:50000};
  if(score>=70)return {grade:'C',amount:30000};
  if(score>=60)return {grade:'D',amount:10000};
  // Keep the existing low-band award label, not a new review-result value.
  return {grade:'건수처리',amount:5000};
}
export function reviewAwardPreview(proposal={},mode='score',result='미심사',thirdTotal=null) {
  const pending=message=>({ready:false,award:{grade:'',amount:0},basisScore:null,basis:'',message});
  if(result==='미심사'||!result)return pending('심사결과 선택 전 · 미확정');
  if(!['score','outcome'].includes(mode))return pending('심사방식을 확인하세요.');
  if(!['채택','건수처리','미채택','보류','중복제안'].includes(result))return pending('심사결과를 확인하세요.');
  if(['미채택','보류','중복제안'].includes(result))return {ready:true,award:{grade:'',amount:0},basisScore:null,basis:'심사결과',message:`${result} · 지급 예정액 0원`};
  if(mode==='outcome'&&result==='채택')return pending('채택은 3차 점수심사로 저장하세요.');
  const basis=mode==='outcome'?'2차 팀장평가':'3차 심사위원 평가';
  const score=validAwardScore(mode==='outcome'?proposal.team_leader_evaluation_total:thirdTotal);
  if(score===null)return pending(`${basis} 점수 확인 필요 · 금액 미확정`);
  if(result==='건수처리'&&(score<50||score>65))return pending('건수처리 지급기준은 50~65점입니다. 기준 점수를 확인하세요.');
  const award=awardForScore(score,result);
  return {ready:true,award,basisScore:score,basis,message:`${basis} ${score}점 기준 · ${result}${mode==='outcome'?' (3차 점수 신규 입력 없음)':''}`};
}
