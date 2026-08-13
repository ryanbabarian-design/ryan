import {
  calculateAward,
  currentYearProposalCount,
  dashboardBreakdown,
  dashboardDepartmentMonthly,
  dashboardHighlights,
  dashboardMetrics,
  departmentGoalProgress,
  effectAnalysis,
  findSimilarProposals,
  operationalMetrics,
  proposerPerformance,
  topProposals,
  buildTimelineFallback,
  filterProposals,
  formatCurrency,
  formatDate,
  IMPLEMENTATION_STATUSES,
  normalizeImplementationDetails,
  PAYMENT_STATUSES,
  REVIEW_RESULTS,
  resolveApprovalPermission,
  toProposalCsv,
  WORKFLOW_STATUSES,
} from "./core.js?v=2.3.5";
import { createStore } from "./services/store.js?v=2.3.5";
import {
  appendImageFiles,
  createImageSelection,
  getNewFiles,
  getRetainedImages,
  MAX_IMAGES_PER_SECTION,
  removeSelectedImage,
  totalSelectedImages,
} from "./image-manager.js?v=2.3.5";
import { buildPrintModel, PRINT_APPROVAL_ROLES } from "./print.js?v=2.3.5";

const store = createStore();
const state = {
  proposals: [],
  employees: [],
  departmentGoals: [],
  approvalSteps: [],
  approverAssignments: [],
  approvalInbox: [],
  approvalOverdueSummary: {},
  admin: null,
  loading: true,
  error: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const main = $("#app");
const toast = $("#toast");

let formImageSelections = null;
const filePreviewUrls = new WeakMap();

function ensureImageEditorStyles() {
  if (document.querySelector('link[data-image-editor-style]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./css/image-editor.css?v=1.7";
  link.dataset.imageEditorStyle = "true";
  document.head.append(link);
}

function initializeFormImageSelections(proposal) {
  formImageSelections = {
    before: createImageSelection(proposal?.before_images || []),
    after: createImageSelection(proposal?.after_images || []),
  };
}

function imageSectionLabel(section) {
  return section === "before" ? "개선 전" : "개선 후";
}

function filePreviewUrl(file) {
  if (!filePreviewUrls.has(file)) {
    filePreviewUrls.set(file, URL.createObjectURL(file));
  }
  return filePreviewUrls.get(file);
}

function renderFormImagePreview(section) {
  const selection = formImageSelections?.[section];
  const preview = $(`#${section}Preview`);
  const count = $(`#${section}ImageCount`);
  if (!selection || !preview) return;

  const existing = selection.existing.map((image, index) => `
    <div class="preview-item editable-preview-item">
      <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || `${imageSectionLabel(section)} 사진`)}">
      <span>${escapeHtml(image.name || "등록된 사진")}</span>
      <em>기존</em>
      <button type="button" class="preview-remove" data-action="remove-form-image" data-section="${section}" data-kind="existing" data-index="${index}" aria-label="사진 삭제">×</button>
    </div>
  `);

  const added = selection.files.map((file, index) => `
    <div class="preview-item editable-preview-item">
      <img src="${escapeHtml(filePreviewUrl(file))}" alt="${escapeHtml(file.name)}">
      <span>${escapeHtml(file.name)}</span>
      <em class="new-image-tag">신규</em>
      <button type="button" class="preview-remove" data-action="remove-form-image" data-section="${section}" data-kind="new" data-index="${index}" aria-label="사진 삭제">×</button>
    </div>
  `);

  preview.innerHTML = [...existing, ...added].join("") || `
    <div class="image-preview-empty">
      <strong>등록된 사진 없음</strong>
      <span>위 영역을 눌러 사진을 추가하세요.</span>
    </div>
  `;

  if (count) {
    const total = totalSelectedImages(selection);
    count.textContent = `${total}/${MAX_IMAGES_PER_SECTION}장`;
    count.classList.toggle("limit", total >= MAX_IMAGES_PER_SECTION);
  }
}

function appendFormImages(section, files) {
  const current = formImageSelections?.[section] || createImageSelection([]);
  const result = appendImageFiles(current, files, MAX_IMAGES_PER_SECTION);
  formImageSelections[section] = result.selection;
  renderFormImagePreview(section);

  if (result.rejected.length) {
    showToast(`${imageSectionLabel(section)} 사진은 기존 사진과 합쳐 최대 ${MAX_IMAGES_PER_SECTION}장까지 등록할 수 있습니다.`, "error");
  } else if (result.duplicates.length) {
    showToast("이미 선택한 동일 사진은 중복으로 추가하지 않았습니다.", "error");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function routeParts() {
  const hash = (location.hash || "#dashboard").slice(1).split("?")[0];
  return hash.split("/").filter(Boolean);
}

function go(path) {
  location.hash = path.startsWith("#") ? path : `#${path}`;
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.className = "toast";
  }, 3200);
}

function showError(error) {
  console.error(error);
  showToast(error?.message || String(error), "error");
}

function statusBadge(value) {
  const tone = {
    접수: "blue",
    심사중: "amber",
    심사완료: "green",
    미심사: "gray",
    채택: "green",
    미채택: "red",
    보류: "amber",
    중복제안: "purple",
    건수처리: "blue",
    미실시: "gray",
    진행중: "amber",
    완료: "green",
    미지급: "gray",
    예정: "amber",
  }[value] || "gray";
  return `<span class="badge badge-${tone}">${escapeHtml(value || "-")}</span>`;
}

function imageUrl(image) {
  return typeof image === "string" ? image : image?.url;
}

function renderImages(images, label) {
  if (!images?.length) {
    return `<div class="image-empty"><span>📷</span><p>${escapeHtml(label)} 미등록</p></div>`;
  }
  return `
    <div class="image-grid">
      ${images.map((image, index) => `
        <button class="image-button" data-action="open-image" data-url="${escapeHtml(imageUrl(image))}" aria-label="${escapeHtml(label)} ${index + 1} 확대">
          <img src="${escapeHtml(imageUrl(image))}" alt="${escapeHtml(label)} ${index + 1}">
        </button>
      `).join("")}
    </div>`;
}

function setActiveNav(route) {
  $$(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.route === route);
  });
}

function actionableApprovalCount(rows = state.approvalInbox) {
  return (rows || []).filter((row) => row.can_act === true && row.approval_status === "대기").length;
}

function syncApprovalInboxBadge() {
  const count = actionableApprovalCount();
  const badge = $("#approvalInboxBadge");
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = count < 1;
  badge.setAttribute("aria-label", `내 결재 대기 ${count}건`);
}

function showApprovalLoginNotice() {
  const count = actionableApprovalCount();
  const dialog = $("#approvalNoticeDialog");
  const text = $("#approvalNoticeText");
  if (!dialog || count < 1) return;
  if (text) text.textContent = `현재 본인 결재 대기 ${count}건이 있습니다. 처리하지 않은 건은 내 결재함에 계속 표시됩니다.`;
  if (!dialog.open && typeof dialog.showModal === "function") dialog.showModal();
}

async function refreshData() {
  const [proposals, employees, departmentGoals, approvalSteps, admin, approverAssignments] = await Promise.all([
    store.getProposals(), store.getEmployees(), store.getDepartmentGoals().catch(() => []), store.getApprovalSteps(true).catch(() => []), store.getAdminSession(), store.getApproverAssignments(true).catch(() => []),
  ]);
  state.proposals = proposals; state.employees = employees; state.departmentGoals = departmentGoals; state.approvalSteps = approvalSteps; state.admin = admin; state.approverAssignments = approverAssignments;
  state.approvalInbox = admin ? await store.getMyApprovalInbox().catch(() => []) : [];
  state.approvalOverdueSummary = admin?.isSystemAdmin ? await store.getApprovalOverdueSummary().catch(() => ({})) : {};
  syncApprovalInboxBadge();
}

async function init() {
  try {
    await refreshData();
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  const [route = "dashboard"] = routeParts();
  document.body.classList.toggle("print-route", route === "print" || route === "report");
  setActiveNav(["detail", "edit", "print", "person"].includes(route) ? "list" : route === "report" ? "dashboard" : route);
  $("#modeBadge").textContent = store.mode === "demo" ? "데모 모드" : "Supabase 연결";
  $("#modeBadge").className = `mode-badge ${store.mode}`;
  syncApprovalInboxBadge();

  if (state.loading) {
    main.innerHTML = `<div class="loading-card"><div class="spinner"></div><p>제안 데이터를 불러오는 중입니다.</p></div>`;
    return;
  }
  if (state.error) {
    main.innerHTML = `<section class="empty-state"><h2>데이터 연결 오류</h2><p>${escapeHtml(state.error)}</p></section>`;
    return;
  }

  if (route === "dashboard") renderDashboard();
  else if (route === "new") renderProposalForm();
  else if (route === "list") renderList();
  else if (route === "detail") renderDetail(routeParts()[1]);
  else if (route === "print") renderPrint(routeParts()[1]);
  else if (route === "edit") renderProposalForm(routeParts()[1]);
  else if (route === "person") renderProposerProfile(decodeURIComponent(routeParts()[1] || ""));
  else if (route === "report") renderManagementReport();
  else if (route === "admin") renderAdmin(routeParts()[1], routeParts()[2]);
  else renderDashboard();
}

function proposalCard(proposal) {
  return `
    <article class="proposal-card">
      <div class="proposal-card-top">
        <div>
          <div class="proposal-meta">
            <strong>${escapeHtml(proposal.proposal_no)}</strong>
            <span>${escapeHtml(formatDate(proposal.received_date))}</span>
            <span>${escapeHtml(proposal.department)}</span>
          </div>
          <h3>${escapeHtml(proposal.title)}</h3>
        </div>
        ${statusBadge(proposal.review_result)}
      </div>
      <p class="proposal-summary">${escapeHtml(proposal.current_problem || "상세내용 없음")}</p>
      <div class="proposal-card-bottom">
        <button class="proposer proposer-link" data-route="person/${encodeURIComponent(proposal.proposer_name)}?year=${encodeURIComponent(String(proposal.received_date || "").slice(0,4) || "all")}"><span class="avatar">${escapeHtml(proposal.proposer_name?.slice(0, 1) || "?")}</span>${escapeHtml(proposal.proposer_name)}</button>
        <div class="card-actions">
          ${statusBadge(proposal.implementation_status)}
          <button class="button button-ghost button-small" data-action="detail" data-no="${escapeHtml(proposal.proposal_no)}">상세보기</button>
        </div>
      </div>
    </article>`;
}

function getDashboardYearFromUrl() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return params.get("year") || "";
}

function getRankingMetricFromUrl() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const metric = params.get("ranking") || "score";
  return ["score", "effect", "award"].includes(metric) ? metric : "score";
}

function getReportMonthFromUrl() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const month = String(params.get("month") || "").trim();
  return /^(?:[1-9]|1[0-2])$/.test(month) ? month : "";
}

function analyticsRows(rows, emptyMessage) {
  if (!rows.length) {
    return `<div class="analytics-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  const maxCount = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => {
    const width = row.count ? Math.max(7, Math.round((row.count / maxCount) * 100)) : 0;
    return `
      <article class="analytics-row">
        <div class="analytics-row-main">
          <div class="analytics-row-title">
            <strong>${escapeHtml(row.label)}</strong>
            <span>${row.count.toLocaleString("ko-KR")}건</span>
          </div>
          <div class="analytics-bar-track" aria-hidden="true">
            <span style="width:${width}%"></span>
          </div>
        </div>
        <dl class="analytics-amounts">
          <div><dt>예상 투입비용</dt><dd>${formatCurrency(row.costTotal)}</dd></div>
          <div><dt>포상금</dt><dd>${formatCurrency(row.awardTotal)}</dd></div>
          <div><dt>효과금액</dt><dd>${formatCurrency(row.effectTotal)}</dd></div>
        </dl>
      </article>`;
  }).join("");
}

function analyticsTable(rows, labelHeading) {
  if (!rows.length) {
    return `<div class="analytics-empty">집계할 데이터가 없습니다.</div>`;
  }
  return `
    <div class="analytics-table-wrap">
      <table class="analytics-table">
        <thead>
          <tr>
            <th>${escapeHtml(labelHeading)}</th>
            <th>제안건수</th>
            <th>예상 투입비용</th>
            <th>포상금</th>
            <th>효과금액</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.label)}</strong></td>
              <td>${row.count.toLocaleString("ko-KR")}건</td>
              <td>${formatCurrency(row.costTotal)}</td>
              <td>${formatCurrency(row.awardTotal)}</td>
              <td class="effect-money">${formatCurrency(row.effectTotal)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function departmentMonthlyTable(report) {
  if (!report.available) {
    return `<div class="department-month-empty">부서별 월 제안실적은 <strong>조회 연도</strong>를 선택하면 표시됩니다.</div>`;
  }
  if (!report.departments.length) {
    return `<div class="analytics-empty">선택한 연도에 부서별 제안자료가 없습니다.</div>`;
  }
  return `
    <div class="department-month-matrix-wrap">
      <table class="department-month-matrix">
        <thead>
          <tr><th>부서</th>${Array.from({ length: 12 }, (_, index) => `<th>${index + 1}월</th>`).join("")}<th>합계</th></tr>
        </thead>
        <tbody>
          ${report.departments.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.department)}</strong></td>
              ${row.months.map((count) => `<td class="${count ? "has-value" : ""}">${count.toLocaleString("ko-KR")}</td>`).join("")}
              <td class="department-month-total">${row.total.toLocaleString("ko-KR")}건</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderDashboard() {
  const report = dashboardBreakdown(state.proposals, getDashboardYearFromUrl());
  const scopedProposals = filterProposals(state.proposals, { year: report.selectedYear });
  const metrics = dashboardMetrics(scopedProposals);
  const currentYear = String(new Date().getFullYear());
  const currentYearCount = currentYearProposalCount(state.proposals);
  const departmentMonthly = dashboardDepartmentMonthly(state.proposals, report.selectedYear);
  const highlights = dashboardHighlights(state.proposals, report.selectedYear);
  const operations = operationalMetrics(scopedProposals);
  const goals = departmentGoalProgress(state.proposals, state.departmentGoals, report.selectedYear);
  const effects = effectAnalysis(scopedProposals);
  const rankingMetric = getRankingMetricFromUrl();
  const top10 = topProposals(state.proposals, report.selectedYear, rankingMetric, 10);
  const recent = filterProposals(state.proposals).slice(0, 3);
  const departments = [...new Set(state.proposals.map((item) => item.department).filter(Boolean))].sort();
  const selectedLabel = report.selectedYear === "all" ? "전체 연도" : `${report.selectedYear}년`;
  const dashboardYearParam = encodeURIComponent(report.selectedYear);

  main.innerHTML = `
    <section class="hero brand-hero">
      <div class="hero-copy">
        <span class="eyebrow">HANA METAL IDEA HUB</span>
        <h1>작은 개선이<br><em>큰 변화를 만듭니다.</em></h1>
        <p>기존 제안을 검색하고, 개선 전·후 사진과 함께 새로운 아이디어를 바로 접수하세요.</p>
        <div class="hero-actions">
          <button class="button button-primary" data-route="new"><span aria-hidden="true">＋</span> 새 제안 작성</button>
          <button class="button button-secondary" data-route="list"><span aria-hidden="true">⌕</span> 유사 제안 검색</button>
        </div>
      </div>
      <div class="hero-panel brand-hero-panel" aria-hidden="true">
        <div class="hero-metal-lines"></div>
        <div class="hero-metal-symbol">H</div>
        <div class="hero-mini-card">
          <span>올해 누적 제안</span>
          <strong>${currentYearCount.toLocaleString("ko-KR")}건</strong>
          <small>${currentYear}년 접수 기준 · 전체 DB ${state.proposals.length.toLocaleString("ko-KR")}건</small>
        </div>
      </div>
    </section>

    <section class="metric-grid workflow-metric-grid" aria-label="제안 현황 요약">
      <button class="metric-card workflow-card total" data-route="list?year=${dashboardYearParam}&workflow=total">
        <span class="metric-icon" aria-hidden="true">♢</span>
        <div><small>전체 제안</small><strong>${metrics.total.toLocaleString("ko-KR")}</strong></div>
        <span class="metric-arrow">›</span>
      </button>
      <button class="metric-card workflow-card pending" data-route="list?year=${dashboardYearParam}&workflow=pending">
        <span class="metric-icon" aria-hidden="true">◷</span>
        <div><small>심사 대기</small><strong>${metrics.pending.toLocaleString("ko-KR")}</strong></div>
        <span class="metric-arrow">›</span>
      </button>
      <button class="metric-card workflow-card adopted" data-route="list?year=${dashboardYearParam}&workflow=adopted">
        <span class="metric-icon" aria-hidden="true">✓</span>
        <div><small>채택</small><strong>${metrics.adopted.toLocaleString("ko-KR")}</strong></div>
        <span class="metric-arrow">›</span>
      </button>
      <button class="metric-card workflow-card completed" data-route="list?year=${dashboardYearParam}&workflow=completed">
        <span class="metric-icon" aria-hidden="true">⚑</span>
        <div><small>실시 완료</small><strong>${metrics.completed.toLocaleString("ko-KR")}</strong></div>
        <span class="metric-arrow">›</span>
      </button>
    </section>

    <section class="metric-grid operational-metric-grid" aria-label="운영관리 요약">
      <button class="metric-card operational-card danger" data-route="list?year=${dashboardYearParam}&workflow=overdue-review"><span class="metric-icon">!</span><div><small>장기 미심사</small><strong>${operations.overdueReview.toLocaleString("ko-KR")}건</strong><em>7일 이상</em></div></button>
      <button class="metric-card operational-card warning" data-route="list?year=${dashboardYearParam}&workflow=overdue-implementation"><span class="metric-icon">↻</span><div><small>시행 지연</small><strong>${operations.overdueImplementation.toLocaleString("ko-KR")}건</strong><em>채택 후 30일+</em></div></button>
      <div class="metric-card operational-card"><span class="metric-icon">＋</span><div><small>이번달 신규</small><strong>${operations.monthNew.toLocaleString("ko-KR")}건</strong><em>현재 월 접수</em></div></div>
      <div class="metric-card operational-card"><span class="metric-icon">₩</span><div><small>이번달 포상금</small><strong class="metric-money">${formatCurrency(operations.monthAward)}</strong><em>현재 월 제안 기준</em></div></div>
    </section>

    <section class="quick-search brand-quick-search">
      <div>
        <span class="eyebrow">DUPLICATE CHECK</span>
        <h2>제안하기 전에 비슷한 아이디어가 있는지 검색하세요.</h2>
      </div>
      <form id="quickSearchForm" class="search-box">
        <input name="query" placeholder="예: 에어건, 절단기, 안전장치, 작업시간 단축" aria-label="유사 제안 검색어">
        <button class="button button-primary" type="submit">⌕ 검색</button>
      </form>
      <div class="keyword-row">
        <span class="keyword-label">추천 검색어</span>
        ${departments.slice(0, 8).map((department) => `<button class="keyword" data-search="${escapeHtml(department)}">${escapeHtml(department)}</button>`).join("")}
      </div>
    </section>

    <section class="section dashboard-recent brand-recent">
      <div class="section-heading">
        <div><span class="eyebrow">RECENT IDEAS</span><h2>최근 접수된 제안</h2></div>
        <button class="button button-ghost" data-route="list">전체보기 ›</button>
      </div>
      ${recent.length
        ? `<div class="proposal-grid">${recent.map(proposalCard).join("")}</div>`
        : `<div class="analytics-empty">등록된 제안이 없습니다.</div>`}
    </section>

    <section class="analytics-dashboard" id="analytics">
      <div class="analytics-dashboard-head">
        <div>
          <span class="eyebrow">PERFORMANCE ANALYTICS</span>
          <h2>제안실적 종합 대시보드</h2>
          <p>제안건수·예상 투입비용·포상금·효과금액을 연도별, 월별, 부서별로 확인합니다.</p>
        </div>
        <div class="dashboard-controls">
          <button class="button button-ghost" data-route="report?year=${dashboardYearParam}">월간/연간 운영보고서</button>
          <label>조회 연도
            <select id="dashboardYearFilter">
              <option value="all" ${report.selectedYear === "all" ? "selected" : ""}>전체 연도</option>
              ${report.years.map((year) => `<option value="${year}" ${report.selectedYear === year ? "selected" : ""}>${year}년</option>`).join("")}
            </select>
          </label>
        </div>
      </div>

      <div class="dashboard-period-banner">
        <div><span>현재 조회</span><strong>${escapeHtml(selectedLabel)}</strong></div>
        <p>${report.selectedYear === "all" ? "등록된 전체 기간을 합산했습니다." : `${report.selectedYear}년 1월부터 12월까지의 실적입니다.`}</p>
      </div>

      <section class="metric-grid dashboard-money-grid" aria-label="선택 기간 금액 현황">
        <div class="metric-card analytics-kpi count"><span class="metric-icon">件</span><div><small>제안건수</small><strong>${report.totals.count.toLocaleString("ko-KR")}건</strong></div></div>
        <div class="metric-card analytics-kpi cost"><span class="metric-icon">₩</span><div><small>예상 투입비용</small><strong class="metric-money">${formatCurrency(report.totals.costTotal)}</strong></div></div>
        <div class="metric-card analytics-kpi award"><span class="metric-icon">賞</span><div><small>포상금</small><strong class="metric-money">${formatCurrency(report.totals.awardTotal)}</strong></div></div>
        <div class="metric-card analytics-kpi effect"><span class="metric-icon">↗</span><div><small>효과금액</small><strong class="metric-money">${formatCurrency(report.totals.effectTotal)}</strong></div></div>
      </section>

      <section class="v2-insight-grid">
        <article class="analytics-panel goal-panel">
          <div class="analytics-panel-head"><div><span class="eyebrow">GOAL</span><h2>부서 목표달성률</h2><p>연도별 목표 대비 실제 제안건수를 비교합니다.</p></div></div>
          ${report.selectedYear === "all" ? `<div class="analytics-empty">조회 연도를 선택하면 부서 목표달성률이 표시됩니다.</div>` : goals.length ? `
            <div class="goal-progress-list">${goals.map((row) => `
              <div class="goal-progress">
                <div><strong>${escapeHtml(row.department)}</strong><span>${row.actual}건 / 목표 ${row.goal}건</span><b>${row.rate.toLocaleString("ko-KR")}%</b></div>
                <div class="goal-progress-track"><span style="width:${Math.min(100, row.rate)}%"></span></div>
              </div>`).join("")}</div>` : `<div class="analytics-empty">등록된 부서 목표가 없습니다. 관리자에서 목표를 설정하세요.</div>`}
        </article>

        <article class="analytics-panel roi-panel">
          <div class="analytics-panel-head"><div><span class="eyebrow">VALUE</span><h2>제안 효과 분석</h2><p>투입비용과 포상금을 포함해 순효과와 ROI를 계산합니다.</p></div></div>
          <div class="roi-summary">
            <div><small>총 효과금액</small><strong>${formatCurrency(effects.effectTotal)}</strong></div>
            <div><small>총 투자비용</small><strong>${formatCurrency(effects.investment)}</strong></div>
            <div class="net"><small>순효과</small><strong>${formatCurrency(effects.netEffect)}</strong></div>
            <div class="roi"><small>ROI</small><strong>${effects.roi.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%</strong></div>
          </div>
        </article>
      </section>

      <section class="analytics-panel top10-panel">
        <div class="analytics-panel-head"><div><span class="eyebrow">TOP 10</span><h2>우수제안 TOP 10</h2><p>점수·효과금액·포상금 기준으로 순위를 비교합니다.</p></div><label>순위기준<select id="top10MetricFilter"><option value="score" ${rankingMetric === "score" ? "selected" : ""}>심사점수</option><option value="effect" ${rankingMetric === "effect" ? "selected" : ""}>효과금액</option><option value="award" ${rankingMetric === "award" ? "selected" : ""}>포상금</option></select></label></div>
        ${top10.length ? `<div class="top10-list">${top10.map((proposal, index) => `
          <button class="top10-row" data-action="detail" data-no="${escapeHtml(proposal.proposal_no)}">
            <b>${index + 1}</b><span><strong>${escapeHtml(proposal.title)}</strong><small>${escapeHtml(proposal.proposal_no)} · ${escapeHtml(proposal.proposer_name)} · ${escapeHtml(proposal.department)}</small></span><em>${rankingMetric === "effect" ? formatCurrency(proposal.effect_amount) : rankingMetric === "award" ? formatCurrency(proposal.award_amount) : `${Number(proposal.score || 0)}점`}</em>
          </button>`).join("")}</div>` : `<div class="analytics-empty">선택 기준에 해당하는 제안이 없습니다.</div>`}
      </section>

      <section class="analytics-layout">
        <article class="analytics-panel monthly-panel">
          <div class="analytics-panel-head">
            <div><span class="eyebrow">MONTHLY</span><h2>월별 제안실적</h2><p>월별 건수와 세 가지 금액을 함께 비교합니다.</p></div>
            <span class="analytics-count">${report.monthly.reduce((sum, row) => sum + row.count, 0).toLocaleString("ko-KR")}건</span>
          </div>
          <div class="analytics-list monthly-list">
            ${analyticsRows(report.monthly, "월별 집계자료가 없습니다.")}
          </div>
        </article>

        <div class="analytics-side-stack">
          <article class="analytics-panel department-panel">
            <div class="analytics-panel-head">
              <div><span class="eyebrow">DEPARTMENT</span><h2>부서별 제안실적</h2><p>제안건수가 많은 부서 순으로 표시합니다.</p></div>
              <span class="analytics-count">${report.departments.length.toLocaleString("ko-KR")}개 부서</span>
            </div>
            <div class="analytics-list department-list">
              ${analyticsRows(report.departments, "부서별 집계자료가 없습니다.")}
            </div>
          </article>

          <section class="dashboard-highlight-list" aria-label="우수 제안 하이라이트">
            <article class="dashboard-highlight-card top-proposer-card">
              <div class="highlight-card-icon" aria-hidden="true">★</div>
              <div class="highlight-card-body">
                <span class="eyebrow">MOST ACTIVE</span>
                <h2>최다제안</h2>
                ${highlights.topProposer ? `
                  <div class="highlight-winner-row">
                    <div>
                      <strong>${escapeHtml(highlights.topProposer.name)}</strong>
                      <span>${escapeHtml(highlights.topProposer.department)}</span>
                    </div>
                    <b>${highlights.topProposer.count.toLocaleString("ko-KR")}건</b>
                  </div>
                  <dl class="highlight-stats">
                    <div><dt>채택</dt><dd>${highlights.topProposer.adoptedCount.toLocaleString("ko-KR")}건</dd></div>
                    <div><dt>점수 합계</dt><dd>${highlights.topProposer.totalScore.toLocaleString("ko-KR")}점</dd></div>
                  </dl>
                  <button class="highlight-link" data-search="${escapeHtml(highlights.topProposer.name)}">제안내역 보기 ›</button>
                ` : `
                  <div class="highlight-empty">선택 기간에 등록된 제안자가 없습니다.</div>
                `}
                <p class="highlight-rule">제안건수 기준 · 동률 시 채택건수와 점수합계 순</p>
              </div>
            </article>

            <article class="dashboard-highlight-card best-proposal-card">
              <div class="highlight-card-icon" aria-hidden="true">♛</div>
              <div class="highlight-card-body">
                <span class="eyebrow">BEST IDEA</span>
                <h2>최우수제안</h2>
                ${highlights.bestProposal ? `
                  <div class="best-proposal-title">
                    <span>${escapeHtml(highlights.bestProposal.proposal_no)}</span>
                    <strong>${escapeHtml(highlights.bestProposal.title)}</strong>
                    <small>${escapeHtml(highlights.bestProposal.proposer_name)} · ${escapeHtml(highlights.bestProposal.department)}</small>
                  </div>
                  <dl class="highlight-stats best-stats">
                    <div><dt>심사점수</dt><dd>${highlights.bestProposal.score.toLocaleString("ko-KR")}점</dd></div>
                    <div><dt>포상금</dt><dd>${formatCurrency(highlights.bestProposal.award_amount)}</dd></div>
                    <div><dt>효과금액</dt><dd>${formatCurrency(highlights.bestProposal.effect_amount)}</dd></div>
                  </dl>
                  <button class="highlight-link" data-action="detail" data-no="${escapeHtml(highlights.bestProposal.proposal_no)}">제안 상세보기 ›</button>
                ` : `
                  <div class="highlight-empty">심사점수가 입력된 제안이 없습니다.</div>
                `}
                <p class="highlight-rule">심사점수 기준 · 동률 시 효과금액과 포상금 순</p>
              </div>
            </article>
          </section>
        </div>
      </section>

      <section class="analytics-panel department-month-panel">
        <div class="analytics-panel-head">
          <div><span class="eyebrow">DEPARTMENT × MONTH</span><h2>부서별 월 제안실적</h2><p>${report.selectedYear === "all" ? "연도를 선택하면 부서별 1~12월 제안건수를 비교할 수 있습니다." : `${report.selectedYear}년 부서별 월 제안건수와 연간 합계를 비교합니다.`}</p></div>
          <span class="analytics-count">${report.selectedYear === "all" ? "연도 선택" : `${departmentMonthly.departments.length.toLocaleString("ko-KR")}개 부서`}</span>
        </div>
        ${departmentMonthlyTable(departmentMonthly)}
      </section>

      <section class="analytics-panel yearly-panel">
        <div class="analytics-panel-head">
          <div><span class="eyebrow">YEARLY</span><h2>연도별 종합현황</h2><p>전체 연도의 제안건수와 금액 합계를 비교합니다.</p></div>
        </div>
        ${analyticsTable(report.yearly, "연도")}
      </section>

      <section class="analytics-panel department-table-panel">
        <div class="analytics-panel-head">
          <div><span class="eyebrow">DETAIL TABLE</span><h2>${escapeHtml(selectedLabel)} 부서별 상세표</h2><p>표 형태로 정확한 건수와 금액을 확인합니다.</p></div>
        </div>
        ${analyticsTable(report.departments, "부서")}
      </section>
    </section>
  `;
}
function getFiltersFromUrl() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return {
    query: params.get("q") || "",
    year: params.get("year") || "all",
    workflow: params.get("workflow") || "total",
    category: params.get("category") || "",
    department: params.get("department") || "",
    reviewResult: params.get("review") || "",
    implementationStatus: params.get("implementation") || "",
  };
}

function renderList() {
  const filters = getFiltersFromUrl();
  const proposals = filterProposals(state.proposals, filters);
  const departments = [...new Set(state.proposals.map((item) => item.department))].sort();
  const years = dashboardBreakdown(state.proposals, "all").years;
  const workflowLabels = { total: "전체 제안", pending: "심사 대기", "overdue-review": "장기 미심사", adopted: "채택", "overdue-implementation": "시행 지연", completed: "실시 완료" };
  const yearLabel = filters.year === "all" ? "전체 연도" : `${filters.year}년`;
  const workflowLabel = workflowLabels[filters.workflow] || "전체 제안";

  main.innerHTML = `
    <section class="page-header">
      <div><span class="eyebrow">PUBLIC DATABASE</span><h1>제안 접수현황</h1><p>제안명·문제점·개선방안·효과·제안자·부서를 통합 검색합니다.</p></div>
      <button class="button button-primary" data-route="new">새 제안 작성</button>
    </section>

    <div class="active-filter-summary">
      <span>현재 조회</span><strong>${escapeHtml(yearLabel)}</strong><i>·</i><strong>${escapeHtml(workflowLabel)}</strong>
    </div>

    <section class="filter-panel">
      <form id="filterForm">
        <div class="filter-search">
          <label for="listQuery">통합검색</label>
          <div class="search-input-wrap">
            <span>⌕</span>
            <input id="listQuery" name="query" value="${escapeHtml(filters.query)}" placeholder="제안번호, 제안명, 내용, 이름, 부서 검색">
          </div>
        </div>
        <div class="filter-grid">
          <label>조회연도
            <select name="year">
              <option value="all" ${filters.year === "all" ? "selected" : ""}>전체 연도</option>
              ${years.map((year) => `<option value="${year}" ${filters.year === year ? "selected" : ""}>${year}년</option>`).join("")}
            </select>
          </label>
          <label>현황
            <select name="workflow">
              <option value="total" ${filters.workflow === "total" ? "selected" : ""}>전체 제안</option>
              <option value="pending" ${filters.workflow === "pending" ? "selected" : ""}>심사 대기</option>
              <option value="overdue-review" ${filters.workflow === "overdue-review" ? "selected" : ""}>장기 미심사(7일+)</option>
              <option value="adopted" ${filters.workflow === "adopted" ? "selected" : ""}>채택</option>
              <option value="overdue-implementation" ${filters.workflow === "overdue-implementation" ? "selected" : ""}>시행 지연(30일+)</option>
              <option value="completed" ${filters.workflow === "completed" ? "selected" : ""}>실시 완료</option>
            </select>
          </label>
          <label>제안종류
            <select name="category">
              <option value="">전체</option>
              ${["개선", "안전"].map((v) => `<option ${filters.category === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
          <label>부서
            <select name="department">
              <option value="">전체</option>
              ${departments.map((v) => `<option ${filters.department === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </label>
          <label>심사결과
            <select name="reviewResult">
              <option value="">전체</option>
              ${REVIEW_RESULTS.map((v) => `<option ${filters.reviewResult === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
          <label>실시상태
            <select name="implementationStatus">
              <option value="">전체</option>
              ${IMPLEMENTATION_STATUSES.map((v) => `<option ${filters.implementationStatus === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="filter-actions">
          <button class="button button-primary" type="submit">검색 적용</button>
          <button class="button button-ghost" type="button" data-action="clear-filter">초기화</button>
        </div>
      </form>
    </section>

    <section class="section">
      <div class="result-bar"><strong>${proposals.length}건</strong><span>검색 결과</span></div>
      ${proposals.length
        ? `<div class="proposal-grid">${proposals.map(proposalCard).join("")}</div>`
        : `<div class="empty-state"><h2>검색 결과가 없습니다.</h2><p>다른 검색어나 조건으로 다시 확인하세요.</p></div>`}
    </section>
  `;
}

function employeeOptions(selectedName = "", selectedDepartment = "") {
  return state.employees.map((employee) => `
    <option value="${escapeHtml(employee.name)}" data-department="${escapeHtml(employee.department)}" ${employee.name === selectedName && employee.department === selectedDepartment ? "selected" : ""}>
      ${escapeHtml(employee.name)} · ${escapeHtml(employee.department)}
    </option>
  `).join("");
}

function renderSimilar(title, excludeNo = "") {
  if (!title?.trim()) return "";
  const form = $("#proposalForm");
  const draft = {
    title,
    current_problem: form?.elements?.current_problem?.value || "",
    improvement_plan: form?.elements?.improvement_plan?.value || "",
    expected_effect: form?.elements?.expected_effect?.value || "",
  };
  const similar = findSimilarProposals(state.proposals, draft, { excludeProposalNo: excludeNo, limit: 5 });
  if (!similar.length) return `<p class="similar-empty">유사도가 높은 기존 제안이 없습니다.</p>`;
  return similar.map((proposal) => `
    <button type="button" class="similar-item" data-action="detail" data-no="${escapeHtml(proposal.proposal_no)}">
      <strong>${escapeHtml(proposal.title)}</strong>
      <span>${escapeHtml(proposal.proposal_no)} · ${escapeHtml(proposal.department)} · ${escapeHtml(proposal.proposer_name)} · <b>유사도 ${proposal.similarity}%</b></span>
    </button>
  `).join("");
}

function syncImplementationDateField() {
  const statusSelect = $("#implementationStatus");
  const dateInput = $("#implementedDateInput");
  const dateField = $("#implementedDateField");
  if (!statusSelect || !dateInput || !dateField) return;

  const isCompleted = statusSelect.value === "완료";
  dateInput.disabled = !isCompleted;
  dateInput.required = isCompleted;
  dateField.classList.toggle("is-disabled", !isCompleted);

  if (!isCompleted) {
    dateInput.value = "";
  }
}

function renderProposalForm(proposalNo = "") {
  const proposal = proposalNo ? state.proposals.find((item) => item.proposal_no === proposalNo) : null;
  if (proposalNo && !proposal) {
    main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="list">목록으로</button></div>`;
    return;
  }

  const isEdit = Boolean(proposal);
  initializeFormImageSelections(proposal);
  main.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">${isEdit ? "EDIT PROPOSAL" : "NEW PROPOSAL"}</span>
        <h1>${isEdit ? `${escapeHtml(proposal.proposal_no)} 제안 수정` : "새 제안 작성"}</h1>
        <p>${isEdit ? "심사중으로 전환되기 전까지만 4자리 수정번호로 변경할 수 있습니다." : "제출 즉시 접수현황에 공개됩니다. 회사 기밀이나 개인정보는 입력하지 마세요."}</p>
      </div>
      <button class="button button-ghost" data-route="list">접수현황 보기</button>
    </section>

    <form id="proposalForm" class="proposal-form" data-edit="${isEdit ? "true" : "false"}" data-no="${escapeHtml(proposalNo)}">
      <input class="honeypot" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">

      ${isEdit ? `
        <section class="form-section form-section-pin">
          <div class="form-section-title"><span>🔐</span><div><h2>수정 확인</h2><p>제출할 때 설정한 4자리 수정번호를 입력하세요.</p></div></div>
          <label class="field compact">수정번호
            <input name="edit_pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="4자리 숫자">
          </label>
        </section>` : ""}

      <section class="form-section">
        <div class="form-section-title"><span>01</span><div><h2>제안자 정보</h2><p>직원명을 선택하면 부서가 자동 입력됩니다.</p></div></div>
        <div class="form-grid three">
          <label class="field">제안자 <b>*</b>
            <select id="employeeSelect" name="proposer_name" required>
              <option value="">직원 선택</option>
              ${employeeOptions(proposal?.proposer_name, proposal?.department)}
            </select>
          </label>
          <label class="field">부서
            <input id="departmentInput" name="department" value="${escapeHtml(proposal?.department || "")}" readonly required>
          </label>
          <label class="field">제안종류 <b>*</b>
            <select name="category" required>
              ${["개선", "안전"].map((v) => `<option ${proposal?.category === v ? "selected" : ""}>${v}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-title"><span>02</span><div><h2>제안 핵심내용</h2><p>검색이 잘 되도록 설비·공정·문제점을 제목에 포함하세요.</p></div></div>
        <label class="field">제안명 <b>*</b>
          <input id="proposalTitle" name="title" value="${escapeHtml(proposal?.title || "")}" maxlength="120" required placeholder="예: 산처리 에어건 노즐 교체로 작업시간 단축">
        </label>
        <div class="similar-box">
          <div><strong>유사 제안 자동검색</strong><span>입력한 제목을 기준으로 기존 DB를 확인합니다.</span></div>
          <div id="similarResults">${renderSimilar(proposal?.title || "", proposalNo)}</div>
        </div>
      </section>

      <section class="form-section comparison-section">
        <div class="form-section-title"><span>03</span><div><h2>개선 전·후 비교</h2><p>현재 문제와 개선방안을 구체적으로 작성하고 사진을 첨부하세요.</p></div></div>
        <div class="comparison-grid">
          <div class="comparison-card before">
            <div class="comparison-label">BEFORE · 개선 전</div>
            <label class="field">현재 문제점 <b>*</b>
              <textarea id="currentProblem" name="current_problem" rows="8" required placeholder="어떤 문제가 있고, 왜 불편하거나 위험한지 작성">${escapeHtml(proposal?.current_problem || "")}</textarea>
            </label>
            <label class="upload-box image-add-box">개선 전 사진 추가
              <input id="beforeImages" type="file" accept="image/jpeg,image/png,image/webp" multiple>
              <span>한 장씩 여러 번 추가하거나 여러 장을 한꺼번에 선택할 수 있습니다.</span>
              <small id="beforeImageCount" class="image-count">0/${MAX_IMAGES_PER_SECTION}장</small>
            </label>
            <div id="beforePreview" class="preview-grid editable-preview-grid"></div>
          </div>

          <div class="comparison-arrow">→</div>

          <div class="comparison-card after">
            <div class="comparison-label">AFTER · 개선 후</div>
            <label class="field">개선방안 <b>*</b>
              <textarea id="improvementPlan" name="improvement_plan" rows="8" required placeholder="무엇을 어떻게 바꿀지 구체적으로 작성">${escapeHtml(proposal?.improvement_plan || "")}</textarea>
            </label>
            <label class="upload-box image-add-box">개선 후·참고 사진 추가
              <input id="afterImages" type="file" accept="image/jpeg,image/png,image/webp" multiple>
              <span>한 장씩 여러 번 추가할 수 있으며, 실시 전이면 도면·예시 사진도 가능합니다.</span>
              <small id="afterImageCount" class="image-count">0/${MAX_IMAGES_PER_SECTION}장</small>
            </label>
            <div id="afterPreview" class="preview-grid editable-preview-grid"></div>
          </div>
        </div>
      </section>

      <section class="form-section">
        <div class="form-section-title"><span>04</span><div><h2>효과 및 비용</h2><p>정량효과가 없더라도 안전·품질·작업성 개선 내용을 작성하세요.</p></div></div>
        <label class="field">기대효과 <b>*</b>
          <textarea name="expected_effect" rows="5" required placeholder="예: 작업시간 1회당 10분 단축, 비산 위험 감소, 불량 방지">${escapeHtml(proposal?.expected_effect || "")}</textarea>
        </label>
        <label class="field compact">예상 투입비용(원)
          <input name="cost_amount" type="number" min="0" step="1000" value="${Number(proposal?.cost_amount || 0)}">
        </label>
      </section>

      <section class="form-section implementation-section">
        <div class="form-section-title"><span>05</span><div><h2>제안 실시현황</h2><p>제안이 현재 어느 단계인지 선택하세요. 완료된 경우 실제 실시일을 입력합니다.</p></div></div>
        <div class="form-grid two implementation-grid">
          <label class="field">실시상태 <b>*</b>
            <select id="implementationStatus" name="implementation_status" required>
              ${IMPLEMENTATION_STATUSES.map((status) => `<option value="${status}" ${(proposal?.implementation_status || "미실시") === status ? "selected" : ""}>${status}</option>`).join("")}
            </select>
          </label>
          <label id="implementedDateField" class="field">실시일 <b>*</b>
            <input id="implementedDateInput" name="implemented_date" type="date" value="${escapeHtml(proposal?.implemented_date || "")}">
            <small class="field-help">‘완료’ 상태일 때만 실시일이 저장됩니다.</small>
          </label>
        </div>
      </section>

      ${!isEdit ? `
        <section class="form-section form-section-pin">
          <div class="form-section-title"><span>06</span><div><h2>수정번호 설정</h2><p>심사 시작 전 본인 제안을 수정할 때 사용합니다.</p></div></div>
          <label class="field compact">4자리 수정번호 <b>*</b>
            <input name="edit_pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" required placeholder="예: 1234">
          </label>
        </section>` : ""}

      <div class="form-submit-bar">
        <label class="check-label"><input type="checkbox" required> 입력 내용과 사진이 전체 공개되는 것에 동의합니다.</label>
        <div>
          <button type="button" class="button button-ghost" data-route="list">취소</button>
          <button type="submit" class="button button-primary">${isEdit ? "수정 저장" : "제안 제출"}</button>
        </div>
      </div>
    </form>
  `;
  renderFormImagePreview("before");
  renderFormImagePreview("after");
  syncImplementationDateField();
}

function renderDetail(proposalNo) {
  const proposal = state.proposals.find((item) => item.proposal_no === proposalNo);
  if (!proposal) {
    main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="list">목록으로</button></div>`;
    return;
  }

  main.innerHTML = `
    <section class="detail-header">
      <button class="back-link" data-route="list">← 접수현황</button>
      <div class="detail-title-row">
        <div>
          <div class="proposal-meta">
            <strong>${escapeHtml(proposal.proposal_no)}</strong>
            <span>${escapeHtml(formatDate(proposal.received_date))}</span>
            <span>${escapeHtml(proposal.category)}제안</span>
          </div>
          <h1>${escapeHtml(proposal.title)}</h1>
          <p><button class="detail-proposer-link" data-route="person/${encodeURIComponent(proposal.proposer_name)}?year=${encodeURIComponent(String(proposal.received_date || "").slice(0,4) || "all")}"><strong>${escapeHtml(proposal.proposer_name)}</strong></button> · ${escapeHtml(proposal.department)}</p>
        </div>
        <div class="detail-actions">
          ${statusBadge(proposal.status)}
          ${statusBadge(proposal.review_result)}
          <button class="button button-ghost print-open-button" data-action="print-proposal" data-no="${escapeHtml(proposal.proposal_no)}">제안서 인쇄</button>
          ${!proposal.locked && proposal.status === "접수"
            ? `<button class="button button-secondary" data-route="edit/${escapeHtml(proposal.proposal_no)}">제안자 수정</button>`
            : ""}
        </div>
      </div>
    </section>

    <section class="detail-summary-grid">
      <div><small>심사결과</small>${statusBadge(proposal.review_result)}</div>
      <div><small>실시상태</small>${statusBadge(proposal.implementation_status)}</div>
      <div><small>점수</small><strong>${proposal.score ?? "-"}${proposal.score != null ? "점" : ""}</strong></div>
      <div><small>포상금</small><strong>${formatCurrency(proposal.award_amount)}</strong></div>
      <div><small>지급상태</small>${statusBadge(proposal.payment_status)}</div>
      <div><small>효과금액</small><strong>${formatCurrency(proposal.effect_amount)}</strong></div>
    </section>

    <section class="detail-comparison">
      <article class="detail-column before">
        <div class="comparison-label">BEFORE · 개선 전</div>
        <h2>현재 문제점</h2>
        <p class="detail-text">${escapeHtml(proposal.current_problem)}</p>
        ${renderImages(proposal.before_images, "개선 전 사진")}
      </article>
      <article class="detail-column after">
        <div class="comparison-label">AFTER · 개선 후</div>
        <h2>개선방안</h2>
        <p class="detail-text">${escapeHtml(proposal.improvement_plan)}</p>
        ${renderImages(proposal.after_images, "개선 후 사진")}
      </article>
    </section>

    <section class="detail-effect">
      <div><span class="eyebrow">EXPECTED EFFECT</span><h2>기대효과</h2><p>${escapeHtml(proposal.expected_effect)}</p></div>
      <div class="effect-cost"><small>예상 투입비용</small><strong>${formatCurrency(proposal.cost_amount)}</strong></div>
    </section>

    <section class="detail-operations-grid">
      <article class="detail-operation-card timeline-card">
        <div class="section-heading"><div><span class="eyebrow">TIMELINE</span><h2>진행상태 타임라인</h2></div></div>
        <div id="timelineContent" class="proposal-timeline">${renderTimelineRows(buildTimelineFallback(proposal))}</div>
      </article>
      <article class="detail-operation-card proposer-performance-card">
        <div class="section-heading"><div><span class="eyebrow">PERSONAL</span><h2>개인 제안실적</h2></div><button class="button button-ghost button-small" data-route="person/${encodeURIComponent(proposal.proposer_name)}?year=${encodeURIComponent(String(proposal.received_date || "").slice(0,4) || "all")}">전체보기</button></div>
        ${renderProposerMiniPerformance(proposal)}
      </article>
    </section>

    <section class="detail-operation-card approval-progress-card">
      <div class="section-heading"><div><span class="eyebrow">APPROVAL</span><h2>전자결재 진행</h2></div></div>
      <div id="approvalContent">${proposal.approval_required === true ? renderApprovalProgress(state.approvalSteps, []) : `<div class="approval-not-required"><strong>전자결재 대상 아님</strong><p>V2.3 적용 이전 등록 제안은 전자결재·이메일 알림 대상에서 제외됩니다.</p></div>`}</div>
    </section>

    <section class="review-box">
      <div>
        <span class="eyebrow">REVIEW</span>
        <h2>심사 및 실시정보</h2>
      </div>
      <dl>
        <div><dt>시행부서</dt><dd>${escapeHtml(proposal.implementing_department || "-")}</dd></div>
        <div><dt>실시일</dt><dd>${escapeHtml(formatDate(proposal.implemented_date))}</dd></div>
        <div><dt>심사의견</dt><dd>${escapeHtml(proposal.review_comment || "등록된 심사의견이 없습니다.")}</dd></div>
      </dl>
    </section>
  `;
  hydrateDetailOperations(proposal).catch((error) => console.warn("V2 상세정보를 불러오지 못했습니다.", error));
}

function renderTimelineRows(rows) {
  if (!rows?.length) return `<div class="analytics-empty">기록된 진행이력이 없습니다.</div>`;
  return rows.map((row, index) => `
    <div class="timeline-item ${index === rows.length - 1 ? "current" : ""}">
      <span class="timeline-dot"></span>
      <div><strong>${escapeHtml(row.stage || "-")}</strong><small>${escapeHtml(formatDate(String(row.happened_at || row.date || "").slice(0,10)))} · ${escapeHtml(row.actor_name || row.actor || "-")}</small><p>${escapeHtml(row.detail || "")}</p></div>
    </div>`).join("");
}

function renderApprovalProgress(steps, records) {
  if (!steps?.length) return `<div class="analytics-empty">전자결재 단계가 설정되지 않았습니다.</div>`;
  const activeSteps = steps.filter((step) => step.active !== false).sort((a,b)=>Number(a.step_order)-Number(b.step_order));
  const recordMap = new Map((records || []).map((row) => [String(row.step_id), row]));
  const finalStep = activeSteps[activeSteps.length - 1];
  const finalApproved = finalStep ? recordMap.get(String(finalStep.id))?.status === "승인" : false;
  return `<div class="approval-progress">${activeSteps.map((step) => {
    const record = recordMap.get(String(step.id));
    const migratedFinalMissing = !record && finalApproved && step.auto_author !== true;
    const status = migratedFinalMissing ? "승인" : (record?.status || "대기");
    const isAutoAuthor = step.auto_author === true;
    const statusLabel = migratedFinalMissing ? "전환 전 완료" : (isAutoAuthor && status === "승인" ? "작성완료" : status);
    const signer = migratedFinalMissing ? "소급결재 제외" : (record?.approver_name || record?.assigned_name || (isAutoAuthor ? "제안자 자동작성" : "결재자 미지정"));
    return `<div class="approval-step ${status === "승인" ? "approved" : status === "반려" ? "rejected" : "pending"} ${isAutoAuthor ? "auto-author" : ""}"><span>${escapeHtml(String(step.step_order))}</span><div><strong>${escapeHtml(step.role_name)}${isAutoAuthor ? ' <em class="approval-auto-tag">자동작성</em>' : ""}</strong><small>${escapeHtml(statusLabel)} · ${escapeHtml(signer)}</small></div></div>`;
  }).join("")}</div>`;
}

function renderProposerMiniPerformance(proposal) {
  const year = String(proposal.received_date || "").slice(0, 4) || "all";
  const perf = proposerPerformance(state.proposals, proposal.proposer_name, year, proposal.department);
  if (!perf) return `<div class="analytics-empty">개인 실적이 없습니다.</div>`;
  return `<div class="personal-mini-grid"><div><small>${year}년 제안</small><strong>${perf.total}건</strong></div><div><small>채택률</small><strong>${perf.adoptionRate}%</strong></div><div><small>누적점수</small><strong>${perf.totalScore}점</strong></div><div><small>연도 순위</small><strong>${perf.rank}위</strong></div></div>`;
}

async function hydrateDetailOperations(proposal) {
  const [history, approvals] = await Promise.all([
    store.getStatusHistory(proposal.id).catch(() => []),
    store.getApprovalRecords(proposal.id).catch(() => []),
  ]);
  const timelineTarget = $("#timelineContent");
  if (timelineTarget) timelineTarget.innerHTML = renderTimelineRows(history.length ? history : buildTimelineFallback(proposal));
  const approvalTarget = $("#approvalContent");
  if (approvalTarget) approvalTarget.innerHTML = proposal.approval_required === true ? renderApprovalProgress(state.approvalSteps, approvals) : `<div class="approval-not-required"><strong>전자결재 대상 아님</strong><p>V2.3 적용 이전 등록 제안은 전자결재·이메일 알림 대상에서 제외됩니다.</p></div>`;
}

function renderProposerProfile(name) {
  const requested = getDashboardYearFromUrl();
  const report = dashboardBreakdown(state.proposals, requested);
  const year = report.selectedYear;
  const perf = proposerPerformance(state.proposals, name, year);
  const rows = filterProposals(state.proposals, { year: year === "all" ? "all" : year, query: name }).filter((p) => p.proposer_name === name);
  main.innerHTML = `
    <section class="page-header"><div><span class="eyebrow">PROPOSER PROFILE</span><h1>${escapeHtml(name)} 개인 제안실적</h1><p>연도별 제안건수·채택률·점수·포상금·효과금액을 확인합니다.</p></div><button class="button button-ghost" data-route="list">접수현황</button></section>
    <section class="profile-toolbar"><label>조회연도<select id="personYearFilter" data-person="${escapeHtml(name)}"><option value="all" ${year === "all" ? "selected" : ""}>전체 연도</option>${report.years.map((y) => `<option value="${y}" ${year === y ? "selected" : ""}>${y}년</option>`).join("")}</select></label></section>
    ${perf ? `<section class="metric-grid profile-metrics"><div class="metric-card"><div><small>총 제안</small><strong>${perf.total}건</strong></div></div><div class="metric-card"><div><small>채택</small><strong>${perf.adopted}건</strong></div></div><div class="metric-card"><div><small>채택률</small><strong>${perf.adoptionRate}%</strong></div></div><div class="metric-card"><div><small>순위</small><strong>${perf.rank}위</strong></div></div><div class="metric-card"><div><small>누적점수</small><strong>${perf.totalScore}점</strong></div></div><div class="metric-card"><div><small>포상금</small><strong>${formatCurrency(perf.awardTotal)}</strong></div></div><div class="metric-card"><div><small>효과금액</small><strong>${formatCurrency(perf.effectTotal)}</strong></div></div></section>` : `<div class="analytics-empty">선택 기간 실적이 없습니다.</div>`}
    <section class="section"><div class="section-heading"><div><span class="eyebrow">IDEAS</span><h2>${escapeHtml(year === "all" ? "전체 연도" : `${year}년`)} 제안내역</h2></div></div>${rows.length ? `<div class="proposal-grid">${rows.map(proposalCard).join("")}</div>` : `<div class="analytics-empty">제안내역이 없습니다.</div>`}</section>`;
}

function renderPrintImages(images, label) {
  if (!images.length) {
    return `<div class="print-image-empty">${escapeHtml(label)} 미등록</div>`;
  }
  return `
    <div class="print-image-grid ${images.length === 1 ? "single" : ""}">
      ${images.map((url, index) => `
        <figure class="print-image-item">
          <img src="${escapeHtml(url)}" alt="${escapeHtml(label)} ${index + 1}">
          <figcaption>${escapeHtml(label)} ${index + 1}</figcaption>
        </figure>`).join("")}
    </div>`;
}

function renderPrint(proposalNo) {
  const proposal = state.proposals.find((item) => item.proposal_no === proposalNo);
  if (!proposal) {
    main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="list">목록으로</button></div>`;
    return;
  }

  const model = buildPrintModel(proposal);
  const printSteps = state.approvalSteps.filter((step) => step.active !== false).slice(0, 5);
  const printRoles = printSteps.length ? printSteps.map((step) => step.role_name) : PRINT_APPROVAL_ROLES;
  const approvalCells = printRoles.map((role) => `
    <th>${escapeHtml(role)}</th>`).join("");
  const approvalSignatures = printRoles.map((_, index) => `<td data-print-approval-index="${index}"></td>`).join("");
  const categoryMark = (checked) => `<span class="print-checkbox ${checked ? "checked" : ""}">${checked ? "✓" : ""}</span>`;

  main.innerHTML = `
    <section class="proposal-print-screen">
      <div class="print-toolbar">
        <div>
          <strong>${escapeHtml(model.proposalNo)} 제안서 인쇄</strong>
          <span>내용이 길거나 사진이 많으면 다음 페이지로 자연스럽게 이어집니다.</span>
        </div>
        <div class="print-toolbar-actions">
          <button class="button button-ghost" data-route="detail/${escapeHtml(model.proposalNo)}">상세화면</button>
          <button class="button button-primary" data-action="trigger-print">인쇄 / PDF 저장</button>
        </div>
      </div>

      <article class="proposal-print-document">
        <div class="print-form-reference">[별지 제 1 호] 제안서</div>
        <header class="print-document-header">
          <div class="print-logo-cell"><img src="./assets/hana-metal-logo.png" alt="HANA METAL"></div>
          <h1>제 안 서</h1>
          <table class="print-approval-table" aria-label="결재란">
            <tbody>
              <tr><td class="approval-side" rowspan="2">결<br>재</td>${approvalCells}</tr>
              <tr>${approvalSignatures}</tr>
            </tbody>
          </table>
        </header>

        <table class="print-info-table">
          <tbody>
            <tr><th>제 목</th><td colspan="3" class="print-title-cell">${escapeHtml(model.title)}</td></tr>
            <tr><th>제 안 일</th><td>${escapeHtml(model.proposalDate)}</td><th>접수번호</th><td>${escapeHtml(model.proposalNo)}</td></tr>
            <tr><th>제 안 자</th><td>${escapeHtml(model.proposerName)} (${escapeHtml(model.department)})</td><th>심사결과</th><td>${escapeHtml(model.reviewResult)}</td></tr>
            <tr><th>시행부서</th><td>${escapeHtml(model.implementingDepartment)}</td><th>제안점수</th><td>${escapeHtml(model.scoreText)}</td></tr>
            <tr><th>실시일/예정일</th><td>${escapeHtml(model.implementedDate)}</td><th>실시여부</th><td>${escapeHtml(model.implementationStatus)}</td></tr>
          </tbody>
        </table>

        <section class="print-category-section">
          <div class="print-category-label">제안<br>분류</div>
          <div class="print-category-content">
            <div class="print-category-line">
              <strong>${categoryMark(model.categoryImprovement)} 개선</strong>
              <span>1. 아이디어　2. 코스트　3. 에너지 절약　4. 품질　5. 관리　6. 작업　7. 기계　8. 공구　9. 환경　10. 설계　11. 인테리어　12. 서비스　13. 고객　14. 작품출원　15. 기타</span>
            </div>
            <div class="print-category-line">
              <strong>${categoryMark(model.categorySafety)} 안전</strong>
              <span>1. 안전</span>
            </div>
          </div>
        </section>

        <section class="print-comparison-section">
          <article class="print-comparison-column">
            <div class="print-section-label">현재의 방법(문제점)</div>
            <h2>개선 전</h2>
            <div class="print-long-text">${escapeHtml(model.currentProblem)}</div>
            ${renderPrintImages(model.beforeImages, "개선 전 사진")}
          </article>
          <article class="print-comparison-column">
            <div class="print-section-label">개 선 책</div>
            <h2>개선 후</h2>
            <div class="print-long-text">${escapeHtml(model.improvementPlan)}</div>
            ${renderPrintImages(model.afterImages, "개선 후 사진")}
          </article>
        </section>

        <section class="print-effect-section print-page-break-candidate">
          <div class="print-section-label">개선효과</div>
          <div class="print-long-text">${escapeHtml(model.expectedEffect)}</div>
          <dl class="print-money-grid">
            <div><dt>예상 투입비용</dt><dd>${escapeHtml(model.costText)}</dd></div>
            <div><dt>포상금</dt><dd>${escapeHtml(model.awardText)}</dd></div>
            <div><dt>효과금액</dt><dd>${escapeHtml(model.effectText)}</dd></div>
            <div><dt>지급상태</dt><dd>${escapeHtml(model.paymentStatus)}</dd></div>
          </dl>
        </section>

        <section class="print-review-section">
          <div class="print-section-label">심사평가 (검토 의견)</div>
          <div class="print-review-meta">
            <span>업무상태: <strong>${escapeHtml(model.workflowStatus)}</strong></span>
            <span>심사결과: <strong>${escapeHtml(model.reviewResult)}</strong></span>
            <span>실시상태: <strong>${escapeHtml(model.implementationStatus)}</strong></span>
          </div>
          <div class="print-long-text review-text">${escapeHtml(model.reviewComment)}</div>
        </section>

        <footer class="print-document-footer">
          <img src="./assets/hana-metal-logo.png" alt="HANA METAL">
          <span>${escapeHtml(model.proposalNo)}</span>
        </footer>
      </article>
    </section>`;
  hydratePrintApproval(proposal, printSteps).catch(() => {});
}

async function hydratePrintApproval(proposal, steps) {
  if (!steps?.length) return;
  const records = await store.getApprovalRecords(proposal.id).catch(() => []);
  const recordMap = new Map(records.map((row) => [String(row.step_id), row]));
  const finalStep = steps[steps.length - 1];
  const finalApproved = finalStep ? recordMap.get(String(finalStep.id))?.status === "승인" : false;
  steps.forEach((step, index) => {
    const cell = document.querySelector(`[data-print-approval-index="${index}"]`);
    if (!cell) return;
    const record = recordMap.get(String(step.id));
    const migratedFinalMissing = !record && finalApproved && step.auto_author !== true;
    if (migratedFinalMissing) {
      cell.innerHTML = `<strong>전환 전 완료</strong><small>소급결재 제외</small><em>V2.3.5 적용 전 최종승인</em>`;
    } else if (!record || record.status === "대기") {
      cell.innerHTML = step.auto_author === true
        ? `<span class="print-approval-pending">자동작성 대기</span>`
        : `<span class="print-approval-pending">대기</span>`;
    } else if (step.auto_author === true) {
      cell.innerHTML = `<strong>작성완료</strong><small>${escapeHtml(record.approver_name || proposal.proposer_name || "")}</small><em>전자작성 · ${escapeHtml(record.acted_at ? formatDate(String(record.acted_at).slice(0,10)) : formatDate(proposal.received_date))}</em>`;
    } else {
      cell.innerHTML = `<strong>${escapeHtml(record.status)}</strong><small>${escapeHtml(record.approver_name || "")}</small><em>${escapeHtml(record.acted_at ? formatDate(String(record.acted_at).slice(0,10)) : "")}</em>`;
    }
  });
}

function renderManagementReport() {
  const requested = getDashboardYearFromUrl();
  const annualReport = dashboardBreakdown(state.proposals, requested);
  const year = annualReport.selectedYear;
  const month = year === "all" ? "" : getReportMonthFromUrl();
  const scoped = filterProposals(state.proposals, { year, month });
  const scopedBreakdown = dashboardBreakdown(scoped, "all");
  const metrics = dashboardMetrics(scoped);
  const operations = operationalMetrics(scoped);
  const effects = effectAnalysis(scoped);
  const goals = departmentGoalProgress(state.proposals, state.departmentGoals, year);
  const top10 = topProposals(scoped, "all", "score", 10);
  const label = year === "all" ? "전체 연도" : month ? `${year}년 ${Number(month)}월` : `${year}년`;
  const monthlyRows = month
    ? annualReport.monthly.filter((row) => Number(row.key) === Number(month))
    : annualReport.monthly;
  const departmentRows = scopedBreakdown.departments;

  main.innerHTML = `
    <section class="proposal-print-screen management-report-screen">
      <div class="print-toolbar">
        <div><strong>월간/연간 운영보고서</strong><span>${escapeHtml(label)} 제안제도 운영실적</span></div>
        <div class="report-filter-controls">
          <label>조회연도<select id="reportYearFilter"><option value="all" ${year === "all" ? "selected" : ""}>전체 연도</option>${annualReport.years.map((y) => `<option value="${y}" ${year === y ? "selected" : ""}>${y}년</option>`).join("")}</select></label>
          <label>조회월<select id="reportMonthFilter" ${year === "all" ? "disabled" : ""}><option value="" ${!month ? "selected" : ""}>연간 전체</option>${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}" ${Number(month) === index + 1 ? "selected" : ""}>${index + 1}월</option>`).join("")}</select></label>
        </div>
        <div class="print-toolbar-actions">
          <button class="button button-ghost" data-route="dashboard?year=${encodeURIComponent(year)}">대시보드</button>
          <button class="button button-ghost" data-action="export-report-csv" data-year="${escapeHtml(year)}" data-month="${escapeHtml(month)}">CSV 저장</button>
          <button class="button button-primary" data-action="trigger-print">인쇄 / PDF 저장</button>
        </div>
      </div>
      <article class="management-report-document">
        <header class="management-report-header"><img src="./assets/hana-metal-logo.png" alt="HANA METAL"><div><span>제안제도 운영보고</span><h1>${escapeHtml(label)} 제안관리 현황</h1><p>출력일 ${escapeHtml(new Date().toLocaleDateString("ko-KR"))}</p></div></header>
        <section class="report-kpi-grid">
          <div><small>전체 제안</small><strong>${metrics.total}건</strong></div><div><small>심사 대기</small><strong>${metrics.pending}건</strong></div><div><small>채택</small><strong>${metrics.adopted}건</strong></div><div><small>실시 완료</small><strong>${metrics.completed}건</strong></div>
          <div><small>장기 미심사</small><strong>${operations.overdueReview}건</strong></div><div><small>시행 지연</small><strong>${operations.overdueImplementation}건</strong></div><div><small>포상금</small><strong>${formatCurrency(scopedBreakdown.totals.awardTotal)}</strong></div><div><small>효과금액</small><strong>${formatCurrency(scopedBreakdown.totals.effectTotal)}</strong></div>
        </section>
        <section class="report-value-summary"><div><small>투입비용</small><strong>${formatCurrency(effects.costTotal)}</strong></div><div><small>포상금</small><strong>${formatCurrency(effects.awardTotal)}</strong></div><div><small>순효과</small><strong>${formatCurrency(effects.netEffect)}</strong></div><div><small>ROI</small><strong>${effects.roi.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%</strong></div></section>
        <section class="report-section"><h2>${month ? `${Number(month)}월 제안실적` : "월별 제안실적"}</h2>${analyticsTable(monthlyRows, "월")}</section>
        <section class="report-section"><h2>부서별 제안실적</h2>${analyticsTable(departmentRows, "부서")}</section>
        <section class="report-section"><h2>부서 목표달성률</h2>${year === "all" ? `<p>연도 선택 시 목표달성률이 표시됩니다.</p>` : month ? `<p>부서 목표는 연간 목표입니다. 연간 전체를 선택하면 목표달성률을 확인할 수 있습니다.</p>` : goals.length ? `<table class="analytics-table"><thead><tr><th>부서</th><th>목표</th><th>실적</th><th>달성률</th></tr></thead><tbody>${goals.map(row=>`<tr><td>${escapeHtml(row.department)}</td><td>${row.goal}건</td><td>${row.actual}건</td><td>${row.rate}%</td></tr>`).join("")}</tbody></table>` : `<p>등록된 목표가 없습니다.</p>`}</section>
        <section class="report-section"><h2>우수제안 TOP 10</h2>${top10.length ? `<table class="analytics-table"><thead><tr><th>순위</th><th>접수번호</th><th>제안명</th><th>제안자</th><th>부서</th><th>점수</th><th>효과금액</th></tr></thead><tbody>${top10.map((proposal,index)=>`<tr><td>${index+1}</td><td>${escapeHtml(proposal.proposal_no)}</td><td>${escapeHtml(proposal.title)}</td><td>${escapeHtml(proposal.proposer_name)}</td><td>${escapeHtml(proposal.department)}</td><td>${Number(proposal.score||0)}점</td><td>${formatCurrency(proposal.effect_amount)}</td></tr>`).join("")}</tbody></table>` : `<p>점수 등록 제안이 없습니다.</p>`}</section>
      </article>
    </section>`;
}

function adminNav(active = "proposals") {
  if (!state.admin?.isSystemAdmin) {
    return `<nav class="admin-subnav"><button class="${active === "inbox" ? "active" : ""}" data-route="admin/inbox">내 결재함${actionableApprovalCount() ? ` <span class="approval-inbox-badge inline">${actionableApprovalCount()}</span>` : ""}</button></nav>`;
  }
  return `<nav class="admin-subnav">
    <button class="${active === "proposals" ? "active" : ""}" data-route="admin">제안 심사</button>
    <button class="${active === "inbox" ? "active" : ""}" data-route="admin/inbox">내 결재함${actionableApprovalCount() ? ` <span class="approval-inbox-badge inline">${actionableApprovalCount()}</span>` : ""}</button>
    <button class="${active === "goals" ? "active" : ""}" data-route="admin/goals">부서 목표관리</button>
    <button class="${active === "approvals" ? "active" : ""}" data-route="admin/approvals">전자결재 설정</button>
    <button class="${active === "notifications" ? "active" : ""}" data-route="admin/notifications">메일알림</button>
    <button class="${active === "audit" ? "active" : ""}" data-route="admin/audit">관리자 변경이력</button>
  </nav>`;
}

function adminPageHeader(title, description, active) {
  const accountLabel = state.admin?.isSystemAdmin ? "SYSTEM ADMIN" : "APPROVER";
  return `<section class="page-header"><div><span class="eyebrow">${accountLabel}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="header-buttons"><button class="button button-secondary" data-action="logout-admin">로그아웃</button></div></section>${adminNav(active)}`;
}

function renderAdminGoals() {
  const years = dashboardBreakdown(state.proposals, "all").years;
  const selectedYear = getDashboardYearFromUrl() === "all" ? String(new Date().getFullYear()) : (getDashboardYearFromUrl() || years[0] || String(new Date().getFullYear()));
  const departments = [...new Set(state.employees.map((e) => e.department).concat(state.proposals.map((p) => p.department)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
  const rows = state.departmentGoals.filter((row) => String(row.year) === String(selectedYear));
  main.innerHTML = `${adminPageHeader("부서 목표관리", "연도별 부서 제안 목표를 설정하고 대시보드 달성률에 반영합니다.", "goals")}
    <section class="admin-config-grid">
      <form id="departmentGoalForm" class="side-card admin-config-form">
        <span class="eyebrow">GOAL SETTING</span><h2>목표 등록·수정</h2>
        <label class="field">연도<input type="number" name="year" min="2000" max="2100" value="${escapeHtml(selectedYear)}" required></label>
        <label class="field">부서<select name="department" required><option value="">부서 선택</option>${departments.map(d=>`<option>${escapeHtml(d)}</option>`).join("")}</select></label>
        <label class="field">연간 목표건수<input type="number" name="annual_goal" min="0" value="0" required></label>
        <label class="field">비고<input name="note" maxlength="120" placeholder="예: 부서원 1인 2건"></label>
        <button class="button button-primary button-wide" type="submit">목표 저장</button>
      </form>
      <article class="analytics-panel admin-config-list"><div class="analytics-panel-head"><div><span class="eyebrow">${escapeHtml(selectedYear)}</span><h2>등록된 부서 목표</h2></div><label>조회연도<select id="adminGoalYearFilter">${years.map(y=>`<option value="${y}" ${String(y)===String(selectedYear)?"selected":""}>${y}년</option>`).join("")}</select></label></div>
        ${rows.length ? `<div class="goal-admin-list">${rows.map(row=>`<button type="button" class="goal-admin-row" data-action="edit-goal" data-year="${row.year}" data-department="${escapeHtml(row.department)}" data-goal="${row.annual_goal}" data-note="${escapeHtml(row.note||"")}"><strong>${escapeHtml(row.department)}</strong><span>${row.annual_goal}건</span><small>${escapeHtml(row.note||"")}</small></button>`).join("")}</div>` : `<div class="analytics-empty">해당 연도 목표가 없습니다.</div>`}
      </article>
    </section>`;
}

function renderAdminApprovals() {
  const steps = state.approvalSteps;
  const departments = [...new Set(state.employees.map((e) => e.department).concat(state.proposals.map((p) => p.department)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ko"));
  const stepMap = new Map(steps.map((step) => [String(step.id), step]));
  const assignments = state.approverAssignments || [];
  const manualSteps = steps.filter((step) => step.active !== false && step.auto_author !== true);
  main.innerHTML = `${adminPageHeader("전자결재 설정", "담당은 자동작성되고, 신규 제안만 부서장 → 해당부서 임원 → 주관부서 → 대표이사 순서로 전자서명합니다.", "approvals")}
    <section class="approval-security-notice">
      <strong>V2.3.5 결재방식</strong><span>① 담당: 제안 제출 즉시 자동작성 · ② 부서장/해당부서 임원: 제안 부서별 계정 연결 · ③ 주관부서/대표이사: 전체 부서 공통 계정 연결 · ④ V2.3 적용 이후 신규 제안만 결재대상 · ⑤ 각 결재자는 본인 단계만 승인·반려</span>
    </section>
    <section class="admin-config-grid">
      <form id="approvalStepForm" class="side-card admin-config-form">
        <span class="eyebrow">APPROVAL FLOW</span><h2>전자서명 단계 등록·수정</h2>
        <p class="form-help">담당 자동작성 단계는 시스템 필수단계이므로 수정·삭제할 수 없습니다. 아래 입력폼은 부서장 이후의 실제 전자서명 단계 관리용입니다.</p>
        <input type="hidden" name="id">
        <label class="field">순서<input type="number" name="step_order" min="2" required></label>
        <label class="field">직책/단계명<input name="role_name" maxlength="50" required placeholder="예: 부서장"></label>
        <label class="field">설명<input name="description" maxlength="150" placeholder="확인내용"></label>
        <label class="check-label"><input type="checkbox" name="active" checked> 사용</label>
        <button class="button button-primary button-wide" type="submit">결재단계 저장</button>
      </form>
      <article class="analytics-panel admin-config-list"><div class="analytics-panel-head"><div><span class="eyebrow">WORKFLOW</span><h2>현재 결재선</h2></div></div>
        <div class="approval-admin-list">${steps.length ? steps.map(step=>step.auto_author === true
          ? `<div class="approval-admin-row approval-auto-row"><b>${step.step_order}</b><span><strong>${escapeHtml(step.role_name)}</strong><small>${escapeHtml(step.description||"제안 제출 시 자동작성")}</small></span><em class="approval-auto-badge">자동작성</em></div>`
          : `<button type="button" class="approval-admin-row" data-action="edit-approval-step" data-id="${step.id}" data-order="${step.step_order}" data-role="${escapeHtml(step.role_name)}" data-description="${escapeHtml(step.description||"")}" data-active="${step.active !== false}"><b>${step.step_order}</b><span><strong>${escapeHtml(step.role_name)}</strong><small>${escapeHtml(step.description||"")}</small></span>${statusBadge(step.active !== false ? "완료" : "미실시")}</button>`).join("") : `<div class="analytics-empty">등록된 결재단계가 없습니다.</div>`}</div>
      </article>
    </section>

    <section class="admin-config-grid approver-assignment-grid">
      <form id="approverAssignmentForm" class="side-card admin-config-form approver-assignment-form">
        <span class="eyebrow">SIGNER ACCOUNT</span><h2>실제 결재자 계정 연결</h2>
        <label class="field">결재자 이메일<input type="email" name="approver_email" required placeholder="Supabase Auth에 생성한 이메일"></label>
        <label class="field">결재자 이름<input name="display_name" maxlength="50" required placeholder="예: 홍길동"></label>
        <label class="field">본인 결재단계<select name="step_id" required><option value="">단계 선택</option>${manualSteps.map(step=>`<option value="${step.id}">${step.step_order}. ${escapeHtml(step.role_name)}</option>`).join("")}</select></label>
        <label class="field">적용부서<select name="department"><option value="">전체 부서</option>${departments.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}</select></label>
        <small class="form-help">담당은 계정 연결 대상이 아닙니다. 부서장·해당부서 임원은 해당 부서를 지정하고, 주관부서·대표이사는 전체 부서를 선택하세요.</small>
        <button class="button button-primary button-wide" type="submit">결재자 연결</button>
      </form>
      <article class="analytics-panel admin-config-list approver-assignment-list"><div class="analytics-panel-head"><div><span class="eyebrow">ASSIGNMENTS</span><h2>지정된 결재자</h2></div></div>
        ${assignments.length ? `<div class="approver-assignment-rows">${assignments.map(row=>{const step=stepMap.get(String(row.step_id)); return `<div class="approver-assignment-row"><div><strong>${escapeHtml(row.display_name)}</strong><small>${escapeHtml(row.email)}</small></div><span>${escapeHtml(step?.role_name||"결재단계")}</span><em>${escapeHtml(row.department||"전체 부서")}</em><button type="button" class="button button-small button-danger" data-action="remove-approver-assignment" data-id="${row.id}">배정 해제</button></div>`;}).join("")}</div>` : `<div class="analytics-empty">아직 지정된 실제 결재자가 없습니다.</div>`}
      </article>
    </section>`;
}

async function renderApproverInbox() {
  main.innerHTML = `${adminPageHeader("내 결재함", "본인 계정에 지정된 결재만 표시됩니다. 이전 단계가 승인되어야 다음 단계가 활성화됩니다.", "inbox")}<div class="loading-card"><div class="spinner"></div><p>결재함을 불러오는 중입니다.</p></div>`;
  try {
    const rows = await store.getMyApprovalInbox();
    const body = rows.length ? `<div class="approver-inbox">${rows.map(row=>{ const days=Number(row.pending_days||0); const delay=days>=7?"장기 미결재":days>=3?"결재 지연":days>=1?"결재 필요":"신규 결재"; return `<article class="approver-inbox-card ${row.can_act ? "actionable" : "blocked"} overdue-${Number(row.overdue_level||0)}"><div><span class="eyebrow">${escapeHtml(row.role_name)} · ${escapeHtml(row.department)}</span><h3>${escapeHtml(row.proposal_no)} · ${escapeHtml(row.title)}</h3><p>${escapeHtml(row.proposer_name)} · ${escapeHtml(formatDate(row.received_date))}</p></div><div class="approver-inbox-state"><span class="approval-delay-label">${escapeHtml(delay)}${row.can_act ? ` · ${days}일` : ""}</span>${statusBadge(row.approval_status)}<small>${escapeHtml(row.block_reason||"")}</small><button class="button ${row.can_act ? "button-primary" : "button-secondary"}" data-route="admin/review/${escapeHtml(row.proposal_id)}">${row.can_act ? "결재 검토" : "내용 보기"}</button></div></article>`;}).join("")}</div>` : `<div class="empty-state"><h2>현재 결재 대기 건이 없습니다.</h2><p>V2.3 적용 이후 신규 제안 중 본인 순서가 된 건만 표시됩니다.</p></div>`;
    main.innerHTML = `${adminPageHeader("내 결재함", "본인 계정에 지정된 결재만 표시됩니다. 이전 단계가 승인되어야 다음 단계가 활성화됩니다.", "inbox")}<section class="section"><div class="section-heading"><div><span class="eyebrow">MY APPROVALS</span><h2>결재 대상</h2></div></div>${body}</section>`;
  } catch (error) {
    main.innerHTML = `${adminPageHeader("내 결재함", "V2.1 전자결재 SQL 적용 후 사용할 수 있습니다.", "inbox")}<div class="empty-state"><h2>결재함을 불러오지 못했습니다.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function renderApprovalAction(permission, proposalId) {
  if (!permission?.assigned) return `<div class="approval-permission blocked"><strong>서명 권한 없음</strong><p>${escapeHtml(permission?.reason || "이 제안에 지정된 본인 결재단계가 없습니다.")}</p></div>`;
  if (!permission.canAct) return `<div class="approval-permission waiting"><strong>본인 결재단계: ${escapeHtml(permission.step.role_name)}</strong><p>${escapeHtml(permission.reason)}</p></div>`;
  return `<div id="approvalActionForm" data-proposal-id="${escapeHtml(proposalId)}" data-step-id="${permission.step.id}" class="approval-action-form secure-approval-action">
    <div class="approval-own-step"><small>본인 결재단계</small><strong>${permission.step.step_order}. ${escapeHtml(permission.step.role_name)}</strong><span>${escapeHtml(permission.assignment?.department || "전체 부서")}</span></div>
    <label class="field">처리<select name="approval_status"><option value="승인">승인</option><option value="반려">반려</option></select></label>
    <label class="field approval-comment">의견<input name="comment" placeholder="결재의견"></label>
    <button class="button button-primary" type="button" data-action="save-approval-action">본인 전자서명 저장</button>
  </div>`;
}

async function renderApproverReview(id) {
  const proposal = state.proposals.find((item) => item.id === id);
  if (!proposal) { main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="admin/inbox">내 결재함${actionableApprovalCount() ? ` <span class="approval-inbox-badge inline">${actionableApprovalCount()}</span>` : ""}</button></div>`; return; }
  const records = await store.getApprovalRecords(proposal.id).catch(() => []);
  const permission = resolveApprovalPermission(proposal, state.approvalSteps, records, state.admin?.assignments || []);
  main.innerHTML = `${adminPageHeader("전자결재 검토", "제안내용을 확인한 뒤 본인에게 지정된 단계만 승인 또는 반려할 수 있습니다.", "inbox")}
    <section class="approver-review-layout">
      <article class="admin-review-preview approver-readonly-preview"><div class="review-preview-head"><div><strong>${escapeHtml(proposal.proposer_name)}</strong><span>${escapeHtml(proposal.department)} · ${escapeHtml(proposal.category)}제안</span></div>${statusBadge(proposal.review_result)}</div><h1>${escapeHtml(proposal.proposal_no)} · ${escapeHtml(proposal.title)}</h1><h2>현재 문제점</h2><p>${escapeHtml(proposal.current_problem)}</p><h2>개선방안</h2><p>${escapeHtml(proposal.improvement_plan)}</p><h2>기대효과</h2><p>${escapeHtml(proposal.expected_effect)}</p><div class="admin-image-pair"><div><strong>개선 전</strong>${renderImages(proposal.before_images, "개선 전 사진")}</div><div><strong>개선 후</strong>${renderImages(proposal.after_images, "개선 후 사진")}</div></div></article>
      <aside class="approver-review-side"><section class="side-card"><span class="eyebrow">APPROVAL STATUS</span><h2>전자결재 진행</h2>${renderApprovalProgress(state.approvalSteps, records)}</section><section class="side-card"><span class="eyebrow">MY SIGNATURE</span><h2>본인 결재</h2>${renderApprovalAction(permission, proposal.id)}</section></aside>
    </section>`;
}

async function renderAdminNotifications() {
  if (!state.admin?.isSystemAdmin) { renderAdminInbox(); return; }
  main.innerHTML = `${adminPageHeader("메일알림", "결재 요청 이메일의 전송 성공·실패를 확인하고 실패 건을 재전송합니다.", "notifications")}<div class="loading-card"><div class="spinner"></div><p>메일 발송기록을 불러오는 중입니다.</p></div>`;
  try {
    const logs = await store.getNotificationLogs(150);
    const rows = logs.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>일시</th><th>제안</th><th>단계</th><th>수신자</th><th>유형</th><th>상태</th><th>처리</th></tr></thead><tbody>${logs.map(row=>`<tr><td>${escapeHtml(new Date(row.created_at).toLocaleString("ko-KR"))}</td><td>${escapeHtml(row.proposals?.proposal_no||"-")}<br><small>${escapeHtml(row.proposals?.title||"")}</small></td><td>${escapeHtml(row.approval_steps?.role_name||"-")}</td><td>${escapeHtml(row.recipient_name||"")}<br><small>${escapeHtml(row.recipient_email||"")}</small></td><td>${escapeHtml(row.notification_type||"")}</td><td>${statusBadge(row.status === "sent" ? "완료" : row.status === "failed" ? "보류" : "진행중")}<br><small>${escapeHtml(row.last_error||"")}</small></td><td>${row.status === "failed" ? `<button class="button button-small button-primary" data-action="retry-notification" data-id="${row.id}">재전송</button>` : "-"}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><h2>메일 발송기록이 없습니다.</h2><p>V2.3 이후 신규 제안이 결재대상으로 등록되면 이곳에 기록됩니다.</p></div>`;
    main.innerHTML = `${adminPageHeader("메일알림", "결재 요청 이메일의 전송 성공·실패를 확인하고 실패 건을 재전송합니다.", "notifications")}<section class="section"><div class="section-heading"><div><span class="eyebrow">EMAIL LOG</span><h2>최근 발송 150건</h2></div></div>${rows}</section>`;
  } catch (error) {
    main.innerHTML = `${adminPageHeader("메일알림", "V2.3 SQL과 Edge Function 적용 후 사용할 수 있습니다.", "notifications")}<div class="empty-state"><h2>메일 발송기록을 불러오지 못했습니다.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function renderAdminAudit() {
  main.innerHTML = `${adminPageHeader("관리자 변경이력", "심사결과·점수·포상금·실시상태·삭제 등 관리자 변경사항을 확인합니다.", "audit")}<div class="loading-card"><div class="spinner"></div><p>변경이력을 불러오는 중입니다.</p></div>`;
  try {
    const logs = await store.getAuditLogs(300);
    const fieldLabels = { status:"업무상태", review_result:"심사결과", implementing_department:"시행부서", implementation_status:"실시상태", implemented_date:"실시일", score:"점수", award_grade:"포상등급", award_amount:"포상금", payment_status:"지급상태", effect_amount:"효과금액", review_comment:"심사의견", title:"제안명", current_problem:"현재 문제점", improvement_plan:"개선방안", expected_effect:"기대효과", cost_amount:"투입비용", __deleted__:"제안 삭제" };
    const content = logs.length ? `<div class="admin-table-wrap"><table class="admin-table audit-table"><thead><tr><th>일시</th><th>관리자</th><th>제안번호</th><th>항목</th><th>변경 전</th><th>변경 후</th></tr></thead><tbody>${logs.map(log=>`<tr><td>${escapeHtml(new Date(log.created_at).toLocaleString("ko-KR"))}</td><td>${escapeHtml(log.actor_name||"-")}</td><td>${escapeHtml(log.proposal_no)}</td><td><strong>${escapeHtml(fieldLabels[log.field_name]||log.field_name)}</strong></td><td>${escapeHtml(displayAuditValue(log.old_value))}</td><td>${escapeHtml(displayAuditValue(log.new_value))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="analytics-empty">변경이력이 없습니다.</div>`;
    main.innerHTML = `${adminPageHeader("관리자 변경이력", "심사결과·점수·포상금·실시상태·삭제 등 관리자 변경사항을 확인합니다.", "audit")}<section class="section"><div class="section-heading"><div><span class="eyebrow">AUDIT TRAIL</span><h2>최근 300건</h2></div></div>${content}</section>`;
  } catch (error) {
    main.innerHTML = `${adminPageHeader("관리자 변경이력", "Supabase V2 SQL 적용 후 사용할 수 있습니다.", "audit")}<div class="empty-state"><h2>변경이력을 불러오지 못했습니다.</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function displayAuditValue(value) {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const rendered = JSON.stringify(value);
    return rendered.length > 120 ? `${rendered.slice(0,117)}...` : rendered;
  } catch { return String(value); }
}

function renderAdmin(action = "", id = "") {
  if (!state.admin) {
    main.innerHTML = `
      <section class="admin-login-wrap">
        <form id="adminLoginForm" class="admin-login">
          <span class="admin-lock">🔐</span>
          <span class="eyebrow">ADMIN · APPROVER</span>
          <h1>관리자·결재자 로그인</h1>
          <p>시스템 관리자는 설정/심사업무를, 지정 결재자는 본인 결재단계만 처리합니다.</p>
          <label class="field">이메일<input type="email" name="email" required autocomplete="username" value="${store.mode === "demo" ? "admin@demo.local" : ""}"></label>
          <label class="field">비밀번호<input type="password" name="password" required autocomplete="current-password" value="${store.mode === "demo" ? "admin1234" : ""}"></label>
          <button class="button button-primary button-wide" type="submit">로그인</button>
          ${store.mode === "demo" ? `<small class="demo-help">데모 계정: admin@demo.local / admin1234</small>` : ""}
        </form>
      </section>`;
    return;
  }

  if (!state.admin.isSystemAdmin) {
    if (action === "review") { void renderApproverReview(id); return; }
    void renderApproverInbox();
    return;
  }

  if (action === "edit") { renderAdminEdit(id); return; }
  if (action === "review") { void renderApproverReview(id); return; }
  if (action === "inbox") { void renderApproverInbox(); return; }
  if (action === "goals") { renderAdminGoals(); return; }
  if (action === "approvals") { renderAdminApprovals(); return; }
  if (action === "notifications") { void renderAdminNotifications(); return; }
  if (action === "audit") { void renderAdminAudit(); return; }

  const metrics = dashboardMetrics(state.proposals);
  const proposals = filterProposals(state.proposals);
  main.innerHTML = `
    <section class="page-header">
      <div><span class="eyebrow">ADMIN CONSOLE</span><h1>제안관리 관리자</h1><p>${escapeHtml(state.admin.displayName || state.admin.email)} 로그인 중 · 관리자 작업만 수정권한이 있습니다.</p></div>
      <div class="header-buttons">
        <button class="button button-ghost" data-action="export-csv">CSV 내보내기</button>
        <button class="button button-secondary" data-action="logout-admin">로그아웃</button>
      </div>
    </section>
    ${adminNav("proposals")}

    <section class="metric-grid admin-metrics approval-admin-summary">
      <div class="metric-card"><span class="metric-icon">✅</span><div><small>현재 결재대기</small><strong>${Number(state.approvalOverdueSummary.pending_total || 0)}건</strong></div></div>
      <div class="metric-card"><span class="metric-icon">⚠️</span><div><small>결재 지연 3일+</small><strong>${Number(state.approvalOverdueSummary.overdue_3 || 0)}건</strong></div></div>
      <div class="metric-card"><span class="metric-icon">🚨</span><div><small>장기 미결재 7일+</small><strong>${Number(state.approvalOverdueSummary.overdue_7 || 0)}건</strong></div></div>
    </section>

    <section class="metric-grid admin-metrics">
      <div class="metric-card"><span class="metric-icon">💡</span><div><small>전체</small><strong>${metrics.total}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">🕒</span><div><small>심사 대기</small><strong>${metrics.pending}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">💰</span><div><small>포상금</small><strong class="metric-money">${formatCurrency(metrics.awardTotal)}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">📈</span><div><small>효과금액</small><strong class="metric-money">${formatCurrency(metrics.effectTotal)}</strong></div></div>
    </section>

    <section class="admin-layout">
      <div class="admin-main">
        <div class="section-heading"><div><span class="eyebrow">REVIEW QUEUE</span><h2>접수·심사 관리</h2></div></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>접수번호</th><th>제안명</th><th>제안자</th><th>심사상태</th><th>결과</th><th>실시</th><th></th></tr></thead>
            <tbody>
              ${proposals.map((p) => `
                <tr>
                  <td><strong>${escapeHtml(p.proposal_no)}</strong><small>${escapeHtml(formatDate(p.received_date))}</small></td>
                  <td><button class="table-title" data-action="detail" data-no="${escapeHtml(p.proposal_no)}">${escapeHtml(p.title)}</button></td>
                  <td>${escapeHtml(p.proposer_name)}<small>${escapeHtml(p.department)}</small></td>
                  <td>${statusBadge(p.status)}</td>
                  <td>${statusBadge(p.review_result)}</td>
                  <td>${statusBadge(p.implementation_status)}</td>
                  <td><button class="button button-small button-primary" data-route="admin/edit/${escapeHtml(p.id)}">심사</button></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <aside class="admin-side">
        <section class="side-card">
          <span class="eyebrow">EMPLOYEE MASTER</span>
          <h2>직원명단 엑셀 업로드</h2>
          <p>첫 번째 시트에서 ‘성명/이름/직원명’과 ‘부서/소속’ 열을 자동 인식합니다.</p>
          <label class="upload-box compact-upload">
            <input id="employeeFile" type="file" accept=".xlsx,.xls,.csv">
            <span>직원명단 파일 선택</span>
          </label>
          <button class="button button-primary button-wide" data-action="import-employees">직원명단 반영</button>
          <small>현재 활성 직원 ${state.employees.length}명</small>
        </section>
        ${store.mode === "demo" ? `
        <section class="side-card danger-card">
          <span class="eyebrow">DEMO RESET</span>
          <h2>데모 데이터 초기화</h2>
          <p>테스트로 등록한 제안과 직원명단을 최초 상태로 되돌립니다.</p>
          <button class="button button-danger button-wide" data-action="reset-demo">초기화</button>
        </section>` : ""}
      </aside>
    </section>
  `;
}

function renderAdminEdit(id) {
  const proposal = state.proposals.find((item) => item.id === id);
  if (!proposal) {
    main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="admin">관리자 목록</button></div>`;
    return;
  }

  main.innerHTML = `
    <section class="page-header">
      <div><button class="back-link" data-route="admin">← 관리자 목록</button><span class="eyebrow">ADMIN REVIEW</span><h1>${escapeHtml(proposal.proposal_no)} 심사</h1><p>${escapeHtml(proposal.title)}</p></div>
      <div class="header-buttons">
        <button class="button button-ghost" data-action="print-proposal" data-no="${escapeHtml(proposal.proposal_no)}">제안서 인쇄</button>
        <button class="button button-ghost" data-route="detail/${escapeHtml(proposal.proposal_no)}">공개 상세보기</button>
      </div>
    </section>

    <form id="adminReviewForm" class="admin-review-form" data-id="${escapeHtml(proposal.id)}">
      <section class="admin-review-preview">
        <div class="review-preview-head">
          <div><strong>${escapeHtml(proposal.proposer_name)}</strong><span>${escapeHtml(proposal.department)} · ${escapeHtml(proposal.category)}제안</span></div>
          ${statusBadge(proposal.status)}
        </div>
        <h2>현재 문제점</h2><p>${escapeHtml(proposal.current_problem)}</p>
        <h2>개선방안</h2><p>${escapeHtml(proposal.improvement_plan)}</p>
        <h2>기대효과</h2><p>${escapeHtml(proposal.expected_effect)}</p>
        <div class="admin-image-pair">
          <div><strong>개선 전</strong>${renderImages(proposal.before_images, "개선 전 사진")}</div>
          <div><strong>개선 후</strong>${renderImages(proposal.after_images, "개선 후 사진")}</div>
        </div>
      </section>

      <section class="admin-review-fields">
        <div class="form-grid two">
          <label class="field">업무상태
            <select name="status">${WORKFLOW_STATUSES.map((v) => `<option ${proposal.status === v ? "selected" : ""}>${v}</option>`).join("")}</select>
          </label>
          <label class="field">심사결과
            <select name="review_result">${REVIEW_RESULTS.map((v) => `<option ${proposal.review_result === v ? "selected" : ""}>${v}</option>`).join("")}</select>
          </label>
          <label class="field">시행부서
            <input name="implementing_department" value="${escapeHtml(proposal.implementing_department || "")}">
          </label>
          <label class="field">실시상태
            <select name="implementation_status">${IMPLEMENTATION_STATUSES.map((v) => `<option ${proposal.implementation_status === v ? "selected" : ""}>${v}</option>`).join("")}</select>
          </label>
          <label class="field">실시일
            <input type="date" name="implemented_date" value="${escapeHtml(proposal.implemented_date || "")}">
          </label>
          <label class="field">점수
            <input type="number" min="0" max="100" name="score" value="${proposal.score ?? ""}" placeholder="0~100">
          </label>
          <label class="field">지급상태
            <select name="payment_status">${PAYMENT_STATUSES.map((v) => `<option ${proposal.payment_status === v ? "selected" : ""}>${v}</option>`).join("")}</select>
          </label>
          <label class="field">효과금액(원)
            <input type="number" min="0" name="effect_amount" value="${Number(proposal.effect_amount || 0)}">
          </label>
        </div>
        <label class="field">심사의견
          <textarea name="review_comment" rows="5">${escapeHtml(proposal.review_comment || "")}</textarea>
        </label>
        <div class="award-preview" id="awardPreview">
          <small>점수 기준 예상 포상</small>
          <strong>${escapeHtml(proposal.award_grade || "-")} · ${formatCurrency(proposal.award_amount)}</strong>
        </div>
        <section class="admin-approval-box">
          <div class="section-heading"><div><span class="eyebrow">APPROVAL</span><h2>전자결재 처리</h2></div></div>
          <div id="adminApprovalProgress">${renderApprovalProgress(state.approvalSteps, [])}</div>
          <div id="adminApprovalAction"><div class="approval-permission blocked"><strong>서명권한 확인 중</strong><p>본인에게 지정된 결재단계를 확인하고 있습니다.</p></div></div>
        </section>
        <div class="admin-review-actions">
          <button type="button" class="button button-danger" data-action="delete-proposal" data-id="${escapeHtml(proposal.id)}">제안 삭제</button>
          <div><button type="button" class="button button-ghost" data-route="admin">취소</button><button class="button button-primary" type="submit">심사 저장</button></div>
        </div>
      </section>
    </form>
  `;
  hydrateAdminApproval(proposal).catch((error) => console.warn("전자결재 현황을 불러오지 못했습니다.", error));
}

async function hydrateAdminApproval(proposal) {
  const records = await store.getApprovalRecords(proposal.id).catch(() => []);
  const target = $("#adminApprovalProgress");
  if (target) target.innerHTML = renderApprovalProgress(state.approvalSteps, records);
  const actionTarget = $("#adminApprovalAction");
  if (actionTarget) {
    const permission = resolveApprovalPermission(proposal, state.approvalSteps, records, state.admin?.assignments || []);
    actionTarget.innerHTML = renderApprovalAction(permission, proposal.id);
  }
}

function buildProposalPayload(form) {
  const data = new FormData(form);
  const select = form.querySelector("#employeeSelect");
  const option = select?.selectedOptions?.[0];
  const employeeName = String(data.get("proposer_name") || "").trim();
  const employeeDepartment = String(option?.dataset?.department || "").trim();
  if (!employeeName || !employeeDepartment) {
    throw new Error("직원명단에서 제안자를 선택하세요.");
  }

  const implementation = normalizeImplementationDetails(
    data.get("implementation_status"),
    data.get("implemented_date"),
  );

  return {
    proposer_name: employeeName,
    department: employeeDepartment,
    category: data.get("category"),
    title: data.get("title")?.trim(),
    current_problem: data.get("current_problem")?.trim(),
    improvement_plan: data.get("improvement_plan")?.trim(),
    expected_effect: data.get("expected_effect")?.trim(),
    cost_amount: Number(data.get("cost_amount") || 0),
    ...implementation,
    edit_pin: data.get("edit_pin"),
  };
}

async function handleProposalSubmit(form) {
  const data = new FormData(form);
  if (data.get("website")) return;
  const payload = buildProposalPayload(form);
  const isEdit = form.dataset.edit === "true";

  if (!/^\d{4}$/.test(payload.edit_pin)) {
    throw new Error("수정번호는 숫자 4자리로 입력하세요.");
  }

  const beforeSelection = formImageSelections?.before || createImageSelection([]);
  const afterSelection = formImageSelections?.after || createImageSelection([]);
  const beforeFiles = getNewFiles(beforeSelection);
  const afterFiles = getNewFiles(afterSelection);
  if (
    totalSelectedImages(beforeSelection) > MAX_IMAGES_PER_SECTION
    || totalSelectedImages(afterSelection) > MAX_IMAGES_PER_SECTION
  ) {
    throw new Error(`사진은 개선 전·후 각각 최대 ${MAX_IMAGES_PER_SECTION}장까지 등록할 수 있습니다.`);
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = isEdit ? "수정 저장 중..." : "제출 중...";

  try {
    let saved;
    if (isEdit) {
      const patch = {
        ...payload,
        before_images: getRetainedImages(beforeSelection),
        after_images: getRetainedImages(afterSelection),
      };
      delete patch.edit_pin;
      saved = await store.updateProposalWithPin(
        form.dataset.no,
        payload.edit_pin,
        patch,
        beforeFiles,
        afterFiles,
      );
      showToast("제안이 수정되었습니다.");
    } else {
      const lastSubmit = Number(localStorage.getItem("proposal:last-submit") || 0);
      if (Date.now() - lastSubmit < 15000) {
        throw new Error("연속 제출 방지를 위해 잠시 후 다시 제출하세요.");
      }
      saved = await store.createProposal(payload, beforeFiles, afterFiles);
      localStorage.setItem("proposal:last-submit", String(Date.now()));
      showToast(`${saved.proposal_no}로 접수되었습니다.`);
    }
    await refreshData();
    go(`detail/${saved.proposal_no}`);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = isEdit ? "수정 저장" : "제안 제출";
  }
}

async function parseEmployeeFile(file) {
  if (!file) throw new Error("직원명단 파일을 선택하세요.");
  if (!window.XLSX) throw new Error("엑셀 읽기 라이브러리를 불러오지 못했습니다.");

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rows.length) throw new Error("직원명단에서 데이터를 찾지 못했습니다.");

  const headers = Object.keys(rows[0]);
  const findHeader = (candidates) => headers.find((header) =>
    candidates.some((candidate) => String(header).replace(/\s/g, "").includes(candidate))
  );
  const nameHeader = findHeader(["성명", "이름", "직원명"]);
  const departmentHeader = findHeader(["부서", "소속", "소속부서", "팀"]);
  const noHeader = findHeader(["사번", "직번", "직원번호"]);

  if (!nameHeader || !departmentHeader) {
    throw new Error("‘성명/이름’ 열과 ‘부서/소속’ 열을 찾지 못했습니다.");
  }

  const employees = rows
    .map((row) => ({
      name: String(row[nameHeader]).trim(),
      department: String(row[departmentHeader]).trim(),
      employee_no: noHeader ? String(row[noHeader]).trim() : "",
      active: true,
    }))
    .filter((row) => row.name && row.department);

  if (!employees.length) throw new Error("등록 가능한 직원 행이 없습니다.");
  return employees;
}

function downloadCsv(year = "all", month = "") {
  const scoped = filterProposals(state.proposals, { year, month });
  const csv = toProposalCsv(scoped);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `제안접수현황_${year === "all" ? "전체" : year}${month ? `_${month}월` : ""}_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    go(routeButton.dataset.route);
    return;
  }

  const searchButton = event.target.closest("[data-search]");
  if (searchButton) {
    go(`list?q=${encodeURIComponent(searchButton.dataset.search)}`);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const { action } = actionButton.dataset;
  try {
    if (action === "remove-form-image") {
      const section = actionButton.dataset.section;
      const kind = actionButton.dataset.kind;
      const index = Number(actionButton.dataset.index);
      if (!formImageSelections?.[section]) return;
      formImageSelections[section] = removeSelectedImage(formImageSelections[section], kind, index);
      renderFormImagePreview(section);
    } else if (action === "detail") {
      go(`detail/${actionButton.dataset.no}`);
    } else if (action === "print-proposal") {
      const printUrl = `${location.href.split("#")[0]}#print/${encodeURIComponent(actionButton.dataset.no)}`;
      window.open(printUrl, "_blank", "noopener");
    } else if (action === "trigger-print") {
      window.print();
    } else if (action === "clear-filter") {
      go("list");
    } else if (action === "open-image") {
      $("#lightboxImage").src = actionButton.dataset.url;
      $("#lightbox").showModal();
    } else if (action === "close-lightbox") {
      $("#lightbox").close();
    } else if (action === "logout-admin") {
      await store.logoutAdmin();
      await refreshData();
      render();
      showToast("로그아웃되었습니다.");
    } else if (action === "export-csv") {
      downloadCsv();
    } else if (action === "export-report-csv") {
      downloadCsv(actionButton.dataset.year || "all", actionButton.dataset.month || "");
    } else if (action === "edit-goal") {
      const form = $("#departmentGoalForm");
      if (form) {
        form.elements.year.value = actionButton.dataset.year || "";
        form.elements.department.value = actionButton.dataset.department || "";
        form.elements.annual_goal.value = actionButton.dataset.goal || "0";
        form.elements.note.value = actionButton.dataset.note || "";
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (action === "edit-approval-step") {
      const form = $("#approvalStepForm");
      if (form) {
        form.elements.id.value = actionButton.dataset.id || "";
        form.elements.step_order.value = actionButton.dataset.order || "";
        form.elements.role_name.value = actionButton.dataset.role || "";
        form.elements.description.value = actionButton.dataset.description || "";
        form.elements.active.checked = actionButton.dataset.active !== "false";
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (action === "remove-approver-assignment") {
      if (!confirm("이 결재자 배정을 해제하시겠습니까?")) return;
      await store.deleteApproverAssignment(actionButton.dataset.id);
      await refreshData();
      renderAdmin("approvals");
      showToast("결재자 배정을 해제했습니다.");
    } else if (action === "close-approval-notice") {
      $("#approvalNoticeDialog")?.close();
    } else if (action === "open-approval-inbox") {
      $("#approvalNoticeDialog")?.close();
      go("admin/inbox");
    } else if (action === "retry-notification") {
      await store.retryNotification(actionButton.dataset.id);
      renderAdminNotifications();
      showToast("메일 재전송 대기열에 넣었습니다.");
    } else if (action === "save-approval-action") {
      const box = $("#approvalActionForm");
      if (!box) return;
      const stepId = box.dataset.stepId;
      const approvalStatus = box.querySelector('[name="approval_status"]')?.value;
      const comment = box.querySelector('[name="comment"]')?.value?.trim() || "";
      await store.actApproval(box.dataset.proposalId, stepId, approvalStatus, comment);
      await refreshData();
      const proposal = state.proposals.find((p) => p.id === box.dataset.proposalId);
      if (routeParts()[1] === "review") {
        await renderApproverReview(box.dataset.proposalId);
      } else if (proposal) {
        await hydrateAdminApproval(proposal);
      }
      showToast("본인 전자서명을 저장했습니다.");
    } else if (action === "import-employees") {
      const rows = await parseEmployeeFile($("#employeeFile").files[0]);
      await store.importEmployees(rows);
      await refreshData();
      render();
      showToast(`직원 ${rows.length}명을 반영했습니다.`);
    } else if (action === "delete-proposal") {
      if (!confirm("이 제안을 삭제하시겠습니까? 삭제 후 복구할 수 없습니다.")) return;
      await store.deleteProposal(actionButton.dataset.id);
      await refreshData();
      go("admin");
      showToast("제안과 첨부 사진을 삭제했습니다.");
    } else if (action === "reset-demo") {
      if (!confirm("데모 데이터를 최초 상태로 되돌리시겠습니까?")) return;
      await store.resetDemo();
      await refreshData();
      render();
      showToast("데모 데이터를 초기화했습니다.");
    }
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === "quickSearchForm") {
      const query = new FormData(event.target).get("query");
      go(`list?q=${encodeURIComponent(query)}`);
    } else if (event.target.id === "filterForm") {
      const data = new FormData(event.target);
      const params = new URLSearchParams();
      if (data.get("query")) params.set("q", data.get("query"));
      if (data.get("year")) params.set("year", data.get("year"));
      if (data.get("workflow")) params.set("workflow", data.get("workflow"));
      if (data.get("category")) params.set("category", data.get("category"));
      if (data.get("department")) params.set("department", data.get("department"));
      if (data.get("reviewResult")) params.set("review", data.get("reviewResult"));
      if (data.get("implementationStatus")) params.set("implementation", data.get("implementationStatus"));
      location.hash = `#list${params.toString() ? `?${params}` : ""}`;
      render();
    } else if (event.target.id === "proposalForm") {
      await handleProposalSubmit(event.target);
    } else if (event.target.id === "adminLoginForm") {
      const data = new FormData(event.target);
      const loginRoute = routeParts();
      const account = await store.loginAdmin(data.get("email"), data.get("password"));
      await refreshData();
      const hasDirectReview = loginRoute[0] === "admin" && loginRoute[1] === "review" && loginRoute[2];
      if (!account?.isSystemAdmin && !hasDirectReview) location.hash = "#admin/inbox";
      render();
      showToast(account?.isSystemAdmin ? "시스템 관리자 로그인되었습니다." : "결재자 로그인되었습니다.");
      setTimeout(showApprovalLoginNotice, 120);
    } else if (event.target.id === "departmentGoalForm") {
      const data = new FormData(event.target);
      await store.saveDepartmentGoal({ year: Number(data.get("year")), department: data.get("department"), annual_goal: Number(data.get("annual_goal") || 0), note: data.get("note")?.trim() });
      await refreshData();
      location.hash = `#admin/goals?year=${encodeURIComponent(String(data.get("year")))}`;
      render();
      showToast("부서 목표를 저장했습니다.");
    } else if (event.target.id === "approvalStepForm") {
      const data = new FormData(event.target);
      await store.saveApprovalStep({ id: data.get("id") || undefined, step_order: Number(data.get("step_order")), role_name: data.get("role_name")?.trim(), description: data.get("description")?.trim(), active: data.get("active") === "on" });
      await refreshData();
      renderAdmin("approvals");
      showToast("전자결재 단계를 저장했습니다.");
    } else if (event.target.id === "approverAssignmentForm") {
      const data = new FormData(event.target);
      await store.linkApproverAccount({
        email: data.get("approver_email"), display_name: data.get("display_name"),
        step_id: data.get("step_id"), department: data.get("department"),
      });
      await refreshData();
      renderAdmin("approvals");
      showToast("결재자 계정을 연결했습니다.");
    } else if (event.target.id === "adminReviewForm") {
      const data = new FormData(event.target);
      const proposal = state.proposals.find((p) => p.id === event.target.dataset.id);
      const award = calculateAward(data.get("score"), proposal.category);
      const patch = {
        status: data.get("status"),
        review_result: data.get("review_result"),
        implementing_department: data.get("implementing_department")?.trim(),
        implementation_status: data.get("implementation_status"),
        implemented_date: data.get("implemented_date") || null,
        score: data.get("score") === "" ? null : Number(data.get("score")),
        award_grade: award.grade,
        award_amount: award.amount,
        payment_status: data.get("payment_status"),
        effect_amount: Number(data.get("effect_amount") || 0),
        review_comment: data.get("review_comment")?.trim(),
        locked: ["심사중", "심사완료"].includes(data.get("status")),
      };
      await store.adminUpdateProposal(event.target.dataset.id, patch);
      await refreshData();
      go("admin");
      showToast("심사정보를 저장했습니다.");
    }
  } catch (error) {
    showError(error);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "dashboardYearFilter") {
    const year = event.target.value || "all";
    const ranking = getRankingMetricFromUrl();
    location.hash = `#dashboard?year=${encodeURIComponent(year)}&ranking=${encodeURIComponent(ranking)}`;
    render();
    return;
  }
  if (event.target.id === "top10MetricFilter") {
    const year = getDashboardYearFromUrl() || "all";
    location.hash = `#dashboard?year=${encodeURIComponent(year)}&ranking=${encodeURIComponent(event.target.value || "score")}`;
    render();
    return;
  }
  if (event.target.id === "reportYearFilter") {
    const year = event.target.value || "all";
    location.hash = `#report?year=${encodeURIComponent(year)}`;
    render();
    return;
  }
  if (event.target.id === "reportMonthFilter") {
    const year = getDashboardYearFromUrl() || "all";
    const month = event.target.value || "";
    location.hash = `#report?year=${encodeURIComponent(year)}${month ? `&month=${encodeURIComponent(month)}` : ""}`;
    render();
    return;
  }
  if (event.target.id === "adminGoalYearFilter") {
    location.hash = `#admin/goals?year=${encodeURIComponent(event.target.value)}`;
    render();
    return;
  }
  if (event.target.id === "personYearFilter") {
    const name = event.target.dataset.person || "";
    location.hash = `#person/${encodeURIComponent(name)}?year=${encodeURIComponent(event.target.value || "all")}`;
    render();
    return;
  }
  if (event.target.id === "employeeSelect") {
    const option = event.target.selectedOptions[0];
    $("#departmentInput").value = option?.dataset.department || "";
  }
  if (event.target.id === "implementationStatus") {
    syncImplementationDateField();
  }
  if (event.target.id === "beforeImages") {
    appendFormImages("before", event.target.files);
    event.target.value = "";
  }
  if (event.target.id === "afterImages") {
    appendFormImages("after", event.target.files);
    event.target.value = "";
  }
});

document.addEventListener("input", (event) => {
  if (["proposalTitle", "currentProblem", "improvementPlan"].includes(event.target.id) || ["current_problem", "improvement_plan"].includes(event.target.name)) {
    const form = $("#proposalForm");
    if ($("#similarResults") && form) {
      $("#similarResults").innerHTML = renderSimilar(form.elements.title?.value || "", form.dataset.no || "");
    }
  }
  if (event.target.name === "score" && $("#awardPreview")) {
    const proposal = state.proposals.find((p) => p.id === $("#adminReviewForm")?.dataset.id);
    const award = calculateAward(event.target.value, proposal?.category);
    $("#awardPreview strong").textContent = `${award.grade || "-"} · ${formatCurrency(award.amount)}`;
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  ensureImageEditorStyles();
  init();
});
