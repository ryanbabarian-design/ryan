import test from 'node:test';
import assert from 'node:assert/strict';

import * as workflow from '../js/ui/workflow-progress.js';
import * as history from '../js/admin/proposal-history.js';
import * as recall from '../js/admin/ceo-recall.js';

const proposal = {id:'p1', proposal_no:'Q26-001', title:'개선안', first_evaluation_total:0, team_leader_evaluation_total:null, second_evaluation_total:null,
  implementation_status:'진행중', payment_status:'미지급', ceo_submission_status:'상신완료', updated_at:'2026-11-10T00:00:00.123456Z', received_date:'2026-11-02'};
const ceo = {role_name:'대표이사',status:'대기',actionable_at:'2026-11-12T00:00:00Z'};
const summary = {proposal_id:'p1', stage_key:'ceo', current_stage:'대표이사 결재 대기', current_role:'대표이사', assignee_name:'김대표', pending_days:7,
  actionable_at:ceo.actionable_at, next_action:'결재 확인', records:[ceo]};
const deferred = () => Promise.withResolvers();

test('detail uses recorded scores/approvals and current actionable time, never later-stage inference', () => {
  const html = workflow.renderWorkflow(proposal, summary);
  for (const t of ['1차','2차','임원','3차','대표','0점','승인 기록 없음','김대표','7일','결재 확인','진행중','미지급']) assert.ok(html.includes(t), t);
  assert.doesNotMatch(html, /임원 승인 완료/);
  const unknown = workflow.renderWorkflow(proposal, {...summary,actionable_at:null,pending_days:0});
  assert.doesNotMatch(unknown, /대기 0일|0일 대기/);
  const compact = workflow.renderWorkflow(proposal, summary, {compact:true});
  assert.match(compact,/김대표/);
  assert.doesNotMatch(compact,/wf-stages/);
});

test('legacy direct retains real scores and explicit exemptions without inventing approvals', () => {
  const html = workflow.renderWorkflow({...proposal,first_evaluation_total:null,legacy_first_evaluation_exempt:true,approval_required:false,score:77},
    {...summary,legacy_direct:true,records:[{...ceo,status:'승인',approver_name:'실제결재자'}]});
  for(const t of ['기존건 면제','직접 상신','77점','실제결재자']) assert.ok(html.includes(t),t);
  assert.doesNotMatch(html,/임원 승인 완료/);
});

test('removed placeholders and suspended requests cannot write stale progress; missing rows show retry', async () => {
  const first=deferred(), second=deferred(), calls=[];
  const box=id=>({dataset:{workflowProposal:id},innerHTML:'',hasAttribute:()=>false});
  const old=box('p1'), next=box('p2');let mounted=[old];
  const root={querySelectorAll:()=>mounted,contains:n=>mounted.includes(n),addEventListener(){},removeEventListener(){}};
  const controller=workflow.createWorkflowProgress({root,store:{getWorkflowSummaries(ids){calls.push(ids);return calls.length===1?first.promise:second.promise;}},
    getProposals:()=>[proposal,{...proposal,id:'p2'}],getAdmin:()=>null});
  const oldLoad=controller.refresh(); controller.suspend();
  mounted=[next];const newLoad=controller.refresh();
  second.resolve([]);await newLoad;
  assert.match(next.innerHTML,/다시 조회/);
  first.resolve([summary]);await oldLoad;
  assert.doesNotMatch(old.innerHTML,/김대표/);
  assert.doesNotMatch(next.innerHTML,/김대표/);
  await controller.refresh();
  assert.deepEqual(calls,[['p1'],['p2']]);
});

test('Korean calendar day filters and keywords search before/after values and reason', () => {
  const rows=[{id:'a',happened_at:'2026-11-01T15:01:00Z',category:'score',reason:'원본 확인',before:{score:72},after:{score:78}},
    {id:'b',happened_at:'2026-11-01T14:59:00Z',category:'content',reason:'글자 수정'}];
  for(const keyword of ['원본','72','78'])assert.deepEqual(history.filterHistory(rows,{from:'2026-11-02',to:'2026-11-02',category:'score',keyword}).map(x=>x.id),['a']);
  assert.deepEqual(history.filterHistory(rows,{from:'2026-11-01',to:'2026-11-01'}).map(x=>x.id),['b']);
  assert.match(history.historyCount(0,50,true),/50/);
  assert.match(history.historyCount(0,50,true),/더|추가/);
  assert.match(history.historyCount(0,50,false),/전체/);
});

test('recall requires current pending CEO evidence, unpaid status and exact reviewed revisions', () => {
  const items=[proposal,{...proposal,id:'p2',payment_status:'완료'},{...proposal,id:'p3',ceo_submission_status:'승인완료'},
    {...proposal,id:'p4'},{...proposal,id:'p5'},{...proposal,id:'p6',payment_status:null}];
  const sums=items.map(p=>({...summary,proposal_id:p.id,records:p.id==='p4'?[{...ceo,status:'승인'}]:p.id==='p5'?[]:[ceo]}));
  const eligible=recall.recallCandidates(items,sums);
  assert.deepEqual(eligible.map(p=>p.id),['p1']);
  const checked=recall.reviewRecall(eligible,['p1'],'  심사 원본 다시 확인  ');
  assert.deepEqual(checked.expected,{p1:'2026-11-10T00:00:00.123456Z'});
  assert.equal(checked.reason,'심사 원본 다시 확인');
  for(const reason of ['    ','가나다라','가'.repeat(1001)])assert.throws(()=>recall.reviewRecall(eligible,['p1'],reason));
  assert.throws(()=>recall.reviewRecall(eligible,[],'자료를 다시 확인'));
  assert.throws(()=>recall.reviewRecall(eligible,['p2'],'자료를 다시 확인'));
});

test('missing waiting start does not hide a legally pending submission, while recorded action blocks recall', () => {
  const noTime={...summary,actionable_at:null,pending_days:null,records:[{...ceo,actionable_at:null}]};
  assert.equal(recall.recallCandidates([proposal],[noTime]).length,1);
  for (const acted of [{acted_at:'2026-11-17T00:00:00Z'},{approver_name:'기존 승인자'}]) {
    assert.equal(recall.recallCandidates([proposal],[{...summary,records:[{...ceo,...acted}]}]).length,0);
  }
});

test('selection is limited to one atomic server batch of 200 proposals', () => {
  const eligible=Array.from({length:201},(_,i)=>({...proposal,id:String(i),summary:{...summary,proposal_id:String(i)}}));
  assert.throws(()=>recall.reviewRecall(eligible,eligible.map(p=>p.id),'최신 심사자료 확인'),/200/);
});

// The controllers own detached panels. This fixture drives their delegated event
// listeners and promises without network access or a browser dependency.
function panelFixture() {
  const events = new Map(), results={innerHTML:''};
  const panel = {innerHTML:'',addEventListener(type,fn){events.set(type,fn);},querySelector:()=>results};
  const root = {innerHTML:'',querySelector:()=>panel,contains:el=>el===panel};
  const dispatch = (type,attr,fields={}) => {
    const target={hasAttribute:name=>name===attr,closest:()=>target,...fields};
    events.get(type)({target});
  };
  return {root,panel,results,dispatch};
}
const frame = () => new Promise(resolve=>setImmediate(resolve));

test('history suspending during page read preserves the replacement route', async () => {
  const f=panelFixture(), page=deferred();
  const c=history.createProposalHistory({root:f.root,store:{getProposalHistory:()=>page.promise},getAdmin:()=>({isSystemAdmin:true}),header:()=>''});
  const pending=c.render(proposal);
  assert.match(f.results.innerHTML,/조회하고/);
  c.suspend(); f.results.innerHTML='다른 화면';
  page.resolve({items:[{id:1,detail:'예전 제안'}],next_cursor:null});await pending;
  assert.equal(f.results.innerHTML,'다른 화면');
});

test('submitted recall takes one exact-revision request and keeps receipt on refresh failure', async () => {
  const f=panelFixture(), save=deferred(), calls=[];
  const c=recall.createCeoRecall({root:f.root,store:{getWorkflowSummaries:async()=>[summary],recallCeoSubmissions:(...args)=>{calls.push(args);return save.promise;}},
    loadProposals:async()=>[proposal],getAdmin:()=>({isSystemAdmin:true}),header:()=>'',onSaved:async()=>{throw Error('offline')}});
  await c.render({year:'2026',proposalId:'p1'});
  f.dispatch('input','data-rc-reason',{value:'점수표 원본 다시 확인'});
  f.dispatch('click','data-rc-review');
  assert.match(f.panel.innerHTML,/회수 전 확인/);
  f.dispatch('click','data-rc-save'); f.dispatch('click','data-rc-save');
  assert.deepEqual(calls,[[['p1'],'점수표 원본 다시 확인',{p1:proposal.updated_at}]]);
  assert.match(f.panel.innerHTML,/disabled/);
  save.resolve({recalled_count:1,proposal_ids:['p1']});
  await frame();
  assert.match(f.panel.innerHTML,/1건 회수 완료/);
  assert.match(f.panel.innerHTML,/목록을 새로 불러오지 못해/);
  assert.doesNotMatch(f.panel.innerHTML,/data-rc-save/);
});

test('rejected recall requires a fresh server read and never retries the previous selection directly', async () => {
  const f=panelFixture();let calls=0;
  const c=recall.createCeoRecall({root:f.root,store:{getWorkflowSummaries:async()=>[summary],recallCeoSubmissions:async()=>{calls++;throw Error('목록이 변경되었습니다');}},
    loadProposals:async()=>[proposal],getAdmin:()=>({isSystemAdmin:true}),header:()=>''});
  await c.render({proposalId:'p1'});
  f.dispatch('input','data-rc-reason',{value:'점수표 원본 다시 확인'});
  f.dispatch('click','data-rc-review'); f.dispatch('click','data-rc-save'); await frame();
  assert.match(f.panel.innerHTML,/목록이 변경되었습니다/);
  assert.doesNotMatch(f.panel.innerHTML,/data-rc-save/);
  f.dispatch('click','data-rc-save'); assert.equal(calls,1);
});
