import {escapeOperationsHtml as esc, formatOperationsDate} from '../operations/operations-core.js?v=2.7.0';
import {proposalYear} from './workspace-core.js?v=2.9.5';
import {isPendingCeo} from '../ui/workflow-progress.js?v=2.9.17';

const submitted = p => p?.id && !p.deleted_at && p.is_deleted !== true && p.status !== '삭제' &&
  p.ceo_submission_status === '상신완료' && ['미지급','예정'].includes(p.payment_status);

export function recallCandidates(proposals, summaries) {
  const byId = new Map(summaries.map(s => [s.proposal_id,s]));
  return proposals.filter(p => submitted(p) && isPendingCeo(p,byId.get(p.id)))
    .map(p => ({...p,summary:byId.get(p.id)}))
    .sort((a,b) => String(a.summary.actionable_at || '').localeCompare(String(b.summary.actionable_at || '')) || String(a.proposal_no).localeCompare(String(b.proposal_no)));
}

export function reviewRecall(rows, selection, input) {
  const ids = [...new Set(selection)];
  const reason = String(input || '').trim();
  if (ids.length > 200) throw new Error('한 번에 200건까지 회수할 수 있습니다.');
  if (!ids.length) throw new Error('회수할 제안을 선택하세요.');
  if ([...reason].length < 5 || [...reason].length > 1000) throw new Error('회수 사유를 5~1,000자로 입력하세요.');
  const byId = new Map(rows.map(p => [p.id,p]));
  const selected = ids.map(id => byId.get(id));
  if (selected.some(p => !p || !isPendingCeo(p,p.summary) || typeof p.updated_at !== 'string' || !Number.isFinite(Date.parse(p.updated_at)))) {
    throw new Error('선택한 제안의 상신 상태 또는 변경 시각을 다시 조회하세요.');
  }
  return {ids, reason, selected, expected:Object.fromEntries(selected.map(p => [p.id,p.updated_at]))};
}

export function createCeoRecall({root, store, loadProposals, getAdmin, navigate, header, onSaved}) {
  let generation = 0;
  function suspend() { generation++; }

  async function render({year = 'all', proposalId = ''} = {}) {
    const version = ++generation;
    if (!getAdmin()?.isSystemAdmin) {
      root.innerHTML = '<section class="empty-state"><h2>시스템 관리자 권한을 확인하세요.</h2></section>';
      return;
    }
    const route = globalThis.location?.hash;
    root.innerHTML = header('대표상신 회수','대표이사 결재 대기 중인 제안을 선택하여 재심사로 돌려보냅니다.','ceo-recall') +
      '<section class="wf-panel wf-recall" data-recall-panel aria-label="대표상신 회수"></section>';
    const panel = root.querySelector('[data-recall-panel]');
    const active = () => generation === version && route === globalThis.location?.hash && root.contains(panel) && getAdmin()?.isSystemAdmin === true;
    let rows = [], selected = new Set(), reason = '', error = '', review = null, phase = 'loading', initial = proposalId;
    let receiptNote = '';
    const visible = () => rows.filter(p => year === 'all' || proposalYear(p) === year);
    const label = p => `<strong>${esc(p.proposal_no)} · ${esc(p.title)}</strong><small>${esc([p.department,p.proposer_name].filter(Boolean).join(' · '))}</small>`;
    const option = y => `<option value="${esc(y)}" ${y === year ? 'selected' : ''}>${y === 'all' ? '전체 연도' : y === 'unknown' ? '접수연도 미확인' : esc(y)+'년'}</option>`;
    const alert = () => error ? `<p class="wf-error" role="alert">${esc(error)}</p>` : '';

    function paint() {
      if (!active()) return;
      if (phase === 'loading') { panel.innerHTML = '<p role="status">대표 결재 대상을 확인하고 있습니다.</p>'; return; }
      if (phase === 'error') { panel.innerHTML = alert()+'<button class="button button-secondary" type="button" data-rc-load>현재 상태 다시 조회</button>'; return; }
      if (phase === 'done') {
        panel.innerHTML = `<h2>대표상신 ${review.ids.length}건 회수 완료</h2>
          <p>각 제안의 심사 내용을 확인한 뒤 기존 상신 절차로 다시 제출할 수 있습니다.</p><p class="wf-reason"><b>회수 사유</b> ${esc(review.reason)}</p>
          <ul class="wf-recall-list">${review.selected.map(p => `<li><div>${label(p)}</div><button type="button" class="wf-link" data-rc-edit="${esc(p.id)}">${p.summary.legacy_direct ? '기존 심사점수 검토' : '3차 재심사 열기'}</button></li>`).join('')}</ul>
          ${receiptNote ? `<p role="status">${esc(receiptNote)}</p>` : ''}<button type="button" class="button button-secondary" data-rc-load>회수 대상 다시 조회</button>`;
        return;
      }
      if (phase === 'review' || phase === 'saving') {
        const locked = phase === 'saving';
        panel.innerHTML = `<h2>대표상신 회수 전 확인</h2><p>선택한 ${review.ids.length}건의 대표이사 결재 대기와 미발송 알림을 종료합니다. 기존 심사와 이전 결재 기록은 보존됩니다.</p>
          <ul class="wf-recall-list">${review.selected.map(p => `<li><div>${label(p)}</div></li>`).join('')}</ul>
          <p class="wf-reason"><b>회수 사유</b> ${esc(review.reason)}</p><div class="wf-actions">
          <button type="button" class="button button-secondary" data-rc-back ${locked ? 'disabled' : ''}>선택 수정</button>
          <button type="button" class="button button-primary" data-rc-save ${locked ? 'disabled' : ''}>${locked ? '회수 처리 중…' : review.ids.length+'건 회수 확정'}</button></div>`;
        return;
      }
      const matches = visible();
      const years = [...new Set([year,...rows.map(proposalYear)])].filter(y => y !== 'all').sort().reverse();
      panel.innerHTML = `<div class="wf-recall-heading"><div><h2>회수 가능한 상신</h2><p>대표 결재 대기 ${matches.length}건</p></div>
        <label class="wf-year">접수 연도<select data-rc-year>${['all',...years].map(option).join('')}</select></label></div>
        ${initial && !matches.some(p => p.id === initial) ? '<p class="wf-note">지정한 제안은 현재 선택한 연도의 회수 대상에 없습니다.</p>' : ''}
        ${matches.length ? `<fieldset class="wf-pick"><legend>회수할 제안</legend>
        ${matches.map(p => `<label><input type="checkbox" data-rc-id="${esc(p.id)}" ${selected.has(p.id) ? 'checked' : ''} ${!p.updated_at ? 'disabled' : ''}><span>${label(p)}
        <small>${p.updated_at ? '상신 · '+esc(formatOperationsDate(p.summary.actionable_at)) : '변경 시각 미기록 · 선택 불가'}</small></span></label>`).join('')}</fieldset>
        <label class="wf-reason-field">회수 사유 <small>5~1,000자</small><textarea rows="3" data-rc-reason required>${esc(reason)}</textarea></label>
        <div data-rc-alert>${alert()}</div><button class="button button-primary" type="button" data-rc-review>선택 ${selected.size}건 검토</button>` : '<p>이 연도에 회수할 대표상신이 없습니다.</p>'}`;
    }

    async function load() {
      phase = 'loading'; error = ''; selected.clear(); review = null;
      paint();
      try {
        const proposals = await loadProposals();
        if (!active()) return;
        if (!Array.isArray(proposals)) throw new Error('제안 목록 응답을 확인할 수 없습니다.');
        const ids = proposals.filter(submitted).map(p => p.id);
        const summaries = [];
        for (let i=0; i<ids.length; i+=500) {
          const batch = ids.slice(i,i+500);
          const result = await store.getWorkflowSummaries(batch);
          if (!active()) return;
          if (!Array.isArray(result) || !batch.every(id => result.some(row => row.proposal_id === id && row.stage_key && Array.isArray(row.records)))) {
            throw new Error('일부 제안의 최신 결재 상태를 확인할 수 없습니다.');
          }
          summaries.push(...result);
        }
        rows = recallCandidates(proposals,summaries);
        if (initial && visible().some(p => p.id === initial && p.updated_at)) selected.add(initial);
        phase = 'choose';
      } catch (e) {
        phase = 'error'; error = '상신 대상 조회 실패 · '+(e.message || '연결을 확인하세요.');
      }
      paint();
    }

    async function save() {
      if (phase !== 'review' || !active()) return;
      phase = 'saving'; paint();
      try {
        const result = await store.recallCeoSubmissions(review.ids,review.reason,review.expected);
        if (result?.recalled_count !== review.ids.length || !Array.isArray(result.proposal_ids) ||
          result.proposal_ids.length !== review.ids.length || !review.ids.every(id => result.proposal_ids.includes(id))) {
          throw new Error('회수 결과를 확인하지 못했습니다.');
        }
      } catch (e) {
        phase = 'error'; initial = ''; error = (e.message || '회수 결과 확인 실패')+' 현재 상태를 다시 조회한 후 선택하세요.';
        paint(); return;
      }
      phase = 'done'; initial = ''; reason = ''; receiptNote = ''; paint();
      try { await onSaved?.(); }
      catch { receiptNote = '회수는 완료되었습니다. 목록을 새로 불러오지 못해 현재 상태를 다시 조회해야 합니다.'; paint(); }
    }

    panel.addEventListener('input',event => {
      if (active() && phase === 'choose' && event.target.hasAttribute('data-rc-reason')) reason = event.target.value;
    });
    panel.addEventListener('change',event => {
      if (!active() || phase !== 'choose') return;
      if (event.target.hasAttribute('data-rc-year')) {
        year = event.target.value; initial = ''; selected.clear(); error = ''; paint();
      } else if (event.target.hasAttribute('data-rc-id')) {
        const id = event.target.dataset.rcId;
        if (event.target.checked) selected.add(id); else selected.delete(id);
        panel.querySelector('[data-rc-review]').textContent = '선택 '+selected.size+'건 검토';
      }
    });
    panel.addEventListener('click',event => {
      if (!active()) return;
      const btn = event.target.closest('button');
      if (!btn || btn.disabled) return;
      if (btn.hasAttribute('data-rc-load') && ['done','error'].includes(phase)) { void load(); return; }
      if (btn.hasAttribute('data-rc-edit') && phase === 'done') {
        const p = review.selected.find(p => p.id === btn.dataset.rcEdit);
        if (p) navigate(`admin/${p.summary.legacy_direct ? 'legacy-score' : 'edit'}/${encodeURIComponent(p.id)}`);
        return;
      }
      if (btn.hasAttribute('data-rc-back') && phase === 'review') { phase = 'choose'; error = ''; paint(); return; }
      if (btn.hasAttribute('data-rc-save')) { void save(); return; }
      if (btn.hasAttribute('data-rc-review') && phase === 'choose') {
        try {
          review = reviewRecall(visible(),selected,reason);
          phase = 'review'; paint();
        } catch (e) {
          error = e.message;
          panel.querySelector('[data-rc-alert]').innerHTML = alert();
        }
      }
    });
    await load();
  }
  return {render,suspend};
}
