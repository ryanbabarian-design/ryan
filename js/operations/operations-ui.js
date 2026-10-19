import {escapeOperationsHtml as esc, formatOperationsDate as fmt, sortPublicNotices, validateSettings, validateNotice} from './operations-core.js?v=2.7.0';

// Small, independent admin/public UI. No changes to proposal approval or scoring.
export function createOperationsUI({root,repository,getAdmin,adminHeader,notify}) {
  let settings=null,settingsError='',notices=[],noticesError='',adminNotices=[],editing=null,retained=[],generation=0,refreshing=null;
  const routeIs=value=>location.hash.replace(/^#/,'').split('?')[0]===value;
  const common='기존 제안의 평가·결재·수정·보완·재상신과 실적·엑셀은 계속 이용할 수 있습니다.';
  function settingsLabel(){return settings?.is_open===true?'신규 제안 접수 중':settings?.is_open===false?'신규 접수 일시 중단':'신규 접수 상태 확인 필요';}
  function message(){return settingsError|| (settings?.is_open===false?`${settings.reason} · 재개: ${settings.resume_message||'별도 공지'}`:common);}
  function attachmentsMarkup(n){return (n.attachments||[]).length?`<div class="ops-attachments"><strong>첨부자료</strong>${n.attachments.map((f,i)=>`<button type="button" class="ops-file" data-ops-action="attachment" data-notice-id="${esc(n.id)}" data-file-path="${esc(f.path)}">▧ ${esc(f.name)} <small>${Math.ceil(Number(f.size||0)/1024).toLocaleString('ko-KR')}KB · 열기</small></button>`).join('')}</div>`:'';}
  function noticeMarkup(n){return `<details class="ops-notice" data-notice-key="${esc(n.id)}" ${new URLSearchParams(location.hash.split('?')[1]||'').get('notice')===String(n.id)?'open':''}><summary><div><span class="ops-tag ${n.is_pinned?'is-important':''}">${n.system_key?'접수 안내':n.is_pinned?'중요 공지':'공지'}</span><strong>${esc(n.title)}</strong></div><time>${fmt(n.published_at||n.updated_at)}</time><span class="ops-expand" aria-hidden="true">＋</span></summary><div class="ops-notice-content"><p class="ops-body">${esc(n.body)}</p>${attachmentsMarkup(n)}<small class="ops-author">작성: ${esc(n.author_name||'관리자')} · ${fmt(n.updated_at)}</small></div></details>`;}
  function dashboardMarkup(){return `<section class="ops-dashboard" data-ops-dashboard><div class="ops-section-heading"><div><span class="ops-eyebrow">NOTICE</span><h2>공지사항</h2></div><button class="button button-ghost button-small" type="button" data-route="notices">전체 보기 →</button></div>${noticesError?`<p class="ops-muted">공지를 불러오지 못했습니다. 공지사항에서 다시 확인해 주세요.</p>`:notices.length?sortPublicNotices(notices).slice(0,3).map(noticeMarkup).join(''):'<p class="ops-muted">등록된 공지가 없습니다.</p>'}</section>`;}
  function syncChrome(){
    const banner=document.getElementById('intakeStatusBanner');
    if(banner){banner.className=`intake-banner ${settings?.is_open===true?'is-open':settings?.is_open===false?'is-paused':'is-unknown'}`;banner.innerHTML=`<div class="intake-banner-inner"><span class="ops-status-dot" aria-hidden="true"></span><strong>${settingsLabel()}</strong><span class="intake-banner-copy">${esc(message())}</span><button type="button" data-route="notices">공지 보기 →</button></div>`;}
    const form=root.querySelector('#proposalForm[data-edit="false"]');
    if(form){
      const blocked=settings?.is_open!==true;const submit=form.querySelector('button[type="submit"]');
      if(submit&&!submit.dataset.submitting){submit.disabled=blocked;submit.textContent=blocked?'신규 접수 중단':'제안 제출';}
      let note=form.querySelector('[data-intake-form-message]');if(!note){note=document.createElement('div');note.className='ops-draft-message';note.setAttribute('data-intake-form-message','');note.setAttribute('role','status');form.prepend(note);}
      note.hidden=!blocked;note.textContent=`${settingsError||'신규 제안 접수가 중단되었습니다.'} 작성 중인 내용은 유지됩니다. 필요한 내용은 복사해 보관해 주세요. 기존 제안의 수정·재상신은 가능합니다.`;
    }
    const dashboard=root.querySelector('[data-ops-dashboard]');if(dashboard){const opened=new Set(Array.from(dashboard.querySelectorAll('details[open]')).map(d=>d.dataset.noticeKey));dashboard.outerHTML=dashboardMarkup();root.querySelectorAll('[data-ops-dashboard] details').forEach(d=>{d.open=opened.has(d.dataset.noticeKey);});}
    root.querySelectorAll('.hero [data-route="new"]').forEach(button=>{button.textContent=settings?.is_open===true?'＋ 새 제안 작성':'접수 상태 확인';});
    const mode=document.getElementById('intakeNavState');if(mode)mode.textContent=settings?.is_open===false?'중단':'';
  }
  async function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{
      const [s,n]=await Promise.allSettled([repository.getSettings(),repository.listNotices({limit:3})]);
      if(s.status==='fulfilled'){settings=s.value;settingsError='';}else{settings=null;settingsError=s.reason.message;}
      if(n.status==='fulfilled'){notices=n.value;noticesError='';}else{notices=[];noticesError=n.reason.message;}
      syncChrome();
    })();try{await refreshing;}finally{refreshing=null;}
  }
  function renderClosedNew(){root.innerHTML=`<section class="ops-closed-page"><span class="ops-closed-symbol" aria-hidden="true">Ⅱ</span><span class="ops-eyebrow">PROPOSAL INTAKE</span><h1>${settings?.is_open===false?'신규 제안 접수 일시 중단':'신규 접수 상태 확인 필요'}</h1><p class="ops-closed-lead">${esc(settingsError||'이미 접수된 제안은 정상적으로 평가·결재합니다.')}</p><dl><div><dt>중단 사유</dt><dd>${esc(settings?.reason||'관리자에게 접수 상태를 문의해 주세요.')}</dd></div><div><dt>중단 시작</dt><dd>${fmt(settings?.paused_at)}</dd></div><div><dt>접수 재개</dt><dd>${esc(settings?.resume_message||'별도 공지')}</dd></div></dl><div class="ops-info">${common}<br>반려 제안은 기존 접수번호의 <strong>수정·보완·재상신</strong>을 이용해 주세요.</div><div class="ops-actions"><button class="button button-primary" type="button" data-route="list">기존 접수현황 보기</button><button class="button button-secondary" type="button" data-route="notices">공지사항 보기</button><button class="button button-ghost" type="button" data-ops-action="refresh-new">접수 상태 다시 확인</button></div></section>`;}
  async function renderPublic(){const token=++generation;root.innerHTML=`<section class="ops-page-heading"><span class="ops-eyebrow">NOTICE BOARD</span><h1>공지사항</h1><p>접수 운영, 평가기준과 심사 일정을 확인하세요.</p></section><section id="siteNoticesPage" class="ops-card"><p class="ops-muted">공지를 불러오는 중입니다.</p></section>`;
    try{const all=await repository.listNotices();if(token!==generation||!root.querySelector('#siteNoticesPage'))return;root.querySelector('#siteNoticesPage').innerHTML=all.length?sortPublicNotices(all).map(noticeMarkup).join(''):'<div class="ops-empty">등록된 공지가 없습니다.</div>';}
    catch(e){if(root.querySelector('#siteNoticesPage'))root.querySelector('#siteNoticesPage').innerHTML=`<p class="ops-error">공지를 불러오지 못했습니다. ${esc(e.message)}</p><button class="button button-secondary" data-ops-action="reload-notices">다시 확인</button>`;}}
  function settingsMarkup(){return `<section class="ops-card" id="intakeControls"><div class="ops-section-heading"><div><span class="ops-eyebrow">01 · INTAKE</span><h2>신규 접수 운영</h2></div><span class="ops-current ${settings?.is_open?'is-open':'is-paused'}">${settingsLabel()}</span></div><p class="ops-intro">신규 제안 등록만 제어합니다. 기존 제안의 결재·평가·보완은 그대로 유지됩니다.</p>${settings?`<form id="intakeSettingsForm" class="ops-form" data-revision="${settings.revision}"><fieldset class="ops-status-options"><legend>접수 상태</legend><label><input type="radio" name="intake_status" value="open" ${settings.is_open?'checked':''}><span><strong>접수 중</strong><small>새 제안 등록 허용</small></span></label><label><input type="radio" name="intake_status" value="closed" ${!settings.is_open?'checked':''}><span><strong>접수 일시 중단</strong><small>관리자가 재개할 때까지 중단</small></span></label></fieldset><div class="ops-fields"><label>중단 사유 <span class="ops-muted">중단 시 필수</span><textarea name="intake_reason" rows="3" maxlength="1000" placeholder="예: 기존 접수 제안 평가 및 처리">${esc(settings.reason)}</textarea></label><label>재개 안내<input name="intake_resume" maxlength="200" value="${esc(settings.resume_message||'별도 공지')}" placeholder="별도 공지"><small>예약 재개가 아닙니다. 직접 접수 중으로 바꿔야 재개됩니다.</small></label></div><p class="ops-info">저장하면 <strong>상단 안내와 접수 공지 1건이 함께 갱신</strong>됩니다. 중단 전 접수 완료된 건과 기존 반려 건은 계속 처리할 수 있습니다.</p><div class="ops-actions ops-settings-footer"><small>마지막 변경: ${fmt(settings.updated_at)} · 한국시간</small><button class="button button-primary" type="submit">변경사항 저장 · 안내 반영</button></div></form>`:`<p class="ops-error">${esc(settingsError||'현재 상태를 불러오지 못했습니다.')}</p><p class="ops-muted">V2.7.0 SQL 적용 후 다시 확인하세요. 접수 상태를 확인하기 전에는 변경할 수 없습니다.</p><button class="button button-secondary" type="button" data-ops-action="reload-admin">다시 확인</button>`}</section>`;}
  function adminNoticesMarkup(){return `<section class="ops-card"><div class="ops-section-heading"><div><span class="ops-eyebrow">02 · NOTICES</span><h2>공지사항 관리</h2></div><button class="button button-primary" type="button" data-ops-action="new-notice">＋ 공지 작성</button></div><p class="ops-intro">평가기준·심사 일정은 게시하거나 숨김 상태로 보관하세요. 중요 공지는 목록 상단에 표시됩니다.</p><div id="opsNoticeEditor"></div><div id="opsAdminNoticeList">${adminNotices.length?adminNotices.map(n=>`<article class="ops-admin-notice"><div><span class="ops-tag">${n.is_published?'게시 중':'숨김'}</span>${n.is_pinned?'<span class="ops-tag is-important">중요</span>':''}<strong>${esc(n.title)}</strong><small>${fmt(n.updated_at)} · ${n.attachments?.length||0}개 첨부</small></div>${n.system_key?'<span class="ops-muted">접수 설정에서 자동 반영</span>':`<button class="button button-secondary button-small" type="button" data-ops-action="edit-notice" data-id="${esc(n.id)}">수정 · 게시 설정</button>`}</article>`).join(''):'<p class="ops-muted">등록된 공지가 없습니다. 접수 상태를 변경하면 안내 공지가 자동으로 만들어집니다.</p>'}</div></section>`;}
  async function renderAdmin(){
    if(!getAdmin()?.isSystemAdmin){notify('시스템 관리자만 이용할 수 있습니다.',true);return;}
    const token=++generation;root.innerHTML=`${adminHeader().replace('class="page-header"','class="page-header ops-admin-header"')}<div id="opsAdminPage"><p class="ops-muted">접수·공지 설정을 불러오는 중입니다.</p></div>`;editing=null;retained=[];
    await refresh();let audit=[],error='';try{[adminNotices,audit]=await Promise.all([repository.listNotices({admin:true}),repository.listAudit()]);}catch(e){error=e.message;adminNotices=[];}
    if(token!==generation||!root.querySelector('#opsAdminPage'))return;
    root.querySelector('#opsAdminPage').innerHTML=`${settingsMarkup()}${error?`<p class="ops-error">공지·이력을 불러오지 못했습니다. ${esc(error)}</p>`:adminNoticesMarkup()}<details class="ops-card ops-audit"><summary>최근 운영 변경이력 <span>접수 중단·재개 및 공지 변경 · 최근 30건</span></summary><div>${audit.length?audit.map(a=>`<div class="ops-audit-row"><strong>${esc(a.action)}</strong><span>${esc(a.actor_name)}</span><time>${fmt(a.happened_at)}</time></div>`).join(''):'<p class="ops-muted">아직 변경이력이 없습니다.</p>'}</div></details>`;
  }
  function openNoticeEditor(id){
    editing=id?adminNotices.find(n=>n.id===id):{id:crypto.randomUUID(),title:'',body:'',is_published:true,is_pinned:false,attachments:[],revision:0};
    if(!editing||editing.system_key)return;retained=[...(editing.attachments||[])];
    const box=root.querySelector('#opsNoticeEditor');if(!box)return;
    box.innerHTML=`<form id="noticeForm" class="ops-form ops-editor"><div class="ops-section-heading"><h3>${editing.revision?'공지 수정':'새 공지 작성'}</h3><button class="button button-ghost button-small" type="button" data-ops-action="cancel-notice">닫기</button></div><label>제목<input name="title" required maxlength="160" value="${esc(editing.title)}" placeholder="예: 변경된 제안 평가기준 안내"></label><label>내용<textarea name="body" required rows="8" maxlength="20000" placeholder="직원들에게 안내할 내용을 작성하세요.">${esc(editing.body)}</textarea></label><div class="ops-checkboxes"><label><input type="checkbox" name="is_published" ${editing.is_published?'checked':''}> 직원에게 게시</label><label><input type="checkbox" name="is_pinned" ${editing.is_pinned?'checked':''}> 중요 공지 · 상단 고정</label></div><p class="ops-muted">‘직원에게 게시’를 해제하면 숨김으로 저장되며, 관리자만 볼 수 있습니다.</p><label>첨부자료 <small>PDF · PPT · PPTX / 최대 3개, 파일당 20MB</small><input name="notice_files" type="file" multiple accept=".pdf,.ppt,.pptx"></label><div id="opsRetainedFiles"></div><p class="ops-warning">공지와 첨부자료는 로그인 없이 열람 가능합니다. 개인정보·회사 기밀을 넣지 마세요.</p><div class="ops-actions"><button class="button button-primary" type="submit">공지 저장</button><button class="button button-secondary" type="button" data-ops-action="cancel-notice">취소</button></div></form>`;renderRetained();box.scrollIntoView({block:'nearest',behavior:'smooth'});box.querySelector('[name="title"]').focus();
  }
  function renderRetained(){const b=root.querySelector('#opsRetainedFiles');if(b)b.innerHTML=retained.map((f,i)=>`<div class="ops-retained"><span>▧ ${esc(f.name)}</span><button type="button" data-ops-action="remove-file" data-index="${i}" aria-label="${esc(f.name)} 첨부 제거">첨부 제거</button></div>`).join('');}
  // Own event namespace keeps existing approval/editor handlers independent.
  document.addEventListener('click',async event=>{
    const b=event.target.closest?.('[data-ops-action]');if(!b)return;event.preventDefault();const action=b.dataset.opsAction;
    try{
      if(action==='new-notice')openNoticeEditor();else if(action==='edit-notice')openNoticeEditor(b.dataset.id);
      else if(action==='cancel-notice'){editing=null;retained=[];root.querySelector('#opsNoticeEditor').innerHTML='';}
      else if(action==='remove-file'){retained.splice(Number(b.dataset.index),1);renderRetained();}
      else if(action==='reload-admin')await renderAdmin();else if(action==='reload-notices')await renderPublic();
      else if(action==='refresh-new'){await refresh();if(settings?.is_open===true){window.dispatchEvent(new Event('hashchange'));}else renderClosedNew();}
      else if(action==='attachment'){
        const win=window.open('about:blank','_blank');if(win)win.opener=null;
        try{b.disabled=true;const url=await repository.getAttachmentUrl(b.dataset.noticeId,b.dataset.filePath);if(win){win.location.replace(url);}else{notify('브라우저에서 새 창 열기를 허용한 후 첨부자료를 다시 눌러 주세요.',true);}}catch(e){if(win)win.close();throw e;}finally{b.disabled=false;}
      }
    }catch(e){notify(e.message,true);}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target;if(!['intakeSettingsForm','noticeForm'].includes(form.id))return;event.preventDefault();
    const btn=form.querySelector('button[type="submit"]');if(btn.disabled)return;
    try{
      if(!getAdmin()?.isSystemAdmin)throw new Error('시스템 관리자만 변경할 수 있습니다.');
      if(form.id==='intakeSettingsForm'){
        const f=new FormData(form);const input=validateSettings({is_open:f.get('intake_status')==='open',reason:f.get('intake_reason'),resume_message:f.get('intake_resume')});
        const confirmation=input.is_open?'신규 제안 접수를 허용하고 재개 안내를 반영하시겠습니까?':'신규 제안 접수를 중단하시겠습니까?\n기존 제안의 평가·결재·보완·재상신은 계속 가능합니다.';
        if(!window.confirm(confirmation))return;btn.disabled=true;
        settings=await repository.saveSettings(input,Number(form.dataset.revision));await refresh();notify('접수 상태와 안내 공지를 저장했습니다.');await renderAdmin();
      }else{
        const f=new FormData(form),files=Array.from(form.querySelector('[name="notice_files"]').files||[]);
        if(retained.length+files.length>3)throw new Error('기존 첨부를 포함해 최대 3개까지 가능합니다.');
        const values=validateNotice({title:f.get('title'),body:f.get('body'),is_published:f.has('is_published'),is_pinned:f.has('is_pinned'),attachments:retained});
        btn.disabled=true;const id=editing.id,revision=editing.revision,added=await repository.uploadAttachments(id,files);
        try{await repository.saveNotice(id,{...values,attachments:[...retained,...added]},revision);}catch(e){await repository.removeUploaded(added).catch(()=>{});throw e;}
        // Retired files remain private/unreferenced: no destructive cleanup of previous notice attachments.
        await refresh();notify(values.is_published?'공지를 게시 상태로 저장했습니다.':'공지를 숨김 상태로 저장했습니다.');await renderAdmin();
      }
    }catch(e){notify(e.message,true);}finally{if(btn.isConnected)btn.disabled=false;}
  });
  window.addEventListener('focus',()=>{void refresh();});
  window.addEventListener('storage',event=>{if(event.key==='proposal-system:v270:operations')void refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
  // Do not redraw in-progress forms; only update status and NEW submit availability.
  const timer=setInterval(()=>{if(!document.hidden)void refresh();},30000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  return {refresh,syncChrome,dashboardMarkup,renderPublic,renderAdmin,renderClosedNew,canStartNew:()=>settings?.is_open===true};
}
