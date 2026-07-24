export const REVIEW_RESULTS = ["미심사", "채택", "미채택", "보류", "중복제안", "건수처리"];
export const WORKFLOW_STATUSES = ["접수", "심사중", "심사완료"];
export const IMPLEMENTATION_STATUSES = ["미실시", "진행중", "완료"];
export const PAYMENT_STATUSES = ["미지급", "예정", "완료"];

export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function nextProposalNo(proposals, date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const prefix = `Q${year}-`;
  const maxNo = proposals
    .map((proposal) => String(proposal.proposal_no ?? ""))
    .filter((no) => no.startsWith(prefix))
    .map((no) => Number(no.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((max, no) => Math.max(max, no), 0);

  return `${prefix}${String(maxNo + 1).padStart(3, "0")}`;
}

export function calculateAward(score, category = "개선") {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return { grade: "", amount: 0 };

  if (numericScore >= 90) return { grade: "A", amount: 100000 };
  if (numericScore >= 80) return { grade: "B", amount: 50000 };
  if (numericScore >= 70) return { grade: "C", amount: 30000 };
  if (numericScore >= 60) return { grade: "D", amount: 10000 };

  return { grade: "건수처리", amount: category === "안전" ? 10000 : 5000 };
}

export function isEmployeeEditable(proposal) {
  return !proposal.locked && proposal.status !== "심사중" && proposal.status !== "심사완료";
}

export function filterProposals(proposals, filters = {}) {
  const query = normalizeText(filters.query);
  const category = filters.category ?? "";
  const department = filters.department ?? "";
  const reviewResult = filters.reviewResult ?? "";
  const implementationStatus = filters.implementationStatus ?? "";

  return proposals
    .filter((proposal) => {
      if (category && proposal.category !== category) return false;
      if (department && proposal.department !== department) return false;
      if (reviewResult && proposal.review_result !== reviewResult) return false;
      if (implementationStatus && proposal.implementation_status !== implementationStatus) return false;

      if (!query) return true;

      const haystack = normalizeText([
        proposal.proposal_no,
        proposal.proposer_name,
        proposal.department,
        proposal.title,
        proposal.current_problem,
        proposal.improvement_plan,
        proposal.expected_effect,
        proposal.review_result,
        proposal.implementation_status,
      ].join(" "));

      return query.split(" ").every((term) => haystack.includes(term));
    })
    .sort((a, b) => {
      const dateCompare = String(b.received_date).localeCompare(String(a.received_date));
      if (dateCompare !== 0) return dateCompare;
      return String(b.proposal_no).localeCompare(String(a.proposal_no));
    });
}

export function dashboardMetrics(proposals) {
  return {
    total: proposals.length,
    pending: proposals.filter((item) => ["접수", "심사중"].includes(item.status) && item.review_result === "미심사").length,
    adopted: proposals.filter((item) => item.review_result === "채택").length,
    completed: proposals.filter((item) => item.implementation_status === "완료").length,
    awardTotal: proposals.reduce((sum, item) => sum + Number(item.award_amount || 0), 0),
    effectTotal: proposals.reduce((sum, item) => sum + Number(item.effect_amount || 0), 0),
  };
}

export async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function toProposalCsv(proposals) {
  const headers = [
    "접수번호", "접수일", "제안종류", "부서", "성명", "제안명", "현재 문제점",
    "개선방안", "기대효과", "심사상태", "심사결과", "실시여부", "점수",
    "포상등급", "포상금", "지급여부", "효과금액"
  ];

  const rows = proposals.map((p) => [
    p.proposal_no, p.received_date, p.category, p.department, p.proposer_name,
    p.title, p.current_problem, p.improvement_plan, p.expected_effect, p.status,
    p.review_result, p.implementation_status, p.score ?? "", p.award_grade,
    p.award_amount, p.payment_status, p.effect_amount
  ]);

  return "\uFEFF" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}
