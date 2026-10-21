/** V2.7.7 — progressively enhance the existing author select.
 * The original option (not the typed display name) remains the submitted value.
 */
const str=v=>String(v??'').normalize('NFKC').trim();
const fold=v=>str(v).replace(/\s+/g,'').toLocaleLowerCase('ko-KR');
const initials=value=>[...str(value)].map(ch=>{const n=ch.charCodeAt(0)-0xac00;return n>=0&&n<11172?'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(n/588)]:ch;}).join('');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function matchEmployees(items,query,limit=12){
  const tokens=str(query).split(/\s+/).filter(Boolean).map(fold);
  const q=fold(query);
  // Whitespace inside Korean names is accepted as well as name + department.
  const found=items.filter(e=>{const h=fold([e.name,e.department,e.employeeNo,initials(e.name)].join(' '));return tokens.every(t=>h.includes(t))||q&&fold(e.name).includes(q);});
  return {total:found.length,matches:found.slice(0,limit)};
}
export function mountEmployeePicker(select){
  if(!select)return {destroy(){}};
  const doc=select.ownerDocument,form=select.form;
  const id='employeeSearchInput',listId='employeeSearchResults';
  const entries=[...select.options].map((o,index)=>({index,name:o.value,department:o.dataset.department||'',employeeNo:o.dataset.employeeNo||'',legacy:o.dataset.legacy==='true',disabled:o.disabled})).filter(e=>e.name&&!e.disabled);
  const wrap=doc.createElement('div');wrap.className='employee-picker';
  wrap.innerHTML=`<div class="employee-picker-entry"><input type="search" id="${id}" role="combobox" aria-label="제안자 이름 검색" aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}" aria-describedby="employeeSearchHelp" autocomplete="off" placeholder="이름·부서·사번 검색" required><button type="button" data-employee-clear aria-label="선택한 제안자 지우기" title="선택 지우기" hidden>×</button></div><div class="employee-picker-popup" hidden><div class="employee-picker-count" role="status"></div><ul id="${listId}" role="listbox" aria-label="제안자 검색 결과"></ul></div><small id="employeeSearchHelp" class="employee-picker-help">이름 일부를 입력한 뒤 직원을 선택하세요.</small>`;
  select.insertAdjacentElement('afterend',wrap);
  const input=wrap.querySelector('input'),popup=wrap.querySelector('.employee-picker-popup'),list=wrap.querySelector('ul'),count=wrap.querySelector('.employee-picker-count'),clear=wrap.querySelector('[data-employee-clear]'),help=wrap.querySelector('.employee-picker-help');
  const original={hidden:select.hidden,required:select.required,tabIndex:select.tabIndex};
  select.classList.add('employee-picker-source');select.hidden=true;select.required=false;select.tabIndex=-1;
  let current=null,matches=[],active=-1,expanded=false,composing=false,internalChange=false;
  const controller=new AbortController();const on=(el,type,fn)=>el.addEventListener(type,fn,{signal:controller.signal});
  function valid(){input.setCustomValidity(current?'':'검색 결과에서 제안자를 선택하세요. 이름만 입력하면 선택되지 않습니다.');}
  function close(){expanded=false;popup.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function sync(){current=entries.find(e=>e.index===select.selectedIndex)||null;input.value=current?`${current.name} · ${current.department}${current.employeeNo?' · '+current.employeeNo:''}`:'';clear.hidden=!current;help.textContent=current?(current.legacy?'기존 제안자 정보를 유지합니다. 현재 명단에서 개인을 확정하지 않습니다.':'선택 완료 · 부서가 자동 입력되었습니다.'):'이름 일부를 입력한 뒤 직원을 선택하세요.';valid();}
  function highlight(){[...list.children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)));if(active>=0&&list.children[active]){input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function open(){
    const found=matchEmployees(entries,current?'':input.value);matches=found.matches;active=-1;expanded=true;popup.hidden=false;input.setAttribute('aria-expanded','true');
    count.textContent=found.total?`${found.total}명${found.total>matches.length?` · 상위 ${matches.length}명 표시, 이름을 더 입력하세요`:''}`:'일치하는 직원이 없습니다. 이름·부서·사번을 확인하세요.';
    list.innerHTML=matches.map((e,i)=>`<li role="option" id="employee-option-${e.index}" aria-selected="false" data-employee-index="${i}"><strong>${esc(e.name)}</strong><span>${esc(e.department)}${e.employeeNo?' · 사번 '+esc(e.employeeNo):''}${e.legacy?' · 기존 제안자':''}</span></li>`).join('');
    highlight();
  }
  function emitChange(){internalChange=true;try{select.dispatchEvent(new Event('change',{bubbles:true}));}finally{internalChange=false;}}
  function choose(index){const e=matches[index];if(!e)return;select.selectedIndex=e.index;sync();close();emitChange();input.focus();close();}
  function clearSelection(){current=null;select.selectedIndex=0;clear.hidden=true;valid();help.textContent='검색 결과의 직원을 클릭하거나 방향키로 선택 후 Enter를 누르세요.';emitChange();}
  on(input,'focus',()=>{if(!expanded)open();});
  on(input,'click',()=>{if(!expanded)open();});
  on(input,'input',()=>{clearSelection();if(!composing)open();});
  on(input,'compositionstart',()=>composing=true);
  on(input,'compositionend',()=>{composing=false;open();});
  on(input,'keydown',e=>{
    if(composing||e.isComposing||e.keyCode===229){if(e.key==='Enter'){e.preventDefault();e.stopPropagation();}return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!expanded)open();if(matches.length){active=e.key==='ArrowDown'?Math.min(active+1,matches.length-1):(active<0?matches.length-1:Math.max(0,active-1));highlight();}}
    else if(e.key==='Enter'){e.preventDefault();e.stopPropagation();if(expanded&&active>=0)choose(active);else if(expanded&&matches.length===1)choose(0);else{open();help.textContent='이름과 부서를 확인하여 검색 결과에서 선택하세요.';}}
    else if(e.key==='Escape'){e.preventDefault();close();}
    else if(e.key==='Tab')close();
  });
  on(list,'pointerdown',e=>{if(e.target.closest('[data-employee-index]'))e.preventDefault();});
  on(list,'click',e=>{const li=e.target.closest('[data-employee-index]');if(li)choose(Number(li.dataset.employeeIndex));});
  on(clear,'click',()=>{input.value='';clearSelection();input.focus();open();});
  on(doc,'pointerdown',e=>{if(!wrap.contains(e.target))close();});
  on(input,'blur',()=>{setTimeout(()=>{if(!wrap.contains(doc.activeElement))close();},0);});
  on(select,'change',()=>{if(!internalChange)sync();});
  if(form)on(form,'reset',()=>{setTimeout(()=>{sync();select.dispatchEvent(new Event('change',{bubbles:true}));close();},0);});
  input.disabled=select.disabled;sync();
  return {destroy(){controller.abort();wrap.remove();select.hidden=original.hidden;select.required=original.required;select.tabIndex=original.tabIndex;select.classList.remove('employee-picker-source');}};
}
