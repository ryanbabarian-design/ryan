import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformancePage } from '../js/reports/performance-ui.js';

async function renderReport(hash) {
  const previous = { location: globalThis.location, localStorage: globalThis.localStorage };
  globalThis.location = { hash };
  const employees = [{id:'employee-a',name:'테스트직원',department:'압연팀',active:true}];
  globalThis.localStorage = { getItem: () => JSON.stringify(employees) };
  const base = {received_date:'2026-01-01',department:'압연',proposer_name:'테스트직원',title:'테스트 제안',status:'심사완료',review_result:'채택',approval_required:true,payment_status:'예정'};
  const store = {
    mode:'demo',
    getProposals:async()=>[
      {...base,id:'a',proposal_no:'Q26-001',award_amount:105000,ceo_submission_status:'승인완료'},
      {...base,id:'b',proposal_no:'Q26-002',award_amount:75000,ceo_submission_status:'상신완료'},
    ],
    getDepartmentGoals:async()=>[],getApprovalSteps:async()=>[],getApprovalRecords:async()=>[],
  };
  const root = {innerHTML:'',addEventListener(){},querySelector(){return null;}};
  try {
    const page=createPerformancePage({root,store,notify(){},navigate(){}});
    page.render();
    for(let i=0;i<10&&!page.getReport();i++)await new Promise(resolve=>setImmediate(resolve));
    assert.ok(page.getReport(), 'Actual report renderer completed its data load');
    return root.innerHTML;
  } finally {
    if(previous.location===undefined)delete globalThis.location;else globalThis.location=previous.location;
    if(previous.localStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous.localStorage;
  }
}

test('department confirmed award column excludes CEO-pending awards and labels amounts separately', async () => {
  const html=await renderReport('#performance?year=2026&tab=departments');
  const table=html.match(/<table[^>]+id="perfDepartmentTable"[\s\S]*?<\/table>/)?.[0];
  assert.ok(table);
  assert.match(table, /포상 확정액/);
  assert.match(table, /<strong>105,000원<\/strong>/);
  assert.match(table, /미확정 75,000원/);
  assert.match(table, /지급완료 0원/);
  assert.doesNotMatch(table, /180,000원/);
});

test('legacy alias URL displays the same selected department as its filtered results', async () => {
  const html=await renderReport('#performance?year=2026&tab=departments&department=압연팀');
  assert.match(html, /<option value="압연" selected>압연<\/option>/);
  assert.match(html, /2026년 접수 · 압연/);
  assert.doesNotMatch(html, /<option value="압연팀"/);
});
