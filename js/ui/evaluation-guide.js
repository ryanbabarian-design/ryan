import { awardForScore } from '../review/award-policy.js?v=2.9.1';

/** Read-only help. The existing app remains the owner of every form and write. */
const installations = new WeakMap();
let nextGuideId = 0;

// Read the same monetary rules used by review saving instead of copying amounts.
export function getGuideAwardSchedule() {
  function bands(result, includeZero) {
    const rows = [];
    for (let score = 0; score <= 100; score += 1) {
      const award = awardForScore(score, result);
      if (!includeZero && !award.amount) continue;
      const previous = rows.at(-1);
      if (previous && previous.max === score - 1 && previous.grade === award.grade && previous.amount === award.amount) {
        previous.max = score;
      } else {
        rows.push({ min: score, max: score, grade: award.grade, amount: award.amount });
      }
    }
    return rows;
  }
  return { adopted: bands('채택', true).reverse(), count: bands('건수처리', false) };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => Number(value).toLocaleString('ko-KR') + '원';
const scoreRange = row => row.min === 0 ? `${row.max + 1}점 미만` : row.min === row.max ? `${row.min}점` : `${row.min}~${row.max}점`;

function guideMarkup(id) {
  const awards = getGuideAwardSchedule();
  const adoptedRows = awards.adopted.map(row => `<tr><th scope="row">${scoreRange(row)}</th><td>${escapeHtml(row.grade || '없음')}</td><td class="evaluation-guide-amount">${money(row.amount)}</td></tr>`).join('');
  const countRows = awards.count.map(row => `<tr><th scope="row">${scoreRange(row)}</th><td class="evaluation-guide-amount">${money(row.amount)}</td></tr>`).join('');
  return `
    <header class="evaluation-guide-header">
      <div><span class="evaluation-guide-eyebrow">평가 · 결재 · 포상</span><h2 id="${id}-title" tabindex="-1">제안제도 안내</h2></div>
      <button type="button" class="evaluation-guide-close" data-evaluation-guide-close aria-label="제안제도 안내 닫기">×</button>
    </header>
    <div class="evaluation-guide-body">
      <p id="${id}-intro" class="evaluation-guide-intro">제안이 접수된 뒤 누가 평가하고, 어떻게 최종 결과와 포상금이 정해지는지 확인하세요.</p>
      <section class="evaluation-guide-section" aria-labelledby="${id}-flow">
        <h3 id="${id}-flow">평가는 세 단계로 진행됩니다</h3>
        <ol class="evaluation-guide-stages">
          <li><span class="evaluation-guide-step" aria-hidden="true">01</span><h4>1차 본인평가</h4><p>제안자가 6개 항목을 직접 평가합니다.</p><strong>50점 이상 제출 가능</strong><small>50점 미만이면 등록·수정할 수 없습니다.</small></li>
          <li><span class="evaluation-guide-step" aria-hidden="true">02</span><h4>2차 팀장평가</h4><p>부서장 결재 단계에서 팀장평가를 저장합니다.</p><strong>50점 이상 → 임원 승인</strong><small>해당부서 임원 승인 후 3차 심사를 진행합니다.</small></li>
          <li><span class="evaluation-guide-step" aria-hidden="true">03</span><h4>3차 심사위원 평가</h4><p>심사위원회가 최종 점수와 결과를 심사하고 관리자가 기록합니다.</p><strong>점수심사 또는 결과심사</strong><small>채택 · 건수처리 · 미채택 · 보류 · 중복제안</small></li>
        </ol>
        <aside class="evaluation-guide-callout"><strong>2차 50~64점도 3차 심사가 필요합니다.</strong><p>‘건수처리 후보’로 분류되며, 임원 승인 후 3차 심사에서 최종 결과를 결정합니다.</p></aside>
      </section>
      <section class="evaluation-guide-section" aria-labelledby="${id}-approval">
        <h3 id="${id}-approval">심사 이후에는 결재와 지급을 진행합니다</h3>
        <div class="evaluation-guide-after">
          <div><h4>대표이사 최종결재</h4><p>관리자가 저장된 심사결과를 대표이사에게 상신하고, 대표이사가 확인 후 승인합니다.</p></div>
          <div><h4>포상금 별도 지급</h4><p>대표이사 승인 후 실제 지급을 별도로 처리합니다. 심사 저장이나 승인만으로 ‘지급완료’가 되지 않습니다.</p></div>
        </div>
      </section>
      <section class="evaluation-guide-section" aria-labelledby="${id}-details">
        <h3 id="${id}-details">평가기준과 자주 묻는 질문</h3>
        <div class="evaluation-guide-questions">
          <details>
            <summary>점수는 어떻게 계산하나요?</summary>
            <div class="evaluation-guide-answer">
              <p>각 항목에 정수 1~10점을 입력하고 가중치를 곱해 합산합니다. 총점은 100점 만점입니다.</p>
              <div class="evaluation-guide-table-wrap" tabindex="0" role="region" aria-label="평가항목과 가중치 표">
                <table><caption class="evaluation-guide-sr-only">각 단계 점수심사의 항목별 가중치</caption><thead><tr><th scope="col">평가항목</th><th scope="col">입력점수</th><th scope="col">가중치</th><th scope="col">최대점수</th></tr></thead><tbody>
                  <tr><th scope="row">독창성</th><td>1~10점</td><td>×2</td><td>20점</td></tr>
                  <tr><th scope="row">노력도</th><td>1~10점</td><td>×2</td><td>20점</td></tr>
                  <tr><th scope="row">실현성</th><td>1~10점</td><td>×1</td><td>10점</td></tr>
                  <tr><th scope="row">응용범위</th><td>1~10점</td><td>×1</td><td>10점</td></tr>
                  <tr><th scope="row">지속성</th><td>1~10점</td><td>×1</td><td>10점</td></tr>
                  <tr><th scope="row">유형효과</th><td>1~10점</td><td>×3</td><td>30점</td></tr>
                </tbody></table>
              </div>
              <p class="evaluation-guide-example">예: 모든 항목에 5점을 입력하면 5×(2+2+1+1+1+3) = <strong>50점</strong>입니다.</p>
              <p><strong>1·2·3차 점수는 단계별로 따로 기록합니다.</strong> 세 점수를 합산하거나 평균하지 않으며, 점수심사의 최종점수는 3차 평가 총점입니다.</p>
            </div>
          </details>
          <details>
            <summary>2차 점수에 따라 다음 절차가 달라지나요?</summary>
            <div class="evaluation-guide-answer">
              <dl class="evaluation-guide-definitions">
                <div><dt>50점 미만</dt><dd>2차 승인 저장 시 기준미달(미채택) 처리됩니다.</dd></div>
                <div><dt>50~64점</dt><dd>건수처리 후보입니다. 임원 승인 후 3차 심사에서 결과를 결정합니다.</dd></div>
                <div><dt>65점 이상</dt><dd>임원 승인 후 3차 심사위원 점수평가를 진행할 수 있습니다.</dd></div>
              </dl>
              <p>3차 <strong>점수심사</strong>는 1차 50점 이상(확인된 기존건 면제 포함), 2차 50점 이상과 해당부서 임원 승인을 확인합니다. 앞선 결재가 반려되었다면 보완·재상신하여 승인받아야 합니다.</p>
              <p><strong>채택은 점수심사로 저장합니다.</strong> 건수처리·미채택·보류·중복제안은 새 점수를 입력하지 않는 <strong>결과심사</strong>로 저장할 수 있습니다. 결과심사에서도 전자결재 대상 건은 임원 승인이 필요합니다.</p>
            </div>
          </details>
          <details>
            <summary>심사결과별 포상금은 얼마인가요?</summary>
            <div class="evaluation-guide-answer">
              <p>아래 금액은 현재 심사에 적용되는 <strong>지급 예정액</strong>입니다. 점수만으로 채택이나 지급완료가 자동 확정되지는 않습니다.</p>
              <h4>‘채택’으로 심사한 경우</h4>
              <p>3차 점수심사의 총점을 기준으로 계산합니다.</p>
              <div class="evaluation-guide-table-wrap" tabindex="0" role="region" aria-label="채택 포상금 표">
                <table><caption class="evaluation-guide-sr-only">채택 결과의 점수별 포상등급과 지급 예정액</caption><thead><tr><th scope="col">3차 점수</th><th scope="col">포상등급</th><th scope="col">지급 예정액</th></tr></thead><tbody>${adoptedRows}</tbody></table>
              </div>
              <p class="evaluation-guide-note">채택 50~59점의 포상등급 이름도 ‘건수처리’로 표시됩니다. <strong>심사결과</strong>와 <strong>포상등급</strong>은 별도 항목입니다.</p>
              <h4>‘건수처리’로 심사한 경우</h4>
              <div class="evaluation-guide-table-wrap" tabindex="0" role="region" aria-label="건수처리 포상금 표">
                <table><caption class="evaluation-guide-sr-only">건수처리 결과의 기준점수별 지급 예정액</caption><thead><tr><th scope="col">기준점수</th><th scope="col">지급 예정액</th></tr></thead><tbody>${countRows}</tbody></table>
              </div>
              <p><strong>점수심사는 3차 총점</strong>, <strong>결과심사는 저장된 2차 팀장 총점</strong>을 금액 기준으로 사용합니다. 건수처리 지급기준은 50~65점이며, 점수가 없거나 범위를 벗어나면 기준 확인이 필요합니다.</p>
              <p class="evaluation-guide-note">2차의 ‘50~64점 후보 분류’와 건수처리의 ‘50~65점 지급기준’은 쓰임이 다릅니다.</p>
              <p><strong>미채택·보류·중복제안</strong>의 지급 예정액은 <strong>0원</strong>입니다.</p>
            </div>
          </details>
          <details>
            <summary>심사위원과 점수 입력자는 어떻게 다른가요?</summary>
            <div class="evaluation-guide-answer">
              <p><strong>심사위원</strong>은 제안을 실제로 평가한 사람이고, <strong>입력자</strong>는 점수·결과를 시스템에 저장한 관리자입니다. 입력자 이름만으로 심사위원을 판단하지 않습니다.</p>
              <dl class="evaluation-guide-definitions">
                <div><dt>지정 위원</dt><dd>심사할 위원으로 등록된 명단입니다. 실제 심사 참여는 아직 확인되지 않은 상태입니다.</dd></div>
                <div><dt>실제 심사자 확인</dt><dd>해당 위원이 현재 저장된 3차 결과를 실제 심사했음을 근거로 확인한 상태입니다.</dd></div>
                <div><dt>재확인 필요</dt><dd>평가결과가 변경되어 실제 심사자를 다시 확인해야 합니다.</dd></div>
              </dl>
              <p>위원 명단 지정·확인은 위원 본인의 전자서명이나 결재를 의미하지 않습니다. 전자결재는 지정된 결재자가 자신의 단계에서 별도로 처리합니다.</p>
            </div>
          </details>
          <details>
            <summary>심사완료·실시완료·지급완료는 무엇이 다른가요?</summary>
            <div class="evaluation-guide-answer">
              <dl class="evaluation-guide-definitions">
                <div><dt>심사완료</dt><dd>심사결과를 저장한 상태입니다. 대표이사 상신·승인 상태는 별도로 확인합니다.</dd></div>
                <div><dt>실시완료</dt><dd>현장 개선을 완료한 상태입니다. 실시상태와 실제 실시일로 관리합니다.</dd></div>
                <div><dt>지급완료</dt><dd>포상금 지급이 완료된 상태입니다. 지급 예정액이 표시되는 것과 구분합니다.</dd></div>
              </dl>
              <p>채택 여부, 현장 실시 여부, 포상금 지급 여부는 각각 확인하세요.</p>
            </div>
          </details>
          <details>
            <summary>과거 제안이나 ‘미평가’ 표시는 어떻게 확인하나요?</summary>
            <div class="evaluation-guide-answer">
              <p>과거 이관건에는 기록으로 확인된 1차 면제나 별도 결과 정정 절차가 적용될 수 있습니다. ‘기존 심사’ 총점은 과거 확정 기록이며, 없는 1·2·3차 항목별 점수를 새로 만든 것이 아닙니다.</p>
              <p><strong>미평가는 0점이 아닙니다.</strong> 평가기록이 아직 없다는 뜻입니다. ‘조회 실패’·‘자료 확인 필요’가 표시되면 미평가로 단정하지 말고 기록을 다시 확인하세요.</p>
              <p>대표이사 상신·승인 또는 지급완료 이후에는 일반 3차 수정이 제한됩니다. 기존 기록을 확인하고 해당 정정 절차를 이용해야 합니다.</p>
            </div>
          </details>
        </div>
      </section>
      <p class="evaluation-guide-scope">일반 신규 제안의 현행 절차를 기준으로 안내합니다. 개별 제안은 접수현황의 저장된 평가·결재·지급 기록을 함께 확인하세요.</p>
    </div>
    <footer class="evaluation-guide-footer"><p>닫으면 보던 화면에서 계속할 수 있습니다.</p><button type="button" class="evaluation-guide-done" data-evaluation-guide-close>안내 닫기</button></footer>`;
}

/** Accept either the app element or its Document. Opening never changes routes. */
export function installEvaluationGuide({ root } = {}) {
  const doc = root?.nodeType === 9 ? root : root?.ownerDocument;
  if (!doc?.body) throw new Error('제안제도 안내를 표시할 화면이 없습니다.');
  if (installations.has(doc)) return installations.get(doc);

  const id = `evaluation-guide-${++nextGuideId}`;
  const dialog = doc.createElement('dialog');
  dialog.className = 'evaluation-guide-dialog';
  dialog.dataset.evaluationGuide = '';
  dialog.id = id;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-intro`);
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = guideMarkup(id);
  doc.body.append(dialog);

  const title = dialog.querySelector('h2');
  let opener = null;
  let savedRanges = [];
  let fallbackInert = [];
  let showing = false;
  let destroyed = false;
  let ownsScrollLock = false;
  let backdropPointer = false;

  function finishClose() {
    if (!showing) return;
    showing = false;
    if (ownsScrollLock) doc.documentElement.classList.remove('evaluation-guide-open');
    for (const [element, previous] of fallbackInert) element.inert = previous;
    fallbackInert = [];
    const ranges = savedRanges.filter(range => range.commonAncestorContainer.isConnected);
    if (ranges.length) {
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    }
    savedRanges = [];
    const target = opener?.isConnected ? opener : doc.querySelector('[data-evaluation-guide-open]');
    target?.focus?.({ preventScroll: true });
    opener = null;
  }

  function close() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    finishClose();
  }

  function open(trigger = doc.activeElement) {
    if (destroyed || showing) return;
    opener = trigger;
    const selection = doc.getSelection();
    savedRanges = [];
    for (let index = 0; index < (selection?.rangeCount || 0); index += 1) {
      const range = selection.getRangeAt(index);
      if (!dialog.contains(range.commonAncestorContainer)) savedRanges.push(range.cloneRange());
    }
    ownsScrollLock = !doc.documentElement.classList.contains('evaluation-guide-open');
    doc.documentElement.classList.add('evaluation-guide-open');
    showing = true;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.classList.add('evaluation-guide-fallback');
      for (const element of doc.body.children) {
        if (element === dialog) continue;
        fallbackInert.push([element, element.inert]);
        element.inert = true;
      }
      dialog.setAttribute('open', '');
    }
    dialog.querySelector('.evaluation-guide-body').scrollTop = 0;
    title.focus({ preventScroll: true });
  }

  function onOpenClick(event) {
    const trigger = event.target.closest?.('[data-evaluation-guide-open]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    open(trigger);
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', finishClose);
  dialog.addEventListener('pointerdown', event => { backdropPointer = event.target === dialog; });
  dialog.addEventListener('click', event => {
    if (event.target.closest?.('[data-evaluation-guide-close]')) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.target === dialog && backdropPointer) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }
    backdropPointer = false;
  });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key !== 'Tab') return;
    // Keep a background rich-editor's keyboard handler out of this modal.
    event.stopPropagation();
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'));
    const first = focusable[0], last = focusable.at(-1), active = doc.activeElement;
    if (event.shiftKey && (active === first || active === title || !dialog.contains(active))) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault(); first?.focus();
    }
  });
  doc.addEventListener('click', onOpenClick, true);

  const api = {
    open,
    close,
    destroy() {
      close();
      destroyed = true;
      doc.removeEventListener('click', onOpenClick, true);
      dialog.remove();
      installations.delete(doc);
    },
  };
  installations.set(doc, api);
  return api;
}
