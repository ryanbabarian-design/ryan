import {
  calculateAward,
  dashboardMetrics,
  filterProposals,
  formatCurrency,
  formatDate,
  IMPLEMENTATION_STATUSES,
  PAYMENT_STATUSES,
  REVIEW_RESULTS,
  toProposalCsv,
  WORKFLOW_STATUSES,
} from "./core.js";
import { createStore } from "./services/store.js";

const store = createStore();
const state = {
  proposals: [],
  employees: [],
  admin: null,
  loading: true,
  error: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const main = $("#app");
const toast = $("#toast");

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

async function refreshData() {
  const [proposals, employees, admin] = await Promise.all([
    store.getProposals(),
    store.getEmployees(),
    store.getAdminSession(),
  ]);
  state.proposals = proposals;
  state.employees = employees;
  state.admin = admin;
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
  setActiveNav(route === "detail" || route === "edit" ? "list" : route);
  $("#modeBadge").textContent = store.mode === "demo" ? "데모 모드" : "Supabase 연결";
  $("#modeBadge").className = `mode-badge ${store.mode}`;

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
  else if (route === "edit") renderProposalForm(routeParts()[1]);
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
        <div class="proposer"><span class="avatar">${escapeHtml(proposal.proposer_name?.slice(0, 1) || "?")}</span>${escapeHtml(proposal.proposer_name)}</div>
        <div class="card-actions">
          ${statusBadge(proposal.implementation_status)}
          <button class="button button-ghost button-small" data-action="detail" data-no="${escapeHtml(proposal.proposal_no)}">상세보기</button>
        </div>
      </div>
    </article>`;
}

function renderDashboard() {
  const metrics = dashboardMetrics(state.proposals);
  const recent = filterProposals(state.proposals).slice(0, 6);
  const departments = [...new Set(state.proposals.map((item) => item.department))].sort();

  main.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">HANA METAL IDEA HUB</span>
        <h1>작은 개선이<br><em>큰 변화를 만듭니다.</em></h1>
        <p>기존 제안을 검색하고, 개선 전·후 사진과 함께 새로운 아이디어를 바로 접수하세요.</p>
        <div class="hero-actions">
          <button class="button button-primary" data-route="new">새 제안 작성</button>
          <button class="button button-secondary" data-route="list">유사 제안 검색</button>
        </div>
      </div>
      <div class="hero-panel">
        <div class="hero-orb">IDEA</div>
        <div class="hero-mini-card">
          <span>올해 누적 제안</span>
          <strong>${metrics.total.toLocaleString("ko-KR")}건</strong>
          <small>기존 엑셀 ${state.proposals.filter((p) => p.id?.startsWith("seed-")).length}건 포함</small>
        </div>
      </div>
    </section>

    <section class="metric-grid" aria-label="제안 현황 요약">
      <div class="metric-card"><span class="metric-icon">💡</span><div><small>전체 제안</small><strong>${metrics.total}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">🕒</span><div><small>심사 대기</small><strong>${metrics.pending}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">✅</span><div><small>채택</small><strong>${metrics.adopted}</strong></div></div>
      <div class="metric-card"><span class="metric-icon">🏁</span><div><small>실시 완료</small><strong>${metrics.completed}</strong></div></div>
    </section>

    <section class="quick-search">
      <div>
        <span class="eyebrow">DUPLICATE CHECK</span>
        <h2>제안하기 전에 비슷한 아이디어가 있는지 검색하세요.</h2>
      </div>
      <form id="quickSearchForm" class="search-box">
        <input name="query" placeholder="예: 에어건, 절단기, 안전장치, 작업시간 단축" aria-label="유사 제안 검색어">
        <button class="button button-primary" type="submit">검색</button>
      </form>
      <div class="keyword-row">
        ${departments.map((department) => `<button class="keyword" data-search="${escapeHtml(department)}">${escapeHtml(department)}</button>`).join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <div><span class="eyebrow">RECENT IDEAS</span><h2>최근 접수된 제안</h2></div>
        <button class="button button-ghost" data-route="list">전체보기</button>
      </div>
      <div class="proposal-grid">${recent.map(proposalCard).join("")}</div>
    </section>
  `;
}

function getFiltersFromUrl() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  return {
    query: params.get("q") || "",
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

  main.innerHTML = `
    <section class="page-header">
      <div><span class="eyebrow">PUBLIC DATABASE</span><h1>제안 접수현황</h1><p>제안명·문제점·개선방안·효과·제안자·부서를 통합 검색합니다.</p></div>
      <button class="button button-primary" data-route="new">새 제안 작성</button>
    </section>

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
  const similar = filterProposals(state.proposals, { query: title })
    .filter((p) => p.proposal_no !== excludeNo)
    .slice(0, 4);
  if (!similar.length) return `<p class="similar-empty">현재 검색어와 일치하는 기존 제안이 없습니다.</p>`;
  return similar.map((proposal) => `
    <button type="button" class="similar-item" data-action="detail" data-no="${escapeHtml(proposal.proposal_no)}">
      <strong>${escapeHtml(proposal.title)}</strong>
      <span>${escapeHtml(proposal.proposal_no)} · ${escapeHtml(proposal.department)} · ${escapeHtml(proposal.proposer_name)}</span>
    </button>
  `).join("");
}

function renderProposalForm(proposalNo = "") {
  const proposal = proposalNo ? state.proposals.find((item) => item.proposal_no === proposalNo) : null;
  if (proposalNo && !proposal) {
    main.innerHTML = `<div class="empty-state"><h2>제안을 찾지 못했습니다.</h2><button class="button button-primary" data-route="list">목록으로</button></div>`;
    return;
  }

  const isEdit = Boolean(proposal);
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
              <textarea name="current_problem" rows="8" required placeholder="어떤 문제가 있고, 왜 불편하거나 위험한지 작성">${escapeHtml(proposal?.current_problem || "")}</textarea>
            </label>
            <label class="upload-box">개선 전 사진
              <input id="beforeImages" type="file" name="before_images" accept="image/jpeg,image/png,image/webp" multiple>
              <span>사진 선택 · 최대 4장 · 장당 5MB</span>
            </label>
            <div id="beforePreview" class="preview-grid">${proposal ? renderImages(proposal.before_images, "개선 전 사진") : ""}</div>
          </div>

          <div class="comparison-arrow">→</div>

          <div class="comparison-card after">
            <div class="comparison-label">AFTER · 개선 후</div>
            <label class="field">개선방안 <b>*</b>
              <textarea name="improvement_plan" rows="8" required placeholder="무엇을 어떻게 바꿀지 구체적으로 작성">${escapeHtml(proposal?.improvement_plan || "")}</textarea>
            </label>
            <label class="upload-box">개선 후·참고 사진
              <input id="afterImages" type="file" name="after_images" accept="image/jpeg,image/png,image/webp" multiple>
              <span>실시 전이면 도면·예시 사진도 가능</span>
            </label>
            <div id="afterPreview" class="preview-grid">${proposal ? renderImages(proposal.after_images, "개선 후 사진") : ""}</div>
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

      ${!isEdit ? `
        <section class="form-section form-section-pin">
          <div class="form-section-title"><span>05</span><div><h2>수정번호 설정</h2><p>심사 시작 전 본인 제안을 수정할 때 사용합니다.</p></div></div>
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
          <p><strong>${escapeHtml(proposal.proposer_name)}</strong> · ${escapeHtml(proposal.department)}</p>
        </div>
        <div class="detail-actions">
          ${statusBadge(proposal.status)}
          ${statusBadge(proposal.review_result)}
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
}

function renderAdmin(action = "", id = "") {
  if (!state.admin) {
    main.innerHTML = `
      <section class="admin-login-wrap">
        <form id="adminLoginForm" class="admin-login">
          <span class="admin-lock">🔐</span>
          <span class="eyebrow">ADMIN ONLY</span>
          <h1>관리자 로그인</h1>
          <p>관리자별 이메일과 비밀번호로 로그인하여 심사·수정·직원명단을 관리합니다.</p>
          <label class="field">이메일<input type="email" name="email" required autocomplete="username" value="${store.mode === "demo" ? "admin@demo.local" : ""}"></label>
          <label class="field">비밀번호<input type="password" name="password" required autocomplete="current-password" value="${store.mode === "demo" ? "admin1234" : ""}"></label>
          <button class="button button-primary button-wide" type="submit">로그인</button>
          ${store.mode === "demo" ? `<small class="demo-help">데모 계정: admin@demo.local / admin1234</small>` : ""}
        </form>
      </section>`;
    return;
  }

  if (action === "edit") {
    renderAdminEdit(id);
    return;
  }

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
      <button class="button button-ghost" data-route="detail/${escapeHtml(proposal.proposal_no)}">공개 상세보기</button>
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
        <div class="admin-review-actions">
          <button type="button" class="button button-danger" data-action="delete-proposal" data-id="${escapeHtml(proposal.id)}">제안 삭제</button>
          <div><button type="button" class="button button-ghost" data-route="admin">취소</button><button class="button button-primary" type="submit">심사 저장</button></div>
        </div>
      </section>
    </form>
  `;
}

function previewFiles(input, target) {
  const files = Array.from(input.files || []).slice(0, 4);
  if (input.files.length > 4) {
    showToast("사진은 구분별 최대 4장까지 등록됩니다.", "error");
  }
  target.innerHTML = files.map((file) => {
    const url = URL.createObjectURL(file);
    return `<div class="preview-item"><img src="${url}" alt="${escapeHtml(file.name)}"><span>${escapeHtml(file.name)}</span></div>`;
  }).join("");
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

  return {
    proposer_name: employeeName,
    department: employeeDepartment,
    category: data.get("category"),
    title: data.get("title")?.trim(),
    current_problem: data.get("current_problem")?.trim(),
    improvement_plan: data.get("improvement_plan")?.trim(),
    expected_effect: data.get("expected_effect")?.trim(),
    cost_amount: Number(data.get("cost_amount") || 0),
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

  const beforeFiles = $("#beforeImages").files;
  const afterFiles = $("#afterImages").files;
  if (beforeFiles.length > 4 || afterFiles.length > 4) {
    throw new Error("사진은 개선 전·후 각각 최대 4장까지 등록할 수 있습니다.");
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = isEdit ? "수정 저장 중..." : "제출 중...";

  try {
    let saved;
    if (isEdit) {
      const patch = { ...payload };
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

function downloadCsv() {
  const csv = toProposalCsv(filterProposals(state.proposals));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `제안접수현황_${new Date().toISOString().slice(0, 10)}.csv`;
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
    if (action === "detail") {
      go(`detail/${actionButton.dataset.no}`);
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
      await store.loginAdmin(data.get("email"), data.get("password"));
      await refreshData();
      render();
      showToast("관리자 로그인되었습니다.");
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
  if (event.target.id === "employeeSelect") {
    const option = event.target.selectedOptions[0];
    $("#departmentInput").value = option?.dataset.department || "";
  }
  if (event.target.id === "beforeImages") previewFiles(event.target, $("#beforePreview"));
  if (event.target.id === "afterImages") previewFiles(event.target, $("#afterPreview"));
});

document.addEventListener("input", (event) => {
  if (event.target.id === "proposalTitle") {
    $("#similarResults").innerHTML = renderSimilar(event.target.value, $("#proposalForm")?.dataset.no || "");
  }
  if (event.target.name === "score" && $("#awardPreview")) {
    const proposal = state.proposals.find((p) => p.id === $("#adminReviewForm")?.dataset.id);
    const award = calculateAward(event.target.value, proposal?.category);
    $("#awardPreview strong").textContent = `${award.grade || "-"} · ${formatCurrency(award.amount)}`;
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", init);
