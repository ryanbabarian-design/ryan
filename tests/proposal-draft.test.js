import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const chromium = process.env.CHROMIUM_BIN || 'chromium';
const python = process.env.PYTHON || 'python3';
const available = process.env.HANA_DRAFT_BROWSER_TEST === '1' && spawnSync(chromium, ['--version']).status === 0 &&
  spawnSync(python, ['-c', 'from playwright.sync_api import sync_playwright']).status === 0;

// No server or Supabase connections. Exercise real Chromium storage and controls
// in the same ASGI/Playwright-capable runtime used for release visual QA.
test('proposal draft lifecycle in Chromium', { skip: !available && 'Opt in with HANA_DRAFT_BROWSER_TEST=1, Chromium and Python Playwright' }, async t => {
  const fixture = fileURLToPath(new URL('./fixtures/proposal-draft.html', import.meta.url));
  const script = `
import json, shutil, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which(sys.argv[1]), args=['--no-sandbox','--allow-file-access-from-files'])
    page = browser.new_page(viewport={'width':390,'height':844})
    checks = []
    for query in ('', '?lost-response'):
        page.goto(Path(sys.argv[2]).as_uri() + query)
        page.wait_for_function("Array.isArray(window.draftChecks)", timeout=30000)
        checks.extend(page.evaluate("window.draftChecks"))
    print(json.dumps(checks))
    browser.close()
`;
  const result = spawnSync(python, ['-c', script, chromium, fixture], {encoding:'utf8', timeout:45000});
  assert.equal(result.status, 0, result.stderr);
  for (const check of JSON.parse(result.stdout)) {
    await t.test(check.name, () => assert.equal(check.error, undefined, check.error));
  }
});

import * as draft from '../js/editor/proposal-draft.js';
const keys = ['originality','effort','feasibility','applicability','continuity','tangible_effect'];
function controls() {
  const values = { title:'<제목>', category:'안전', current_problem:'현재', improvement_plan:'개선', expected_effect:'효과', proposer_name:'이름', department:'생산', implementation_status:'미실시', edit_pin:'8726', website:'trap' };
  for (const key of keys) values['first_eval_'+key] = '5';
  return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{value:v}]));
}
const employee = {value:'이름',dataset:{department:'생산',employeeId:'b'}};
test('text checkpoint allowlists form fields, sanitizes rich text, and retains exact employee identity', () => {
  const elements = controls();
  elements.proposer_name.selectedOptions=[employee];
  elements.current_problem.value='<b>허용</b><script>주입</script>';
  const snapshot = draft.captureFields({elements}, html => html.replace(/<script>.*?<\/script>/g,''));
  assert.equal(snapshot.fields.title,'<제목>');
  assert.equal(snapshot.fields.current_problem,'<b>허용</b>');
  assert.equal(snapshot.author.employeeId,'b');
  assert.equal(JSON.stringify(snapshot).includes('8726'),false);
  assert.equal(JSON.stringify(snapshot).includes('trap'),false);
});

test('restoring never guesses between duplicate names and re-sanitizes stored rich text', () => {
  assert.equal(typeof draft.applyFields,'function');
  const elements = controls();
  elements.edit_pin.value='';
  elements.proposer_name.options=[{value:'',dataset:{}},{value:'이름',dataset:{department:'생산',employeeId:'a'}},employee];
  draft.applyFields({elements},{fields:{title:'복구',current_problem:'<b>본문</b>bad',edit_pin:'2468'},author:{name:'이름',department:'생산',employeeId:'b'}},v=>v.replace('bad',''));
  assert.equal(elements.current_problem.value,'<b>본문</b>');
  assert.equal(elements.edit_pin.value,'');
  assert.equal(elements.proposer_name.selectedIndex,2);
  draft.applyFields({elements},{fields:{},author:{name:'이름',department:'생산'}},v=>v);
  assert.equal(elements.proposer_name.selectedIndex,0);
});

test('seven progress groups link missing data and enforce the weighted 50 point threshold', () => {
  assert.equal(typeof draft.requiredGroups,'function');
  const elements = controls();
  const consent = {checked:true};
  const form = {elements,querySelector:s=>s.includes('checkbox')?consent:null};
  const groups = () => draft.requiredGroups(form,v=>v.replace(/<[^>]+>/g,'').trim());
  assert.equal(groups().length,7);
  assert.equal(groups().filter(g=>!g.missing).length,7);
  elements.first_eval_originality.value='4';
  elements.implementation_status.value='완료';
  elements.current_problem.value='<br>';
  assert.deepEqual(groups().filter(g=>g.missing).map(g=>g.missing).sort(),['current_problem','first_eval_originality','implemented_date']);
  elements.edit_pin.value='';
  assert.ok(groups().some(g=>g.missing==='edit_pin'));
  elements.edit_pin.value='1234';consent.checked=false;
  assert.ok(groups().some(g=>g.missing==='consent'));
});

test('checkpoints survive a new controller and report quota errors while preserving same-tab recovery', () => {
  assert.equal(typeof draft.textCheckpoint,'function');
  const values = new Map();
  const storage = {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k)};
  const first = draft.textCheckpoint('node-quota',()=>storage);
  const saved = {requestId:'first',fields:{title:'초안'},sourceUpdatedAt:'rev1'};
  assert.equal(first.write(saved),true);
  assert.deepEqual(draft.textCheckpoint('node-quota',()=>storage).read(),saved);
  storage.setItem=()=>{throw Error('quota');};
  const latest = {...saved,fields:{title:'수정'}};
  assert.equal(first.write(latest),false);
  assert.deepEqual(draft.textCheckpoint('node-quota',()=>storage).read(),latest);

});

function imageBackend() {
  const map = new Map();
  return async (_mode, operation) => operation({
    put:(v,k)=>map.set(k,structuredClone(v)),
    add:(v,k)=>{if(map.has(k))throw new DOMException('duplicate','ConstraintError');map.set(k,structuredClone(v));},
    get:k=>structuredClone(map.get(k)), delete:k=>map.delete(k), getAllKeys:()=>[...map.keys()],
  });
}
test('a fresh attachment reader recovers both retained images and real File bytes with metadata',async()=>{
  assert.equal(typeof draft.attachmentCheckpoint,'function');
  const transact = imageBackend();
  const images = {before:{existing:[{path:'kept.jpg'}],files:[new File(['picture1'],'before.png',{type:'image/png',lastModified:42})]},after:{existing:[],files:[]}};
  const manifest = {token:'rev-photo', before:{existing:images.before.existing,names:['before.png']},after:{existing:[],names:[]}};
  await draft.attachmentCheckpoint(transact).write('draft-id', manifest.token, images);
  const reader = draft.attachmentCheckpoint(transact);
  const restored = await reader.read('draft-id', manifest);
  assert.deepEqual(restored.before.existing,[{path:'kept.jpg'}]);
  const [file] = restored.before.files;
  assert.ok(file instanceof File);
  assert.equal(await file.text(),'picture1');assert.equal(file.name,'before.png');assert.equal(file.lastModified,42);
  await assert.rejects(reader.read('draft-id',{...manifest,token:'newer-incomplete'}));
  await reader.remove('draft-id');await assert.rejects(reader.read('draft-id',manifest));
});

test('if image storage fails, a same-tab route change still recovers photos while a reload reports them missing',async()=>{
  assert.equal(typeof draft.attachmentCheckpoint,'function');
  const failed = draft.attachmentCheckpoint(async()=>{throw Error('quota');});
  const images = {before:{existing:[],files:[]},after:{existing:[],files:[new File(['photo'],'p.jpg')]}};
  const manifest={token:'im',before:{existing:[],names:[]},after:{existing:[],names:['p.jpg']}};
  await assert.rejects(failed.write('id',manifest.token,images));
  const inTab = await failed.read('id',manifest);
  assert.equal(await inTab.after.files[0].text(),'photo');
  const freshTab = draft.attachmentCheckpoint(imageBackend());
  await assert.rejects(freshTab.read('id',manifest));
});

test('an accepted receipt keeps draft content and request identity while excluding private response fields',()=>{
  assert.equal(typeof draft.recordReceipt,'function');
  const storage = new Map();
  const getStorage = ()=>({getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)});
  const checkpoint = draft.textCheckpoint('new-proof',getStorage);
  const original = {requestId:'req1',sourceUpdatedAt:'rev1',fields:{title:'초안'},images:{token:'photo-rev'}};
  checkpoint.write(original);
  const result=draft.recordReceipt(checkpoint,original,{proposal_no:'Q-1',edit_pin:'7452',private_note:'SECRET'});
  assert.equal(result.saved,true);
  const reloaded = draft.textCheckpoint('new-proof',getStorage).read();
  assert.deepEqual(reloaded.receipt,{proposal_no:'Q-1'});assert.equal(reloaded.requestId,'req1');
  assert.equal(reloaded.fields.title,'초안');assert.deepEqual(reloaded.images,{token:'photo-rev'});
  assert.equal(JSON.stringify(reloaded).includes('7452'),false);
  assert.equal(JSON.stringify(reloaded).includes('SECRET'),false);
});

test('a late server receipt cannot replace a newer draft the author has already started',()=>{
  const storage = new Map();
  const checkpoint = draft.textCheckpoint('late-receipt',()=>({
    getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),
  }));
  checkpoint.write({requestId:'new',fields:{title:'다음 제안'}});
  const accepted = draft.recordReceipt(checkpoint,{requestId:'old',fields:{title:'먼저 제출'}},{proposal_no:'Q-1'});
  assert.deepEqual(accepted.receipt,{proposal_no:'Q-1'});
  assert.equal(checkpoint.read().requestId,'new');
  assert.equal(checkpoint.read().fields.title,'다음 제안');
});

function browserStorage() {
  const data = new Map();
  return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,
    setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
}
const denied = () => { throw new Error('storage denied'); };
test('independent blank tabs retain both manuscripts, keep the initial active owner, and list recoverable alternatives',()=>{
  const storage = browserStorage();
  const a=draft.textCheckpoint('parallel',()=>storage), b=draft.textCheckpoint('parallel',()=>storage);
  b.write({requestId:'B',fields:{title:'B의 제안'}});a.write({requestId:'A',fields:{title:'A의 제안'}});
  assert.equal(a.read().requestId,'B');
  assert.equal(a.read('A').fields.title,'A의 제안');
  assert.deepEqual(b.list().map(r=>r.requestId).sort(),['A','B']);
});
test('same-ID stale autosaves cannot erase an accepted receipt even before storage-event delivery',()=>{
  const storage=browserStorage(), a=draft.textCheckpoint('accepted',()=>storage),b=draft.textCheckpoint('accepted',()=>storage);
  const entry={requestId:'shared',fields:{title:'제출'}};
  a.write(entry);draft.recordReceipt(a,entry,'Q-1');b.write({...entry,fields:{title:'늦은 수정'}});
  assert.equal(b.read('shared').receipt?.proposal_no,'Q-1');
  assert.equal(b.read('shared').fields.title,'제출');
});
test('discard durably redirects the old request before typing; late writes, receipts, and stale clears cannot resurrect it',async()=>{
  const storage=browserStorage(), idb=imageBackend();
  const store=()=>draft.textCheckpoint('discard-gap',()=>storage,idb,new Map());
  const a=store(),old={requestId:'discarded',fields:{title:'폐기'}};
  a.write(old);
  await a.replace('discarded','fresh');
  draft.recordReceipt(store(),old,'Q-2');
  store().write(old);await store().replace('discarded','stale-replacement');
  assert.equal(store().read().requestId,'fresh');
  assert.deepEqual(store().read('discarded'),{requestId:'fresh'});
});
test('committed-but-unacknowledged create after denied localStorage retries with the verified ID from IndexedDB on full reload',async()=>{
  const idb=imageBackend(), newTab=()=>draft.textCheckpoint('lost-response',denied,idb,new Map());
  const first=newTab();first.write({requestId:'uncertain',fields:{title:'첫 제안'}});
  await first.ensure('uncertain');
  const server = new Map([['uncertain','Q-117']]);
  const reload=newTab(), recovered=await reload.recover('uncertain');
  assert.equal(recovered.requestId,'uncertain');
  assert.equal((await newTab().recover()).requestId,'uncertain');
  await reload.ensure(recovered.requestId);
  if (!server.has(recovered.requestId)) server.set(recovered.requestId,'Q-118');
  assert.equal(server.get(recovered.requestId),'Q-117');assert.equal(server.size,1);
  await reload.replace('uncertain','replacement');
  assert.equal((await newTab().recover('uncertain')).requestId,'replacement');
});
test('a verified localStorage identity permits create when IndexedDB is unavailable; losing both stores blocks create',async()=>{
  const good = browserStorage();
  const local = draft.textCheckpoint('ls-only',()=>good,denied,new Map());
  await local.ensure('local-id');
  assert.equal((await draft.textCheckpoint('ls-only',()=>good,denied,new Map()).recover('local-id')).requestId,'local-id');
  const none=draft.textCheckpoint('none',denied,denied,new Map());
  none.write({requestId:'no-store',fields:{title:'글'}});
  await assert.rejects(none.ensure('no-store'),/요청번호/);
});
test('a tab that has not seen acceptance cannot discard the now-accepted request',async()=>{
  const storage=browserStorage(), idb=imageBackend();
  const make=()=>draft.textCheckpoint('clear-accepted',()=>storage,idb,new Map());
  const entry={requestId:'old',fields:{title:'문서'}};
  const stale=make();stale.write(entry);draft.recordReceipt(make(),entry,'Q-4');
  assert.equal(await stale.replace('old','silent'),false);
  assert.equal((await make().recover('old')).receipt.proposal_no,'Q-4');
  assert.equal(await make().replace('old','deliberate','Q-4'),true);
  assert.equal((await make().recover('old')).requestId,'deliberate');
});
test('IndexedDB-only terminal decisions keep a confirmed receipt through stale clear and suppress a post-discard receipt',async()=>{
  const db=imageBackend(), open=()=>draft.textCheckpoint('terminal-idb',denied,db,new Map());
  const entry={requestId:'uncertain',fields:{title:'제안'}};
  await open().ensure(entry.requestId);
  await draft.recordReceipt(open(),entry,'Q-6').durable;
  assert.equal(await open().replace(entry.requestId,'stale'),false);
  assert.equal((await open().recover(entry.requestId)).receipt.proposal_no,'Q-6');
  assert.equal(await open().replace(entry.requestId,'new','Q-6'),true);
  await draft.recordReceipt(open(),entry,'Q-6').durable;
  assert.equal((await open().recover(entry.requestId)).requestId,'new');
});

// Native EventTarget plus the form controls used by mount. The only paused
// operation in these controller tests is the real checkpoint's storage transaction.
class DraftHostElement extends EventTarget {
  children=[]; dataset={}; content={textContent:''}; nodes=new Map();
  setAttribute() {}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  remove(){}
  querySelectorAll(){return [];}
  querySelector(selector) {
    if(selector.includes('table')) return null;
    if(!this.nodes.has(selector))this.nodes.set(selector,new DraftHostElement());
    return this.nodes.get(selector);
  }
}
function mountTestController(checkpoint, options={}) {
  const win=new EventTarget();
  win.history={state:{},replaceState(v){this.state=v;}};
  win.sessionStorage=browserStorage();
  const form=new DraftHostElement();
  form.elements=controls();form.elements.proposer_name.options=[{value:'',dataset:{}},employee];
  form.ownerDocument=new DraftHostElement();form.ownerDocument.defaultView=win;
  form.ownerDocument.createElement=()=>new DraftHostElement();
  const controller=draft.mountProposalDraft(form,{key:'new',checkpoint,syncEditors:()=>{},restoreEditors:()=>{},sanitizeHtml:s=>s,readImages:()=>({}),restoreImages:()=>{},...options});
  return {form,controller};
}
test('actual mounted markSubmitted locks immediately and waits for the delayed IndexedDB receipt commit',async()=>{
  const db=imageBackend(), pause=Promise.withResolvers(), writing=Promise.withResolvers();
  const transact=async(mode,op)=>{
    if(mode==='readwrite'){writing.resolve();await pause.promise;}
    return db(mode,op);
  };
  const {controller,form}=mountTestController(draft.textCheckpoint('actual-receipt',denied,transact,new Map()));
  await controller.ready;
  const result=controller.markSubmitted('Q-10');
  assert.ok(result instanceof Promise);
  assert.equal(controller.getReceipt().proposal_no,'Q-10');
  assert.equal(form.querySelector('[type=submit]').disabled,true);
  let settled=false;result.then(()=>{settled=true;});
  await writing.promise;await Promise.resolve();assert.equal(settled,false);
  pause.resolve();await result;
  assert.equal((await draft.textCheckpoint('actual-receipt',denied,db,new Map()).recover(controller.getRequestId())).receipt.proposal_no,'Q-10');
  controller.destroy();
});
test('closed intake blocks fresh requests; an attempted exact payload including photo bytes can replay with zero persisted PIN data',async()=>{
  const storage=browserStorage(), db=imageBackend(), open=()=>draft.textCheckpoint('closed-retry',()=>storage,db,new Map());
  const original={title:'원본',edit_pin:'9874',first_evaluation:{effort:5,continuity:8}};
  const photo=new File(['original bytes'],'before.jpg',{type:'image/jpeg'});
  let {form,controller}=mountTestController(open(),{recoveryOnly:true});
  await controller.ready;
  assert.equal(form.dataset.draftCanRetry,'false');assert.equal(form.querySelector('[type=submit]').disabled,true);
  await assert.rejects(controller.prepareSubmission(original,[photo],[]),/접수/);
  assert.equal(controller.canRetrySubmission(),false);
  form.dataset.intakeBlocked='false';
  await controller.prepareSubmission(original,[photo],[]);
  assert.equal(controller.canRetrySubmission(),true);
  form.dataset.intakeBlocked='true';
  await controller.prepareSubmission({...original,edit_pin:'1234'},[photo],[]);
  await assert.rejects(controller.prepareSubmission({...original,title:'다른 제안'},[photo],[]),/내용|사진/);
  await assert.rejects(controller.prepareSubmission(original,[new File(['changed bytes'],'before.jpg',{type:'image/jpeg'})],[]),/내용|사진/);
  const id=controller.getRequestId();
  assert.equal(JSON.stringify(await open().readAttempt(id)).includes('9874'),false);
  assert.equal(JSON.stringify(await open().readAttempt(id)).includes('edit_pin'),false);
  controller.destroy();
  ({form,controller}=mountTestController(open(),{recoveryOnly:true}));
  await controller.ready;
  assert.equal(controller.getRequestId(),id);
  assert.equal(form.dataset.draftLocked,'true'); // Restore the sealed manuscript and supply PIN.
  assert.ok(await open().readAttempt(id));
  const panel=form.children[0];
  panel.closest = () => ({dataset:{draftAction:'restore'}});
  panel.dispatchEvent(new Event('click'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(form.dataset.draftCanRetry,'true');
  assert.equal(form.dataset.draftLocked,'false');
  assert.equal(form.querySelector('[type=submit]').disabled,false);
  await controller.prepareSubmission(original,[photo],[]);
  await controller.markSubmitted('Q-retry');
  assert.equal(form.dataset.draftCanRetry,'false');
  controller.destroy();
});

test('an IndexedDB attempt is discoverable after localStorage becomes unreadable, including without a tab locator',async()=>{
  const db=imageBackend(), storage=browserStorage();
  const cp=draft.textCheckpoint('attempt-only',()=>storage,db,new Map());
  cp.write({requestId:'saved-locally',fields:{title:'제안'}});
  await cp.ensure('saved-locally');
  await cp.prepare('saved-locally','digest',{fields:{title:'제안'}},true);
  const reloaded=draft.textCheckpoint('attempt-only',denied,db,new Map());
  assert.equal((await reloaded.recover())?.requestId,'saved-locally');
  assert.equal((await reloaded.recover('saved-locally'))?.requestId,'saved-locally');
});
