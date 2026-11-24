import {escapeOperationsHtml as esc, formatOperationsDate} from '../operations/operations-core.js?v=2.7.0';
import {reviewStages} from './review-stages.js?v=2.9.12-original';
import {proposalYear} from '../admin/workspace-core.js?v=2.9.5';

import {isBelowStandardClosed,isLegacyReassessment,isInactiveUnsigned} from '../review/pending-policy.js?v=2.9.19';
const selector = '[data-workflow-proposal]';
const retry = '<button class="wf-link" type="button" data-wf-retry>다시 조회</button>';
const message = (value, action = '') => `<div class="wf-message" role="status">${esc(value)} ${action}</div>`;
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

export function isPendingCeo(proposal, summary) {
  if (proposal?.ceo_submission_status !== '상신완료' || !['미지급','예정'].includes(proposal.payment_status) ||
    summary?.proposal_id !== proposal.id || summary.stage_key !== 'ceo' || !Array.isArray(summary.records)) return false;
  const records = summary.records.filter(row => row.role_name === '대표이사');
  return records.length === 1 && records[0].status === '대기' && !records[0].acted_at && !records[0].approver_name;
}

function approval(records, role, exempt, terminated=false) {
  const record = records.find(row => row.role_name === role);
  if (terminated && isInactiveUnsigned(record)) return {value:'대상 제외',status:'2차 기준미달로 종결'};
  if (!record?.status) return {value:exempt ? '기존건 결재 제외' : '승인 기록 없음', status:''};
  const actor = record.status === '대기' ? record.assigned_name : record.approver_name;
  return {value:record.status === '대기' && !record.actionable_at ? '처리 전' : record.status || '상태 미기록',
    status:[actor, record.acted_at && formatOperationsDate(record.acted_at)].filter(Boolean).join(' · ')};
}

export function renderWorkflow(proposal, summary, {compact = false, admin = false} = {}) {
  const downstream=(summary.records||[]).filter(r=>['해당부서 임원','대표이사'].includes(r.role_name));
  const terminated=isBelowStandardClosed(proposal) && Array.isArray(summary.records) && downstream.length>0 && downstream.every(isInactiveUnsigned);
  const reassessment=isLegacyReassessment(proposal);
  const stage = terminated?'기준미달 · 미채택 종결':reassessment?'재평가 대기':summary.current_stage;
  const role = terminated||reassessment?'':summary.current_role || '';
  const assignee = terminated||reassessment?'':summary.assignee_name || (role ? '담당자 미기록' : '');
  const timing = !terminated&&!reassessment&&validTime(summary.actionable_at);
  const days = summary.pending_days;
  const wait = timing && Number.isInteger(days) && days >= 0 ? `대기 ${days}일` : '';
  const next = terminated?'결과 확인 · 후속 결재 없음':reassessment?'기존 심사점수 재평가 저장':summary.next_action || '다음 작업 미기록';
  const actor = [role, assignee].filter((part, index, all) => part && all.indexOf(part) === index).join(' · ');
  if (compact) return `<div class="wf-compact" aria-label="결재 진행"><strong>${esc(stage)}</strong><span>${esc([actor, wait].filter(Boolean).join(' · '))}</span><small>다음 · ${esc(next)}</small></div>`;
  const [first, team, third] = reviewStages(proposal).stages;
  const exempt = proposal.approval_required === false || summary.legacy_direct;
  const stages = [
    ['1차 본인평가', first],
    ['2차 팀장평가', team],
    ['임원 결재', approval(summary.records, '해당부서 임원', exempt, terminated)],
    ['3차 심사', terminated?{value:'대상 제외',status:'기준미달'}:third],
    ['대표이사 결재', approval(summary.records, '대표이사', exempt && !summary.legacy_direct, terminated)]
  ];
  const id = encodeURIComponent(proposal.id);
  const year = proposalYear(proposal);
  return `<section class="wf-panel" aria-label="평가·결재 진행">
    <h2>평가·결재 진행</h2><div class="wf-current"><div><strong>${esc(stage)}</strong><span>${esc(actor)}</span></div>
    ${role || timing ? `<div><strong>${esc(wait || '대기기간 미확인')}</strong><span>${timing ? '시작 '+esc(formatOperationsDate(summary.actionable_at)) : '시작일 미기록'}</span></div>` : ''}</div>
    <p class="wf-next"><b>다음 작업</b> ${esc(next)}</p>
    ${summary.legacy_direct ? '<p class="wf-note">기존 심사 총점으로 대표이사 직접 상신 · 이전 단계는 저장된 기록만 표시합니다.</p>' : ''}
    <ol class="wf-stages">${stages.map(([label, data]) => `<li><span>${esc(label)}</span><strong>${esc(data.value)}</strong><small>${esc(data.status)}</small></li>`).join('')}</ol>
    <div class="wf-separate"><span>실시 <b>${esc(proposal.implementation_status || '미기록')}</b></span><span>포상금 지급 <b>${esc(proposal.payment_status || '미기록')}</b></span></div>
    ${admin ? `<div class="wf-actions"><button type="button" class="wf-link" data-wf-go="admin/history/${esc(id)}">제안 변경이력</button>${isPendingCeo(proposal, summary) ? `<button type="button" class="wf-link" data-wf-go="admin/ceo-recall?year=${esc(year)}&amp;proposal=${esc(id)}">대표상신 회수 검토</button>` : ''}</div>` : ''}
  </section>`;
}

export function createWorkflowProgress({root, store, getProposals, getAdmin, navigate}) {
  let generation = 0;
  let observer;
  let active = false;
  const cache = new Map();
  const hash = () => globalThis.location?.hash;

  function paint() {
    const proposals = new Map(getProposals().map(p => [p.id,p]));
    for (const el of root.querySelectorAll(selector)) {
      const id = el.dataset.workflowProposal;
      const item = cache.get(id);
      let html;
      if (item?.error) html = message(item.error, retry);
      else if (!item?.summary) html = message('진행상태를 조회하고 있습니다.');
      else if (!proposals.has(id)) html = message('제안 원본을 확인할 수 없습니다.', retry);
      else html = renderWorkflow(proposals.get(id), item.summary, {compact:el.hasAttribute('data-workflow-compact'), admin:getAdmin()?.isSystemAdmin === true});
      // The browser normalizes innerHTML, so compare our own last output.
      if (lastPaint.get(el) !== html) { el.innerHTML = html; lastPaint.set(el,html); }
    }
  }
  const lastPaint = new WeakMap();

  async function read(ids, version, route) {
    try {
      const rows = await store.getWorkflowSummaries(ids);
      if (!active || version !== generation || route !== hash()) return;
      if (!Array.isArray(rows)) throw new Error('진행상태 응답을 확인할 수 없습니다.');
      const byId = new Map(rows.map(row => [row.proposal_id,row]));
      for (const id of ids) {
        const row = byId.get(id);
        cache.set(id, row?.current_stage && Array.isArray(row.records) ? {summary:row} : {error:'진행 기록을 조회하지 못했습니다.'});
      }
    } catch (error) {
      if (!active || version !== generation || route !== hash()) return;
      for (const id of ids) cache.set(id,{error:`진행상태 조회 실패 · ${error.message || '연결을 확인하세요.'}`});
    }
    paint();
  }

  function onClick(event) {
    const btn = event.target.closest('[data-wf-retry],[data-wf-go]');
    if (!btn || !root.contains(btn)) return;
    if (btn.dataset.wfGo) { if (getAdmin()?.isSystemAdmin) navigate(btn.dataset.wfGo); return; }
    const holder = btn.closest(selector);
    if (holder) { cache.delete(holder.dataset.workflowProposal); void refresh(); }
  }

  async function refresh() {
    if (!active) {
      active = true;
      root.addEventListener('click',onClick);
      const Observer = root.ownerDocument?.defaultView?.MutationObserver || globalThis.MutationObserver;
      if (Observer) {
        observer = new Observer(mutations => {
          if (mutations.some(m => m.type === 'attributes' || Array.from(m.addedNodes).some(n => n.matches?.(selector) || n.querySelector?.(selector)))) void refresh();
        });
        observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['data-workflow-proposal','data-workflow-compact']});
      }
    }
    const ids = [...new Set(Array.from(root.querySelectorAll(selector), el => el.dataset.workflowProposal))].filter(id => id && !cache.has(id));
    for (const id of ids) cache.set(id,{});
    paint();
    const requests = [];
    for (let i = 0; i < ids.length; i += 500) requests.push(read(ids.slice(i,i+500), generation, hash()));
    await Promise.all(requests);
  }
  function invalidate() {
    generation++;
    cache.clear();
    if (active) return refresh();
  }
  function suspend() {
    generation++;
    active = false;
    observer?.disconnect();
    cache.clear();
    root.removeEventListener('click',onClick);
  }
  return {refresh,invalidate,suspend};
}
