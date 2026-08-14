export const PRINT_APPROVAL_ROLES = ["담당", "부서장", "해당부서 임원", "대표이사"];

function display(value, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function dateText(value) {
  if (!value) return "-";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return display(value);
  return `${match[1]}. ${match[2]}. ${match[3]}.`;
}

function currencyText(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function imageUrls(images) {
  return (Array.isArray(images) ? images : [])
    .map((image) => typeof image === "string" ? image : image?.url)
    .filter(Boolean)
    .slice(0, 4);
}

export function buildPrintModel(proposal = {}) {
  const category = display(proposal.category, "개선");
  return {
    proposalNo: display(proposal.proposal_no),
    proposalDate: dateText(proposal.received_date),
    title: display(proposal.title),
    proposerName: display(proposal.proposer_name),
    department: display(proposal.department),
    category,
    categoryImprovement: category === "개선",
    categorySafety: category === "안전",
    workflowStatus: display(proposal.status, "접수"),
    reviewResult: display(proposal.review_result, "미심사"),
    implementingDepartment: display(proposal.implementing_department),
    implementationStatus: display(proposal.implementation_status, "미실시"),
    implementedDate: dateText(proposal.implemented_date),
    scoreText: proposal.score === null || proposal.score === undefined || proposal.score === ""
      ? "-"
      : `${Number(proposal.score)}점`,
    currentProblem: display(proposal.current_problem, "등록된 문제점이 없습니다."),
    improvementPlan: display(proposal.improvement_plan, "등록된 개선방안이 없습니다."),
    expectedEffect: display(proposal.expected_effect, "등록된 기대효과가 없습니다."),
    costText: currencyText(proposal.cost_amount),
    proposerEffectText: currencyText(proposal.proposer_effect_amount),
    awardText: currencyText(proposal.award_amount),
    effectText: currencyText(proposal.effect_amount),
    paymentStatus: display(proposal.payment_status, "미지급"),
    reviewComment: display(proposal.review_comment, "등록된 심사의견이 없습니다."),
    beforeImages: imageUrls(proposal.before_images),
    afterImages: imageUrls(proposal.after_images),
  };
}
