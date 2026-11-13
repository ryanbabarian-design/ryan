/** V2.8.7: shared presentation/test rules. The database repeats all authority checks. */
export const REVIEW_VERSION = '2.8.9';
export const REVIEW_KEYS = Object.freeze(['originality','effort','feasibility','applicability','continuity','tangible_effect']);
export const FINAL_RESULTS = Object.freeze(['채택','미채택','보류','중복제안','건수처리']);
export const hasThirdReview = p => p?.second_evaluation_total != null || !!p?.second_evaluation_completed_at;
export const firstReviewPassed = p => p?.first_evaluation_total != null
  ? Number.isFinite(Number(p.first_evaluation_total)) && Number(p.first_evaluation_total) >= 50
  : p?.legacy_first_evaluation_exempt === true;
export const isReviewProtected = p => ['상신완료','승인완료'].includes(p?.ceo_submission_status) || p?.payment_status === '완료';
export function isLegacyCountCandidate(p) {
  const n=Number(p?.team_leader_evaluation_total);
  return !hasThirdReview(p) && !isReviewProtected(p) && p?.team_leader_evaluation_total!=null && n>=50 && n<65 &&
    (p.review_result==='건수처리' || (['미채택','채택'].includes(p.review_result) && p.award_grade==='건수처리'));
}
export function thirdReviewDecision(p,steps=[],records=[],systemAdmin=true,mode="score") {
  const fail=reason=>({allowed:false,reason,editing:hasThirdReview(p)});
  if(!systemAdmin)return fail('시스템 관리자(심사위원)로 로그인하세요. 전자결재 서명권한과는 별도입니다.');
  if(!p)return fail('제안을 찾지 못했습니다.');
  if(!Array.isArray(records))return fail('결재기록을 확인하지 못했습니다. 다시 확인하세요.');
  const rowForRole=role=>records.filter(r=>(!r.proposal_id||String(r.proposal_id)===String(p.id)) && steps.some(s=>String(s.id)===String(r.step_id)&&s.role_name===role&&s.active!==false));
  if(p.payment_status==='완료')return fail('포상금 지급완료 건은 일반 심사 수정이 잠겨 있습니다. 지급 정정 절차를 먼저 확인하세요.');
  if(['상신완료','승인완료'].includes(p.ceo_submission_status)||rowForRole('대표이사').some(r=>r.status==='승인'))return fail('대표이사 상신·승인 이후에는 3차 평가를 수정할 수 없습니다.');
  if(!['score','outcome'].includes(mode))return fail('심사방식을 확인하세요.');
  if(mode==='score' && !firstReviewPassed(p))return fail('1차 본인평가 50점 이상 또는 확인된 기존건 면제가 필요합니다.');
  const team=Number(p.team_leader_evaluation_total);
  if(mode==='score' && (p.team_leader_evaluation_total==null||!Number.isFinite(team)||team<50))return fail('2차 팀장평가 50점 이상이어야 3차 심사할 수 있습니다.');
  if(rowForRole('부서장').some(r=>r.status==='반려')||rowForRole('해당부서 임원').some(r=>r.status==='반려'))return fail('반려된 결재를 보완·재상신하여 승인받은 후 심사하세요.');
  if(!rowForRole('해당부서 임원').some(r=>r.status==='승인'))return fail('해당부서 임원 승인 후 3차 평가를 진행할 수 있습니다.');
  const editing=hasThirdReview(p);
  return {allowed:true,editing,reason:mode==='outcome'?'결과심사: 점수를 새로 입력하지 않고 건수처리·미채택·보류·중복제안과 지급 예정액을 저장합니다. 1·2차 점수와 결재기록은 유지됩니다.':editing?'기존 3차 평가를 수정할 수 있습니다. 점수·결과·포상 변경 사유를 남겨 주세요.':team<65?'건수처리 후보입니다. 3차 심사에서 건수처리·미채택·보류 등 최종 결과를 선택하세요.':'3차 심사위원 평가를 진행할 수 있습니다. 심사결과를 직접 선택하세요.'};
}
export function validateThirdReview(evaluation,patch,options={}) {
  const mode=options.mode||'score';
  if(!['score','outcome'].includes(mode))throw new Error('심사방식을 확인하세요.');
  let total=null;
  if(mode==='outcome') {
    if(evaluation!==null)throw new Error('결과심사에는 새 평가점수를 보내지 않습니다.');
    if(!['건수처리','미채택','보류','중복제안'].includes(patch?.review_result))throw new Error('채택은 점수심사로 저장하세요.');
  } else {
    if(!evaluation||typeof evaluation!=='object'||Array.isArray(evaluation)||Object.keys(evaluation).length!==6)throw new Error('3차 평가 6개 항목을 입력하세요.');
    total=0;const weights=[2,2,1,1,1,3];
    for(const [i,k] of REVIEW_KEYS.entries()){const v=evaluation[k];if(typeof v!=='number'||!Number.isInteger(v)||v<1||v>10)throw new Error('3차 평가 각 항목은 정수 1~10점입니다.');total+=v*weights[i];}
  }
  if(!FINAL_RESULTS.includes(patch?.review_result))throw new Error('3차 심사결과를 선택하세요.');
  const reason=String(options.reason??'').trim();if(reason.length<5||reason.length>1000)throw new Error('심사·수정 사유를 5~1,000자로 입력하세요.');
  if(!options.expectedUpdatedAt)throw new Error('최신 자료를 다시 불러온 후 저장하세요.');
  const amount=Number(patch.effect_amount??0);if(!Number.isSafeInteger(amount)||amount<0)throw new Error('효과금액을 0 이상의 정수로 입력하세요.');
  const result=patch.review_result;
  const award=result==='건수처리'?{grade:'건수처리',amount:5000}:result==='채택'?
    total>=90?{grade:'A',amount:100000}:total>=80?{grade:'B',amount:50000}:total>=70?{grade:'C',amount:30000}:total>=60?{grade:'D',amount:10000}:{grade:'',amount:0}:{grade:'',amount:0};
  if(patch.payment_status==='완료')throw new Error('심사 저장은 지급 처리가 아닙니다. 대표이사 승인 후 별도 지급 처리하세요.');
  return {total,reason,award,mode};
}
