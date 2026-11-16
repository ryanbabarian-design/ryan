import { PAID_LEGACY_RESULTS, validatePaidLegacyInput, preservedPaidLegacyFields } from './paid-legacy-policy.js?v=2.9.4';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v==null?'기존 금액 미기록':`${new Intl.NumberFormat('ko-KR').format(Number(v)||0)}원`;
const score=v=>v==null?'기존 기록 없음':`${Number(v)}점`;
const time=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'기록 없음';
export function paidLegacyMarkup(info) {
  const p=info.proposal,allowed=info.allowed===true;
  const history=info.history||[];
  return `<div class="paid-legacy-workspace" data-paid-legacy-version="2.9.4">
    <section class="paid-legacy-heading"><div><span class="eyebrow">LEGACY RESULT CORRECTION · 2.9.4</span><h1>${esc(p.proposal_no)} · 과거 심사결과 정정</h1><p>${esc(p.title)}</p></div><button type="button" class="button button-ghost" data-paid-route="admin">관리자 목록</button></section>
    <section class="paid-legacy-notice"><strong>이미 지급된 과거 기록입니다. 돈을 다시 계산하는 화면이 아닙니다.</strong><p>결과·심사의견만 정정하고 지급액, 지급완료, 1·2·3차 점수와 결재기록은 그대로 남깁니다. 재지급·자동 환수·대표이사 재상신을 하지 않습니다.</p></section>
    <section class="paid-legacy-summary" aria-label="변경 전 저장 기록">
      <div><small>현재 저장된 심사결과</small><strong id="paidLegacyOriginalResult">${esc(p.review_result||'미심사')}</strong></div>
      <div><small>기존 지급 완료액 · 변경 안 함</small><strong id="paidLegacyAmount">${money(p.award_amount)}</strong></div>
      <div><small>지급상태 · 변경 안 함</small><strong>${esc(p.payment_status)}</strong></div>
    </section>
    <section class="paid-legacy-scores" aria-label="기존 평가 기록 보존"><div><small>1차 본인평가</small><b>${score(p.first_evaluation_total)}</b></div><div><small>2차 팀장평가</small><b>${score(p.team_leader_evaluation_total)}</b></div><div><small>3차 항목평가</small><b>${score(p.second_evaluation_total)}</b></div><div><small>과거 최종 심사점수</small><b>${score(p.score)}</b></div></section>
    <p class="paid-legacy-help">기록이 없는 점수는 임의로 채우지 않습니다. 이번 정정은 신규 3차 점수심사가 아닌 기존 기록의 행정상 정정입니다.</p>
    <div class="evaluation-lock-note ${allowed?'evaluation-ready-note':''}" role="status">${esc(info.reason)}</div>
    <form id="paidLegacyForm" class="paid-legacy-form" data-id="${esc(p.id)}">
      <fieldset ${allowed?'':'disabled'}><div class="form-grid two">
        <label class="field">정정할 심사결과 <b>*</b><select name="review_result" required><option value="" disabled ${!PAID_LEGACY_RESULTS.includes(p.review_result)?'selected':''}>심사결과 선택</option>${PAID_LEGACY_RESULTS.map(v=>`<option value="${v}" ${p.review_result===v?'selected':''}>${v==='건수처리'?'건수처리 인정':v}</option>`).join('')}</select><small class="field-help">기존 ‘채택’도 그대로 표시·선택합니다. 선택만으로 저장되지 않습니다.</small></label>
        <div class="field"><span>정정 후 지급기록</span><div class="paid-legacy-fixed">${money(p.award_amount)} · ${esc(p.payment_status)} 유지</div><small class="field-help">미채택으로 바꾸더라도 이미 지급한 기록을 0원으로 지우지 않습니다.</small></div>
      </div>
      <label class="field">심사의견<textarea name="review_comment" rows="4" maxlength="20000">${esc(p.review_comment||'')}</textarea></label>
      <label class="field">정정 사유 <b>*</b><textarea name="reason" rows="3" minlength="5" maxlength="1000" required placeholder="예: 과거 제안의 중복 여부 재확인에 따른 심사결과 정정"></textarea><small class="field-help">변경 전후 결과·의견, 관리자와 정정일시를 별도 이력으로 남깁니다.</small></label>
      <div class="paid-legacy-change" id="paidLegacyChange" aria-live="polite">저장할 결과를 확인하세요. 기존 지급액은 변경하지 않습니다.</div>
      <label class="paid-legacy-consent"><input type="checkbox" name="preserve_payment" required> 기존 지급금액·지급완료·평가점수·결재기록을 보존하고, 결과·의견만 정정합니다.</label>
      <div class="paid-legacy-actions"><button type="button" class="button button-ghost" data-paid-route="admin">취소</button><button type="submit" class="button button-primary" ${allowed?'':'disabled'}>지급기록 보존하고 결과 정정 저장</button></div></fieldset>
    </form>
    <div id="paidLegacySaveStatus" role="status" aria-live="polite"></div>
    <section class="paid-legacy-history"><h2>과거 심사결과 정정 이력</h2>${history.length?history.map(h=>`<article><strong>${esc(h.before_result||'미심사')} → ${esc(h.after_result)}</strong><span>${esc(time(h.created_at))} · ${esc(h.actor_name||'관리자')}</span><p>${esc(h.reason)}</p><small>기존 지급액 ${money(h.paid_amount)} 보존 · ${Number(h.revision)}회차 정정</small></article>`).join(''):'<p>아직 정정 이력이 없습니다. 기존 결과를 임의로 변경하지 않았습니다.</p>'}</section>
    <div class="paid-legacy-actions"><button type="button" class="button button-ghost" data-paid-route="detail/${esc(encodeURIComponent(p.proposal_no||''))}">제안 내용·사진 보기</button><button type="button" class="button button-ghost" data-paid-reload>다시 조회</button></div>
  </div>`;
}
export async function mountPaidLegacyEditor(options) {
  const {root,id,store,systemAdmin,navigate,notify,refresh}=options;
  if(!systemAdmin){root.innerHTML='<div class="empty-state"><h2>시스템 관리자 전용 기능입니다.</h2></div>';return;}
  root.innerHTML='<section class="loading-card" data-paid-loading><div class="spinner"></div><p>지급기록과 실제 결재를 확인하고 있습니다.</p></section>';
  const marker=root.firstElementChild;
  let info;
  try{info=await store.getPaidLegacyStatus(id);if(!marker.isConnected)return;root.innerHTML=paidLegacyMarkup(info);}
  catch(error){if(!marker.isConnected)return;root.innerHTML=`<section class="empty-state"><h2>과거 결과 정정 정보를 불러오지 못했습니다.</h2><p>${esc(error.message)}</p><p>확인되지 않은 상태에서 저장을 열지 않습니다.</p><button class="button button-ghost" data-route="admin">관리자 목록</button></section>`;return;}
  const panel=root.firstElementChild,form=panel.querySelector('#paidLegacyForm'),status=panel.querySelector('#paidLegacySaveStatus');
  panel.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.hasAttribute('data-paid-route')){e.preventDefault();e.stopPropagation();navigate(button.dataset.paidRoute);}else if(button.hasAttribute('data-paid-reload')){e.preventDefault();e.stopPropagation();void mountPaidLegacyEditor(options);}});
  const update=()=>{panel.querySelector('#paidLegacyChange').textContent=`${info.proposal.review_result||'미심사'} → ${form.elements.review_result.value||'결과 선택 전'} / 기존 지급액 ${money(info.proposal.award_amount)} · 지급완료 유지. 금액 정산이 필요한 경우 별도로 확인하세요.`;};
  form.elements.review_result.addEventListener('change',update);update();
  form.addEventListener('submit',async e=>{
    e.preventDefault();e.stopPropagation();if(form.dataset.saving==='true'||!info.allowed)return;
    const button=form.querySelector('[type="submit"]');let sent=false;
    try{
      const input=validatePaidLegacyInput({review_result:form.elements.review_result.value,review_comment:form.elements.review_comment.value,
        reason:form.elements.reason.value,expectedUpdatedAt:info.proposal.updated_at,preservePayment:form.elements.preserve_payment.checked});
      if(!confirm(`${info.proposal.proposal_no}: ${info.proposal.review_result||'미심사'} → ${input.review_result}\n기존 지급액 ${money(info.proposal.award_amount)} 및 지급완료·점수·결재기록은 보존합니다.\n재지급·환수·재상신이 아닙니다. 결과를 정정하시겠습니까?`))return;
      form.dataset.saving='true';button.disabled=true;button.textContent='결과 정정 저장 중…';status.textContent='';
      sent=true;const saved=await store.savePaidLegacyResult(id,input);
      if(!preservedPaidLegacyFields(info.proposal,saved.proposal))throw new Error('기존 지급·점수·결재정보의 보존 여부를 확인하지 못했습니다.');
      const verified=await store.getPaidLegacyStatus(id);
      if(verified.proposal.review_result!==input.review_result || verified.proposal.review_comment!==input.review_comment ||
        Number(verified.proposal.legacy_result_revision)!==Number(info.proposal.legacy_result_revision||0)+1 ||
        !preservedPaidLegacyFields(info.proposal,verified.proposal))throw new Error('다시 조회한 결과가 저장 내용과 다릅니다.');
      await refresh();if(!panel.isConnected)return;
      await mountPaidLegacyEditor(options);
      const note=root.querySelector('#paidLegacySaveStatus');if(note){note.className='evaluation-lock-note evaluation-ready-note';note.textContent=`정정 저장·재조회 확인 완료: ${input.review_result}. 기존 지급액 ${money(verified.proposal.award_amount)} 및 지급완료 기록 유지.`;}
      notify('과거 심사결과 정정 완료 · 기존 지급기록 보존');
    }catch(error){if(status.isConnected){status.className='evaluation-lock-note';status.textContent=(sent?'저장 결과 확인이 완료되지 않았습니다. 반복 저장하지 말고 다시 조회하세요. ':'')+(error.message||String(error));}}
    finally{delete form.dataset.saving;if(button.isConnected){button.disabled=!info.allowed;button.textContent='지급기록 보존하고 결과 정정 저장';}}
  });
}
