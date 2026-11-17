import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewStages} from '../js/ui/review-stages-v2913.js';
const p={proposal_no:'TEST-1',second_evaluation_total:80,second_evaluation_completed_at:'2026-11-10T00:00:00Z',second_evaluation_by_name:'제안관리자',review_result:'채택',first_evaluation_total:65,team_leader_evaluation_total:70};
test('inputter is not inferred as a third reviewer',()=>{
 const t=reviewStages(p).stages[2];assert.match(t.by,/심사위원: 미확인/);assert.match(t.by,/입력자: 제안관리자/);assert.equal(t.dateLabel,'입력일');
});
test('assigned reviewers do not imply actual attendance',()=>{
 const t=reviewStages({...p,review_committee:{state:'assigned',members:[{name:'테스트위원',department:'테스트부서'}]}}).stages[2];
 assert.match(t.by,/지정 심사위원: 테스트위원/);assert.match(t.by,/실제 심사자 미확인/);assert.match(t.by,/입력자: 제안관리자/);
});
test('confirmed multiple reviewers and inputter remain distinct',()=>{
 const t=reviewStages({...p,review_committee:{state:'confirmed',members:[{name:'위원가',department:'부서가'},{name:'위원나',department:'부서나'}]}}).stages[2];assert.match(t.by,/심사위원: 위원가.*위원나/);assert.match(t.by,/실제 심사자 확인/);
});
test('changed review must be reconfirmed',()=>{
 const t=reviewStages({...p,review_committee:{state:'reconfirm',members:[{name:'위원가'}]}}).stages[2];assert.match(t.by,/재확인 필요/);
});
test('load failure is not unassigned',()=>{
 const t=reviewStages({...p,review_committee:{state:'error'}}).stages[2];assert.match(t.by,/조회 실패/);assert.doesNotMatch(t.by,/미지정/);
});
test('legacy registration is labelled input rather than a fresh assessment',()=>{
 const t=reviewStages({approval_required:false,score:80,review_result:'채택',legacy_score_revision:1,legacy_score_registered_at:'2026-11-10',review_committee:{state:'unassigned',inputter:'제안관리자'}}).stages[2];assert.match(t.by,/입력자: 제안관리자/);assert.equal(t.dateLabel,'등록일');
});
test('first and second stages are not changed',()=>{
 assert.equal(reviewStages(p).stages[0].value,'65점');assert.equal(reviewStages(p).stages[1].value,'70점');assert.equal(reviewStages(p).result,'채택');
});
import {createReviewSource} from '../js/ui/review-stages-v2913.js';
const config={supabaseUrl:'https://test.example.invalid',supabaseAnonKey:'test-public-key'};
const response=(rows,status=200)=>({ok:status===200,status,json:async()=>rows,headers:{get:()=>null}});
test('independent metadata error preserves score and inputter',async()=>{
 const reader=createReviewSource({config,fetcher:async url=>url.includes('v2913')?response(null,403):response([p])});
 const map=await reader.load(['TEST-1']);const model=reviewStages(map.get('TEST-1'));assert.equal(model.stages[2].value,'80점');assert.match(model.stages[2].by,/조회 실패/);assert.match(model.stages[2].by,/입력자: 제안관리자/);reader.dispose();
});
test('public metadata is range checked and foreign rows never shown',async()=>{
 const reader=createReviewSource({config,fetcher:async url=>response(url.includes('v2913')?[{proposal_no:'FOREIGN',state:'confirmed',members:[{name:'wrong'}]}]:[p])});
 const model=reviewStages((await reader.load(['TEST-1'])).get('TEST-1'));assert.match(model.stages[2].by,/조회 실패/);assert.doesNotMatch(model.stages[2].by,/wrong/);reader.dispose();
});
test('public metadata maps confirmed members to correct proposal',async()=>{
 const reader=createReviewSource({config,fetcher:async url=>response(url.includes('v2913')?[{proposal_no:'TEST-1',state:'confirmed',members:[{name:'위원가',department:'생산'}],inputter:'입력담당'}]:[p])});
 const model=reviewStages((await reader.load(['TEST-1'])).get('TEST-1'));assert.match(model.stages[2].by,/위원가/);assert.match(model.stages[2].by,/입력자: 입력담당/);reader.dispose();
});
test('duplicate committee results are not silently merged',async()=>{
 const item={proposal_no:'TEST-1',state:'assigned',members:[{name:'위원가'}]};
 const reader=createReviewSource({config,fetcher:async url=>response(url.includes('v2913')?[item,item]:[p])});
 assert.equal((await reader.load(['TEST-1'])).get('TEST-1').review_committee.state,'error');reader.dispose();
});
