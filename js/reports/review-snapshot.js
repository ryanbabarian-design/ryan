/** Read-only view of saved review outcomes. CEO approval is a separate axis. */
export const SAVED_OUTCOMES=Object.freeze({'채택':'adopted','건수처리':'countOnly','미채택':'rejected','중복제안':'duplicate','보류':'onHold'});
export function savedReviewSnapshot(p={}, approvals=[]) {
 const records=approvals.filter(r=>String(r.proposal_id)===String(p.id)&&r.active!==false&&!r.auto_author&&r.role_name!=='담당');
 const status=r=>r.status||r.approval_status;
 const outcome=SAVED_OUTCOMES[p.review_result]||'pending';
 const paid=p.payment_status==='완료';
 const ceoApproved=p.ceo_submission_status==='승인완료'||records.some(r=>r.role_name==='대표이사'&&status(r)==='승인');
 const ceoPending=!ceoApproved&&(p.ceo_submission_status==='상신완료'||records.some(r=>r.role_name==='대표이사'&&status(r)==='대기'&&r.actionable_at));
 const returned=p.ceo_submission_status==='반려'||records.some(r=>status(r)==='반려');
 const legacy=p.approval_required===false;
 const reviewed=outcome!=='pending';
 const legacyNeedsCeo=Number(p.legacy_score_revision||0)>0||p.legacy_ceo_direct===true;
 const final=reviewed&&outcome!=='onHold'&&(paid||ceoApproved||(!returned&&!ceoPending&&!legacyNeedsCeo&&legacy&&p.status==='심사완료'&&reviewed));
 let approvalLabel=paid?'지급 완료':returned?'반려·보완':ceoApproved?'대표 승인완료':ceoPending?'대표결재 대기':legacy&&!legacyNeedsCeo?'과거 심사기록':reviewed?'심사완료 · 상신 전':'평가·결재 진행 중';
 const stage=(reviewed?p.review_result+' · ':'')+approvalLabel;
 return {outcome,stage,final,reviewed,paid,ceoApproved,ceoPending,returned,approvalLabel,legacy};
}
