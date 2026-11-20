"""Run with Python Playwright and Chromium. All data and mutations stay in browser memory."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import os
import shutil
import unittest
from playwright.sync_api import sync_playwright, expect

REPO = Path(__file__).resolve().parents[1]
HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/styles.css">
<link rel="stylesheet" href="/css/proposal-workflow.css"></head><body><main style="max-width:1040px;margin:auto;padding:12px"></main>
<script type="module">
import {createWorkflowProgress} from '/js/ui/workflow-progress.js';
import {createCeoRecall} from '/js/admin/ceo-recall.js';
import {createProposalHistory} from '/js/admin/proposal-history.js';
const root=document.querySelector('main');
const base={proposal_no:'Q26-101',title:'금형 교체 시간 단축',department:'생산1팀',proposer_name:'김하나',
  received_date:'2026-10-09',ceo_submission_status:'상신완료',payment_status:'미지급',updated_at:'2026-11-02T09:00:00.123456Z',
  first_evaluation_total:65,team_leader_evaluation_total:76,second_evaluation_total:78,review_result:'채택',implementation_status:'진행중'};
const proposals=[{...base,id:'p1'},{...base,id:'p2',proposal_no:'Q26-102',title:'검사 시간 개선',approval_required:false},
  {...base,id:'p3',title:'숨겨진 지급 건',payment_status:'완료'},{...base,id:'p4',proposal_no:'Q25-001',received_date:'2025-01-01'}];
const summary=id=>({proposal_id:id,stage_key:'ceo',current_stage:'대표이사 결재 대기',current_role:'대표이사',assignee_name:'박대표',
  actionable_at:'2026-11-02T00:00:00Z',pending_days:11,next_action:'대표이사 결재',legacy_direct:id==='p2',
  records:[{role_name:'해당부서 임원',status:'승인',approver_name:'김임원',acted_at:'2026-10-01T00:00:00Z'},
    {role_name:'대표이사',status:'대기',assigned_name:'박대표',actionable_at:'2026-11-02T00:00:00Z'}]});
const row=(id,category,reason)=>({id,category,reason,happened_at:'2026-10-01T16:00:00Z',actor_name:'운영자',field_name:'title',detail:'제안명 수정',before:'원본',after:'변경 <img src=x onerror=alert(1)>'});
window.app={calls:[],readIds:[],history:[],nav:[],gates:{},saved:0,failWorkflow:false,failRefresh:false};
const getAdmin=()=>({isSystemAdmin:true});
const store={
 async getWorkflowSummaries(ids){app.readIds.push(ids);if(app.failWorkflow){app.failWorkflow=false;throw Error('fixture offline')}return ids.map(summary)},
 async recallCeoSubmissions(ids,reason,expected){app.calls.push({ids,reason,expected});app.gates.save=Promise.withResolvers();return app.gates.save.promise},
 async getProposalHistory(id,{cursor}){app.history.push([id,cursor]);if(id==='p2'){app.gates.history=Promise.withResolvers();return app.gates.history.promise}
   return cursor?{items:[row('b','score','평가 근거 추가')],next_cursor:null}:{items:[row('a','content','현장 자료 확인')],next_cursor:'opaque-1'}}
};
const options={root,store,getAdmin,navigate:r=>app.nav.push(r),header:t=>'<h1>'+t+'</h1>'};
const progress=createWorkflowProgress({...options,getProposals:()=>proposals});
const history=createProposalHistory(options);
const recall=createCeoRecall({...options,loadProposals:async()=>proposals,onSaved:async()=>{app.saved++;if(app.failRefresh)throw Error('offline')}});
app.open=(name,options={})=>{progress.suspend();history.suspend();recall.suspend();root.innerHTML='';location.hash=name;
 if(name==='progress'){root.innerHTML='<div data-workflow-proposal="p1"></div>';return progress.refresh()}
 if(name==='recall')return recall.render(options);
 if(name==='history')return history.render(proposals.find(p=>p.id===(options.id||'p1')));
 root.innerHTML='<h1>다른 화면</h1>';};
const screen=new URLSearchParams(location.search).get('screen');
if(['progress','history','recall'].includes(screen))app.open(screen,{year:'2026'});
</script></body></html>"""


class Fixture(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/scenario.html":
            return super().do_GET()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(HTML.encode())

    def log_message(self, *args):
        pass


class WorkflowBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), partial(Fixture, directory=REPO))
        Thread(target=cls.http.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.http.shutdown()
        cls.http.server_close()

    def setUp(self):
        self.page = self.browser.new_page(viewport={"width": 1040, "height": 900})
        self.addCleanup(self.page.close)
        self.page.goto(f"http://127.0.0.1:{self.http.server_port}/scenario.html")
        self.page.wait_for_function("Boolean(window.app?.open)")

    def capture(self, name):
        target = os.getenv('WORKFLOW_SCREENSHOTS')
        if target:
            self.page.screenshot(path=str(Path(target) / (name + '.png')), full_page=True)

    def test_progress_retry_and_new_placeholder(self):
        p = self.page
        p.evaluate("app.failWorkflow=true; app.open('progress')")
        expect(p.get_by_text('fixture offline', exact=False)).to_be_visible()
        p.get_by_role('button', name='다시 조회').click()
        expect(p.get_by_text('대기 11일')).to_be_visible()
        self.capture('workflow-desktop')
        p.set_viewport_size({'width':360,'height':800})
        self.capture('workflow-mobile')
        self.assertLessEqual(p.evaluate("document.documentElement.scrollWidth"),360)
        p.evaluate("""document.querySelector('main').insertAdjacentHTML('beforeend','<div data-workflow-proposal="p2" data-workflow-compact></div>')""")
        expect(p.locator('.wf-compact')).to_contain_text('박대표')
        self.assertEqual(p.evaluate('app.readIds'),[['p1'],['p1'],['p2']])

    def test_recall_confirmation_single_flight_and_receipt_after_refresh_error(self):
        p = self.page
        p.set_viewport_size({'width':390,'height':844})
        p.evaluate("app.failRefresh=true; app.open('recall',{year:'2026',proposalId:'p1'})")
        choices = p.get_by_role('checkbox')
        expect(choices).to_have_count(2)
        expect(choices.first).to_be_checked()
        p.get_by_role('button', name='선택 1건 검토').click()
        expect(p.get_by_role('alert')).to_contain_text('5~1,000자')
        choices.nth(1).check()
        p.locator('textarea').fill('최신 평가자료로 재심사')
        p.get_by_role('button',name='선택 2건 검토').click()
        self.capture('recall-mobile')
        self.assertLessEqual(p.evaluate("document.documentElement.scrollWidth"),390)
        p.evaluate("""const btn=document.querySelector('[data-rc-save]');btn.click();btn.click()""")
        expect(p.get_by_role('button',name='회수 처리 중…')).to_be_disabled()
        self.assertEqual(p.evaluate('app.calls'),[{'ids':['p1','p2'],'reason':'최신 평가자료로 재심사',
            'expected':{k:'2026-11-02T09:00:00.123456Z' for k in ['p1','p2']}}])
        p.evaluate("app.gates.save.resolve({recalled_count:2,proposal_ids:['p2','p1']})")
        expect(p.get_by_text('대표상신 2건 회수 완료')).to_be_visible()
        expect(p.get_by_role('status')).to_contain_text('회수는 완료')
        p.get_by_role('button',name='3차 재심사 열기').click()
        p.get_by_role('button',name='기존 심사점수 검토').click()
        self.assertEqual(p.evaluate('app.nav'),['admin/edit/p1','admin/legacy-score/p2'])
        self.assertEqual(p.evaluate('app.saved'),1)

    def test_route_change_while_recall_response_is_pending(self):
        p = self.page
        p.evaluate("app.open('recall',{proposalId:'p1'})")
        p.locator('textarea').fill('점수 근거 확인 필요')
        p.get_by_role('button',name='선택 1건 검토').click()
        p.get_by_role('button',name='1건 회수 확정').click()
        p.evaluate("app.open('other');app.gates.save.resolve({recalled_count:1,proposal_ids:['p1']})")
        expect(p.get_by_role('heading')).to_have_text('다른 화면')
        p.wait_for_function('app.saved===1')

    def test_filtered_history_pagination_and_stale_response(self):
        p = self.page
        p.evaluate("app.open('history')")
        p.locator('[name=category]').select_option('score')
        expect(p.locator('.wf-count')).to_contain_text('더 오래된 이력')
        p.get_by_role('button',name='이전 이력 더 불러오기').click()
        expect(p.locator('.wf-count')).to_have_text('전체 2건 중 1건 일치')
        self.assertEqual(p.evaluate('app.history'),[['p1',None],['p1','opaque-1']])
        p.get_by_text('변경 전·후 보기').click()
        expect(p.locator('pre').nth(1)).to_contain_text('<img')
        expect(p.locator('pre img')).to_have_count(0)
        self.capture('history-desktop')
        p.set_viewport_size({'width':360,'height':800})
        self.capture('history-mobile')
        self.assertLessEqual(p.evaluate("document.documentElement.scrollWidth"),360)
        p.evaluate("void app.open('history',{id:'p2'})")
        p.evaluate("app.open('other');app.gates.history.resolve({items:[],next_cursor:null})")
        expect(p.get_by_role('heading')).to_have_text('다른 화면')


if __name__ == '__main__':
    unittest.main()
