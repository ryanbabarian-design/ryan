/** Admin list only. All edits, reviews and submissions use existing secured routes. */
import { buildWorkspace, readWorkspaceFilters, workspaceRoute, workspaceCsv, currentKoreaYear, QUEUES, RESULT_LABELS, WORKSPACE_VERSION } from './workspace-core.js?v=2.9.5';
import { loadWorkspaceSnapshot } from './workspace-source.js?v=2.9.6';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('ko-KR').format(Number(v)||0)+'원';
const scopeLabel=f=>f.year==='all'?'전체 연도':f.year==='unknown'?'접수일 미확인':`${f.year}년`;
const searchIcon='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
function yearControl(model){const f=model.filters;return `<label class="aw-year" for="adminWorkspaceYear"><span>접수연도</span><select id="adminWorkspaceYear" aria-label="접수연도">${model.years.map(y=>`<option value="${esc(y)}" ${f.year===y?'selected':''}>${esc(y)}년${y===currentKoreaYear()?' · 올해':''}</option>`).join('')}<option value="all" ${f.year==='all'?'selected':''}>전체 연도</option><option value="unknown" ${f.year==='unknown'?'selected':''}>접수일 미확인</option></select></label>`;}
function headerMarkup(model,state,nav){return `<section class="aw-header"><div><span class="aw-eyebrow">REVIEW WORKSPACE · ${WORKSPACE_VERSION}</span><h1>제안 심사 관리</h1><p><strong>${esc(scopeLabel(model.filters))}</strong>에 접수한 제안의 평가와 상신 현황입니다.</p></div><div class="aw-header-actions">${yearControl(model)}<button type="button" class="aw-button" data-ws-refresh>새로고침</button><button type="button" class="aw-button aw-quiet" data-action="logout-admin">로그아웃</button></div></section>${nav||''}`;}
const evalCell=c=>`<span class="aw-eval ${esc(c.tone)}">${esc(c.text)}</span>`;
function rowMarkup(r,f){const p=r.proposal;const tone={review:'blue',reviewed:'teal',submitted:'violet',closed:'muted',archived:'muted',waiting:'amber',check:'red'}[r.group];const amount=r.amount===null?'<span class="aw-unset">미확정</span>':`<strong class="aw-money">${money(r.amount)}</strong><small>${p.payment_status==='완료'?'지급 완료':r.group==='archived'?'과거건 기록 · 지급확정 아님':r.group==='closed'?'대표승인 후':'대표승인 전'}</small>`;
  const resultTone={채택:'ok',건수처리:'info',미채택:'danger',보류:'warn',중복제안:'muted',미심사:'muted'}[r.result]||'muted';
  return `<tr data-workspace-id="${esc(p.id)}">
    <td class="aw-title-cell" data-label="제안"><div class="aw-row-meta"><span class="aw-proposal-no">${esc(p.proposal_no||'번호 미확인')}</span><time>${esc(p.received_date?.slice(0,10)||'접수일 미확인')}</time></div><button type="button" class="aw-title-link" data-ws-go="detail/${esc(encodeURIComponent(p.proposal_no||''))}">${esc(p.title||'제목 없음')}</button></td>
    <td class="aw-person" data-label="제안자"><strong>${esc(p.proposer_name||'-')}</strong><small>${esc(p.department||'부서 미지정')}</small></td>
    <td data-label="1차 본인">${evalCell(r.first)}</td><td data-label="2차 팀장">${evalCell(r.team)}${r.candidate?'<small class="aw-candidate">건수처리 후보</small>':''}</td>
    <td data-label="3차 심사">${evalCell(r.third)}<small class="aw-result ${resultTone}">${esc(r.resultLabel)}</small></td>
    <td class="aw-stage-cell" data-label="현재 단계"><span class="aw-stage ${tone}">${esc(r.label)}</span><small>${esc(r.note)}</small></td>
    <td class="aw-amount" data-label="지급 예정액">${amount}</td>
    <td class="aw-action" data-label="작업">${r.route?`<button type="button" class="aw-button ${r.group==='review'?'aw-primary':''}" data-ws-go="${esc(r.route)}">${esc(r.primary)}</button>`:''}<details class="aw-more"><summary aria-label="${esc(p.proposal_no)} 추가 작업">더보기</summary><div>${p.approval_required===false&&p.payment_status!=="완료"?`<button type="button" data-ws-go="admin/legacy-score/${esc(encodeURIComponent(p.id||''))}">기존 심사점수 등록·대표상신</button>`:''}<button type="button" data-ws-go="detail/${esc(encodeURIComponent(p.proposal_no||''))}">제안 상세</button><button type="button" data-ws-go="admin/score/${esc(encodeURIComponent(p.id||''))}">1·2·3차 평가 수정</button><button type="button" data-ws-go="admin/content/${esc(encodeURIComponent(p.id||''))}">관리자 내용 수정</button></div></details></td>
  </tr>`;
}
export function workspaceMarkup(model,{snapshot={},state={},nav='',mode='supabase'}={}) {
  const f=model.filters,c=model.counts;
  const queue=QUEUES.find(x=>x.key===f.queue)?.label||({waiting:'평가·결재 대기',check:'확인 필요',archived:'과거건 정리완료'})[f.queue]||'전체 제안';
  const filters=[f.department&&`부서 ${f.department}`,f.q&&`검색 ${f.q}`,f.result&&`결과 ${RESULT_LABELS[f.result]}`].filter(Boolean);
  const employees=state.employees||[];
  return `<div class="admin-workspace" data-workspace-version="${WORKSPACE_VERSION}">
    ${headerMarkup(model,state,nav)}
    <section class="aw-filter-card" aria-label="심사목록 검색">
      <div class="aw-scope"><span class="aw-scope-pill">${esc(scopeLabel(f))}</span><strong>첫 접수일 기준</strong><span>${f.year==='all'?'과거 제안을 포함합니다.':f.year==='unknown'?'접수일이 없거나 잘못 저장된 자료입니다.':'다른 연도 제안은 숨겨집니다. 과거 자료는 위 연도를 바꿔 확인하세요.'}</span></div>
      <form id="adminWorkspaceFilter" class="aw-filter-form"><label class="aw-search"><span class="aw-label">제안·직원 검색</span><span class="aw-input-icon">${searchIcon}<input name="q" value="${esc(f.q)}" placeholder="제안번호, 제안명, 이름 검색" maxlength="160" autocomplete="off"></span></label>
        <label><span class="aw-label">부서</span><select name="department"><option value="">전체 부서</option>${model.departments.map(d=>`<option value="${esc(d)}" ${d===f.department?'selected':''}>${esc(d)}</option>`).join('')}${f.department&&!model.departments.includes(f.department)?`<option value="${esc(f.department)}" selected>${esc(f.department)} (해당 연도 0건)</option>`:''}</select></label>
        <label><span class="aw-label">심사결과</span><select name="result"><option value="">전체 결과</option>${Object.entries(RESULT_LABELS).map(([key,label])=>`<option value="${esc(key)}" ${key===f.result?'selected':''}>${esc(label)}</option>`).join('')}</select></label>
        <button type="submit" class="aw-button aw-primary">검색</button><button type="button" class="aw-button" data-ws-reset>올해로 초기화</button>
      </form>
    </section>
    <nav class="aw-queues" aria-label="처리 단계별 목록">${QUEUES.map(q=>`<button type="button" data-ws-queue="${q.key}" class="aw-queue ${f.queue===q.key?'active':''}" aria-pressed="${f.queue===q.key}"><span>${q.label}</span><strong>${c[q.key].toLocaleString('ko-KR')}<small>건</small></strong></button>`).join('')}</nav>
    <div class="aw-context"><p>처리할 제안 = 평가·결재 대기 + 3차 심사대기 + 심사완료·상신 전 + 확인 필요</p><div><button type="button" data-ws-queue="waiting">평가·결재 대기 <b>${c.waiting}</b></button><button type="button" data-ws-queue="check" class="${c.check?'has-warning':''}">확인 필요 <b>${c.check}</b></button><button type="button" data-ws-queue="archived">과거건 정리완료 <b>${c.archived}</b></button></div></div>
    ${snapshot.candidateError?`<div class="aw-alert" role="status"><strong>대표상신 대상 조회를 완료하지 못했습니다.</strong> 심사완료와 상신 가능 여부를 구분해 표시합니다. <button type="button" data-ws-refresh>다시 확인</button><details><summary>오류 내용</summary>${esc(snapshot.candidateError)}</details></div>`:''}
    ${snapshot.errors?.size||snapshot.stepsError?`<div class="aw-alert" role="status">선택 연도 중 ${snapshot.errors?.size||0}건의 결재상태를 확인하지 못했습니다. 해당 건은 ‘확인 필요’로 표시했습니다. <button type="button" data-ws-refresh>다시 확인</button></div>`:''}
    <section class="aw-list-card" aria-label="제안 심사 목록"><header class="aw-list-heading"><div><h2>${esc(queue)} <span>${model.filtered.length.toLocaleString('ko-KR')}건</span></h2><p>${esc(scopeLabel(f))} · ${filters.length?esc(filters.join(' · ')):'전체 부서·전체 결과'}${f.queue!=='all'?` · 해당 조건 전체 ${c.all}건`:''}</p></div><div class="aw-list-actions"><button type="button" class="aw-button aw-submit-link" data-ws-ceo>대표이사 상신 <b>${snapshot.candidateError?'확인':c.canSubmit+'건'}</b></button><button type="button" class="aw-button" data-ws-export ${model.filtered.length?'':'disabled'}>현재 조건 전체 CSV</button></div></header>
      <div class="aw-list-options"><p>${f.queue==='open'?'대표결재 중·승인/지급 완료·과거건 정리완료 건은 숨겼습니다. ‘전체 제안’에서 다시 볼 수 있습니다.':'실시상태와 심사결과는 다른 항목입니다. 실제 저장·수정은 기존 심사 화면에서 진행합니다.'}</p><label>정렬 <select id="adminWorkspaceSort"><option value="newest" ${f.sort==='newest'?'selected':''}>최근 접수순</option><option value="oldest" ${f.sort==='oldest'?'selected':''}>오래된 접수순</option><option value="name" ${f.sort==='name'?'selected':''}>제안자 이름순</option></select></label><label>표시 <select id="adminWorkspaceSize">${[20,25,50].map(n=>`<option value="${n}" ${f.size===n?'selected':''}>${n}건</option>`).join('')}</select></label></div>
      ${model.rows.length?`<div class="aw-table-scroll"><table class="aw-table"><colgroup><col style="width:27%"><col style="width:10%"><col style="width:8%"><col style="width:9%"><col style="width:10%"><col style="width:15%"><col style="width:10%"><col style="width:11%"></colgroup><thead><tr><th>접수번호 · 제안명</th><th>제안자 · 부서</th><th>1차 본인</th><th>2차 팀장</th><th>3차 심사</th><th>현재 단계</th><th>지급 예정액</th><th>작업</th></tr></thead><tbody>${model.rows.map(r=>rowMarkup(r,f)).join('')}</tbody></table></div>`:`<div class="aw-empty"><strong>이 조건에 해당하는 제안이 없습니다.</strong><p>${f.queue==='open'&&c.all?'이미 처리된 건은 ‘전체 제안’에서 확인하세요.':'조회연도·검색어·부서를 확인하세요. 과거 자료가 삭제된 것은 아닙니다.'}</p><button type="button" class="aw-button" data-ws-queue="all">이 연도의 전체 제안 보기</button></div>`}
      <footer class="aw-pagination"><span>${model.filtered.length?model.start+1:0}–${model.start+model.rows.length} / ${model.filtered.length}건 <small>내보내기는 현재 조건의 전체 페이지</small></span><div><button type="button" class="aw-button" data-ws-page="1" ${f.page===1?'disabled':''} aria-label="첫 페이지">처음</button><button type="button" class="aw-button" data-ws-page="${f.page-1}" ${f.page===1?'disabled':''}>이전</button><strong>${f.page} / ${model.pages}</strong><button type="button" class="aw-button" data-ws-page="${f.page+1}" ${f.page===model.pages?'disabled':''}>다음</button></div></footer>
    </section>
    <p class="aw-footnote">금액은 3차 결과 저장 후 표시합니다. 건수처리 ‘후보’는 지급 확정이 아닙니다. <span>${snapshot.asOf?'조회 '+esc(new Date(snapshot.asOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' (한국시간)':''}</span></p>
    <details class="aw-tools" id="adminEmployeeTools"><summary><span>직원명단 관리 <small>명단을 변경할 때만 펼치세요</small></span><span>활성 ${employees.filter(e=>e.active!==false).length}명</span></summary><div class="aw-tools-body"><div><h3>직원명단 엑셀 업로드</h3><p>첫 번째 시트의 ‘성명/이름/직원명’과 ‘부서/소속’ 열을 읽습니다. 심사 목록의 조회연도와는 별개입니다.</p><label class="upload-box compact-upload"><input id="employeeFile" type="file" accept=".xlsx,.xls,.csv"><span>직원명단 파일 선택</span></label><button type="button" class="button button-primary" data-action="import-employees">직원명단 반영</button></div>${mode==='demo'?'<div><h3>데모 데이터</h3><p>현재 데모 자료로 확인 중입니다.</p><button type="button" class="button button-danger" data-action="reset-demo">데모 초기화</button></div>':''}</div></details>
    ${model.unknownDates?`<p class="aw-data-note">전체 자료에 접수일 미확인 ${model.unknownDates}건이 있습니다. <button type="button" data-ws-unknown>따로 확인</button></p>`:''}
  </div>`;
}
export function createAdminWorkspace({root,store,getState,navigate,nav,notify=()=>{},onRead=()=>{}}) {
  let snapshot=null,model=null,controller=null,generation=0,lastRoute='',lastAccount='';
  const accountKey=()=>String(getState().admin?.userId||getState().admin?.user_id||getState().admin?.id||getState().admin?.email||'');
  const isHere=()=>location.hash.split('?')[0]==='#admin' && getState().admin?.isSystemAdmin===true;
  function suspend(){generation++;controller?.abort();controller=null;}
  function invalidate(){suspend();snapshot=null;model=null;}
  function resetSession(){invalidate();lastRoute='';lastAccount='';}
  function getReturnRoute(){return lastRoute||workspaceRoute(readWorkspaceFilters('#admin'));}
  function change(values){const current=model?.filters||readWorkspaceFilters(location.hash);navigate(workspaceRoute({...current,page:1,...values}));}
  function fromForm(){const form=root.querySelector('#adminWorkspaceFilter');if(!form)return {};const d=new FormData(form);return {q:d.get('q')||'',department:d.get('department')||'',result:d.get('result')||''};}
  function paint(){model=buildWorkspace(snapshot.proposals,readWorkspaceFilters(location.hash),snapshot);lastRoute=workspaceRoute(model.filters);root.innerHTML=workspaceMarkup(model,{snapshot,state:getState(),nav:nav(),mode:store.mode});if(new URLSearchParams(location.hash.split('?')[1]||'').get('tools')==='employees'){const details=root.querySelector('#adminEmployeeTools');details.open=true;details.scrollIntoView({block:'center'});}}
  async function render({force=false}={}){
    suspend();const token=generation;
    if(!getState().admin?.isSystemAdmin)return;
    const account=accountKey();if(account!==lastAccount){snapshot=null;lastRoute='';lastAccount=account;}
    const filters=readWorkspaceFilters(location.hash);lastRoute=workspaceRoute(filters);
    if(snapshot&&snapshot.year===filters.year&&!force){paint();return;}
    controller=new AbortController();const signal=controller.signal;
    const placeholder=buildWorkspace(getState().proposals||[],filters,{});
    root.innerHTML=`<div class="admin-workspace">${headerMarkup(placeholder,getState(),nav())}<section class="aw-loading"><div class="spinner"></div><h2>심사 목록을 확인하고 있습니다.</h2><p id="workspaceLoadProgress">${esc(scopeLabel(filters))}의 접수자료를 읽는 중입니다.</p><small>다른 연도의 자료를 이 연도의 실적으로 표시하지 않습니다.</small></section></div>`;
    try{
      const next=await loadWorkspaceSnapshot(store,{year:filters.year,signal,onProgress:text=>{if(token===generation&&isHere()){const el=root.querySelector('#workspaceLoadProgress');if(el)el.textContent=text;}}});
      if(token!==generation||!isHere()||account!==accountKey())return;
      snapshot=next;onRead(next.proposals,next.stepsError?null:next.steps);paint();
    }catch(error){if(error.name==='AbortError'||token!==generation||!isHere())return;root.innerHTML=`<div class="admin-workspace">${headerMarkup(placeholder,getState(),nav())}<section class="aw-empty aw-error" role="alert"><h2>목록을 불러오지 못했습니다.</h2><p>${esc(error.message)}</p><p>조회 오류를 0건으로 표시하지 않습니다.</p><button class="aw-button aw-primary" type="button" data-ws-refresh>다시 조회</button></section></div>`;}
  }
  root.addEventListener('submit',event=>{if(event.target.id!=='adminWorkspaceFilter')return;event.preventDefault();event.stopPropagation();change(fromForm());});
  root.addEventListener('change',event=>{
    if(!isHere())return;
    if(event.target.id==='adminWorkspaceYear'){event.stopPropagation();change({year:event.target.value,queue:'open',q:'',department:'',result:''});}
    if(event.target.id==='adminWorkspaceSort'){event.stopPropagation();change({...fromForm(),sort:event.target.value});}
    if(event.target.id==='adminWorkspaceSize'){event.stopPropagation();change({...fromForm(),size:Number(event.target.value)});}
  });
  root.addEventListener('click',event=>{
    if(!isHere())return;const button=event.target.closest('button');if(!button)return;
    const has=key=>button.hasAttribute(key);let handled=true;
    if(has('data-ws-queue'))change({...fromForm(),queue:button.dataset.wsQueue});
    else if(has('data-ws-page'))change({page:Number(button.dataset.wsPage)});
    else if(has('data-ws-reset'))navigate(workspaceRoute(readWorkspaceFilters('#admin')));
    else if(has('data-ws-refresh'))void render({force:true});
    else if(has('data-ws-unknown'))change({year:'unknown',queue:'all',q:'',department:'',result:''});
    else if(has('data-ws-go'))navigate(button.dataset.wsGo);
    else if(has('data-ws-ceo'))navigate(workspaceRoute({year:model?.filters.year||currentKoreaYear(),q:model?.filters.q||'',department:model?.filters.department||'',result:model?.filters.result||''},'admin/ceo-submit'));
    else if(has('data-ws-export')){
      if(!model?.filtered.length)return;
      const url=URL.createObjectURL(new Blob([workspaceCsv(model.filtered)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`proposal_review_${model.filters.year}_${model.filters.queue}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`${model.filtered.length}건을 현재 검색조건으로 내보냈습니다.`);
    }else handled=false;
    if(handled){event.preventDefault();event.stopPropagation();}
  });
  return {render,suspend,invalidate,resetSession,getReturnRoute};
}
