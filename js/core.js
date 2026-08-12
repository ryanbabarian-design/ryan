export const REVIEW_RESULTS = ["미심사", "채택", "미채택", "보류", "중복제안", "건수처리"];
export const WORKFLOW_STATUSES = ["접수", "심사중", "심사완료"];
export const IMPLEMENTATION_STATUSES = ["미실시", "진행중", "완료"];
export const PAYMENT_STATUSES = ["미지급", "예정", "완료"];

export function normalizeImplementationDetails(status, implementedDate) {
  const normalizedStatus = String(status ?? "").trim();
  if (!IMPLEMENTATION_STATUSES.includes(normalizedStatus)) {
    throw new Error("실시상태를 다시 선택하세요.");
  }

  if (normalizedStatus !== "완료") {
    return {
      implementation_status: normalizedStatus,
      implemented_date: null,
    };
  }

  const normalizedDate = String(implementedDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new Error("완료 상태는 실시일을 입력하세요.");
  }

  return {
    implementation_status: normalizedStatus,
    implemented_date: normalizedDate,
  };
}

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
  const year = String(filters.year ?? "").trim();
  const month = String(filters.month ?? "").trim();
  const workflow = String(filters.workflow ?? "").trim();

  return proposals
    .filter((proposal) => {
      const date = proposalDateParts(proposal);
      if (year && year !== "all" && date?.year !== year) return false;
      if (month && month !== "all" && date?.month !== Number(month)) return false;
      if (workflow === "pending" && !(["접수", "심사중"].includes(proposal.status) && proposal.review_result === "미심사")) return false;
      if (workflow === "overdue-review" && !(["접수", "심사중"].includes(proposal.status) && proposal.review_result === "미심사" && daysBetween(proposal.received_date, new Date()) >= 7)) return false;
      if (workflow === "adopted" && proposal.review_result !== "채택") return false;
      if (workflow === "overdue-implementation" && !(proposal.review_result === "채택" && proposal.implementation_status !== "완료" && daysBetween(proposal.reviewed_at || proposal.updated_at || proposal.received_date, new Date()) >= 30)) return false;
      if (workflow === "completed" && proposal.implementation_status !== "완료") return false;
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

export function currentYearProposalCount(proposals, now = new Date()) {
  const currentYear = String(now.getFullYear());
  return (Array.isArray(proposals) ? proposals : []).filter((proposal) => proposalDateParts(proposal)?.year === currentYear).length;
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


export function dashboardDepartmentMonthly(proposals, requestedYear = "") {
  const source = Array.isArray(proposals) ? proposals : [];
  const selectedYear = String(requestedYear || "all");
  if (!selectedYear || selectedYear === "all") {
    return { selectedYear: "all", available: false, departments: [] };
  }

  const departmentMap = new Map();
  for (const proposal of source) {
    const date = proposalDateParts(proposal);
    if (!date || date.year !== selectedYear) continue;
    const department = String(proposal.department || "미지정").trim() || "미지정";
    const row = departmentMap.get(department) || { department, months: Array(12).fill(0), total: 0 };
    row.months[date.month - 1] += 1;
    row.total += 1;
    departmentMap.set(department, row);
  }

  const departments = Array.from(departmentMap.values()).sort((a, b) =>
    b.total - a.total || a.department.localeCompare(b.department, "ko")
  );
  return { selectedYear, available: true, departments };
}


export function dashboardHighlights(proposals, requestedYear = "") {
  const source = Array.isArray(proposals) ? proposals : [];
  const { selectedYear } = dashboardBreakdown(source, requestedYear);
  const filtered = source.filter((proposal) => {
    const date = proposalDateParts(proposal);
    if (!date) return false;
    return selectedYear === "all" || date.year === selectedYear;
  });

  const proposerMap = new Map();
  for (const proposal of filtered) {
    const name = String(proposal.proposer_name || "미지정").trim() || "미지정";
    const department = String(proposal.department || "미지정").trim() || "미지정";
    const key = `${name}\u0000${department}`;
    const row = proposerMap.get(key) || {
      name,
      department,
      count: 0,
      adoptedCount: 0,
      totalScore: 0,
    };
    row.count += 1;
    if (proposal.review_result === "채택") row.adoptedCount += 1;
    if (proposal.score !== null && proposal.score !== "" && Number.isFinite(Number(proposal.score))) {
      row.totalScore += Number(proposal.score);
    }
    proposerMap.set(key, row);
  }

  const topProposer = Array.from(proposerMap.values()).sort((a, b) =>
    b.count - a.count
    || b.adoptedCount - a.adoptedCount
    || b.totalScore - a.totalScore
    || a.name.localeCompare(b.name, "ko")
  )[0] || null;

  const scored = filtered
    .filter((proposal) => proposal.score !== null && proposal.score !== "" && Number.isFinite(Number(proposal.score)))
    .sort((a, b) =>
      Number(b.score) - Number(a.score)
      || safeAmount(b.effect_amount) - safeAmount(a.effect_amount)
      || safeAmount(b.award_amount) - safeAmount(a.award_amount)
      || String(b.received_date || "").localeCompare(String(a.received_date || ""))
      || String(b.proposal_no || "").localeCompare(String(a.proposal_no || ""))
    );

  const best = scored[0];
  const bestProposal = best ? {
    proposal_no: String(best.proposal_no || ""),
    title: String(best.title || "제안명 없음"),
    proposer_name: String(best.proposer_name || "미지정"),
    department: String(best.department || "미지정"),
    score: Number(best.score),
    award_amount: safeAmount(best.award_amount),
    effect_amount: safeAmount(best.effect_amount),
  } : null;

  return { selectedYear, topProposer, bestProposal };
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


export function resolveApprovalPermission(proposal, steps, records, assignments) {
  const activeSteps = (Array.isArray(steps) ? steps : [])
    .filter((step) => step.active !== false)
    .sort((a, b) => Number(a.step_order || 0) - Number(b.step_order || 0));
  const manualSteps = activeSteps.filter((step) => step.auto_author !== true);
  const approvalRecords = Array.isArray(records) ? records : [];
  const userAssignments = (Array.isArray(assignments) ? assignments : []).filter((assignment) => assignment.active !== false);
  const department = String(proposal?.department || "").trim();

  const recordFor = (stepId) => approvalRecords.find((record) => String(record.step_id) === String(stepId));

  for (const step of manualSteps) {
    const matchingAssignments = userAssignments
      .filter((assignment) => String(assignment.step_id) === String(step.id))
      .filter((assignment) => {
        const scope = String(assignment.department || "").trim();
        return !scope || scope === department;
      })
      .sort((left, right) => {
        const leftExact = String(left.department || "").trim() === department ? 1 : 0;
        const rightExact = String(right.department || "").trim() === department ? 1 : 0;
        return rightExact - leftExact;
      });

    const assignment = matchingAssignments[0];
    if (!assignment) continue;

    const record = recordFor(step.id) || { step_id: step.id, status: "대기" };
    const previousSteps = activeSteps.filter((candidate) => Number(candidate.step_order || 0) < Number(step.step_order || 0));
    const rejectedPrevious = previousSteps.find((candidate) => recordFor(candidate.id)?.status === "반려");
    if (rejectedPrevious) {
      return { assigned: true, canAct: false, step, assignment, record, reason: "이전 결재단계가 반려되어 진행할 수 없습니다." };
    }

    const incompletePrevious = previousSteps.find((candidate) => recordFor(candidate.id)?.status !== "승인");
    if (incompletePrevious) {
      return { assigned: true, canAct: false, step, assignment, record, reason: "이전 결재단계 승인이 완료되어야 합니다." };
    }

    if (record.status !== "대기") {
      return { assigned: true, canAct: false, step, assignment, record, reason: `이미 ${record.status} 처리된 결재입니다.` };
    }

    return { assigned: true, canAct: true, step, assignment, record, reason: "결재 처리 가능" };
  }

  return { assigned: false, canAct: false, step: null, assignment: null, record: null, reason: "이 제안에 지정된 본인 결재단계가 없습니다." };
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

// V2.0 operational management helpers
function daysBetween(dateText, now = new Date()) {
  if (!dateText) return 0;
  const start = new Date(`${String(dateText).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 86400000));
}

export function operationalMetrics(proposals, now = new Date(), options = {}) {
  const source = Array.isArray(proposals) ? proposals : [];
  const reviewDelayDays = Number(options.reviewDelayDays ?? 7);
  const implementationDelayDays = Number(options.implementationDelayDays ?? 30);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const overdueReview = source.filter((proposal) =>
    proposal.review_result === "미심사"
    && ["접수", "심사중"].includes(proposal.status)
    && daysBetween(proposal.received_date, now) >= reviewDelayDays
  ).length;

  const overdueImplementation = source.filter((proposal) =>
    proposal.review_result === "채택"
    && proposal.implementation_status !== "완료"
    && daysBetween(proposal.reviewed_at || proposal.updated_at || proposal.received_date, now) >= implementationDelayDays
  ).length;

  const monthRows = source.filter((proposal) => {
    const parts = proposalDateParts(proposal);
    return parts && Number(parts.year) === year && parts.month === month;
  });

  return {
    overdueReview,
    overdueImplementation,
    monthNew: monthRows.length,
    monthAward: monthRows.reduce((sum, row) => sum + safeAmount(row.award_amount), 0),
  };
}

export function departmentGoalProgress(proposals, goals, requestedYear = "") {
  const year = String(requestedYear || new Date().getFullYear());
  if (!year || year === "all") return [];
  const actualMap = new Map();
  for (const proposal of Array.isArray(proposals) ? proposals : []) {
    const parts = proposalDateParts(proposal);
    if (!parts || parts.year !== year) continue;
    const department = String(proposal.department || "미지정").trim() || "미지정";
    actualMap.set(department, (actualMap.get(department) || 0) + 1);
  }

  const goalMap = new Map();
  for (const goal of Array.isArray(goals) ? goals : []) {
    if (String(goal.year) !== year) continue;
    goalMap.set(String(goal.department || "미지정"), Math.max(0, Number(goal.annual_goal || 0)));
  }

  const departments = [...new Set([...actualMap.keys(), ...goalMap.keys()])];
  return departments.map((department) => {
    const actual = actualMap.get(department) || 0;
    const goal = goalMap.get(department) || 0;
    return {
      department,
      actual,
      goal,
      rate: goal > 0 ? Math.round((actual / goal) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.rate - a.rate || b.actual - a.actual || a.department.localeCompare(b.department, "ko"));
}

function proposalsForYear(proposals, requestedYear = "") {
  const year = String(requestedYear || "all");
  return (Array.isArray(proposals) ? proposals : []).filter((proposal) => {
    if (year === "all") return true;
    return proposalDateParts(proposal)?.year === year;
  });
}

function proposerRows(proposals) {
  const map = new Map();
  for (const proposal of proposals) {
    const name = String(proposal.proposer_name || "미지정").trim() || "미지정";
    const department = String(proposal.department || "미지정").trim() || "미지정";
    const key = `${name}\u0000${department}`;
    const row = map.get(key) || {
      name, department, total: 0, adopted: 0, totalScore: 0,
      awardTotal: 0, effectTotal: 0, proposals: [],
    };
    row.total += 1;
    row.adopted += proposal.review_result === "채택" ? 1 : 0;
    row.totalScore += Number.isFinite(Number(proposal.score)) ? Number(proposal.score) : 0;
    row.awardTotal += safeAmount(proposal.award_amount);
    row.effectTotal += safeAmount(proposal.effect_amount);
    row.proposals.push(proposal);
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) =>
    b.total - a.total || b.adopted - a.adopted || b.totalScore - a.totalScore || a.name.localeCompare(b.name, "ko")
  );
}

export function proposerPerformance(proposals, proposerName, requestedYear = "all", department = "") {
  const scoped = proposalsForYear(proposals, requestedYear);
  const ranking = proposerRows(scoped);
  const target = ranking.find((row) => row.name === proposerName && (!department || row.department === department));
  if (!target) return null;
  const rank = ranking.findIndex((row) => row === target) + 1;
  return {
    ...target,
    adoptionRate: target.total ? Math.round((target.adopted / target.total) * 1000) / 10 : 0,
    rank,
  };
}

export function topProposals(proposals, requestedYear = "all", metric = "score", limit = 10) {
  const scoped = proposalsForYear(proposals, requestedYear);
  const fieldMap = { score: "score", effect: "effect_amount", award: "award_amount" };
  const field = fieldMap[metric] || "score";
  return scoped
    .filter((proposal) => Number.isFinite(Number(proposal[field])) && Number(proposal[field]) > 0)
    .sort((a, b) =>
      Number(b[field]) - Number(a[field])
      || Number(b.score || 0) - Number(a.score || 0)
      || safeAmount(b.effect_amount) - safeAmount(a.effect_amount)
      || String(b.received_date || "").localeCompare(String(a.received_date || ""))
    )
    .slice(0, Math.max(1, Number(limit) || 10));
}

export function effectAnalysis(proposals) {
  const source = Array.isArray(proposals) ? proposals : [];
  const costTotal = source.reduce((sum, row) => sum + safeAmount(row.cost_amount), 0);
  const awardTotal = source.reduce((sum, row) => sum + safeAmount(row.award_amount), 0);
  const effectTotal = source.reduce((sum, row) => sum + safeAmount(row.effect_amount), 0);
  const investment = costTotal + awardTotal;
  const netEffect = effectTotal - investment;
  return {
    costTotal,
    awardTotal,
    effectTotal,
    investment,
    netEffect,
    roi: investment > 0 ? (netEffect / investment) * 100 : 0,
  };
}

function similarityTokens(value) {
  const normalized = normalizeText(value).replace(/[^0-9a-z가-힣]+/g, " ");
  const tokens = new Set(normalized.split(" ").filter((token) => token.length >= 2));
  const compact = normalized.replace(/\s+/g, "");
  for (let index = 0; index < compact.length - 1; index += 1) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function jaccardSimilarity(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function findSimilarProposals(proposals, draft, options = {}) {
  const limit = Math.max(1, Number(options.limit || 5));
  const excludeProposalNo = String(options.excludeProposalNo || "");
  const draftTitle = similarityTokens(draft?.title || "");
  const draftBody = similarityTokens([draft?.current_problem, draft?.improvement_plan, draft?.expected_effect].join(" "));

  return (Array.isArray(proposals) ? proposals : [])
    .filter((proposal) => String(proposal.proposal_no || "") !== excludeProposalNo)
    .map((proposal) => {
      const titleScore = jaccardSimilarity(draftTitle, similarityTokens(proposal.title || ""));
      const bodyScore = jaccardSimilarity(draftBody, similarityTokens([
        proposal.current_problem, proposal.improvement_plan, proposal.expected_effect,
      ].join(" ")));
      const similarity = Math.round((titleScore * 0.2 + bodyScore * 0.8) * 1000) / 10;
      return { ...proposal, similarity };
    })
    .filter((proposal) => proposal.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity || String(b.received_date || "").localeCompare(String(a.received_date || "")))
    .slice(0, limit);
}

export function buildTimelineFallback(proposal) {
  if (!proposal) return [];
  const rows = [{ stage: "접수", date: proposal.received_date || "", actor: proposal.proposer_name || "", state: "done" }];
  if (proposal.status === "심사중") {
    rows.push({ stage: "심사중", date: proposal.updated_at || "", actor: "관리자", state: "current" });
  }
  if (proposal.review_result && proposal.review_result !== "미심사") {
    rows.push({ stage: proposal.review_result === "채택" ? "채택" : proposal.review_result, date: proposal.reviewed_at || proposal.updated_at || "", actor: "관리자", state: "done" });
  }
  if (proposal.implementation_status === "진행중") {
    rows.push({ stage: "시행중", date: proposal.updated_at || "", actor: proposal.implementing_department || "", state: "current" });
  }
  if (proposal.implementation_status === "완료") {
    rows.push({ stage: "실시완료", date: proposal.implemented_date || proposal.updated_at || "", actor: proposal.implementing_department || "", state: "done" });
  }
  if (proposal.payment_status === "완료") {
    rows.push({ stage: "포상지급", date: proposal.updated_at || "", actor: "관리자", state: "done" });
  }
  return rows;
}
