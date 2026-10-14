import { reportDate } from './annual-report.js?v=2.6.8';
/** Stable ordered pages, fail closed on errors or changing totals. */
export async function fetchAllPages(fetchPage, {pageSize=500,maxRows=100000}={}) {
  const rows=[],seen=new Set();let expected=null;
  for(let page=0;page<10000;page++) {
    const {data,error,count}=await fetchPage(rows.length,rows.length+pageSize-1);
    if(error)throw new Error(`실적자료 조회 실패: ${error.message||String(error)}`);
    if(!Array.isArray(data))throw new Error('전체 실적자료의 응답 형식을 확인할 수 없습니다.');
    if(count!==null&&count!==undefined) {
      if(expected!==null&&expected!==count)throw new Error('조회 중 원자료 건수가 변경되었습니다. 새로 조회하세요.');
      expected=count;
    }
    if(!data.length) {
      if(expected!==null&&rows.length!==expected)throw new Error('전체 자료 조회 중 일부 자료가 누락되었습니다. 다시 조회하세요.');
      return rows;
    }
    for(const row of data) {
      const key=row.id!==null&&row.id!==undefined?String(row.id):row.proposal_no;
      if(key&&seen.has(key))throw new Error('조회 페이지가 중복되거나 자료가 변경되었습니다. 새로 조회하세요.');
      if(key)seen.add(key);rows.push(row);
    }
    if(rows.length>maxRows)throw new Error('자료가 너무 많습니다. 관리자에게 별도 일괄 추출을 요청하세요.');
    if(expected!==null&&rows.length===expected)return rows;
    if(expected!==null&&rows.length>expected)throw new Error('조회 중 원자료 건수가 변경되었습니다. 새로 조회하세요.');
  }
  throw new Error('전체 자료 조회를 완료하지 못했습니다.');
}
async function concurrentMap(items,worker,concurrency=5) {
  let i=0;const out=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(i<items.length){const index=i++;out[index]=await worker(items[index]);}
  }));return out;
}
export async function loadAnnualData(store,year,onProgress=()=>{}) {
  onProgress('제안·직원명단·목표 자료를 불러오는 중입니다.');
  let proposals,employees,goals,steps;
  if(store.mode==='demo') {
    [proposals,goals,steps]=await Promise.all([store.getProposals(),store.getDepartmentGoals(),store.getApprovalSteps(true)]);
    employees=JSON.parse(localStorage.getItem('proposal-system:v1:employees')||'[]');
  } else {
    const client=store.client;
    [proposals,employees,goals,steps]=await Promise.all([
      // Existing RPC orders by received_date DESC, proposal_no DESC (unique).
      fetchAllPages((from,to)=>client.rpc('get_public_proposals_v258',{}, {count:'exact'}).range(from,to)),
      fetchAllPages((from,to)=>client.from('employees').select('id,name,department,employee_no,active',{count:'exact'}).order('id').range(from,to)),
      fetchAllPages((from,to)=>client.from('department_goals').select('id,year,department,annual_goal,note',{count:'exact'}).order('id').range(from,to)),
      store.getApprovalSteps(true),
    ]);
  }
  const annual=proposals.filter(p=>reportDate(p.received_date)?.slice(0,4)===String(year));
  let done=0;
  const groups=await concurrentMap(annual,async p=>{
    if(!p.id)return [];
    // Use the existing safe public-progress RPC; never access private approval tables.
    const rows=await store.getApprovalRecords(p.id);
    done++;onProgress(`결재 상태를 확인하는 중입니다. ${done} / ${annual.length}건`);
    return rows.map(r=>({...steps.find(s=>String(s.id)===String(r.step_id)),...r,proposal_id:p.id}));
  });
  return {proposals,employees,goals,approvals:groups.flat(),year:Number(year),asOf:new Date().toISOString(),mode:store.mode};
}
