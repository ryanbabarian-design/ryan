/** V2.9.13 — committee metadata only; never change evaluation/approval records. */
import {committeeText} from '../ui/review-stages-v2913.js?v=2.9.13';
const text=v=>String(v??'').trim();
const make=(tag,cls='',value='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=value;return n;};
export function installCommitteeUI({root,store,getState,navigate,notify=()=>{}}){
 if(root.dataset.committeeInstalled)return;
 root.dataset.committeeInstalled='2.9.13';
 let queued=false;
 const mounted=new WeakMap();
 const isAdmin=()=>getState()?.admin?.isSystemAdmin===true;
 async function rpc(name,args){
   if(!store.client)throw Error('심사위원 지정은 운영 DB에 연결된 관리자 화면에서 이용하세요.');
   const {data,error}=await store.client.rpc(name,args);if(error)throw Error(error.message||'심사위원 자료를 처리하지 못했습니다.');return data;
 }
 function context(){
   const hash=location.hash.slice(1).split('?')[0], form=root.querySelector('#adminReviewForm'), legacy=root.querySelector('#legacyScoreForm');
   if(form&&isAdmin())return {id:form.dataset.id,host:form.querySelector('.second-evaluation-section')||form,admin:true};
   if(legacy&&isAdmin())return {id:hash.split('/')[2],host:legacy.parentElement,admin:true,legacy:true};
   if(hash.startsWith('detail/')){
     const p=(getState()?.proposals||[]).find(p=>p.proposal_no===decodeURIComponent(hash.slice(7)));
     const host=root.querySelector('[data-evaluation-stage="3"]');
     if(p&&host)return {id:p.id,no:p.proposal_no,host,admin:isAdmin(),detail:true};
   }
   return null;
 }
 function showError(panel,message,retry){
   panel.replaceChildren(make('strong','','심사위원 자료 확인 필요'),make('p','committee-error',message));
   const b=make('button','button button-secondary button-small','다시 조회');b.type='button';b.onclick=retry;panel.append(b);
 }
 function summaryNode(info){
   const b=make('div','committee-summary',committeeText(info.summary,info.has_review));
   if(info.summary?.inputter)b.append(make('small','','점수·결과 입력자: '+info.summary.inputter));
   return b;
 }
 async function mount(ctx){
   if(mounted.has(ctx.host))return;
   const account=text(getState()?.admin?.email),route=location.hash;
   const panel=make('section','committee-panel');panel.dataset.committeePanel='';panel.setAttribute('aria-label','3차 심사위원 지정');
   mounted.set(ctx.host,panel);
   const anchor=ctx.host.querySelector('.review-third-saved');
   if(anchor)anchor.after(panel);else if(ctx.legacy){ctx.host.querySelector('form').before(panel);}else ctx.host.append(panel);
   const current=()=>panel.isConnected&&location.hash===route&&text(getState()?.admin?.email)===account;
   async function load(){
     panel.replaceChildren(make('p','','심사위원과 입력자를 구분하여 조회하고 있습니다.'));
     try{
       if(!ctx.admin){
         const data=await rpc('v2913_review_committee_public',{p_proposal_numbers:[ctx.no]});if(!current())return;
         if(!Array.isArray(data)||data.length!==1||data[0].proposal_no!==ctx.no)throw Error('심사위원 조회 범위를 확인하세요.');
         panel.replaceChildren(make('h3','','3차 심사위원'),summaryNode({summary:data[0],has_review:data[0].has_review===true}));return;
       }
       const info=await rpc('v2913_get_review_committee',{p_proposal_id:ctx.id});if(!current())return;
       if(info?.proposal_id!==ctx.id||!Array.isArray(info.employees)||!Array.isArray(info.members))throw Error('심사위원 응답이 일치하지 않습니다.');
       draw(info);
     }catch(e){if(current())showError(panel,e.message,load);}
   }
   function draw(info){
     const selected=new Set(info.members.map(m=>m.id)),byId=new Map(info.employees.map(e=>[e.id,e]));
     for(const m of info.members)if(!byId.has(m.id))byId.set(m.id,{...m,active:false});
     const heading=make('div','committee-heading');heading.append(make('h3','','3차 심사위원 지정'),make('span','','위원 ≠ 입력자'));
     const help=make('p','committee-help','실제 심사할 위원을 선택하세요. 관리자 계정은 입력자로만 기록합니다. 위원 지정은 결재권한 부여나 점수 저장이 아닙니다.');
     const details=make('details','committee-editor');details.open=!ctx.detail;
     details.append(make('summary','','심사위원 명단 지정·보완'));
     const search=make('input','committee-search');search.type='search';search.placeholder='심사위원 이름·부서·사번 검색';search.setAttribute('aria-label','심사위원 이름·부서·사번 검색');
     const chips=make('div','committee-chips'),list=make('div','committee-options');list.setAttribute('aria-label','심사위원 선택');
     const reasonLabel=make('label','committee-reason','지정 근거·사유 (필수)');
     const reason=make('textarea');reason.rows=2;reason.maxLength=1000;reason.value=info.evidence||'';reason.placeholder='예: 제안 심사회의 평가표의 참석 심사위원 확인';reasonLabel.append(reason);
     const confirmLabel=make('label','committee-confirm'),confirm=make('input');confirm.type='checkbox';confirm.checked=info.summary?.state==='confirmed';confirm.disabled=!info.has_review;
     confirmLabel.append(confirm,document.createTextNode('선택한 위원이 현재 저장된 3차 결과를 실제 심사했음을 근거로 확인했습니다.'));
     const warning=make('p','committee-help',info.has_review?'재평가로 결과가 바뀌면 실제 심사자 확인은 다시 받아야 합니다.':'지금은 예정 위원 지정만 가능합니다. 3차 결과 저장 후 실제 심사자를 확인하세요.');
     const save=make('button','button button-primary','심사위원 명단 저장');save.type='button';
     const message=make('p','committee-message');message.setAttribute('role','status');
     const history=make('details','committee-history');history.append(make('summary','',`위원 지정·보완 이력 ${(info.history||[]).length}건`));
     for(const h of info.history||[]){const row=make('p','',`${text(h.at).replace('T',' ').slice(0,16)} (UTC) · ${h.actor} · ${h.reason}`);history.append(row);}
     details.append(search,chips,list,reasonLabel,confirmLabel,warning,save,message,history);
     panel.replaceChildren(heading,summaryNode(info),help,details);
     let saving=false;
     function render(){
       chips.replaceChildren();
       for(const id of selected){const e=byId.get(id);const chip=make('button','committee-chip',`${e?.name||'명단 확인'} · ${e?.department||'-'} ×`);chip.type='button';chip.disabled=saving;chip.setAttribute('aria-label',`${e?.name||'직원'} 선택 해제`);chip.onclick=()=>{selected.delete(id);confirm.checked=false;render();};chips.append(chip);}
       if(!selected.size)chips.append(make('span','committee-help','선택된 심사위원 없음 · 자동 배정하지 않습니다.'));
       const tokens=search.value.normalize('NFKC').trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean);
       const matches=[...byId.values()].filter(e=>tokens.every(q=>`${e.name} ${e.department} ${e.employee_no||''}`.toLocaleLowerCase('ko-KR').includes(q)));
       list.replaceChildren();
       if(!matches.length)list.append(make('p','committee-help','검색 결과가 없습니다. 직원명단을 확인하세요.'));
       for(const e of matches){const label=make('label','committee-option'),check=make('input');check.type='checkbox';check.checked=selected.has(e.id);check.disabled=saving;check.dataset.employeeId=e.id;
         const copy=make('span','',e.name);copy.append(make('small','',`${e.department||'부서 미등록'}${e.employee_no?' · 사번 '+e.employee_no:''}${e.active===false?' · 과거/비활성 명단':''}`));label.append(check,copy);
         check.onchange=()=>{if(check.checked){if(selected.size>=10){check.checked=false;message.textContent='심사위원은 최대 10명입니다.';return;}selected.add(e.id);}else selected.delete(e.id);confirm.checked=false;render();};list.append(label);
       }
     }
     search.addEventListener('input',render);
     // Never let Enter in the picker submit the surrounding score form.
     details.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target===search){e.preventDefault();e.stopPropagation();}});
     save.onclick=async e=>{
       e.preventDefault();e.stopPropagation();if(saving)return;
       if(!isAdmin()){message.textContent='관리자 로그인을 다시 확인하세요.';return;}
       if(selected.size<1||selected.size>10){message.textContent='직원명단에서 심사위원을 1~10명 선택하세요.';return;}
       if(reason.value.trim().length<5){message.textContent='지정 근거·사유를 5자 이상 입력하세요.';reason.focus();return;}
       const ids=[...selected],actual=confirm.checked,evidence=reason.value.trim();saving=true;save.disabled=true;search.disabled=true;reason.disabled=true;confirm.disabled=true;render();save.textContent='저장·재조회 중';message.textContent='';
       try{
         const out=await rpc('v2913_set_review_committee',{p_proposal_id:ctx.id,p_member_ids:ids,p_evidence:evidence,p_expected_revision:info.revision,p_expected_review_token:info.current_review_token,p_confirm_actual:actual});
         if(out?.proposal_id!==ctx.id||out.revision!==info.revision+1)throw Error('저장 결과를 확인하지 못했습니다. 중복 저장하지 말고 다시 조회하세요.');
         const readback=await rpc('v2913_get_review_committee',{p_proposal_id:ctx.id});
         if(readback?.proposal_id!==ctx.id||readback.revision!==out.revision||JSON.stringify(readback.members.map(m=>m.id))!==JSON.stringify(ids)||readback.summary?.state!==(actual?'confirmed':'assigned'))throw Error('저장 후 확인이 필요합니다. 중복 저장하지 말고 다시 조회하세요.');
         if(current()){draw(readback);const note=panel.querySelector('.committee-message');note.textContent='심사위원 명단을 저장했습니다. 점수·포상·상신 상태는 변경하지 않았습니다.';}
       }catch(err){if(current()){message.textContent=err.message;const retry=make('button','button button-secondary button-small','저장 상태 다시 조회');retry.type='button';retry.onclick=load;message.append(retry);}}
       finally{if(save.isConnected){saving=false;save.disabled=false;search.disabled=false;reason.disabled=false;confirm.disabled=!info.has_review;save.textContent='심사위원 명단 저장';render();}}
     };
     render();
   }
   await load();
 }
 function scan(){queued=false;const ctx=context();if(ctx)mount(ctx);}
 function schedule(){if(!queued){queued=true;queueMicrotask(scan);}}
 new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
 window.addEventListener('hashchange',schedule);schedule();
}
