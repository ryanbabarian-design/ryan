import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createSubmissionGate } from '../js/reliability/submission.js';

const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
function source(name, next) {
  const start = app.indexOf(`function ${name}(`);
  const end = app.indexOf(`function ${next}(`, start + 1);
  return app.slice(app.slice(start - 6, start) === 'async ' ? start - 6 : start, end).replace(/async\s*$/, '');
}
const approvalSource = source('renderApprovalProgress', 'allKnownProposals');
const submitSource = source('handleProposalSubmit', 'renderSubmissionReceipt');
const reviewSource = source('renderApproverReview', 'renderAdminNotifications');

test('approver review displays lookup errors instead of an empty actionable approval model',async()=>{
  const context=vm.createContext({location:{hash:'#admin/review/p1'},state:{proposals:[{id:'p1'}]},main:{innerHTML:''},adminPageHeader:()=>'',escapeHtml:String,
    store:{getApprovalRecords:async()=>{throw Error('network unavailable');}},resolveApprovalPermission:()=>{throw Error('must not infer');}});
  vm.runInContext(reviewSource,context);await context.renderApproverReview('p1');
  assert.match(context.main.innerHTML,/결재 기록을 불러오지 못했습니다/);assert.match(context.main.innerHTML,/retry-approver-review/);
  assert.doesNotMatch(context.main.innerHTML,/save-approval-action/);
});

test('an older approver request cannot replace a newly selected route',async()=>{
  let finish;const read=new Promise(resolve=>{finish=resolve;});
  const context=vm.createContext({location:{hash:'#admin/review/p1'},state:{proposals:[{id:'p1'}]},main:{innerHTML:''},adminPageHeader:()=>'',
    store:{getApprovalRecords:()=>read},resolveApprovalPermission:()=>{throw Error('must not render stale response');}});
  vm.runInContext(reviewSource,context);const pending=context.renderApproverReview('p1');
  context.location.hash='#list';context.main.innerHTML='replacement screen';finish([]);await pending;
  assert.equal(context.main.innerHTML,'replacement screen');
});

test('detail approval renderer does not infer missing historical signatures from final approval', () => {
  const context = vm.createContext({escapeHtml: String});
  vm.runInContext(approvalSource, context);
  const html = context.renderApprovalProgress([
    {id:2,step_order:2,role_name:'부서장'},
    {id:5,step_order:4,role_name:'대표이사'},
  ], [{step_id:5,status:'승인',approver_name:'실제 대표',acted_at:'2026-11-20'}]);
  assert.match(html, /기록 없음/);
  assert.match(html, /실제 대표/);
  assert.doesNotMatch(html, /전환 전 완료|소급결재 제외/);
  assert.equal((html.match(/approval-step approved/g) || []).length, 1);
});

test('failed approval metadata is distinct from a legitimately empty configuration',()=>{
  const context=vm.createContext({escapeHtml:String});vm.runInContext(approvalSource,context);
  assert.match(context.renderApprovalProgress([],[],{error:'offline'}),/불러오지 못했습니다/);
  assert.match(context.renderApprovalProgress([],[]),/설정되지 않았습니다/);
});

test('empty public history stays empty even when the proposal has a later correction timestamp',async()=>{
  const timeline={innerHTML:''},approval={innerHTML:''};
  const context=vm.createContext({detailGeneration:0,hydratePersonMini:()=>{},isCurrentDetail:()=>true,main:{},escapeHtml:String,
    $:selector=>selector==='#timelineContent'?timeline:selector==='#approvalContent'?approval:null,
    store:{getStatusHistory:async()=>[],getApprovalRecords:async()=>[]},
    rejectedApprovalInfo:()=>null,renderTimelineRows:rows=>rows.length?'actual events':'기록된 진행이력이 없습니다.',
    buildTimelineFallback:()=>{throw Error('must never fabricate a payment or review date');}});
  vm.runInContext(source('hydrateDetailOperations','renderProposerProfile'),context);
  await context.hydrateDetailOperations({id:'p1',proposal_no:'Q26-999',updated_at:'2026-11-20',payment_status:'완료',review_result:'채택',approval_required:false});
  assert.equal(timeline.innerHTML,'기록된 진행이력이 없습니다.');
});

function submissionFixture(overrides={}) {
  const calls=[],button={dataset:{},disabled:false,textContent:''};
  const form={dataset:{},isConnected:true,querySelector:()=>button};
  const draft={getReceipt:()=>null,getRequestId:()=> 'draft-A',ensureRequestDurable:async()=>calls.push('durable'),prepareSubmission:async()=>calls.push('prepared'),canRetrySubmission:()=>false,markSubmitted:async r=>calls.push(['receipt',r.proposal_no])};
  const context=vm.createContext({
    submissionGate:createSubmissionGate(),proposalDraft:draft,submissionReceipts:new Map(),
    formImageSelections:{before:{files:['original-photo']},after:{files:[]}},
    state:{proposals:[]},operationsUI:{refresh:async()=>{},canStartNew:()=>true},
    store:{createProposal:async(...args)=>{calls.push(['save',...args]);return {id:'p1',proposal_no:'Q26-999'};}},
    FormData:class{get(){return '';}},
    buildProposalPayload:()=>({edit_pin:'1234',first_evaluation:{}}),validateFirstSelfEvaluationValues(){},
    createImageSelection:()=>({files:[]}),totalSelectedImages:s=>s.files.length,getNewFiles:s=>s.files,getRetainedImages:()=>[],MAX_IMAGES_PER_SECTION:5,
    refreshData:async()=>{throw Error('offline');},showToast:m=>calls.push(['toast',m]),go:r=>calls.push(['route',r]),
    crypto, ...overrides,
  });
  vm.runInContext(submitSource,context);
  return {context,calls,button,form,draft,submit:()=>context.handleProposalSubmit(form)};
}

test('app submits once and retains receipt when subsequent list refresh fails',async()=>{
  const f=submissionFixture();
  await Promise.all([f.submit(),f.submit()]);
  assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
  assert.equal(f.calls[0],'durable');
  assert.ok(f.calls.some(c=>c[0]==='route'&&c[1]==='receipt/Q26-999'));
  assert.equal(f.context.submissionReceipts.get('Q26-999').refreshError,'offline');
  assert.equal(f.button.disabled,true);
});

test('app blocks all network writes until the request ID is durably recoverable',async()=>{
  const f=submissionFixture();f.draft.ensureRequestDurable=async()=>{throw Error('storage unavailable');};
  await assert.rejects(f.submit(),/storage unavailable/);
  assert.equal(f.calls.filter(c=>c[0]==='save').length,0);
  assert.equal(f.button.disabled,false);
});

test('closed intake blocks a fresh request but permits a verified prior attempt',async()=>{
  const f=submissionFixture();f.context.operationsUI.canStartNew=()=>false;
  await assert.rejects(f.submit(),/신규 접수/);
  assert.equal(f.calls.some(c=>c[0]==='save'),false);
  f.draft.canRetrySubmission=()=>true;
  await f.submit();assert.equal(f.calls.filter(c=>c[0]==='save').length,1);
  assert.ok(f.calls.includes('prepared'));
});

test('attempt snapshot persistence failure prevents network submission',async()=>{
  const f=submissionFixture();f.draft.prepareSubmission=async()=>{throw Error('attempt checkpoint unavailable');};
  await assert.rejects(f.submit(),/attempt checkpoint unavailable/);
  assert.equal(f.calls.some(c=>c[0]==='save'),false);
});

test('homonym choices without staff numbers show distinct stored employee IDs',async()=>{
  const context=vm.createContext({location:{hash:'#person/동명'},URLSearchParams,currentKoreaYear:()=>2026,escapeHtml:String,
    main:{innerHTML:''},workflowProgress:{refresh(){}},
    loadPersonPerformance:async()=>({source:{proposals:[]},amountsVerified:true,report:{ambiguous:true,name:'동명',choices:[
      {identity:'id:A',name:'동명',department:'공무팀',employeeId:'A'},
      {identity:'id:B',name:'동명',department:'공무팀',employeeId:'B'}],rows:[]}})});
  vm.runInContext(source('renderProposerProfile','renderPrintImages'),context);await context.renderProposerProfile('동명');
  assert.match(context.main.innerHTML,/직원 ID A/);assert.match(context.main.innerHTML,/직원 ID B/);
});

test('route changes during durability check cannot substitute another draft photo selection',async()=>{
  let release;const ready=new Promise(resolve=>{release=resolve;});
  const f=submissionFixture();f.draft.ensureRequestDurable=()=>ready;
  const work=f.submit();await Promise.resolve();
  f.form.isConnected=false;
  f.context.formImageSelections={before:{files:['other-draft-photo']},after:{files:[]}};
  release();await work;
  const save=f.calls.find(c=>c[0]==='save');
  assert.deepEqual(save[2],['original-photo']);
  assert.equal(f.calls.some(c=>c[0]==='route'),false);
});

test('asynchronous receipt persistence finishes before refresh and navigation',async()=>{
  let release;const saved=new Promise(resolve=>{release=resolve;});
  const f=submissionFixture();f.draft.markSubmitted=()=>saved;
  const work=f.submit();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.some(c=>c[0]==='route'),false);
  release();await work;
  assert.equal(f.calls.some(c=>c[0]==='route'),true);
});

test('edit sends the exact source revision rather than a later cached revision',async()=>{
  const f=submissionFixture();f.form.dataset={edit:'true',no:'Q26-999'};
  f.draft.getSourceUpdatedAt=()=> '2026-11-10T00:00:00.123456Z';
  f.context.state.proposals=[{proposal_no:'Q26-999',updated_at:'newer'}];
  let args;f.context.store.updateProposalWithPin=async(...a)=>{args=a;return {proposal_no:'Q26-999'};};
  await f.submit();assert.equal(args[5].expectedUpdatedAt,'2026-11-10T00:00:00.123456Z');
  assert.equal('edit_pin' in args[2],false);
});
