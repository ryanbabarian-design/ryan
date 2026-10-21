/** Only the existing public read RPC and roster SELECT are used. No private keys or writes. */
import { fetchAllPages } from '../reports/report-source.js?v=2.6.8';
export async function loadQuestionData(store, {storage=globalThis.localStorage,now=()=>new Date(),signal}={}) {
  if (signal?.aborted) throw new Error('조회가 취소되었습니다.');
  const withSignal = q => signal && typeof q.abortSignal === 'function' ? q.abortSignal(signal) : q;
  let proposals, employees;
  if (store.mode === 'demo') {
    proposals = await store.getProposals();
    const saved = storage?.getItem('proposal-system:v1:employees');
    employees = saved ? JSON.parse(saved) : await store.getEmployees();
  } else {
    [proposals,employees] = await Promise.all([
      fetchAllPages((from,to)=>withSignal(store.client.rpc('get_public_proposals_v258',{}, {count:'exact'}).range(from,to))),
      fetchAllPages((from,to)=>withSignal(store.client.from('employees').select('id,name,department,employee_no,active',{count:'exact'}).order('id').range(from,to))),
    ]);
  }
  if (signal?.aborted) throw new Error('조회가 취소되었습니다.');
  if (!Array.isArray(proposals) || !Array.isArray(employees)) throw new Error('전체 조회자료를 읽지 못했습니다.');
  return {proposals,employees,asOf:new Date(now()).toISOString(),mode:store.mode};
}
