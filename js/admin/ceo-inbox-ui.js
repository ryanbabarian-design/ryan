import {evaluatorMarkup,committeeMarkup} from './ceo-evaluators.js?v=2.9.14';
import {filterCeoRows} from './ceo-inbox-core.js?v=2.9.14';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v||0).toLocaleString('ko-KR');
const money=v=>v===null?'확인 필요':`${n(v)}원`;

// The three stages use their own stored totals. No scores are calculated or saved here.
function stageCell(row, stage) {
 const value = stage === 'first' ? row.first : stage === 'team' ? row.team : row.score;
 let main, note = '';
 if (stage === 'third' && row.scoreLabel === '점수 없이 결과심사') {
  main = '결과심사'; note = '점수 입력 없음';
 } else if (value !== null && value !== undefined && Number.isFinite(value)) {
  main = `${value}점`;
  if (stage === 'third') note = row.scoreLabel;
 } else if (stage === 'first' && row.firstExempt === true) {
  main = '기존건 면제';
 } else {
  main = row.missing ? '확인 필요' : stage === 'third' ? '점수 미등록' : '미평가';
  if (stage === 'third' && row.scoreLabel === '기존 심사') note = '기존 총점 확인';
 }
 const identity=stage==='third'?`<div data-ceo-committee="${esc(row.no)}" data-ceo-inputter="${esc(row.evaluators?.inputter||'')}">${committeeMarkup(null,row.evaluators?.inputter)}</div>`:evaluatorMarkup(stage==='first'?row.evaluators?.first:row.evaluators?.team);
 return `<td class="ceo-stage" data-ceo-stage="${stage}"><strong>${esc(main)}</strong>${note ? `<small>${esc(note)}</small>` : ''}${identity}</td>`;
}

export function renderCeoInbox(allRows,filters={},options={}) {
 const {year='all',query='',department='',result='',view='pending'}=filters;
 const rows=filterCeoRows(allRows,filters),pending=view==='pending';
 const sum=rows.reduce((s,r)=>s+(r.amount??0),0),unknown=rows.filter(r=>r.missing).length;
 const years=[...new Set([String(year),...allRows.map(r=>r.year)].filter(y=>/^\d{4}$/.test(y)))].sort().reverse();
 const departments=[...new Set(allRows.map(r=>r.department).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
 const excluded=year==='all'?0:allRows.filter(r=>r.year!==String(year)).length;
 const base=(patch)=>{const p={...filters,...patch};const q=new URLSearchParams({view:p.view||'pending',year:p.year||'all'});if(p.query)q.set('q',p.query);if(p.department)q.set('department',p.department);if(p.result)q.set('result',p.result);return `admin/inbox?${q}`;};
 return `<section class="ceo-workspace"><div class="ceo-topline"><span>CEO APPROVAL · 2.9.14</span><strong>단계별 평가자·심사결과·지급액 확인 후 승인</strong><button class="button button-ghost" data-action="refresh-ceo-inbox">새로 조회</button></div>
 <nav class="ceo-tabs" aria-label="대표결재 구분">${[['pending','결재대기'],['completed','승인완료'],['rejected','반려·보완']].map(([v,l])=>`<button class="${v===view?'active':''}" data-route="${esc(base({view:v}))}">${l}</button>`).join('')}</nav>
 <div class="ceo-kpis"><article><span>현재 조회 ${pending?'결재대기':'결재내역'}</span><strong>${rows.length}<small>건</small></strong></article><article><span>조회 목록 지급액 합계</span><strong>${money(sum)}</strong><small>${unknown?`금액·결과 미확인 ${unknown}건 별도`:'저장된 심사 지급액 기준'}</small></article><article><span>채택 / 건수처리</span><strong>${rows.filter(r=>r.result==='채택').length}<small> / </small>${rows.filter(r=>r.result==='건수처리').length}<small>건</small></strong></article><article><span>미채택 / 보류 / 중복</span><strong>${rows.filter(r=>['미채택','보류','중복제안'].includes(r.result)).length}<small>건</small></strong></article></div>
 <form id="ceoInboxFilters" class="ceo-filters"><input type="hidden" name="view" value="${esc(view)}"><label>접수연도<select name="year" data-ceo-filter>${years.map(y=>`<option value="${y}" ${y===String(year)?'selected':''}>${y}년</option>`).join('')}<option value="all" ${year==='all'?'selected':''}>전체 연도</option>${allRows.some(r=>r.year==='unknown')?`<option value="unknown" ${year==='unknown'?'selected':''}>접수일 미확인</option>`:''}</select></label><label>부서<select name="department" data-ceo-filter><option value="">전체 부서</option>${departments.map(d=>`<option ${d===department?'selected':''}>${esc(d)}</option>`).join('')}</select></label><label>심사결과<select name="result" data-ceo-filter><option value="">전체 결과</option>${['채택','건수처리','미채택','보류','중복제안','확인 필요'].map(r=>`<option ${r===result?'selected':''}>${r}</option>`).join('')}</select></label><label class="ceo-query">제안·직원 검색<input name="q" value="${esc(query)}" placeholder="접수번호, 제안명, 이름"></label><button class="button button-secondary" type="submit">검색</button></form>
 ${excluded?`<div class="ceo-notice">다른 접수연도 자료 ${excluded}건은 현재 숨겨져 있습니다. <button data-route="${esc(base({year:'all'}))}">전체 연도 보기</button></div>`:''}
 ${options.historyError?'<div class="ceo-notice error" role="alert">결재이력을 불러오지 못했습니다. 빈 목록으로 판단하지 말고 새로 조회하세요.</div>':''}
 ${pending?`<div class="ceo-selection-bar"><div><strong id="ceoApprovalSelection">선택 0건 · 합계 0원</strong><small>선택한 건만 승인합니다. 반려는 내용 검토에서 사유를 입력하세요.</small></div><button id="ceoBatchApproveButton" class="button button-primary" data-action="batch-approve-ceo" disabled>선택 0건 승인</button></div>`:''}
 <div class="ceo-table-scroll" tabindex="0"><table class="ceo-table"><thead><tr><th>${pending?'<label><input type="checkbox" id="ceoApproveAll" aria-label="현재 조회 목록 중 승인 가능한 건 모두 선택"> 선택</label>':'결재'}</th><th>접수번호 · 제안명</th><th>제안자 · 부서</th><th>심사결과</th><th class="ceo-stage">1차 본인 · 평가자</th><th class="ceo-stage">2차 팀장 · 평가자</th><th class="ceo-stage">3차 심사 · 심사위원</th><th class="number">지급액</th><th>진행상태</th><th>검토</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${pending&&r.selectable?`<input class="ceo-approve-checkbox" type="checkbox" value="${esc(r.id)}" data-award="${r.amount}" data-result="${esc(r.result)}" aria-label="${esc(r.no)} 승인 선택">`:esc(r.approval||'확인')}</td><td class="ceo-title"><small>${esc(r.no)} · ${esc(r.date)}</small><strong>${esc(r.title)}</strong></td><td>${esc(r.name)}<small>${esc(r.department)}</small></td><td><span class="ceo-result ${r.result==='채택'||r.result==='건수처리'?'positive':''}">${esc(r.result==='건수처리'?'건수처리 인정':r.result)}</span></td>${stageCell(r,'first')}${stageCell(r,'team')}${stageCell(r,'third')}<td class="number"><strong>${money(r.amount)}</strong>${r.missing?'<small class="ceo-danger">원자료 확인 필요</small>':''}</td><td>${pending?`${r.pendingDays}일 대기`:esc(r.approval)}<small>${esc(r.missing?r.reason:pending&&!r.selectable?r.reason:'')}</small></td><td><button class="button button-small button-secondary" data-route="admin/review/${esc(r.id)}">내용 검토</button></td></tr>`).join(''):'<tr><td colspan="10" class="ceo-empty">조회조건에 맞는 내역이 없습니다.</td></tr>'}</tbody></table></div>

 <p class="ceo-footnote"><button type="button" class="button button-ghost button-small" data-ceo-reviewers-refresh>심사위원 다시 조회</button><br><strong>평가자 구분:</strong> 실제 심사위원과 입력자는 별도입니다. 미확인·미지정 명단은 임의로 채우지 않습니다. 위원 지정은 본인 서명이 아닙니다.<br><strong>평가 구분:</strong> 1차 본인평가 · 2차 팀장평가 · 3차 최종심사. 과거 확정 총점은 ‘기존 심사’, 점수 없이 결정한 건은 ‘결과심사’로 표시합니다. 없는 점수는 만들지 않습니다.<br>심사결과 · 대표승인 · 실제 지급은 서로 다른 단계입니다. 승인만으로 지급완료 처리되지 않습니다. 조회조건을 바꾸면 선택을 초기화합니다.</p></section>`;
}
