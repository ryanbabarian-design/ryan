// In-memory PostgreSQL only. Usage: node tools/verify-proposal-v2917.mjs [PGlite dist/index.js] [--baseline]
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : null;
const {PGlite} = await import(path ? pathToFileURL(path).href : '@electric-sql/pglite');
const {pgcrypto} = await import(path ? pathToFileURL(resolve(dirname(path),'contrib/pgcrypto.js')).href : '@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({extensions:{pgcrypto}});
const read = file => readFile(resolve(root,file),'utf8');
const exec = async file => db.exec(await read(file));
const one = async (sql,...args) => (await db.query(sql,args)).rows[0];
const value = async (sql,...args) => Object.values(await one(sql,...args))[0];
const rpc = async (name,...args) => value(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,...args);
const ids = [1,2,3,4].map(n=>`00000000-0000-4000-a000-00000000000${n}`);
const [admin,team,executive] = ids;
const identity = async (id,role='authenticated')=>{await db.exec('RESET ROLE'); await value("select set_config('test.user_id',$1,false)",id||''); await db.exec(`SET ROLE ${role}`);};
const owner = ()=>db.exec('RESET ROLE');
const score = Object.fromEntries(['originality','effort','feasibility','applicability','continuity','tangible_effect'].map(k=>[k,7]));
const body = {category:'개선',title:'격리 시험',proposer_name:'신규',department:'생산',current_problem:'현황',improvement_plan:'개선',expected_effect:'효과',first_evaluation:score,before_images:[],after_images:[]};
const submit = (request = randomUUID(),data=body,pin='7462')=>rpc('v2917_create_proposal',request,JSON.stringify(data),pin);
const revision = async id=>{await owner();return value('select updated_at::text from public.proposals where id=$1',id);};
const approve = (id,step,expected)=>rpc('v2917_approve_team',id,step,JSON.stringify(score),'확인',expected);
const recall = (ids,reason,expected)=>rpc('v2917_recall_ceo',ids,reason,JSON.stringify(expected));
const history = (id,limit,cursor)=>rpc('v2917_proposal_history',id,limit,cursor);
const states = (id)=>one('select p.ceo_submission_status, p.legacy_ceo_direct, r.status,r.actionable_at,r.assigned_user_id from proposals p join approval_records r on r.proposal_id=p.id and r.step_id=4 where p.id=$1',id);
let passed=0;
const check = (ok,message)=>{assert.ok(ok,message);passed++;};
const same = (a,b,message)=>{assert.deepEqual(a,b,message);passed++;};
const rejects = async (operation,pattern,message)=>{await assert.rejects(operation,pattern,message);passed++;};
try {
  await exec('tests/sql/schema_v2917.sql');
  await exec('sql/baseline/proposal_reliability_before_v2917.sql');
  await exec('tests/sql/triggers_v2917.sql');
  await exec('tests/sql/fixture_v2917.sql');
  // Install the existing worker's send-time revalidation and scheduler without deployment cleanup.
  const reminders = await read('sql/ceo_reminder_7d.sql');
  await db.exec(reminders.slice(reminders.indexOf('CREATE OR REPLACE FUNCTION'),reminders.indexOf('-- BEGIN DEPLOYMENT ACL')));
  if (process.argv.includes('--baseline')) {
    for(const fn of ['v2917_create_proposal','v2917_edit_proposal','v2917_approve_team','v2917_recall_ceo','v2917_workflow_summary','v2917_proposal_history']) {
      same(await value('select count(*)::int from pg_proc where proname=$1',fn),0,fn+' should be absent in the old schema');
    }
    // Regression independent of the new endpoints: a freshly submitted legacy CEO row loses its assignee.
    await db.query(`insert into proposals(id,proposal_no,category,proposer_name,department,title,current_problem,improvement_plan,expected_effect,edit_pin_hash,first_evaluation,approval_required,ceo_submission_status,legacy_ceo_direct,legacy_score_revision) values($1,'TEST-L','개선','기존','연구','제안','현황','개선','효과','unused',$2,false,'상신완료',true,1)`,[ids[0],JSON.stringify(score)]);
    await db.query(`insert into approval_records(proposal_id,step_id,assigned_user_id,actionable_at) values($1,4,$2,now())`,[ids[0],ids[3]]);
    same((await states(ids[0])).actionable_at,null,'Pre-release direct CEO step lost its actionable time');
    console.log(`RED baseline confirmed: ${passed} checks`);
  } else {
    await exec('sql/proposal_reliability_v2917.sql');
    const key=randomUUID();
    await identity(null,'anon');
    const receipt=await submit(key);
    same(Object.keys(receipt.proposal).sort(),['id','proposal_no','received_date']);
    const id=receipt.proposal.id;
    same(receipt.created,true);
    await owner();await db.exec('update proposal_intake_settings set is_open=false');await identity(null,'anon');
    same(await submit(key),{proposal:receipt.proposal,created:false},'Accepted retry still works during intake pause');
    await rejects(()=>submit(randomUUID()),/중단/);
    await rejects(()=>submit(key,{...body,title:'다른 본문'}),/요청/);
    await rejects(()=>submit(key,{...body,after_images:[{path:'other'}]}),/요청/);
    await rejects(()=>submit(key,body,'9999'),/요청/);
    await rejects(()=>submit(key,body,null),/수정번호/);
    await rejects(()=>db.query('select * from proposal_private_v2917.requests'),/permission denied/);
    await owner();same(await value('select count(*)::int from proposals'),1);await db.exec('update proposal_intake_settings set is_open=true');
    const rev0=await revision(id); const no=receipt.proposal.proposal_no;
    await identity(null,'anon');
    const edit=(pin,rev)=>rpc('v2917_edit_proposal',no,pin,JSON.stringify({title:'수정된 제안'}),rev);
    await rejects(()=>edit(null,rev0),/수정번호/); await rejects(()=>edit('0000',rev0),/수정번호/);
    await rejects(()=>edit('7462',null),/변경|다시/);
    const edited=await edit('7462',rev0);same(edited.proposal_no,no);check(edited.updated_at,'Current updated revision');
    await rejects(()=>edit('7462',rev0),/변경|다시/);
    const rev1=await revision(id);await identity(team);
    await rejects(()=>approve(id,3,rev1),/부서장/);
    await rejects(()=>approve(id,2,rev0),/변경|다시/);
    await owner();await db.query(`update approval_records set status='대기' where proposal_id=$1 and step_id=1`,[id]);await identity(team);
    await rejects(()=>approve(id,2,rev1),/이전 결재/);
    await owner();same(await value('select team_leader_evaluation_total from proposals where id=$1',id),null,'Second stage failure rolls back score');
    await db.query(`update approval_records set status='승인' where proposal_id=$1 and step_id=1`,[id]);
    await identity(executive);await rejects(()=>approve(id,2,rev1),/권한|지정/);
    await identity(team);same(await approve(id,2,rev1),{proposal_id:id,step_id:2,status:'승인'});
    await owner();same(await value('select team_leader_evaluation_total from proposals where id=$1',id),70);
    await identity(executive);await rpc('v295_act_approval',id,3,'승인','임원 확인');
    // Use the live review and submit functions to build a valid regular cycle.
    const review = async (id,expected)=>rpc('v291_save_third_review',id,JSON.stringify(score),JSON.stringify({review_result:'채택',review_comment:'검토',payment_status:'미지급'}),expected,'심사 기록 확인','score');
    const beforeReview=await revision(id);await identity(admin);await review(id,beforeReview);
    const rev2=await revision(id);await identity(admin);
    const sibling=(await submit()).proposal.id;
    const siblingInitial=await revision(sibling);await identity(team);await approve(sibling,2,siblingInitial);
    await identity(executive);await rpc('v295_act_approval',sibling,3,'승인','임원 확인');
    const siblingReviewed=await revision(sibling);await identity(admin);await review(sibling,siblingReviewed);
    const siblingRevision=await revision(sibling);await identity(admin);
    const batch=await rpc('v295_submit_proposals_to_ceo',[id,sibling],JSON.stringify({[id]:rev2,[sibling]:siblingRevision}));
    check(batch.batch_id,'Existing submit returned batch');
    const second=(await submit()).proposal.id;
    const rev=await revision(id);await identity(team);
    await rejects(()=>recall([id],'재평가 요청 사유',{[id]:rev}),/관리자/);
    await rejects(()=>history(id,10,null),/관리자/);
    await identity(admin);await rejects(()=>recall([id],'   ',{[id]:rev}),/사유/);await rejects(()=>recall([id],'짧음',{[id]:rev}),/사유/);
    await rejects(()=>recall([id],'재평가 요청 사유',{[id]:rev2}),/변경|다시/);
    await rejects(()=>recall([id,second],'재평가 요청 사유',{[id]:rev,[second]:rev}),/변경|대기|상신/);
    await owner();same((await states(id)).ceo_submission_status,'상신완료');
    const recordSnapshot=await value('select jsonb_agg(to_jsonb(r) order by id) from approval_records r where proposal_id=$1 and step_id<>4',id);
    const preserved=await value("select to_jsonb(p)-array['legacy_ceo_direct','ceo_submission_status','ceo_submitted_at','ceo_submitted_by','ceo_submitted_by_name','ceo_batch_id','updated_at'] from proposals p where id=$1",id);
    await db.query("update proposal_notification_queue set status='sending' where ceo_batch_id=$1",[batch.batch_id]);await identity(admin);
    await rejects(()=>recall([id],'재평가 요청 사유',{[id]:rev}),/발송/);
    await owner();
    const initialQueue=await value("update proposal_notification_queue set status='failed',attempts=1,last_error='connection reset after request' where ceo_batch_id=$1 returning id",batch.batch_id);
    await identity(admin);await rejects(()=>recall([id],'심사 근거 재확인',{[id]:rev}),/발송/);
    await rejects(()=>rpc('retry_proposal_notification',initialQueue),/발송/);
    await owner();same(await one('select status,last_error from proposal_notification_queue where id=$1',initialQueue),{status:'failed',last_error:'connection reset after request'});
    for(const status of [409,408,500,504]) {
      const providerError=`Resend ${status}: provider outcome is not definitive`;
      await db.query("update proposal_notification_queue set status='failed',attempts=1,last_error=$2 where id=$1",[initialQueue,providerError]);
      await identity(admin);await rejects(()=>recall([id],'심사 근거 재확인',{[id]:rev}),/발송/,`Legacy HTTP ${status} must block recall`);
      await rejects(()=>rpc('retry_proposal_notification',initialQueue),/발송/,`Legacy HTTP ${status} must block retry`);
      await owner();same(await one('select status,last_error from proposal_notification_queue where id=$1',initialQueue),{status:'failed',last_error:providerError},`Legacy HTTP ${status} preserves the original batch for delivery verification`);
    }
    await db.query("update proposal_notification_queue set last_error='발송 전 확인 실패: 대상 조회 오류' where id=$1",[initialQueue]);
    await identity(admin);await rpc('retry_proposal_notification',initialQueue);await owner();same(await value('select status from proposal_notification_queue where id=$1',initialQueue),'pending');
    for(const status of [400,401,403,404,422,429]) {
      await db.query("update proposal_notification_queue set status='failed',last_error=$2 where id=$1",[initialQueue,`Resend ${status}: request rejected`]);
      await identity(admin);await rpc('retry_proposal_notification',initialQueue);await owner();same(await value('select status from proposal_notification_queue where id=$1',initialQueue),'pending',`Definite HTTP ${status} rejection stays retryable`);
    }
    const ordinaryQueue=await value("update proposal_notification_queue set status='failed',last_error='previous worker error',attempts=1 where proposal_id=$1 and step_id=2 and notification_type='new' returning id",id);
    await identity(admin);await rpc('retry_proposal_notification',ordinaryQueue);await owner();same(await value('select status from proposal_notification_queue where id=$1',ordinaryQueue),'pending');
    // Both an unsent initial batch and its seven-day digest contain the selected anchor and the surviving sibling.
    await db.query("update proposal_notification_queue set status='pending',proposal_id=$2 where ceo_batch_id=$1",[batch.batch_id,id]);
    const sentBatch=randomUUID();await db.query("insert into proposal_notification_queue(proposal_id,step_id,recipient_email,notification_type,status,sent_at,ceo_batch_id) values($1,4,'ceo@example.test','ceo_batch','sent',now(),$2)",[id,sentBatch]);
    const aged=await value("select (now()-interval '8 days')::text");
    await db.query("update approval_records set actionable_at=$1 where proposal_id=any($2) and step_id=4",[aged,[id,sibling]]);
    await db.query("insert into proposal_notification_queue(proposal_id,step_id,recipient_email,notification_type,status) values($1,4,'admin@example.test','admin_7d','pending')",[id]);
    await db.query("insert into proposal_notification_queue(step_id,recipient_email,notification_type,status,digest_key,digest_items) values(4,'ceo@example.test','ceo_reminder_7d','pending','mixed',$1),(4,'ceo@example.test','ceo_reminder_7d','pending','single',$2)",[JSON.stringify([id,sibling].map(proposal_id=>({proposal_id,actionable_at:aged}))),JSON.stringify([{proposal_id:id,actionable_at:aged}])]);
    await identity(admin);same((await recall([id],'심사 근거 재확인',{[id]:rev})).recalled_count,1);
    // The deployed public timeline exposes these status columns to anonymous readers.
    await owner();await db.exec('GRANT SELECT (proposal_id,stage,detail) ON public.proposal_status_history TO anon');
    await identity(null,'anon');
    const publicRecall=await one("select stage,detail from public.proposal_status_history where proposal_id=$1 and stage='대표이사 상신 회수'",id);
    same(publicRecall,{stage:'대표이사 상신 회수',detail:'관리자가 대표이사 상신을 회수했습니다.'},'Anonymous timeline may describe the recall but must not disclose the administrator’s reason');
    await rejects(()=>rpc('v2917_proposal_history',id,50,null),/permission denied/);
    await owner();const s=await states(id);same(s.ceo_submission_status,'미상신');same(s.actionable_at,null);same(s.status,'대기');
    same(await value('select jsonb_agg(to_jsonb(r) order by id) from approval_records r where proposal_id=$1 and step_id<>4',id),recordSnapshot);
    same(await value("select to_jsonb(p)-array['legacy_ceo_direct','ceo_submission_status','ceo_submitted_at','ceo_submitted_by','ceo_submitted_by_name','ceo_batch_id','updated_at'] from proposals p where id=$1",id),preserved);
    same(await one("select status,proposal_id from proposal_notification_queue where ceo_batch_id=$1",batch.batch_id),{status:'pending',proposal_id:sibling});
    same(await value("select status from proposal_notification_queue where ceo_batch_id=$1",sentBatch),'sent');
    same(await value("select status from proposal_notification_queue where notification_type='admin_7d' and proposal_id=$1",id),'cancelled');
    // Older signers queued before recall must also fail at the actual write boundary.
    await rejects(()=>db.query("update approval_records set status='승인' where proposal_id=$1 and step_id=4",[id]),/상신 상태/);
    same(await value("select status from proposal_notification_queue where digest_key='single'"),'cancelled');
    same(await value("select digest_items->0->>'proposal_id' from proposal_notification_queue where digest_key='mixed'"),sibling);
    const digestId=await value("update proposal_notification_queue set status='sending' where digest_key='mixed' returning id");
    const sendable=await rpc('v2916_get_ceo_reminder_items',digestId);same(sendable.map(x=>x.proposal_id),[sibling]);
    await db.query("update proposal_notification_queue set status='sent',digest_sent_items=digest_items,sent_at=now() where id=$1",[digestId]);
    await rpc('v23_enqueue_due_reminders');
    same(await value("select count(*)::int from proposal_notification_queue q cross join lateral jsonb_array_elements(q.digest_items) m where q.status='pending' and m->>'proposal_id'=$1",id),0);
    // Old audit sources can hold identity changes even without a dedicated content correction record.
    await db.query("insert into proposal_audit_log(proposal_id,proposal_no,action,actor_type,before_data,after_data) values($1,$2,'UPDATE','public_pin_edit',$3,$4)",[id,no,JSON.stringify({proposer_name:'이전 이름',department:'이전 부서'}),JSON.stringify({proposer_name:'새 이름',department:'새 부서'})]);
    await db.query("insert into proposal_admin_content_history_v274(proposal_id,proposal_no,revision,actor_id,actor_name,reason,before_content,after_content) values($1,$2,1,$3,'관리자','원문 오기 정정',$4,$5)",[id,no,admin,JSON.stringify({title:'전'}),JSON.stringify({title:'후'})]);
    await identity(admin);const got=await history(id,2,null);same(got.items.length,2);check(got.next_cursor,'History page has another page');
    const events=[...got.items];let cursor=got.next_cursor;while(cursor){const page=await history(id,2,cursor);events.push(...page.items);cursor=page.next_cursor;}
    same(new Set(events.map(e=>e.id)).size,events.length);same(events.filter(e=>e.field_name==='title'&&e.after==='수정된 제안').length,1,'One field event for the same ordinary title change');check(events.some(e=>e.category==='identity'&&e.field_name==='department'&&e.before==='이전 부서'&&e.after==='새 부서'),'Identity change from original audit');check(events.some(e=>e.category==='content'&&e.reason==='원문 오기 정정'&&e.before.title==='전'&&e.after.title==='후'),'Content revision before/after/reason');await rejects(()=>history(sibling,2,got.next_cursor),/페이지/);check(events.some(e=>e.category==='recall'&&e.reason==='심사 근거 재확인'&&e.before&&e.after),'Recall reason and snapshots');
    await identity(null,'anon');const wf=await rpc('v2917_workflow_summary',[id,second]);same(wf.length,2);const firstWf=wf.find(w=>w.proposal_id===id);same(firstWf.stage_key,'submission');const current=wf.find(w=>w.proposal_id===second);same(current.current_role,'부서장');check(current.actionable_at,'Actual actionability');
    await rejects(()=>rpc('v2917_workflow_summary',Array(501).fill(id)),/500/);check(!JSON.stringify(wf).includes('@') && !ids.some(uid=>JSON.stringify(wf).includes(uid)),'No actor UUID or email');
    await owner();await db.query("update approval_assignments set display_name='leak@example.test' where step_id=2");await identity(null,'anon');same((await rpc('v2917_workflow_summary',[second]))[0].assignee_name,null);
    await owner();await db.query("update approval_records set actionable_at=null where proposal_id=$1 and step_id=2",[second]);await identity(null,'anon');const unknown=(await rpc('v2917_workflow_summary',[second]))[0];same(unknown.pending_days,null);same(unknown.actionable_at,null);
    const now=await revision(id);await identity(admin);await review(id,now);const again=await revision(id);await identity(admin);check((await rpc('v295_submit_proposals_to_ceo',[id],JSON.stringify({[id]:again}))).batch_id !== batch.batch_id,'Resubmission with same anchor preserves prior sent batch');
    const CEO=ids[3];await identity(CEO);await rpc('v295_act_approval',id,4,'승인','대표 승인');const signed=await revision(id);await identity(admin);await rejects(()=>recall([id],'재평가 요청 사유',{[id]:signed}),/대기|상신|승인/);
    // Historical direct route. Seed only the already registered score and its audit evidence.
    await owner();const legacy=randomUUID();
    await db.query(`insert into proposals(id,proposal_no,category,proposer_name,department,title,current_problem,improvement_plan,expected_effect,edit_pin_hash,first_evaluation,approval_required,status,review_result,score,award_grade,award_amount,legacy_score_revision,legacy_score_registered_at) values($1,'TEST-LEGACY','개선','기존','연구','기존 제안','현황','개선','효과','unused',$2,false,'심사완료','채택',70,'C',30000,1,now())`,[legacy,JSON.stringify(score)]);
    await db.query(`insert into proposal_legacy_score_history_v295(proposal_id,proposal_no,revision,after_score,after_result,after_award,basis,reason,actor_id,actor_name) values($1,'TEST-LEGACY',1,70,'채택',30000,'기존 평가','근거 확인',$2,'관리자')`,[legacy,admin]);
    const legacyRev=await revision(legacy);await identity(admin);await rpc('v295_submit_proposals_to_ceo',[legacy],JSON.stringify({[legacy]:legacyRev}));
    await owner();let legacyState=await states(legacy);same(legacyState.assigned_user_id,CEO);check(legacyState.actionable_at,'Legacy CEO must be actionable after direct submit');
    const directDigestCount=()=>value("select count(*)::int from proposal_notification_queue q cross join lateral jsonb_array_elements(q.digest_items) m where q.notification_type='ceo_reminder_7d' and q.status IN('pending','sending','sent','failed') and m->>'proposal_id'=$1",legacy);
    await db.query("update approval_records set actionable_at=now()-interval '167 hours 59 minutes' where step_id=4 and proposal_id=$1",[legacy]);
    await rpc('v23_enqueue_due_reminders');same(await directDigestCount(),0,'Direct route waits all 168 hours');
    const oldCycle=await value("update approval_records set actionable_at=now()-interval '168 hours' where step_id=4 and proposal_id=$1 returning actionable_at::text",legacy);
    await rpc('v23_enqueue_due_reminders');same(await directDigestCount(),1,'Verified unpaid direct CEO gets one seven-day digest, without fictional predecessor approvals');
    await rpc('v23_enqueue_due_reminders');same(await directDigestCount(),1,'Direct cycle deduplicates repeated schedules');
    const directDigest=await value("update proposal_notification_queue q set status='sending' where q.notification_type='ceo_reminder_7d' and q.status='pending' and exists(select from jsonb_array_elements(q.digest_items) m where m->>'proposal_id'=$1) returning id",legacy);
    await db.exec('GRANT SELECT ON proposals,approval_records,approval_steps,approval_assignments,proposal_notification_queue TO service_role');
    await identity(null,'service_role');same((await rpc('v2916_get_ceo_reminder_items',directDigest)).map(x=>x.proposal_id),[legacy],'Worker validates a claimed direct item');
    await owner();await db.query("update approval_assignments set user_id=$1,display_name='대체 대표' where step_id=4",[executive]);
    same(await rpc('v2916_get_ceo_reminder_items',directDigest),[],'A replacement CEO cannot use the previous signer’s direct approval');
    const unassigned=(await rpc('v2917_workflow_summary',[legacy]))[0];same(unassigned.stage_key,'ceo');same(unassigned.assignee_name,null);check(unassigned.next_action.includes('배정'),'Direct signer mismatch requests administrative reassignment check');
    await db.query("update approval_assignments set user_id=$1,display_name='대표 이름' where step_id=4",[CEO]);
    await db.query("update proposal_notification_queue set status='pending' where id=$1",[directDigest]);
    const submittedLegacy=await revision(legacy);await identity(admin);await recall([legacy],'기존 평가 확인',{[legacy]:submittedLegacy});
    await owner();legacyState=await states(legacy);same(legacyState.legacy_ceo_direct,false);same(legacyState.actionable_at,null);same(await value("select count(*)::int from approval_records where proposal_id=$1 and step_id<>4",legacy),0);
    same(await value('select status from proposal_notification_queue where id=$1',directDigest),'cancelled','Recall cancels a pending direct reminder');
    const recalledLegacy=await revision(legacy);await identity(admin);await rpc('v295_submit_proposals_to_ceo',[legacy],JSON.stringify({[legacy]:recalledLegacy}));
    await owner();check((await states(legacy)).actionable_at,'Direct resubmission starts a new cycle');await rpc('v23_enqueue_due_reminders');same(await directDigestCount(),0,'Old due time is not reused after direct resubmission');
    // Advance this synthetic cycle to another week using a historical daily queue key for the first digest.
    await db.query("update proposal_notification_queue set digest_key='fixture-prior-week-direct' where id=$1",[directDigest]);
    await db.query("update approval_records set actionable_at=$1::timestamptz-interval '1 second' where proposal_id=$2 and step_id=4",[oldCycle,legacy]);
    await rpc('v23_enqueue_due_reminders');same(await directDigestCount(),1,'Next direct cycle receives its own digest');
    await owner();await db.query("update proposals set payment_status='완료' where id=$1",[legacy]);const paidRevision=await revision(legacy);await identity(admin);await rejects(()=>recall([legacy],'재심사 요청 사유',{[legacy]:paidRevision}),/지급|대기/);
    await owner();same(await value("select count(*)::int from proposal_notification_queue where notification_type='ceo_batch' and status='cancelled' and proposal_id=$1",legacy),1);
    console.log(`GREEN: ${passed} SQL behavior/ACL checks passed`);
  }
} catch(error) {console.error(error.message,error.where||'');process.exitCode=1;} finally { await db.close(); }
