import { reviewStages, createReviewSource } from './review-stages.js?v=2.9.12';
/* V2.9.12 — read-only workflow UI. Original app owns filtering, review and all writes. */
(() => {
  'use strict';
  if (window.__hanaWorkspace) return;
  const root = document.getElementById('app');
  if (!root) return;
  window.__hanaWorkspace = '2.9.12';
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  const mounted = new WeakSet(), memory = new Map();
  let listState = null, scheduled = false, restoring = false;
  const route = () => (location.hash.slice(1).split('?')[0] || 'dashboard').split('/')[0];
  const year = () => new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date());
  function read(key, fallback, persistent = false) {
    try { const s = persistent ? localStorage : sessionStorage; return JSON.parse(s.getItem('hana.ws.' + key)) ?? fallback; }
    catch (_) { return memory.has(key) ? memory.get(key) : fallback; }
  }
  function write(key, value, persistent = false) {
    memory.set(key, value);
    try { (persistent ? localStorage : sessionStorage).setItem('hana.ws.' + key, JSON.stringify(value)); } catch (_) { /* Browser storage may be disabled. */ }
  }
  function el(tag, cls = '', text = '') {
    const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n;
  }
  function button(text, key, value = '') {
    const b = el('button', 'ws-button', text); b.type = 'button'; b.setAttribute(key, value); return b;
  }
  function choices(label, attribute, options, value) {
    const l = el('label', 'ws-select-label', label), s = el('select'); s.setAttribute(attribute, '');
    for (const [v, t] of options) s.add(new Option(t, v)); s.value = String(value); l.append(s); return l;
  }
  function navigate(hash) { location.hash = hash.startsWith('#') ? hash : '#' + hash; }
  function enhanceDashboard() {
    const hero = $('.brand-hero'), metrics = $('.workflow-metric-grid'), operational = $('.operational-metric-grid');
    const analytics = $('#analytics'), select = $('#dashboardYearFilter'), search = $('#questionSearch');
    if (!hero || !metrics || !select || !analytics || !search || mounted.has(hero)) return;
    mounted.add(hero);
    const scope = select.value === 'all' ? '전체 연도' : select.value + '년';
    const head = el('section', 'ws-heading hero'); head.dataset.wsHeading = '';
    const copy = el('div'); copy.append(el('span', 'ws-kicker', 'WORKSPACE · 2.9.12'), el('h1', '', '제안 업무 현황'));
    copy.append(el('p', 'ws-muted', scope + ' 접수 기준 · 숫자를 누르면 해당 제안으로 이동합니다.'));
    const source = $('.hero-mini-card small', hero); if (source) copy.append(el('small', 'ws-source', source.textContent));
    const actions = el('div', 'ws-heading-actions');
    const label = el('label', 'ws-select-label', '조회연도'); label.append(select); actions.append(label);
    const newButton = $('[data-route="new"]', hero); if (newButton) actions.append(newButton);
    actions.append(button('실적·엑셀', 'data-route', 'performance?year=' + (select.value === 'all' ? year() : select.value)));
    head.append(copy, actions); hero.replaceWith(head);
    const totalLabel = $('.workflow-card.total small', metrics); if (totalLabel) totalLabel.textContent = '선택기간 접수';
    const note = el('p', 'ws-metric-note', '심사결과와 실시상태는 별도 기준입니다. 채택·실시완료 건수를 더해 전체 건수로 계산하지 않습니다.');
    root.prepend(head, metrics, ...(operational ? [operational] : []), note, search);
    const recent = $('.dashboard-recent');
    if (recent) {
      const title = $('h2', recent); if (title) title.textContent = '최근 접수된 제안 · 전체 연도';
      const more = $('[data-route="list"]', recent); if (more) more.dataset.route = 'list?year=all';
      search.after(recent);
    }
    const report = $('.dashboard-report-entry');
    if (report) {
      const targetYear = select.value === 'all' ? year() : select.value;
      const h = $('h2', report); if (h) h.textContent = targetYear + '년 직원별 실적 · 관리부 제출';
      const b = $('[data-route]', report); if (b) b.dataset.route = 'performance?year=' + targetYear;
      (recent || search).after(report);
    }
    const fold = el('details', 'ws-analytics'); fold.dataset.wsAnalytics = '';
    fold.open = read('analytics-open', false) === true;
    const summary = el('summary', '', '상세 분석 펼치기 · 월별·부서별·목표·금액'); fold.append(summary);
    analytics.before(fold); fold.append(analytics);
    fold.addEventListener('toggle', () => write('analytics-open', fold.open));
  }
  function prepareFilters(form) {
    if (mounted.has(form)) return;
    const grid = $('.filter-grid', form), search = $('.filter-search', form), actions = $('.filter-actions', form);
    if (!grid || !search || !actions || !form.elements.year || !form.elements.workflow) return;
    mounted.add(form);
    const requestedYear = new URLSearchParams(location.hash.split('?')[1] || '').get('year');
    if (/^20\d{2}$/.test(requestedYear || '') && ![...form.elements.year.options].some(o => o.value === requestedYear)) {
      form.elements.year.add(new Option(requestedYear + '년', requestedYear)); form.elements.year.value = requestedYear;
    }
    const row = el('div', 'ws-filter-search'); row.append(search, actions); form.prepend(row);
    const advanced = el('details', 'ws-advanced'); advanced.dataset.wsAdvanced = '';
    const summary = el('summary', '', '상세 필터 · 제안종류 / 심사결과 / 실시상태'); advanced.append(summary);
    const body = el('div', 'ws-advanced-grid');
    for (const name of ['category', 'reviewResult', 'implementationStatus']) {
      const field = form.elements[name]; if (!field) continue;
      if (field.value) advanced.open = true;
      const label = field.closest('label'); if (label) body.append(label);
    }
    advanced.append(body); grid.after(advanced);
    const quick = el('div', 'ws-quick-filters'); quick.setAttribute('aria-label', '자주 쓰는 조회 조건');
    for (const [v, t] of [[year(), '올해'], ['all', '전체 연도']]) {
      const b = button(t, 'data-ws-year', v); b.setAttribute('aria-pressed', String(form.elements.year.value === v)); quick.append(b);
    }
    quick.append(el('span', 'ws-divider'));
    for (const [v, t] of [['total', '전체 현황'], ['pending', '심사대기'], ['overdue-review', '장기 미심사'], ['adopted', '채택'], ['completed', '실시완료']]) {
      const b = button(t, 'data-ws-workflow', v); b.setAttribute('aria-pressed', String(form.elements.workflow.value === v)); quick.append(b);
    }
    row.after(quick);
    const reset = $('[data-action="clear-filter"]', form); if (reset) reset.textContent = '조건 초기화';
  }
  function dateKey(text) {
    const n = String(text).match(/\d+/g) || []; return n.length >= 3 ? n[0] + n[1].padStart(2, '0') + n[2].padStart(2, '0') : '';
  }
  function cardData(card, index) {
    const meta = $$('.proposal-meta span', card), author = $('.proposer', card)?.cloneNode(true);
    if (author) $('.avatar', author)?.remove();
    return { card, index, no: $('.proposal-meta strong', card)?.textContent || '', date: meta[0]?.textContent || '',
      department: meta[1]?.textContent || '', name: author?.textContent.trim() || '', author,
      title: $('h3', card)?.textContent || '', review: $('.proposal-card-top > .badge', card),
      reviewText: $('.proposal-card-top > .badge', card)?.textContent.trim() || '',
      implementationText: $('.card-actions > .badge', card)?.textContent.trim() || '',
      stage: $('.evaluation-admin-state', card)?.textContent || '', implementation: $('.card-actions > .badge', card),
      detail: $('[data-action="detail"]', card) };
  }
  const stageLabels = ['1차 본인평가', '2차 팀장평가', '3차 심사위원'];
  function rowReview(r) {
    if (r.reviewState === 'ready') return reviewStages(r.reviewData);
    const value = ({ error: '조회 실패', missing: '조회자료 없음', changed: '정보 변경' })[r.reviewState] || '조회 중';
    const note = r.reviewState === 'changed' ? '목록을 새로고침하세요.' : ['error', 'missing'].includes(r.reviewState) ? '미평가로 처리하지 않음' : '';
    return { stages: stageLabels.map(label => ({ label, value, status: note, tone: ['error', 'missing', 'changed'].includes(r.reviewState) ? 'warn' : 'muted' })),
      result: r.reviewText, resultNote: '', progress: r.reviewState === 'changed' ? '결과가 변경됨 · 새로고침 필요' : r.stage };
  }
  function stageContent(value, showLabel = false) {
    const box = el('div', 'ws-review-stage ' + (value.tone || 'muted'));
    if (showLabel) box.append(el('span', 'ws-review-label', value.label));
    box.append(el('strong', 'ws-review-score', value.value));
    if (value.status) box.append(el('span', 'ws-review-state', value.status));
    if (value.note) box.append(el('small', 'ws-review-note', value.note));
    if (value.by) box.append(el('small', 'ws-review-by', value.by));
    if (value.date) box.append(el('small', 'ws-review-date', (value.dateLabel || '평가일') + ' ' + value.date));
    else if (/점$/.test(value.value)) box.append(el('small', 'ws-review-date', (value.dateLabel || '평가일') + ' 미기록'));
    return box;
  }
  function reviewCard(r, model) {
    let strip = $('.ws-review-strip', r.card);
    if (!strip) {
      strip = el('div', 'ws-review-strip'); strip.setAttribute('aria-label', '단계별 심사 현황');
      const bottom = $('.proposal-card-bottom', r.card); if (bottom) bottom.before(strip); else r.card.append(strip);
    }
    strip.replaceChildren(...model.stages.map((v, i) => { const n = stageContent(v, true); n.dataset.wsStage = String(i + 1); return n; }));
    let progress = $('.ws-review-progress', r.card);
    if (!progress) { progress = el('p', 'ws-review-progress'); strip.after(progress); }
    progress.textContent = model.resultNote || model.progress;
    const old = $('.evaluation-admin-state', r.card); if (old) old.hidden = true;
    if (r.review) { r.review.textContent = model.result; r.review.title = '최종 심사결과 · ' + (model.resultNote || model.result); }
  }
  function requestReviewRows(state, visible) {
    const pending = visible.filter(r => !r.reviewState);
    if (!pending.length) return;
    for (const r of pending) r.reviewState = 'loading';
    const reader = state.reader;
    reader.load(pending.map(r => r.no)).then(records => {
      if (listState !== state || state.reader !== reader || !state.tableWrap.isConnected || route() !== 'list') return;
      for (const r of pending) {
        const data = records.get(r.no);
        if (!data) { r.reviewState = 'missing'; continue; }
        if ((data.review_result != null && String(data.review_result).trim() !== r.reviewText) ||
            (data.implementation_status != null && String(data.implementation_status).trim() !== r.implementationText)) {
          r.reviewState = 'changed'; continue;
        }
        r.reviewData = data; r.reviewState = 'ready';
      }
      renderListPage(state);
    }).catch(() => {
      if (listState !== state || state.reader !== reader || !state.tableWrap.isConnected || route() !== 'list') return;
      for (const r of pending) r.reviewState = 'error';
      renderListPage(state);
    });
  }
  function saveList() {
    if (!listState) return;
    write('last-list', { hash: listState.hash, page: listState.page, size: listState.size, view: listState.view, sort: listState.sort, scroll: window.scrollY });
  }
  function renderListPage(state) {
    const rows = [...state.rows];
    const compare = (a, b) => {
      if (state.sort === 'oldest') return dateKey(a.date).localeCompare(dateKey(b.date)) || a.index - b.index;
      if (state.sort === 'name' || state.sort === 'department') return a[state.sort].localeCompare(b[state.sort], 'ko') || a.index - b.index;
      return dateKey(b.date).localeCompare(dateKey(a.date)) || a.index - b.index;
    };
    rows.sort(compare);
    const pages = Math.max(1, Math.ceil(rows.length / state.size)); state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.size, visible = rows.slice(start, start + state.size);
    state.grid.hidden = state.view !== 'cards'; state.tableWrap.hidden = state.view !== 'table';
    state.grid.replaceChildren(...(state.view === 'cards' ? visible.map(r => r.card) : []));
    const tbody = $('tbody', state.tableWrap); tbody.replaceChildren();
    for (const r of visible) reviewCard(r, rowReview(r));
    if (state.view === 'table') for (const r of visible) {
      const tr = el('tr'), identity = el('td'), title = el('td', 'ws-title-cell'), person = el('td'), result = el('td'), implementation = el('td');
      identity.append(el('strong', '', r.no), el('small', '', r.date));
      const open = r.detail?.cloneNode(true) || button('', 'data-action', 'detail'); open.dataset.no = r.no;
      open.className = 'ws-title-link'; open.textContent = r.title; open.setAttribute('aria-label', r.no + ' ' + r.title + ' 상세보기'); title.append(open);
      if (r.author) { const a = r.author.cloneNode(true); a.className = 'ws-person-link'; person.append(a); } else person.append(el('span', '', r.name));
      person.append(el('small', '', r.department));
      const model = rowReview(r);
      const cells = model.stages.map((v, i) => { const td = el('td', 'ws-stage-cell'); td.dataset.wsStage = String(i + 1); td.append(stageContent(v)); return td; });
      if (r.review) { const badge = r.review.cloneNode(true); badge.textContent = model.result; result.append(badge); }
      if (model.resultNote) result.append(el('small', 'ws-review-candidate', model.resultNote));
      if (model.progress) result.append(el('small', 'ws-stage', model.progress));
      if (r.implementation) implementation.append(r.implementation.cloneNode(true));
      tr.append(identity, title, person, ...cells, result, implementation); tbody.append(tr);
    }
    $('[data-ws-range]', state.pager).textContent = `${rows.length ? start + 1 : 0}–${Math.min(start + state.size, rows.length)} / ${rows.length.toLocaleString('ko-KR')}건`;
    $('[data-ws-page-label]', state.pager).textContent = `${state.page} / ${pages} 페이지`;
    $('[data-ws-prev]', state.pager).disabled = state.page === 1; $('[data-ws-next]', state.pager).disabled = state.page === pages;
    $$('[data-ws-view]', state.toolbar).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.wsView === state.view)));
    const warnings = visible.filter(r => ['error', 'missing', 'changed'].includes(r.reviewState)).length;
    const loading = visible.filter(r => !r.reviewState || r.reviewState === 'loading').length;
    state.reviewInfo.textContent = '1차 본인 → 2차 팀장 → 3차 심사위원 · 최종결과/실시상태 별도' +
      (warnings ? ` · 조회 확인 ${warnings}건 (미평가와 다름)` : loading ? ' · 단계별 기록 조회 중' : ' · 저장된 기록 기준');
    state.reviewInfo.classList.toggle('has-warning', warnings > 0);
    saveList(); requestReviewRows(state, visible);
  }
  function enhanceList() {
    const form = $('#filterForm'); if (!form) return;
    if (!location.hash.includes('?')) {
      history.replaceState(null, '', '#list?year=' + year()); window.dispatchEvent(new HashChangeEvent('hashchange')); return;
    }
    prepareFilters(form);
    const result = $('#filteredProposalResults'), grid = $('.proposal-grid', result || root);
    if (!result || !grid) { listState?.reader?.dispose(); listState = null; return; }
    if (mounted.has(grid)) return;
    const cards = $$('.proposal-card', grid); if (!cards.length) return;
    mounted.add(grid); listState?.reader?.dispose();
    const previous = read('last-list', {}), same = previous.hash === location.hash;
    const preferred = read('view', 'table', true), preferredSize = Number(read('size', 30, true));
    const state = { reader: createReviewSource(), hash: location.hash, rows: cards.map(cardData), grid, page: same ? Number(previous.page) || 1 : 1,
      view: ['table', 'cards'].includes(same ? previous.view : preferred) ? (same ? previous.view : preferred) : 'table',
      size: [30, 60, 100].includes(same ? Number(previous.size) : preferredSize) ? (same ? Number(previous.size) : preferredSize) : 30,
      sort: ['newest', 'oldest', 'department', 'name'].includes(previous.sort) ? previous.sort : 'newest' };
    const toolbar = el('div', 'ws-result-tools'); toolbar.dataset.wsToolbar = '';
    const views = el('div', 'ws-view-switch'); views.setAttribute('role', 'group'); views.setAttribute('aria-label', '목록 표시 방식');
    views.append(button('표 보기', 'data-ws-view', 'table'), button('카드 보기', 'data-ws-view', 'cards'));
    toolbar.append(views, choices('정렬', 'data-ws-sort', [['newest', '최근 접수순'], ['oldest', '오래된 접수순'], ['department', '부서순'], ['name', '제안자순']], state.sort), choices('표시', 'data-ws-size', [['30', '30건'], ['60', '60건'], ['100', '100건']], state.size));
    grid.before(toolbar);
    const reviewBar = el('div', 'ws-review-bar');
    const reviewInfo = el('p', 'ws-review-info'); reviewInfo.setAttribute('role', 'status');
    reviewBar.append(reviewInfo, button('심사자료 다시 조회', 'data-ws-review-retry'));
    toolbar.after(reviewBar);
    const wrap = el('div', 'ws-table-scroll'); wrap.tabIndex = 0; wrap.setAttribute('aria-label', '제안 접수현황 표 · 좌우 스크롤 가능');
    const table = el('table', 'ws-list-table ws-review-table'), thead = el('thead'), tr = el('tr');
    for (const text of ['접수번호 · 일자', '제안명 · 클릭하여 상세보기', '제안자 · 부서', '1차 본인평가', '2차 팀장평가', '3차 심사위원', '최종 심사결과', '실시상태']) { const th = el('th', '', text); th.scope = 'col'; tr.append(th); }
    thead.append(tr); table.append(thead, el('tbody')); wrap.append(table); grid.after(wrap);
    const pager = el('nav', 'ws-pagination'); pager.setAttribute('aria-label', '검색 결과 페이지');
    const range = el('strong'); range.dataset.wsRange = ''; range.setAttribute('aria-live', 'polite');
    const label = el('span'); label.dataset.wsPageLabel = ''; pager.append(range, button('이전', 'data-ws-prev'), label, button('다음', 'data-ws-next')); wrap.after(pager);
    Object.assign(state, { tableWrap: wrap, pager, toolbar, reviewInfo }); listState = state; renderListPage(state);
    if (restoring && same) { restoring = false; requestAnimationFrame(() => window.scrollTo(0, Number(previous.scroll) || 0)); }
  }
  function enhancePerformance() {
    const form = $('#perfFilters'); if (!form) return;
    root.dataset.wsDensity = read('density', 'compact', true) === 'comfortable' ? 'comfortable' : 'compact';
    const yearLabel = $('.perf-kpis article > span');
    if (yearLabel && /^(올해|20\d{2}년 등록)/.test(yearLabel.textContent)) {
      const value = form.elements.year?.value; if (/^20\d{2}$|^2100$/.test(value || '')) yearLabel.textContent = value + '년 등록건수';
    }
    const heading = $('.perf-section-heading');
    if (heading && !$('[data-ws-density]', heading)) heading.append(button(root.dataset.wsDensity === 'compact' ? '여유 있게 보기' : '촘촘하게 보기', 'data-ws-density'));
  }
  function enhanceNotices() {
    const card = $('#siteNoticesPage'); if (!card || mounted.has(card) || !$('.ops-notice,.ops-empty', card)) return;
    mounted.add(card);
    const tools = el('div', 'ws-notice-tools');
    const search = el('input'); search.type = 'search'; search.placeholder = '공지 제목·내용 검색'; search.setAttribute('aria-label', '공지 제목·내용 검색'); search.dataset.wsNoticeSearch = '';
    const count = el('span', 'ws-muted'); count.dataset.wsNoticeCount = ''; count.setAttribute('aria-live', 'polite');
    tools.append(search, count, button('모두 펼치기', 'data-ws-notices-open'), button('모두 접기', 'data-ws-notices-close')); card.before(tools);
    const empty = el('p', 'ws-notice-empty', '검색어와 일치하는 공지가 없습니다.'); empty.dataset.wsNoticeEmpty = ''; empty.hidden = true; card.append(empty);
    for (const n of $$('.ops-notice', card)) {
      const title = $('summary > div', n), body = $('.ops-body', n);
      if (title && body) title.append(el('span', 'ws-notice-preview', body.textContent.trim().slice(0, 100)));
    }
    filterNotices();
    const links = el('div', 'ws-notice-links'); links.append(el('span', 'ws-muted', '확인 후 바로 이동'), button('접수현황', 'data-route', 'list?year=' + year()), button('실적·엑셀', 'data-route', 'performance?year=' + year())); card.after(links);
  }
  function filterNotices() {
    const term = $('[data-ws-notice-search]')?.value.trim().toLocaleLowerCase() || '';
    const rows = $$('#siteNoticesPage .ops-notice'); let count = 0;
    for (const n of rows) { n.hidden = !n.textContent.toLocaleLowerCase().includes(term); if (!n.hidden) count++; }
    const label = $('[data-ws-notice-count]'); if (label) label.textContent = `검색 ${count} / 전체 ${rows.length}건`;
    const empty = $('[data-ws-notice-empty]'); if (empty) empty.hidden = count !== 0 || rows.length === 0;
  }
  function enhanceDetail() {
    if (!$('.detail-header') || $('[data-ws-return]')) return;
    const saved = read('last-list', {}); if (!/^#list(?:\?|$)/.test(saved.hash || '')) return;
    const bar = el('div', 'ws-return-bar'); bar.append(button('← 검색하던 목록으로', 'data-ws-return'), el('span', 'ws-muted', '조회 조건 · 표시 방식 · 페이지 유지')); root.prepend(bar);
  }
  const observer = new MutationObserver(schedule);
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(enhance); } }
  function enhance() {
    scheduled = false; observer.disconnect();
    try {
      const r = route();
      if (['dashboard', 'list', 'performance', 'notices', 'detail'].includes(r)) root.dataset.workspace = r;
      else { delete root.dataset.workspace; delete root.dataset.wsDensity; return; }
      if (r !== 'list') { listState?.reader?.dispose(); listState = null; }
      if (r === 'dashboard') enhanceDashboard(); else if (r === 'list') enhanceList();
      else if (r === 'performance') enhancePerformance(); else if (r === 'notices') enhanceNotices(); else enhanceDetail();
    } catch (e) { console.warn('업무 화면 개선을 적용하지 못했습니다. 기존 화면을 유지합니다.', e); }
    finally { observer.observe(root, { childList: true, subtree: true }); }
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-ws-review-retry') && listState) {
      listState.reader.dispose(); listState.reader = createReviewSource();
      for (const r of listState.rows) { r.reviewState = null; r.reviewData = null; }
      renderListPage(listState); return;
    }
    if (b.hasAttribute('data-ws-return')) {
      const saved = read('last-list', {}); if (/^#list(?:\?|$)/.test(saved.hash || '')) { restoring = true; navigate(saved.hash); } return;
    }
    if (b.hasAttribute('data-ws-year') || b.hasAttribute('data-ws-workflow')) {
      const f = $('#filterForm'); if (!f) return;
      if (b.hasAttribute('data-ws-year')) {
        if (![...f.elements.year.options].some(o => o.value === b.dataset.wsYear)) f.elements.year.add(new Option(b.dataset.wsYear + '년', b.dataset.wsYear));
        f.elements.year.value = b.dataset.wsYear;
      } else { f.elements.workflow.value = b.dataset.wsWorkflow; f.elements.reviewResult.value = ''; f.elements.implementationStatus.value = ''; }
      f.requestSubmit(); return;
    }
    if (listState && (b.hasAttribute('data-ws-view') || b.hasAttribute('data-ws-next') || b.hasAttribute('data-ws-prev'))) {
      if (b.dataset.wsView) { listState.view = b.dataset.wsView; write('view', listState.view, true); }
      else listState.page += b.hasAttribute('data-ws-next') ? 1 : -1;
      renderListPage(listState); return;
    }
    if (b.hasAttribute('data-ws-density')) {
      const next = root.dataset.wsDensity === 'compact' ? 'comfortable' : 'compact'; write('density', next, true); root.dataset.wsDensity = next;
      b.textContent = next === 'compact' ? '여유 있게 보기' : '촘촘하게 보기'; return;
    }
    if (b.hasAttribute('data-ws-notices-open') || b.hasAttribute('data-ws-notices-close')) $$('#siteNoticesPage .ops-notice').filter(n => !n.hidden).forEach(n => n.open = b.hasAttribute('data-ws-notices-open'));
  });
  root.addEventListener('change', e => {
    if (listState && e.target.matches('[data-ws-sort],[data-ws-size]')) {
      if (e.target.hasAttribute('data-ws-sort')) listState.sort = e.target.value;
      else { listState.size = Number(e.target.value); write('size', listState.size, true); }
      listState.page = 1; renderListPage(listState);
    } else if (e.target.closest('#filterForm') && e.target.matches('select')) e.target.closest('form').requestSubmit();
  });
  root.addEventListener('input', e => { if (e.target.hasAttribute('data-ws-notice-search')) filterNotices(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-route],[data-action]'); if (!b) return;
    if (route() === 'list' && (b.dataset.action === 'detail' || /^(detail|person)\//.test(b.dataset.route || ''))) saveList();
    if (route() === 'detail' && b.dataset.route === 'list') {
      const saved = read('last-list', {}); if (/^#list(?:\?|$)/.test(saved.hash || '')) { b.dataset.route = saved.hash.slice(1); restoring = true; }
    }
  }, true);
  window.addEventListener('hashchange', schedule);
  enhance();
})();
