/** Keeps an accepted receipt authoritative even when later screen refresh fails. */
export function createSubmissionGate() {
  const states=new WeakMap();
  const empty=()=>({phase:'idle',receipt:null,promise:null});
  return {
    state(key){return states.get(key)||empty();},
    run(key,{requestId,save,onAccepted,refresh,navigate,onRefreshError}={}) {
      const existing=states.get(key);
      if(existing?.promise)return existing.promise;
      if(existing?.receipt&&existing.requestId===requestId)return Promise.resolve(existing.receipt);
      const current={phase:'saving',receipt:null,promise:null,requestId};
      states.set(key,current);
      const report=async error=>{try{await onRefreshError?.(error,current.receipt);}catch(_){/* Receipt remains accepted if warning UI fails. */}};
      current.promise=Promise.resolve().then(save).then(async receipt=>{
        if(!receipt||typeof receipt.proposal_no!=='string'||!receipt.proposal_no.trim())throw new Error('접수번호를 확인하지 못했습니다. 같은 작성 내용으로 다시 확인하세요.');
        current.receipt=receipt;current.phase='submitted';
        for(const operation of [onAccepted,refresh,navigate]) {
          try{await operation?.(receipt);}catch(error){await report(error);}
        }
        return receipt;
      }).catch(error=>{
        if(!current.receipt)current.phase='idle';
        throw error;
      }).finally(()=>{current.promise=null;});
      return current.promise;
    },
  };
}

/** A route-owned async result must never paint a different proposal. */
export function isCurrentDetail(proposalNo,root,locationLike=globalThis.location) {
  const path=String(locationLike?.hash||'').split('?')[0];
  const target=root?.querySelector?.('[data-detail-proposal]');
  return path===`#detail/${encodeURIComponent(proposalNo)}`&&target?.dataset?.detailProposal===proposalNo;
}
