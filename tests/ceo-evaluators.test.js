import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCeoRows,ceoSelection,assertCeoUnchanged} from '../js/admin/ceo-inbox-core.js';
import {renderCeoInbox} from '../js/admin/ceo-inbox-ui.js';
const p={id:'id-a',proposal_no:'Q26-TEST',title:'시험 제안',proposer_name:'시험본인',department:'생산',received_date:'2026-11-17',first_evaluation_total:81,team_leader_evaluation_total:82,team_leader_evaluation_by_name:'시험팀장',second_evaluation_by_name:'제안관리자',second_evaluation_total:73,second_evaluation_completed_at:'2026-11-17T00:00:00Z',review_result:'채택',score:73,award_amount:30000,updated_at:'2026-11-17T01:00:00Z'};
const inbox=[{proposal_id:p.id,role_name:'대표이사',can_act:true}];
const rows=(patch={})=>buildCeoRows(inbox,[{...p,...patch}]);
const html=(patch={})=>renderCeoInbox(rows(patch));
test('CEO first and team cells include stored evaluator names',()=>{
 const s=html();assert.match(s,/본인: 시험본인/);assert.match(s,/평가자: 시험팀장/);assert.match(s,/입력자: 제안관리자/);
});
test('missing team evaluator does not fall back to proposer or approver',()=>{
 assert.match(html({team_leader_evaluation_by_name:null}),/평가자: 미확인/);
});
test('administrative correction is not misrepresented as team evaluator',()=>{
 const s=html({team_leader_evaluation_by_name:'관리자 보완: 제안관리자'});assert.match(s,/평가자: 미확인/);assert.match(s,/입력·보완: 관리자 보완: 제안관리자/);assert.doesNotMatch(s,/평가자: 관리자 보완/);
});
test('explicit exemption does not invent a first evaluator',()=>{
 const r=rows({first_evaluation_total:null,legacy_first_evaluation_exempt:true});const s=renderCeoInbox(r);assert.match(s,/평가자: 해당 없음/);assert.doesNotMatch(s,/본인: 시험본인/);
});
test('names are HTML escaped',()=>{
 const s=html({team_leader_evaluation_by_name:'<img src=x onerror=alert(1)>',proposer_name:'<script>bad</script>'});assert.match(s,/평가자: &lt;img/);assert.doesNotMatch(s,/<script>bad/);assert.doesNotMatch(s,/<img src=x/);
});
test('committee placeholder is scoped to exact proposal and not inputter',()=>{
 const s=html();assert.match(s,/data-ceo-committee="Q26-TEST"/);assert.match(s,/심사위원: 조회 중/);assert.doesNotMatch(s,/심사위원: 제안관리자/);
});
test('pending, completed and rejected views all retain evaluator labels',()=>{
 for(const view of ['pending','completed','rejected'])assert.match(renderCeoInbox(rows(),{view}),/평가자: 시험팀장/);
});
test('identity display does not change approval count amount or eligibility',()=>{
 const before=rows(),after=rows({team_leader_evaluation_by_name:'다른명칭'});assert.deepEqual(ceoSelection(before,[p.id]).amount,30000);assert.equal(assertCeoUnchanged(before,after,[p.id]).count,1);assert.equal(before[0].selectable,true);assert.equal(before[0].first,81);assert.equal(before[0].team,82);assert.equal(before[0].score,73);
});
import {committeeMarkup,loadCeoCommittees} from '../js/admin/ceo-evaluators.js';
test('committee stages distinguish intended from confirmed and reconfirm',()=>{
 const members=[{name:'심사위원가',department:'가공'},{name:'심사위원나',department:'관리'}];
 const assigned=committeeMarkup({state:'assigned',members,inputter:'제안관리자'});assert.match(assigned,/지정 위원: 심사위원가/);assert.match(assigned,/실제 심사자 미확인/);
 const confirmed=committeeMarkup({state:'confirmed',members,inputter:'제안관리자'});assert.match(confirmed,/심사위원: 심사위원가.*심사위원나/);assert.match(confirmed,/실제 심사자 확인/);
 assert.match(committeeMarkup({state:'reconfirm',members}),/재확인 필요/);
});
test('unknown committee and query failure are not conflated',()=>{
 assert.match(committeeMarkup({state:'unassigned',members:[],has_review:true}),/심사위원: 미확인/);
 assert.match(committeeMarkup({state:'error'}),/심사위원: 조회 실패/);
 assert.doesNotMatch(committeeMarkup({state:'error'}),/심사위원: 미지정/);
});
test('committee and inputter names are escaped',()=>{
 const s=committeeMarkup({state:'confirmed',members:[{name:'<img src=x onerror=x>',department:'<script>x</script>'}],inputter:'<svg/onload=x>'});assert.doesNotMatch(s,/<img|<svg|<script/);assert.match(s,/&lt;img/);
});
test('metadata batches up to 100 without dropping a partial final batch',async()=>{
 const calls=[],ids=Array.from({length:201},(_,i)=>'TEST-'+i);
 const store={client:{rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_proposal_numbers.map(no=>({proposal_no:no,state:'unassigned',members:[]}))};}}};
 const map=await loadCeoCommittees(store,ids);assert.equal(map.size,201);assert.deepEqual(calls.map(c=>c.args.p_proposal_numbers.length),[100,100,1]);assert.ok(calls.every(c=>c.name==='v2913_review_committee_public'));
});
test('foreign duplicate malformed and omitted committee rows fail closed',async()=>{
 for(const data of [[{proposal_no:'FOREIGN',state:'confirmed',members:[{name:'wrong'}]}],[{proposal_no:'TEST',state:'confirmed',members:[]}],[],[{proposal_no:'TEST',state:'unassigned',members:[]},{proposal_no:'TEST',state:'unassigned',members:[]}],null]){
 const map=await loadCeoCommittees({client:{rpc:async()=>({data})}},['TEST']);assert.equal(map.get('TEST').state,'error');
 }
});
test('metadata network rejection preserves a visible error',async()=>{
 const map=await loadCeoCommittees({client:{rpc:async()=>{throw Error('offline');}}},['TEST']);assert.equal(map.get('TEST').state,'error');
});
test('metadata timeout terminates the loading indicator',async()=>{
 const map=await loadCeoCommittees({client:{rpc:()=>new Promise(()=>{})}},['TEST'],{timeoutMs:5});assert.equal(map.get('TEST').state,'error');
});
test('missing connection is never treated as demo/unassigned',async()=>{
 assert.equal((await loadCeoCommittees({},['TEST'])).get('TEST').state,'error');
});
