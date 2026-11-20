import {escapeOperationsHtml as esc, formatOperationsDate} from '../operations/operations-core.js?v=2.7.0';

const categories = {
  status:'진행상태', approval:'결재', audit:'일반 변경', identity:'제안자·부서', score:'평가점수',
  content:'제안 내용', review:'심사', recall:'대표상신 회수', payment:'포상금 지급', committee:'심사위원'
};
const fields = {
  title:'제안명', department:'부서', proposer_name:'제안자', category:'제안 구분', status:'업무상태', review_result:'심사결과',
  score:'점수', award_grade:'포상등급', award_amount:'포상금', payment_status:'지급상태', effect_amount:'효과금액',
  review_comment:'심사의견', implementation_status:'실시상태', implementing_department:'시행부서', implemented_date:'실시일',
  first_evaluation_total:'1차 총점', team_leader_evaluation_total:'2차 총점', second_evaluation_total:'3차 총점',
  ceo_submission_status:'대표상신 상태', current_problem:'현재 문제점', improvement_plan:'개선방안', expected_effect:'기대효과'
};
const dayFormat = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
const lookup = (map, key) => Object.hasOwn(map,key) ? map[key] : key || '미기록';
const show = value => value === null || value === undefined ? '값 없음' : typeof value === 'string' ? value || '빈 값' : JSON.stringify(value,null,2);

export function filterHistory(items, {category = '', from = '', to = '', keyword = ''} = {}) {
  const query = keyword.trim().toLocaleLowerCase('ko');
  return items.filter(item => {
    if (category && item.category !== category) return false;
    if (from || to) {
      if (!item.happened_at || !Number.isFinite(Date.parse(item.happened_at))) return false;
      const date = dayFormat.format(new Date(item.happened_at));
      if ((from && date < from) || (to && date > to)) return false;
    }
    return !query || [lookup(categories,item.category), lookup(fields,item.field_name), item.field_name, item.actor_name, item.detail,
      item.reason, show(item.before), show(item.after)].join(' ').toLocaleLowerCase('ko').includes(query);
  });
}

export function historyCount(matches, loaded, more) {
  return more ? `불러온 ${loaded}건 중 ${matches}건 일치 · 더 오래된 이력이 있습니다.` : `전체 ${loaded}건 중 ${matches}건 일치`;
}

function entry(item) {
  return `<article class="wf-entry"><div class="wf-entry-head"><strong>${esc(lookup(categories,item.category))}</strong>
    <time datetime="${esc(item.happened_at)}">${esc(formatOperationsDate(item.happened_at))}</time></div>
    <p>${esc(item.detail || lookup(fields,item.field_name))}</p><small>처리자 · ${esc(item.actor_name || '미기록')}${item.field_name ? '　항목 · '+esc(lookup(fields,item.field_name)) : ''}</small>
    ${item.reason ? `<p class="wf-reason"><b>사유</b> ${esc(item.reason)}</p>` : '<small class="wf-reason">사유 미기록</small>'}
    <details><summary>변경 전·후 보기</summary><div class="wf-diff"><div><b>변경 전</b><pre>${esc(show(item.before))}</pre></div>
    <div><b>변경 후</b><pre>${esc(show(item.after))}</pre></div></div></details></article>`;
}

export function createProposalHistory({root, store, getAdmin, navigate, header}) {
  let generation = 0;
  function suspend() { generation++; }

  async function render(proposal) {
    const version = ++generation;
    if (!getAdmin()?.isSystemAdmin || !proposal?.id) {
      root.innerHTML = '<section class="empty-state"><h2>제안 또는 관리자 권한을 확인하세요.</h2></section>';
      return;
    }
    const route = globalThis.location?.hash;
    root.innerHTML = header('제안 변경이력','선택한 제안의 심사·결재·수정 이력을 최신순으로 확인합니다.','audit') +
      `<section class="wf-panel wf-history" data-history-panel><button class="wf-link" type="button" data-history-back>← 제안 상세</button>
      <h2>${esc(proposal.proposal_no)} · ${esc(proposal.title)}</h2>
      <div class="wf-filter"><label>이력 유형<select name="category"><option value="">전체 유형</option>${Object.entries(categories).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
      <label>시작일<input type="date" name="from"></label><label>종료일<input type="date" name="to"></label>
      <label>키워드<input type="search" name="keyword" placeholder="처리자, 사유, 변경값"></label></div>
      <div data-history-results aria-live="polite"></div></section>`;
    const panel = root.querySelector('[data-history-panel]');
    const results = panel.querySelector('[data-history-results]');
    const active = () => version === generation && route === globalThis.location?.hash && root.contains(panel) && getAdmin()?.isSystemAdmin;
    const filters = {category:'',from:'',to:'',keyword:''};
    let items = [], cursor = null, error = '', loading = false, loaded = false;

    function paint() {
      if (!active()) return;
      if (loading && !loaded) { results.innerHTML = '<p role="status">변경이력을 조회하고 있습니다.</p>'; return; }
      const visible = filterHistory(items, filters);
      const invalid = filters.from && filters.to && filters.from > filters.to;
      results.innerHTML = `${invalid ? '<p class="wf-error">종료일은 시작일 이후로 선택하세요.</p>' : ''}
        ${loaded ? `<p class="wf-count">${historyCount(visible.length,items.length,cursor != null)}</p>
        ${visible.map(entry).join('') || (cursor != null ? '<p>현재 불러온 범위에 일치하는 이력이 없습니다.</p>' : '<p>조건에 일치하는 이력이 없습니다.</p>')}` : ''}
        ${error ? `<p class="wf-error" role="alert">변경이력 조회 실패 · ${esc(error)}</p>` : ''}
        ${cursor != null || error ? `<button type="button" class="button button-secondary" data-history-more ${loading ? 'disabled' : ''}>${loading ? '조회 중…' : error ? '다시 조회' : '이전 이력 더 불러오기'}</button>` : ''}`;
    }
    async function load() {
      if (loading || !active()) return;
      loading = true; error = ''; paint();
      try {
        const page = await store.getProposalHistory(proposal.id,{limit:50,cursor});
        if (!active()) return;
        if (!Array.isArray(page?.items) || !Object.hasOwn(page,'next_cursor')) throw new Error('이력 응답을 확인할 수 없습니다.');
        if (page.next_cursor != null && JSON.stringify(page.next_cursor) === JSON.stringify(cursor)) throw new Error('다음 이력의 위치를 확인할 수 없습니다.');
        const known = new Set(items.map(row => row.id));
        items = items.concat(page.items.filter(row => !known.has(row.id)));
        cursor = page.next_cursor;
        loaded = true;
      } catch (e) {
        error = e.message || '연결을 확인하세요.';
      } finally {
        loading = false;
        paint();
      }
    }
    function updateFilter(event) {
      if (!active() || !Object.hasOwn(filters,event.target.name)) return;
      filters[event.target.name] = event.target.value;
      paint();
    }
    panel.addEventListener('input',updateFilter);
    panel.addEventListener('change',updateFilter);
    panel.addEventListener('click',event => {
      if (!active()) return;
      if (event.target.closest('[data-history-more]')) void load();
      if (event.target.closest('[data-history-back]')) navigate('detail/'+encodeURIComponent(proposal.proposal_no));
    });
    await load();
  }
  return {render,suspend};
}
