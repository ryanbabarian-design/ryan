import {LEGACY_RESULTS,hasLegacyScore,validateLegacyScoreInput} from './legacy-score-policy.js?v=2.9.5';
import {awardForScore,validAwardScore} from './award-policy.js?v=2.9.1';
const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>`${Number(x||0).toLocaleString('ko-KR')}원`;
export async function mountLegacyScoreEditor({root,id,store,systemAdmin,navigate,notify,refresh}){
 if(!systemAdmin){root.innerHTML='<section class="empty-state"><h2>시스템 관리자 전용입니다.</h2></section>';return;}
 const route=location.hash;
 root.innerHTML='<section class="loading-card">기존 심사기록과 실제 결재 상태를 확인하고 있습니다.</section>';
 try{
  const info=await store.getLegacyScoreStatus(id);if(location.hash!==route)return;
  const p=info.proposal; const registered=hasLegacyScore(p);const year=String(p.received_date||'').slice(0,4)||'all';
  const result=LEGACY_RESULTS.includes(p.review_result)?p.review_result:'';
  root.innerHTML=`<section class="page-header"><div><span class="eyebrow">LEGACY SCORE · 2.9.5</span><h1 style="color:white">${e(p.proposal_no)} 기존 심사점수 등록</h1><p style="color:#d6e2ef">${e(p.title)}</p></div><button class="button button-secondary" data-route="admin">관리자 목록</button></section>
  <section class="form-section legacy-score-box"><h2>기존 확정 총점 → 대표이사 상신</h2><p>기존 심사 총점만 기록합니다. 없는 1·2차 점수와 3차 6개 항목은 만들지 않습니다.</p><div class="evaluation-lock-note">${e(info.reason)}</div>
  <div class="detail-summary-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div><small>현재 저장 총점</small><strong>${p.score==null?'없음':e(p.score)+'점'}</strong></div><div><small>저장된 결과</small><strong>${e(p.review_result)}</strong></div><div><small>지급상태</small><strong>${e(p.payment_status)}</strong></div><div><small>대표결재</small><strong>${e(p.ceo_submission_status||'미상신')}</strong></div></div>
  <form id="legacyScoreForm" class="proposal-form" data-version="2.9.5"><fieldset ${info.allowed?'':'disabled'} style="border:0;padding:0;margin:16px 0">
  <div class="form-grid two"><label class="field">기존 심사 총점 (0~100점)<input name="score" type="number" min="0" max="100" step="1" required value="${p.score==null?'':e(p.score)}" placeholder="예: 기존 평가표의 80점"></label>
  <label class="field">기존 확정 심사결과<select name="result" required><option value="">결과 선택</option>${LEGACY_RESULTS.map(r=>`<option ${result===r?'selected':''}>${r}</option>`).join('')}</select></label></div>
  <label class="field">기존 심사 근거 (필수)<textarea name="basis" rows="2" minlength="5" maxlength="1000" required placeholder="예: 기존 제안 평가표에서 총점 80점 확인">${e(p.legacy_score_basis||'')}</textarea></label>
  <label class="field">등록·수정 사유 (필수)<textarea name="reason" rows="2" minlength="5" maxlength="1000" required placeholder="예: 누락된 과거 확정 심사점수를 등록하여 대표이사 상신"></textarea></label>
  <div class="award-preview"><small>대표이사 승인 전 지급 예정액</small><strong id="legacyScoreAward">미확정</strong><span>기존 총점 기준으로 계산합니다. 지급완료 처리나 자동 상신이 아닙니다.</span></div>
  <label class="check-label"><input name="confirm" type="checkbox" required> 원본 심사자료에 근거한 총점이며, 1·2차 및 항목별 점수를 임의로 만들지 않는 것을 확인합니다.</label>
  <div style="margin-top:16px"><button type="submit" class="button button-primary">기존 심사점수 저장</button></div></fieldset></form>
  ${registered?`<div class="evaluation-lock-note"><strong>기존 심사 ${e(p.score)}점 · ${e(p.review_result)} · ${money(p.award_amount)}</strong><p>등록 시각: ${e(p.legacy_score_registered_at)} · 입력자: ${e(p.legacy_score_recorded_by_name||'관리자')}<br>위 시각은 이번 입력 시각이며 과거 심사일을 뜻하지 않습니다.</p><button class="button button-primary" data-route="admin/ceo-submit?year=${e(year)}&q=${e(p.proposal_no)}">대표이사 상신 목록으로</button></div>`:''}
  <details style="margin-top:18px"><summary>등록 이력 ${(info.history||[]).length}건</summary>${(info.history||[]).map(h=>`<p>${e(h.created_at)} · ${e(h.actor_name)} · ${e(h.before_score??'-')} → ${e(h.after_score)}점 · ${e(h.reason)}</p>`).join('')}</details></section>`;
  const f=root.querySelector('#legacyScoreForm');
  const preview=()=>{const n=validAwardScore(f.elements.score.value),r=f.elements.result.value;const dest=root.querySelector('#legacyScoreAward');dest.textContent=n===null||!r?'미확정':r==='건수처리'&&(n<50||n>65)?'건수처리 점수 확인 필요':r==='채택'&&n<50?'채택 점수 확인 필요':`${money(awardForScore(n,r).amount)} · 기존 심사 ${n}점`;};preview();f.addEventListener('input',preview);f.addEventListener('change',preview);
  f.addEventListener('submit',async ev=>{ev.preventDefault();ev.stopPropagation();if(f.dataset.saving)return;
   const button=f.querySelector('[type=submit]');
   try{const checked=validateLegacyScoreInput({score:f.elements.score.value===''?null:Number(f.elements.score.value),result:f.elements.result.value,basis:f.elements.basis.value,reason:f.elements.reason.value,expectedUpdatedAt:p.updated_at,confirm:f.elements.confirm.checked});
    if(!confirm(`${p.proposal_no}\n기존 심사 ${checked.score}점 · ${checked.result}\n지급 예정액 ${money(checked.award.amount)}\n1·2차/항목별 점수·결재기록은 유지됩니다.\n기록을 저장할까요? (대표상신은 다음 단계)`))return;
    f.dataset.saving='true';button.disabled=true;button.textContent='저장·재조회 확인 중';const {award,...input}=checked;
    await store.saveLegacyScore(id,input);const readback=await store.getLegacyScoreStatus(id);
    if(!hasLegacyScore(readback.proposal)||Number(readback.proposal.score)!==checked.score||readback.proposal.review_result!==checked.result||Number(readback.proposal.award_amount)!==checked.award.amount)throw new Error('저장 요청 후 점수·금액 재확인이 필요합니다. 중복 저장하지 말고 새로고침하세요.');
    await refresh();notify('기존 심사점수를 저장했습니다. 대표이사 상신 목록에서 확인하세요.');await mountLegacyScoreEditor({root,id,store,systemAdmin,navigate,notify,refresh});
   }catch(err){notify(err.message||String(err),'error');}finally{delete f.dataset.saving;if(button.isConnected){button.disabled=!info.allowed;button.textContent='기존 심사점수 저장';}}});
 }catch(err){if(location.hash===route)root.innerHTML=`<section class="empty-state"><h2>기존 심사점수 화면을 열지 못했습니다.</h2><p>${e(err.message||String(err))}</p><p>V2.9.5 SQL 적용 여부를 확인하세요. 점수는 변경하지 않았습니다.</p></section>`;}
}
