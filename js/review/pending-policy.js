/** Common read-only backlog definition: not authorization to review or approve. */
import {isLegacyCountCandidate,isReviewProtected,hasThirdReview} from './third-review-policy.js?v=2.9.3';
import {hasLegacyScore} from './legacy-score-policy.js?v=2.9.5';
export function isPendingReview(p) {
  return !!p && !p.deleted_at && p.is_deleted!==true && p.status!=='삭제' && !isReviewProtected(p) &&
    ((['접수','심사중'].includes(p.status) && p.review_result==='미심사') || isLegacyCountCandidate(p));
}
export function isBelowTeamMinimum(p) {
  return p?.approval_required===true && p.team_leader_evaluation_total!=null &&
    String(p.team_leader_evaluation_total).trim()!=='' && Number.isFinite(Number(p.team_leader_evaluation_total)) &&
    Number(p.team_leader_evaluation_total)<50;
}
export function isBelowStandardClosed(p) {
  return isBelowTeamMinimum(p) && p.status==='심사완료' && p.review_result==='미채택' &&
    p.ceo_submission_status==='미상신' && !hasThirdReview(p) && Number(p.award_amount??0)===0;
}
export function isLegacyReassessment(p) {
  return p?.approval_required===false && p.status==='심사중' && p.ceo_submission_status==='미상신' &&
    !isReviewProtected(p) && hasLegacyScore(p) && !hasThirdReview(p);
}
export function isInactiveUnsigned(r) {
  return r?.status==='대기' && !r.acted_at && !r.actionable_at && !r.approved_by && !r.approver_name && !r.comment;
}
