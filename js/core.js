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

function safeAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function proposalDateParts(proposal) {
  const match = String(proposal?.received_date || "").match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: match[1], month };
}

function createBreakdownRow(key, label) {
  return {
    key,
    label,
    count: 0,
    costTotal: 0,
    awardTotal: 0,
    effectTotal: 0,
  };
}

function addProposalToBreakdown(row, proposal) {
  row.count += 1;
  row.costTotal += safeAmount(proposal.cost_amount);
  row.awardTotal += safeAmount(proposal.award_amount);
  row.effectTotal += safeAmount(proposal.effect_amount);
  return row;
}

export function dashboardBreakdown(proposals, requestedYear = "") {
  const source = Array.isArray(proposals) ? proposals : [];
  const dated = source
    .map((proposal) => ({ proposal, date: proposalDateParts(proposal) }))
    .filter((item) => item.date);
  const years = [...new Set(dated.map((item) => item.date.year))]
    .sort((a, b) => b.localeCompare(a));

  const requested = String(requestedYear || "");
  const selectedYear = requested === "all"
    ? "all"
    : years.includes(requested)
      ? requested
      : years[0] || "all";

  const filtered = selectedYear === "all"
    ? dated
    : dated.filter((item) => item.date.year === selectedYear);

  const totals = filtered.reduce(
    (row, item) => addProposalToBreakdown(row, item.proposal),
    createBreakdownRow("total", "합계"),
  );
  delete totals.key;
  delete totals.label;

  const yearlyMap = new Map();
  for (const item of dated) {
    const key = item.date.year;
    const row = yearlyMap.get(key) || createBreakdownRow(key, `${key}년`);
    yearlyMap.set(key, addProposalToBreakdown(row, item.proposal));
  }
  const yearly = Array.from(yearlyMap.values())
    .sort((a, b) => b.key.localeCompare(a.key));

  let monthly;
  if (selectedYear === "all") {
    const monthlyMap = new Map();
    for (const item of filtered) {
      const key = `${item.date.year}-${String(item.date.month).padStart(2, "0")}`;
      const row = monthlyMap.get(key) || createBreakdownRow(key, `${item.date.year}년 ${item.date.month}월`);
      monthlyMap.set(key, addProposalToBreakdown(row, item.proposal));
    }
    monthly = Array.from(monthlyMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  } else {
    monthly = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      return createBreakdownRow(
        `${selectedYear}-${String(month).padStart(2, "0")}`,
        `${month}월`,
      );
    });
    for (const item of filtered) {
      addProposalToBreakdown(monthly[item.date.month - 1], item.proposal);
    }
  }

  const departmentMap = new Map();
  for (const item of filtered) {
    const key = String(item.proposal.department || "미지정").trim() || "미지정";
    const row = departmentMap.get(key) || createBreakdownRow(key, key);
    departmentMap.set(key, addProposalToBreakdown(row, item.proposal));
  }
  const departments = Array.from(departmentMap.values()).sort((a, b) =>
    b.count - a.count || b.effectTotal - a.effectTotal || a.label.localeCompare(b.label, "ko")
  );

  return {
    years,
    selectedYear,
    totals,
    yearly,
    monthly,
    departments,
  };
}

export async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}


export function collectProposalImagePaths(proposal, storageBucket) {
  const paths = new Set();
  const images = [
    ...(Array.isArray(proposal?.before_images) ? proposal.before_images : []),
    ...(Array.isArray(proposal?.after_images) ? proposal.after_images : []),
  ];
  const publicMarker = `/storage/v1/object/public/${storageBucket}/`;

  for (const image of images) {
    const explicitPath = typeof image?.path === "string" ? image.path.trim() : "";
    if (explicitPath && !explicitPath.startsWith("http")) {
      paths.add(explicitPath.replace(/^\/+/, ""));
      continue;
    }

    const url = typeof image?.url === "string" ? image.url : "";
    if (!url.startsWith("http")) continue;

    try {
      const pathname = new URL(url).pathname;
      const markerIndex = pathname.indexOf(publicMarker);
      if (markerIndex < 0) continue;
      const encodedPath = pathname.slice(markerIndex + publicMarker.length);
      if (encodedPath) paths.add(decodeURIComponent(encodedPath));
    } catch {
      // Ignore malformed or non-Supabase URLs.
    }
  }

  return Array.from(paths);
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
