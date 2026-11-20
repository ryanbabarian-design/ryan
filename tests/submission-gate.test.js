import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionGate } from '../js/reliability/submission.js';

test('concurrent clicks share one operation before any asynchronous validation', async () => {
  const gate=createSubmissionGate(),form={};let saves=0,release;
  const wait=new Promise(resolve=>{release=resolve;});
  const save=async()=>{saves++;await wait;return {proposal_no:'Q26-999'};};
  const first=gate.run(form,{save}),second=gate.run(form,{save});
  assert.equal(first,second);assert.equal(gate.state(form).phase,'saving');
  await Promise.resolve();assert.equal(saves,1);release();
  assert.equal((await first).proposal_no,'Q26-999');
});

test('accepted receipt survives a failed refresh and still opens its detail', async () => {
  const gate=createSubmissionGate(),form={},calls=[];
  const saved={id:'p1',proposal_no:'Q26-999'};
  const result=await gate.run(form,{save:async()=>saved,onAccepted:r=>calls.push(['accepted',r.proposal_no]),
    refresh:async()=>{throw new Error('offline');},onRefreshError:e=>calls.push(['warning',e.message]),navigate:r=>calls.push(['detail',r.proposal_no])});
  assert.equal(result,saved);assert.equal(gate.state(form).phase,'submitted');
  assert.deepEqual(calls,[['accepted','Q26-999'],['warning','offline'],['detail','Q26-999']]);
  let duplicate=0;await gate.run(form,{save:async()=>{duplicate++;return saved;}});assert.equal(duplicate,0);
});

test('a local draft storage failure after acceptance cannot turn receipt into failed submission', async () => {
  const gate=createSubmissionGate(),form={};let opened=false,warned=false;
  await gate.run(form,{save:async()=>({proposal_no:'Q26-999'}),onAccepted:()=>{throw new Error('quota');},
    onRefreshError:()=>{warned=true;},navigate:()=>{opened=true;}});
  assert.equal(gate.state(form).receipt.proposal_no,'Q26-999');assert.ok(opened);assert.ok(warned);
});

test('failed save releases operation for retry without inventing a receipt', async () => {
  const gate=createSubmissionGate(),form={};let n=0;
  const save=async()=>{if(++n===1)throw new Error('network');return {proposal_no:'Q26-999'};};
  await assert.rejects(gate.run(form,{save}),/network/);assert.equal(gate.state(form).receipt,null);
  assert.equal((await gate.run(form,{save})).proposal_no,'Q26-999');assert.equal(n,2);
});

test('different drafts can submit independently',async()=>{
  const gate=createSubmissionGate();let count=0;
  await Promise.all([gate.run({}, {save:async()=>({proposal_no:`Q26-${++count}`})}),gate.run({}, {save:async()=>({proposal_no:`Q26-${++count}`})})]);
  assert.equal(count,2);
});

test('an invalid server response remains unconfirmed and can be retried with same draft key',async()=>{
  const gate=createSubmissionGate(),form={};
  await assert.rejects(gate.run(form,{save:async()=>null}),/접수번호/);
  assert.equal(gate.state(form).receipt,null);
});

test('navigation failure preserves accepted receipt and exposes warning',async()=>{
  const gate=createSubmissionGate(),form={};const warnings=[];
  await gate.run(form,{save:async()=>({proposal_no:'Q26-999'}),navigate:()=>{throw new Error('route');},onRefreshError:e=>warnings.push(e.message)});
  assert.equal(gate.state(form).phase,'submitted');assert.deepEqual(warnings,['route']);
});

test('explicit new draft in the same form can submit under a new request key',async()=>{
  const gate=createSubmissionGate(),form={};let n=0;
  const save=async()=>({proposal_no:`Q26-${++n}`});
  await gate.run(form,{requestId:'first',save});
  assert.equal((await gate.run(form,{requestId:'second',save})).proposal_no,'Q26-2');
});
