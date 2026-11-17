/** V2.9.14: read-only evaluator attribution. No scoring or approval writes. */
const text=v=>String(v??'').trim();
const esc=v=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hasScore=v=>['string','number'].includes(typeof v)&&text(v)!==''&&Number.isFinite(Number(v));
export function evaluatorInfo(p={}){
 const firstRecorded=hasScore(p.first_evaluation_total)||!!p.first_evaluation_completed_at;
 const teamRecorded=hasScore(p.team_leader_evaluation_total)||!!p.team_leader_evaluation_completed_at;
 const team=text(p.team_leader_evaluation_by_name);
 const adminInput=/관리자|admin|입력|보완|정정|대리|시스템/i.test(team);
 return {
  first:{label:firstRecorded?'본인':'평가자',name:firstRecorded?text(p.proposer_name)||'미확인':p.legacy_first_evaluation_exempt===true?'해당 없음':'미기록',note:!firstRecorded&&p.legacy_first_evaluation_exempt===true?'1차 평가 면제':''},
  team:{label:'평가자',name:teamRecorded&&team&&!adminInput?team:teamRecorded?'미확인':'미기록',note:adminInput?`입력·보완: ${team}`:''},
  inputter:text(p.second_evaluation_by_name)||text(p.legacy_score_recorded_by_name)
 };
}
export function evaluatorMarkup(info){
 return `<div class="ceo-evaluator"><span>${esc(info?.label||'평가자')}: ${esc(info?.name||'미확인')}</span>${info?.note?`<small>${esc(info.note)}</small>`:''}</div>`;
}
export function committeeMarkup(row=null,inputter=''){
 const state=row?.state||'loading',members=Array.isArray(row?.members)?row.members:[];
 let label='심사위원',name='조회 중',note='';
 if(state==='error'){name='조회 실패';note='새로 조회해 확인하세요.';}
 else if(state==='unassigned'){name=row?.has_review?'미확인':'미지정';note='실제 심사위원 기록 필요';}
 else if(['confirmed','assigned','reconfirm'].includes(state)&&members.length){
  label=state==='confirmed'?'심사위원':'지정 위원';
  name=members.map(m=>text(m.name)+(text(m.department)?` (${text(m.department)})`:'')).join(', ');
  note=state==='confirmed'?'실제 심사자 확인':state==='reconfirm'?'평가 변경 · 실제 심사자 재확인 필요':'실제 심사자 미확인';
 }
 const writer=text(row?.inputter)||text(inputter);
 return `<div class="ceo-evaluator ceo-committee-${esc(state)}"><span>${esc(label)}: ${esc(name)}</span>${note?`<small>${esc(note)}</small>`:''}${writer?`<small class="ceo-inputter">입력자: ${esc(writer)}</small>`:''}</div>`;
}
function validateRows(rows,numbers){
 if(!Array.isArray(rows)||rows.length>numbers.length)throw Error('심사위원 조회 응답 확인 필요');
 const map=new Map();
 for(const r of rows){
  if(!numbers.includes(r?.proposal_no)||map.has(r.proposal_no)||!['unassigned','assigned','confirmed','reconfirm'].includes(r.state)||!Array.isArray(r.members)||r.members.length>10||r.members.some(m=>!m||!text(m.name))||(['confirmed','assigned','reconfirm'].includes(r.state)&&!r.members.length))throw Error('심사위원 조회 범위 또는 명단 확인 필요');
  map.set(r.proposal_no,r);
 }
 return map;
}
export async function loadCeoCommittees(store,numbers,{signal,timeoutMs=12000}={}){
 const ids=[...new Set(numbers.map(text).filter(Boolean))],answer=new Map();
 for(let start=0;start<ids.length;start+=100){
  const batch=ids.slice(start,start+100);
  try{
   let rows;
   if(!store.client){
    if(store.mode!=='demo')throw Error('DB 연결 확인 필요');
    const all=await store.getProposals();
    rows=all.filter(p=>batch.includes(p.proposal_no)).map(p=>({proposal_no:p.proposal_no,state:'unassigned',members:[],has_review:!!p.second_evaluation_completed_at,...p.review_committee,inputter:evaluatorInfo(p).inputter}));
   }else{
    if(signal?.aborted)throw Error('조회 취소');
    let request=store.client.rpc('v2913_review_committee_public',{p_proposal_numbers:batch});
    if(signal&&typeof request.abortSignal==='function')request=request.abortSignal(signal);
    let timer;
    try{
     const result=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('심사위원 조회 시간 초과')),timeoutMs);})]);
     if(result.error)throw Error(result.error.message||'심사위원 조회 실패');
     rows=result.data;
    }finally{clearTimeout(timer);}
   }
   const valid=validateRows(rows,batch);
   for(const no of batch)answer.set(no,valid.get(no)||{state:'error'});
  }catch(_){for(const no of batch)answer.set(no,{state:'error'});}
 }
 return answer;
}
export function installCeoEvaluators({root,store,getState}){
 if(!root||root.dataset.ceoEvaluators)return;
 root.dataset.ceoEvaluators='2.9.14';
 const seen=new WeakSet(),tickets=new WeakMap(),details=new WeakSet(),controllers=new Set();
 let queued=false,serial=0;
 function detail(){
  const route=location.hash.slice(1).split('?')[0],host=root.querySelector('.approver-readonly-preview');
  if(!route.startsWith('admin/review/')||!getState()?.admin||!host||details.has(host))return;
  const id=decodeURIComponent(route.slice('admin/review/'.length));
  const p=(getState()?.proposals||[]).find(p=>String(p.id)===id);if(!p)return;
  const people=evaluatorInfo(p),panel=document.createElement('section');panel.className='ceo-evaluator-detail';panel.setAttribute('aria-label','단계별 평가자 확인');
  panel.innerHTML=`<h2>단계별 평가자 확인</h2><div class="ceo-evaluator-grid"><div><h3>1차 본인평가</h3>${evaluatorMarkup(people.first)}</div><div><h3>2차 팀장평가</h3>${evaluatorMarkup(people.team)}</div><div><h3>3차 심사위원</h3><div data-ceo-committee="${esc(p.proposal_no)}" data-ceo-inputter="${esc(people.inputter)}">${committeeMarkup(null,people.inputter)}</div></div></div><p>실제 심사위원과 점수 입력자는 별도입니다. 명단 지정은 위원의 본인 서명이나 결재가 아닙니다.</p>`;
  const heading=host.querySelector('h1');if(heading)heading.after(panel);else host.prepend(panel);details.add(host);
 }
 async function enrich(nodes){
  const route=location.hash,ticket=++serial,controller=new AbortController();controller.ceoRoute=route;controllers.add(controller);
  for(const node of nodes){seen.add(node);tickets.set(node,ticket);}
  try{
   const map=await loadCeoCommittees(store,nodes.map(n=>n.dataset.ceoCommittee),{signal:controller.signal});
   if(controller.signal.aborted||location.hash!==route)return;
   for(const node of nodes)if(node.isConnected&&root.contains(node)&&tickets.get(node)===ticket){
    const row=map.get(node.dataset.ceoCommittee)||{state:'error'};
    node.innerHTML=committeeMarkup(row,node.dataset.ceoInputter);node.dataset.ceoCommitteeState=row.state;
   }
  }finally{controllers.delete(controller);}
 }
 function scan(){queued=false;detail();const nodes=[...root.querySelectorAll('[data-ceo-committee]')].filter(n=>!seen.has(n));if(nodes.length)enrich(nodes);}
 function schedule(){if(!queued){queued=true;queueMicrotask(scan);}}
 new MutationObserver(schedule).observe(root,{childList:true,subtree:true});
 root.addEventListener('click',event=>{
  if(!event.target.closest?.('[data-ceo-reviewers-refresh]'))return;
  event.preventDefault();
  for(const c of controllers)c.abort();
  for(const node of root.querySelectorAll('[data-ceo-committee]')){seen.delete(node);node.innerHTML=committeeMarkup(null,node.dataset.ceoInputter);}
  schedule();
 });
 window.addEventListener('hashchange',()=>{for(const c of controllers)if(c.ceoRoute!==location.hash)c.abort();schedule();});
 schedule();
}
