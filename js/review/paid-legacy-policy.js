/** V2.9.4: correct only historical result/comment; never treat this as a new score review or a payment. */
export const PAID_LEGACY_RESULTS = Object.freeze(['채택','미채택','보류','중복제안','건수처리']);
export const PAID_LEGACY_MUTABLE = Object.freeze(['review_result','review_comment','updated_at','legacy_result_revision','legacy_result_corrected_at']);
export function paidLegacyDecision(p, context, systemAdmin=false) {
  const no=reason=>({allowed:false,reason});
  if(systemAdmin!==true)return no('시스템 관리자만 과거 심사결과를 정정할 수 있습니다.');
  if(!p || p.deleted_at || p.is_deleted===true || p.status==='삭제')return no('정정할 제안을 확인하지 못했습니다.');
  if(p.approval_required!==false)return no('전자결재 대상 제안입니다. 기존 승인·심사 절차를 사용하세요.');
  if(p.payment_status!=='완료')return no('이 화면은 지급완료 과거 건 전용입니다. 일반 결과심사를 사용하세요.');
  if(!['','미상신'].includes(String(p.ceo_submission_status??'').trim()))return no('실제 대표이사 상신·승인·반려 기록은 이 기능으로 변경하지 않습니다.');
  if(context?.source!=='v293' || String(context.proposal_id)!==String(p.id) ||
    !Array.isArray(context.records) || !Array.isArray(context.steps))return no('관리자 전용 결재기록 확인이 필요합니다. 조회 실패 시 저장하지 않습니다.');
  if(!p.updated_at || !context.proposal_updated_at || !Number.isFinite(Date.parse(p.updated_at)) ||
    Date.parse(context.proposal_updated_at)!==Date.parse(p.updated_at))return no('자료가 변경되었습니다. 최신 제안을 다시 불러오세요.');
  if(context.approval_required!==false || context.legacy_eligible!==true || context.blocking_count!==0)
    return no('실제 승인·반려·결재활성 또는 확인이 필요한 기록이 있어 과거 결과 정정을 잠갔습니다.');
  return {allowed:true,reason:'과거 심사결과와 의견만 정정합니다. 기존 지급액·지급완료·점수·결재기록은 보존합니다. 재지급·환수·재상신 처리가 아닙니다.'};
}
export function validatePaidLegacyInput(input) {
  const allowed=['review_result','review_comment','reason','expectedUpdatedAt','preservePayment'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('심사결과·의견·사유 외 항목은 정정할 수 없습니다.');
  if(!PAID_LEGACY_RESULTS.includes(input.review_result))throw new Error('정정할 심사결과를 선택하세요.');
  if(typeof input.review_comment!=='string'||input.review_comment.length>20000)throw new Error('심사의견은 20,000자 이내의 글로 입력하세요.');
  if(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.trim().length>1000)throw new Error('정정 사유를 5~1,000자로 입력하세요.');
  if(input.preservePayment!==true)throw new Error('기존 지급·점수·결재 보존에 동의해야 합니다.');
  if(typeof input.expectedUpdatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(input.expectedUpdatedAt)||!Number.isFinite(Date.parse(input.expectedUpdatedAt)))throw new Error('최신 자료를 다시 불러오세요.');
  return {...input,reason:input.reason.trim()};
}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
export function preservedPaidLegacyFields(before,after) {
  const frozen=p=>Object.fromEntries(Object.entries(p||{}).filter(([key])=>!PAID_LEGACY_MUTABLE.includes(key)));
  return JSON.stringify(canonical(frozen(before)))===JSON.stringify(canonical(frozen(after)));
}
