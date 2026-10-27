import { chooseSearchPerson } from './question-core.js?v=2.7.8';
import { prepareUnifiedResult, unifiedSuggestions } from './unified-core.js?v=2.7.8';
import { loadQuestionData } from './question-source.js?v=2.7.5';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => Number(n).toLocaleString('ko-KR');
const icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';

/** Read-only dashboard enhancement. Conversation state exists only in this page instance. */
export function createQuestionSearch({root,store,now=()=>new Date(),load=loadQuestionData,getSelfIdentity=()=>null}) {
  let query='', answeredQuery='',result=null,message='',busy=false,listOpen=false,listPage=1;
  let lastAnswer=null,pending=null,sequence=0,controller=null;
  const pageSize=10;
  const section=()=>root.querySelector('#questionSearch');
  function markup(){
    return `<section id="questionSearch" class="qsearch" aria-labelledby="questionSearchTitle">
      <header class="qsearch-heading"><div><span class="qsearch-eyebrow">UNIFIED SEARCH · 2.7.8</span><h2 id="questionSearchTitle">실적부터 비슷한 제안까지, 한 번에 검색</h2><p>이름으로 실적을 묻거나, 설비명·개선 내용을 입력해 기존 제안을 찾아보세요.</p></div><span class="qsearch-badge">외부 AI 호출 없음</span></header>
      <form id="questionSearchForm" class="qsearch-form" role="search">
        <label class="qsearch-field" for="questionSearchInput">${icon}<input id="questionSearchInput" name="question" value="${esc(query)}" type="search" maxlength="240" placeholder="예: 직원 이름 + 올해 몇 건? / 에어건 / 작업시간 단축" aria-label="직원 실적 또는 제안 내용 통합 검색" aria-describedby="questionSearchHelp" autocomplete="off" required></label>
        <button class="qsearch-submit" type="submit">검색</button>
      </form>
      <div class="qsearch-context" aria-live="polite"></div>
      <div class="qsearch-examples" aria-label="추천 질문"></div>
      <p class="qsearch-help" id="questionSearchHelp">직원 실적은 올해 기준 · 내용 검색은 전체 연도 기준 · 검색 결과에 적용 조건을 표시합니다.</p>
      <div class="qsearch-output" aria-live="polite" aria-atomic="false"></div>
      <details class="qsearch-guide"><summary>어떤 질문을 할 수 있나요?</summary><p><strong>직원 실적:</strong> 직원 한 명의 연간·월간 등록건수와 제안 목록을 조회합니다. “낸 거”, “올린 제안”, “제출한 것”, “실적 알려줘”처럼 표현해도 됩니다.</p><p>기간을 생략한 새 검색은 올해, 이어 묻기는 표시된 직원·기간 기준입니다. 동명이인은 직접 선택하고, “내 실적”은 본인 이름을 확인합니다.</p><p><strong>제안 내용:</strong> “에어건”, “작업시간 단축 제안 찾아줘”처럼 입력합니다. 제목·본문·작성자·부서의 키워드를 검색하며, “2025년 에어건”처럼 기간도 지정할 수 있습니다. 유료 AI의 의미 검색이나 중복 확정 판정은 아닙니다.</p><p>평가상태·포상금·순위·기간 비교는 이 검색의 범위가 아닙니다. 실적·엑셀 및 접수현황 메뉴를 이용하세요. 대화 문맥은 현재 페이지 메모리에만 유지되며 새로고침·새 질문·계정 갱신 시 초기화됩니다.</p></details>
    </section>`;
  }
  function stop(){sequence++;controller?.abort();controller=null;busy=false;}
  function invalidate(){stop();query='';answeredQuery='';result=null;message='';lastAnswer=null;pending=null;listOpen=false;listPage=1;const input=section()?.querySelector('#questionSearchInput');if(input)input.value='';paint();}
  function mount(){paint();}
  function suspend(){stop();}
  function contextMarkup(){
    if(pending?.period)return `<span class="qsearch-context-tag">조건 확인 중</span><span>${esc(pending.period.label)} · ${pending.kind==='choose'?'직원을 선택해 주세요':'이름을 입력해 주세요'}</span><button type="button" data-qsearch="reset">새 질문</button>`;
    if(lastAnswer?.kind==='ideas')return `<span class="qsearch-context-tag">내용 검색</span><span><strong>${esc(lastAnswer.query)}</strong> · ${lastAnswer.period?esc(lastAnswer.period.label):'전체 연도'}</span><button type="button" data-qsearch="reset">새 검색</button>`;
    if(lastAnswer)return `<span class="qsearch-context-tag">이어 묻기</span><span><strong>${esc(lastAnswer.name)}</strong> · ${esc(lastAnswer.departments.join(' / '))} · ${esc(lastAnswer.period.label)}</span><button type="button" data-qsearch="reset" aria-label="직원과 기간을 지우고 새 질문">새 질문</button>`;
    return '';
  }
  function listMarkup(answer){
    const pages=Math.max(1,Math.ceil(answer.total/pageSize));listPage=Math.max(1,Math.min(listPage,pages));
    const start=(listPage-1)*pageSize,shown=answer.details.slice(start,start+pageSize);
    return `<div id="questionSearchList" class="qsearch-list" ${listOpen?'':'hidden'}><div class="qsearch-list-head"><h3>해당 제안 목록 <span>${num(answer.total)}건</span></h3><small>최초 접수일 최신순</small></div>
      <div class="qsearch-table-wrap" tabindex="0" role="region" aria-label="검색한 제안 목록"><table><thead><tr><th>접수번호</th><th>최초 접수일</th><th>제안명</th><th>접수부서</th></tr></thead><tbody>${shown.map(d=>`<tr><td>${d.no?`<a href="#detail/${encodeURIComponent(d.no)}">${esc(d.no)}</a>`:'번호 미등록'}</td><td>${esc(d.date)}</td><td class="qsearch-title-cell">${d.no?`<a href="#detail/${encodeURIComponent(d.no)}">${esc(d.title||'(제목 없음)')}</a>`:esc(d.title)}</td><td>${esc(d.department)}</td></tr>`).join('')}</tbody></table></div>
      <div class="qsearch-pagebar"><span>${num(start+1)}–${num(Math.min(start+pageSize,answer.total))} / 전체 ${num(answer.total)}건</span>${pages>1?`<nav aria-label="제안 목록 페이지"><button type="button" data-qsearch="prev" ${listPage===1?'disabled':''}>이전</button><span>${listPage} / ${pages}</span><button type="button" data-qsearch="next" ${listPage===pages?'disabled':''}>다음</button></nav>`:''}</div></div>`;
  }
  function ideasMarkup(a){
    const pages=Math.max(1,Math.ceil(a.total/pageSize));listPage=Math.max(1,Math.min(listPage,pages));
    const start=(listPage-1)*pageSize,shown=a.details.slice(start,start+pageSize);
    const scope=a.period?`${a.period.from} ~ ${a.period.to} (한국시간)`:'전체 연도 · 조회 가능한 기존 제안';
    return `<article class="qsearch-answer qsearch-ideas">
      ${a.mode==='demo'?'<div class="qsearch-demo">데모 자료입니다. 실제 제안 검색 결과가 아닙니다.</div>':''}
      <div class="qsearch-answer-top qsearch-ideas-heading"><div><span class="qsearch-filter">내용·키워드 검색 · ${esc(scope)}</span><h3><strong>“${esc(a.query)}”</strong> 검색 결과 <b class="qsearch-count">${num(a.total)}<small>건</small></b></h3><p class="qsearch-assumption">제목·문제점·개선방안·기대효과·작성자·부서 검색 · 입력한 검색어 모두 포함</p></div><button type="button" class="qsearch-refresh" data-qsearch="refresh">다시 조회</button></div>
      ${a.total?`<div class="qsearch-idea-items">${shown.map(d=>`<article class="qsearch-idea"><div class="qsearch-idea-meta"><span>${esc(d.no||'번호 미등록')}</span><span>${esc(d.date||'접수일 미확인')}</span><span>${esc(d.name)} · ${esc(d.department)}</span></div><h4>${d.no?`<a href="#detail/${encodeURIComponent(d.no)}">${esc(d.title)}</a>`:esc(d.title)}</h4><p>${esc(d.snippet)}</p>${d.no?`<a class="qsearch-idea-link" href="#detail/${encodeURIComponent(d.no)}">제안서 보기 ›</a>`:''}</article>`).join('')}</div>`:'<p class="qsearch-zero-result">일치하는 제안이 없습니다. 설비명이나 핵심 단어로 짧게 다시 검색해 보세요.</p>'}
      ${a.total?`<div class="qsearch-pagebar"><span>${start+1}–${Math.min(start+pageSize,a.total)} / ${num(a.total)}건</span>${pages>1?`<nav aria-label="내용 검색 결과 페이지"><button type="button" data-qsearch="prev" ${listPage===1?'disabled':''}>이전</button><span>${listPage} / ${pages}</span><button type="button" data-qsearch="next" ${listPage===pages?'disabled':''}>다음</button></nav>`:''}</div>`:''}
      ${a.warnings.length?`<details class="qsearch-warnings"><summary>자료 확인사항 ${a.warnings.length}건</summary>${a.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:''}
      <p class="qsearch-help">키워드가 일치하는 자료이며 중복 제안 확정 판정은 아닙니다. 제안서를 열어 실제 내용을 확인하세요.</p>
    </article>`;
  }
  function paint(){
    const s=section();if(!s)return;
    const out=s.querySelector('.qsearch-output'),button=s.querySelector('.qsearch-submit');
    button.disabled=busy;button.textContent=busy?'조회 중…':'검색';s.setAttribute('aria-busy',String(busy));
    const ctx=s.querySelector('.qsearch-context');ctx.innerHTML=contextMarkup();ctx.hidden=!ctx.innerHTML;
    const suggestions=unifiedSuggestions(pending?null:lastAnswer,now());
    s.querySelector('.qsearch-examples').innerHTML=`<span>${lastAnswer&&!pending?'이어서 검색':'이렇게 물어보세요'}</span>${suggestions.map(q=>`<button type="button" data-qsearch="example" data-query="${esc(q.query)}" data-mode="${esc(q.mode||'auto')}" ${busy?'disabled':''}>${esc(q.label)}</button>`).join('')}`;
    if(busy){out.innerHTML='<p class="qsearch-loading" role="status">조회 가능한 전체 자료를 확인하고 있습니다. 일부 목록만 세지 않습니다.</p>';return;}
    const question=answeredQuery?`<div class="qsearch-user-question"><span>질문</span> ${esc(answeredQuery)}</div>`:'';
    if(message){out.innerHTML=question+`<p class="qsearch-error" role="alert">${esc(message)}</p>`;return;}
    if(!result){out.innerHTML='';return;}
    if(result.kind==='ideas'){out.innerHTML=question+ideasMarkup(result);return;}
    if(result.kind==='search-choice'){out.innerHTML=question+`<div class="qsearch-clarify"><strong>검색할 내용을 확인할게요.</strong><p>${esc(result.message)}</p><button type="button" class="qsearch-list-toggle" data-qsearch="as-keywords">입력한 단어로 내용 검색</button></div>`;return;}
    if(result.kind==='search-clarify'){out.innerHTML=question+`<div class="qsearch-clarify"><strong>검색어를 확인해 주세요.</strong><p>${esc(result.message)}</p></div>`;return;}
    if(result.kind==='clarify'||result.kind==='unknown'){
      out.innerHTML=question+`<div class="qsearch-clarify" role="status"><strong>${result.kind==='unknown'?'조회 대상을 다시 확인할게요.':'한 가지만 확인할게요.'}</strong><p>${esc(result.message)}</p><small>선택 기간: ${esc(result.period.label)} · ${esc(result.period.from)} ~ ${esc(result.period.to)} (한국시간)</small>${result.kind==='unknown'?'<p><button type="button" class="qsearch-list-toggle" data-qsearch="as-keywords">이름이 아니라 검색어예요 · 내용 검색</button></p>':''}</div>`;return;
    }
    if(result.kind==='choose'){
      out.innerHTML=question+`<div class="qsearch-choice"><h3>같은 이름의 직원이 있습니다.</h3><p>사번이 다르거나 현재 재직 중인 동명이인입니다. 조회할 직원을 선택하세요. (${esc(result.period.label)})</p><div class="qsearch-candidates">${result.candidates.map(c=>`<button type="button" data-qsearch="person" data-identity="${esc(c.identity)}"><strong>${esc(c.name)}</strong><span>${esc(c.departments.join(' · '))}</span><small>${c.employeeNo?'사번 '+esc(c.employeeNo):esc(c.rosterStatus)}</small></button>`).join('')}</div></div>`;return;
    }
    const a=result,at=new Date(a.asOf).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
    const count=`<b class="qsearch-count">${num(a.total)}<small>건</small></b>`;
    const sentence=a.total===0?`<strong>${esc(a.name)}</strong> 님의 이 기간 등록 제안은 ${count}입니다.`:a.intent==='list'?`<strong>${esc(a.name)}</strong> 님의 등록 제안 ${count}을 찾았습니다.`:`<strong>${esc(a.name)}</strong> 님이 등록한 제안은 총 ${count}입니다.`;
    const periodNote=a.period.source==='default'?'기간을 따로 말씀하지 않아 올해 기준으로 조회했습니다.':a.period.source==='context'?'앞서 선택한 직원·기간을 이어서 조회했습니다.':a.period.source==='pending'?'방금 말씀하신 기간을 유지해 조회했습니다.':a.period.source==='context-year'?'월은 새로 선택하고, 연도는 이전 조회연도를 유지했습니다.':a.period.source==='default-year'?'연도를 따로 말씀하지 않아 올해 해당 월로 조회했습니다.':a.personSource==='context'?'직원은 그대로 두고, 말씀하신 기간으로 조회했습니다.':'';
    out.innerHTML=question+`<article class="qsearch-answer">
      ${a.mode==='demo'?'<div class="qsearch-demo">데모 자료입니다. 실제 직원 실적이 아닙니다.</div>':''}
      <div class="qsearch-answer-top"><div><span class="qsearch-filter">${esc(a.period.label)} · ${esc(a.name)} · ${esc(a.departments.join(' / '))}</span><h3>${sentence}</h3><p class="qsearch-period">조회기간: <strong>${esc(a.period.from)} ~ ${esc(a.period.to)}</strong> <span>(한국시간)</span></p>${periodNote?`<p class="qsearch-assumption">${esc(periodNote)}</p>`:''}</div><button type="button" class="qsearch-refresh" data-qsearch="refresh">다시 조회</button></div>
      ${a.warnings.some(w=>w.includes('과거 부서'))?'<p class="qsearch-assumption">과거 부서 기록도 함께 집계했습니다. 사번 연결이 없는 이전 자료는 확인이 필요합니다.</p>':''}
      <div class="qsearch-answer-foot"><p>최초 접수 기준 · 같은 접수번호는 1건<br><span>조회 ${esc(at)} (한국시간) · 조회 권한 내 자료</span></p>${a.total?`<button type="button" class="qsearch-list-toggle" data-qsearch="list" aria-expanded="${listOpen}" aria-controls="questionSearchList">${listOpen?'목록 접기':'제안 목록 보기'} <span aria-hidden="true">${listOpen?'⌃':'›'}</span></button>`:'<span class="qsearch-zero">이 기간에 등록된 제안이 없습니다.<br>다른 기간도 물어보세요.</span>'}</div>
      ${a.warnings.length?`<details class="qsearch-warnings"><summary>집계자료 확인사항 ${a.warnings.length}건</summary>${a.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>`:''}${a.total?listMarkup(a):''}</article>`;
  }
  function accept(value){
    result=value;message='';listPage=1;listOpen=value.kind==='ideas'||value.kind==='answer'&&value.intent==='list';
    if(value.kind==='answer'||value.kind==='ideas'){lastAnswer=value;pending=null;}else pending=value;
  }
  async function search(text,mode='auto'){
    stop();query=String(text||'').trim();answeredQuery=query;result=null;message='';listOpen=false;listPage=1;
    const input=section()?.querySelector('#questionSearchInput');if(input)input.value=query;
    const instant=now(),options={context:lastAnswer,pending,selfIdentity:getSelfIdentity(),mode};
    if(!query||query.length>240){message='질문은 1~240자로 입력하세요.';paint();return;}
    busy=true;paint();controller=new AbortController();const token=sequence;
    try{
      const snapshot=await load(store,{signal:controller.signal,now:()=>instant});
      if(token!==sequence||!section())return;
      accept(prepareUnifiedResult(snapshot,query,instant,options));
    }catch(error){if(token!==sequence||!section())return;message='검색하지 못했습니다. '+(error.message||'다시 시도하세요.');result=null;}
    finally{if(token===sequence){busy=false;controller=null;paint();}}
  }
  root.addEventListener('submit',e=>{
    if(e.target.id!=='questionSearchForm')return;
    e.preventDefault();e.stopPropagation();void search(new FormData(e.target).get('question'));
  });
  root.addEventListener('input',e=>{
    if(e.target.id!=='questionSearchInput')return;
    stop();query=e.target.value;result=null;answeredQuery='';message='';listOpen=false;paint();
  });
  root.addEventListener('keydown',e=>{if(e.target.id==='questionSearchInput'&&e.key==='Enter'&&(e.isComposing||e.keyCode===229))e.preventDefault();});
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-qsearch]');if(!b||!section()?.contains(b))return;
    e.preventDefault();e.stopPropagation();const action=b.dataset.qsearch;
    if(action==='as-keywords')void search(answeredQuery,'keywords');
    else if(action==='example')void search(b.dataset.query,b.dataset.mode||'auto');
    else if(action==='reset'){invalidate();section()?.querySelector('#questionSearchInput')?.focus();}
    else if(action==='refresh'&&result?.kind==='ideas'){
      const a=result;void search(`${a.period?a.period.label+' ':''}${a.query}`, 'keywords');
    }else if(action==='refresh'&&result?.kind==='answer'){
      const a=result;void search(`${a.departments[0]} ${a.name} ${a.period.year}년${a.period.month===null?'':` ${a.period.month}월`} 제안 ${a.intent==='list'?'목록 보여줘':'몇 건이야?'}`);
    }else if(action==='person'&&result?.kind==='choose'){try{accept(chooseSearchPerson(result,b.dataset.identity));}catch(error){message=error.message;}paint();}
    else if(action==='list'){listOpen=!listOpen;paint();section()?.querySelector('.qsearch-list-toggle')?.focus();}
    else if(action==='next'||action==='prev'){listPage+=action==='next'?1:-1;paint();section()?.querySelector('.qsearch-list-head, .qsearch-ideas-heading')?.scrollIntoView({block:'nearest'});}
  });
  return {markup,mount,suspend,invalidate,search};
}
