import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/services/store.js';

function fixture(response) {
  const calls=[];
  const client={storage:{from:()=>({})},rpc(name,args,options){calls.push({name,args,options});return response(name,args,options);}};
  globalThis.window={supabase:{createClient:()=>client}};
  const store=createStore({demoMode:false,supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'public-fixture',storageBucket:'images'});
  return {store,calls};
}

test('create binds request ID, complete content and PIN and returns the immutable receipt',async()=>{
  const receipt={id:'p1',proposal_no:'Q26-999',received_date:'2026-11-20'};
  const f=fixture(async()=>({data:{proposal:receipt,created:false},error:null}));
  f.store.operations.assertNewProposalAllowed=()=>{throw Error('must not preempt retry after intake pauses');};
  const requestId='60000000-0000-4000-8000-000000000001';
  const result=await f.store.createProposal({title:'검증',edit_pin:'1234',implementation_status:'미실시'},[],[],{requestId});
  assert.equal(result,receipt);
  const call=f.calls[0];assert.equal(call.name,'v2917_create_proposal');
  assert.equal(call.args.p_request_id,requestId);assert.equal(call.args.p_edit_pin,'1234');
  assert.equal(call.args.p_payload.title,'검증');assert.ok(!('edit_pin' in call.args.p_payload));
  assert.deepEqual(call.args.p_payload.before_images,[]);
});

test('edit forwards exact microsecond source revision and preserves supplied retained images',async()=>{
  const f=fixture(async()=>({data:{proposal_no:'Q26-999'},error:null}));
  const timestamp='2026-11-19T01:02:03.123456+00:00',image={path:'old/photo.png',url:'https://fixture.invalid/photo.png'};
  await f.store.updateProposalWithPin('Q26-999','1234',{title:'수정',before_images:[image],implementation_status:'미실시'},[],[],{expectedUpdatedAt:timestamp});
  assert.equal(f.calls[0].args.p_expected_updated_at,timestamp);
  assert.deepEqual(f.calls[0].args.p_payload.before_images,[image]);
});

test('team evaluation and signature use a single transactional call',async()=>{
  const f=fixture(async()=>({data:{proposal_id:'p1',status:'승인'},error:null}));
  const evaluation={originality:8};await f.store.approveTeamEvaluation('p1','2',evaluation,'의견','revision');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'v2917_approve_team');
  assert.equal(f.calls[0].args.p_step_id,2);assert.equal(f.calls[0].args.p_evaluation,evaluation);
  assert.equal(f.calls[0].args.p_expected_updated_at,'revision');
});

test('progress batches all unique IDs and never converts lookup failure to empty approvals',async()=>{
  const f=fixture(async(_name,args)=>({data:args.p_proposal_ids.map(id=>({proposal_id:id,records:[]})),error:null}));
  const ids=Array.from({length:201},(_,i)=>'p'+i);assert.equal((await f.store.getWorkflowSummaries([...ids,'p0'])).length,201);
  assert.deepEqual(f.calls.map(c=>c.args.p_proposal_ids.length),[100,100,1]);
  const fail=fixture(async()=>({data:null,error:Error('unavailable')}));
  await assert.rejects(fail.store.getWorkflowSummaries(['p1']),/unavailable/);
  const malformed=fixture(async()=>({data:{},error:null}));
  await assert.rejects(malformed.store.getWorkflowSummaries(['p1']),/응답/);
});

test('proposal loading follows exact page count beyond the first server page',async()=>{
  const pages=[];
  const f=fixture(()=>({range:async(from,to)=>{pages.push([from,to]);const count=1005;return {count,error:null,data:Array.from({length:Math.min(to+1,count)-from},(_,i)=>({id:String(from+i)}))};}}));
  const rows=await f.store.getProposals();assert.equal(rows.length,1005);assert.equal(new Set(rows.map(r=>r.id)).size,1005);assert.ok(pages.length>1);
});

test('recall forwards only selected IDs, reason and exact revision map; history preserves cursor',async()=>{
  const f=fixture(async(name,args)=>({data:name==='v2917_recall_ceo'?{recalled_count:1,proposal_ids:args.p_proposal_ids}:{items:[],next_cursor:'next'},error:null}));
  await f.store.recallCeoSubmissions(['p1','p1'],'  원본 점수 확인  ',{p1:'rev'});
  assert.deepEqual(f.calls[0].args,{p_proposal_ids:['p1'],p_reason:'원본 점수 확인',p_expected:{p1:'rev'}});
  await f.store.getProposalHistory('p1',{limit:50,cursor:'opaque-cursor'});
  assert.equal(f.calls[1].args.p_cursor,'opaque-cursor');
});
