// The author select can contain homonyms. Its option identity travels with the text.
const richFields = ['current_problem', 'improvement_plan', 'expected_effect'];
const scoreKeys = ['originality', 'effort', 'feasibility', 'applicability', 'continuity', 'tangible_effect'];
const scoreNames = scoreKeys.map(key => 'first_eval_' + key);
const fieldNames = ['category', 'title', ...richFields, 'cost_amount', 'proposer_effect_amount',
  'implementation_status', 'implemented_date', ...scoreNames];
const scoreWeights = [2, 2, 1, 1, 1, 3];
const sides = ['before', 'after'];
const blankImages = () => ({before:{existing:[], files:[]}, after:{existing:[], files:[]}});
const makeId = () => crypto.randomUUID();
const value = (form, key) => String(form.elements[key]?.value ?? '');
const consentInput = form => form.querySelector('.form-submit-bar input[type="checkbox"]');

export function captureFields(form, sanitizeHtml) {
  const fields = {};
  for (const key of fieldNames) {
    const text = value(form, key);
    fields[key] = richFields.includes(key) ? sanitizeHtml(text) : text;
  }
  const option = form.elements.proposer_name?.selectedOptions?.[0];
  const author = { name:option?.value || '', department:option?.dataset.department || '',
    employeeId:option?.dataset.employeeId || '', employeeNo:option?.dataset.employeeNo || '' };
  return { fields, author };
}

export function applyFields(form, snapshot, sanitizeHtml) {
  for (const name of fieldNames) {
    if (form.elements[name] && typeof snapshot.fields?.[name] === 'string') {
      form.elements[name].value = richFields.includes(name) ? sanitizeHtml(snapshot.fields[name]) : snapshot.fields[name];
    }
  }
  const select = form.elements.proposer_name;
  if (select) {
    const author = snapshot.author || {};
    const matches = [...select.options].filter(o => {
      if (!author.name || o.disabled) return false;
      if (author.employeeId) return o.dataset.employeeId === author.employeeId;
      if (author.employeeNo) return o.dataset.employeeNo === author.employeeNo;
      return o.value === author.name && o.dataset.department === author.department;
    });
    select.selectedIndex = matches.length === 1 ? [...select.options].indexOf(matches[0]) : 0;
    if (form.elements.department) form.elements.department.value = matches.length === 1 ? matches[0].dataset.department : '';
    select.dispatchEvent?.(new Event('change', {bubbles:true}));
  }
  if (form.elements.edit_pin) form.elements.edit_pin.value = '';
  const consent = form.querySelector && consentInput(form);
  if (consent) consent.checked = false;
}

export function requiredGroups(form, plainText) {
  const missing = (...names) => names.find(name => !value(form, name).trim());
  const scores = scoreNames.map(name => Number(value(form, name)));
  const invalidScore = scores.findIndex(s => !Number.isInteger(s) || s < 1 || s > 10);
  const total = scores.reduce((sum, s, i) => sum + s * scoreWeights[i], 0);
  const compare = richFields.slice(0, 2).find(name => !plainText(value(form, name)));
  const costs = ['cost_amount', 'proposer_effect_amount'].find(name => form.elements[name]?.validity?.valid === false);
  return [
    { label:'제안자 정보', missing:missing('proposer_name', 'department', 'category') },
    { label:'제안명', missing:missing('title') },
    { label:'개선 전·후 비교', missing:compare },
    { label:'효과 및 비용', missing:!plainText(value(form, 'expected_effect')) ? 'expected_effect' : costs },
    { label:'1차 자기평가', missing:invalidScore >= 0 ? scoreNames[invalidScore] : total < 50 ? scoreNames[0] : null },
    { label:'실시현황', missing:missing('implementation_status') || (value(form, 'implementation_status') === '완료' && missing('implemented_date')) },
    { label:'수정번호·공개 동의', missing:!/^\d{4}$/.test(value(form, 'edit_pin')) ? 'edit_pin' : !consentInput(form)?.checked ? 'consent' : null },
  ];
}

const unsavedText = new Map();
const requestStorageError = '중복 접수를 막기 위한 요청번호를 저장하지 못했습니다. 브라우저 저장 공간을 확보한 뒤 다시 제출하세요.';

async function submissionFingerprint(payload, before, after) {
  // The original PIN is checked by the receipt RPC. Never include it in a local digest.
  const {edit_pin: ignoredPin, ...body} = payload;
  const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
    value => value.toString(16).padStart(2,'0')).join('');
  const files = group => Promise.all(Array.from(group || [], async file =>
    [file.name,file.type,await hash(await file.arrayBuffer())]));
  const ordered = (key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k,value[k]])) : value;
  return hash(new TextEncoder().encode(JSON.stringify([body,await files(before),await files(after)],ordered)));
}

export function textCheckpoint(key, getStorage = () => window.localStorage, transact = imageTransaction, memory = unsavedText) {
  // Existing v1 entries remain readable. The route key is now only a default
  // selection. Each request has its own manuscript and immutable terminal keys.
  const seed = 'hana.proposal.draft.v1.' + key;
  const prefix = 'hana.proposal.draft.v2.' + encodeURIComponent(key) + '/';
  const slot = (type, id) => prefix + type + '/' + id;
  const raw = name => {
    try { return JSON.parse(getStorage().getItem(name) || 'null'); } catch { return null; }
  };
  const get = name => memory.get(name) || raw(name);
  function put(name, entry) {
    try {
      const data = JSON.stringify(entry);
      getStorage().setItem(name, data);
      if (getStorage().getItem(name) !== data) throw new Error('저장 결과를 확인하지 못했습니다.');
      memory.delete(name);
      return true;
    } catch { memory.set(name, entry); return false; }
  }
  const erase = name => {
    memory.delete(name);
    try { getStorage().removeItem(name); } catch { /* a tombstone still prevents recovery */ }
  };
  const dbGet = name => transact('readonly', store => store.get(name));
  const dbPut = (name, data) => transact('readwrite', store => store.put(data, name));
  const safeDbGet = async name => { try { return await dbGet(name); } catch { return null; } };
  function selectDefault(id) {
    if (!get(seed)) put(seed, {requestId:id});
  }
  function read(id = get(seed)?.requestId) {
    if (!id) return null;
    const seen = new Set();
    while (get(slot('retired',id)) && !seen.has(id)) {
      seen.add(id); id = get(slot('retired',id)).requestId;
    }
    const legacy = get(seed);
    return get(slot('receipt',id)) || get(slot('draft',id)) || get(slot('id',id)) ||
      (legacy?.requestId === id ? legacy : null) || (seen.size ? {requestId:id} : null);
  }
  function list() {
    const ids = new Set();
    const keys = new Set(memory.keys());
    try { const storage = getStorage(); for (let i=0; i<storage.length; i++) keys.add(storage.key(i)); } catch { /* list this tab's unsaved work */ }
    const primary = read();
    if (primary) ids.add(primary.requestId);
    for (const name of keys) {
      if (name?.startsWith(prefix)) ids.add(name.slice(name.lastIndexOf('/') + 1));
    }
    return [...new Map([...ids].map(id => read(id)).filter(Boolean).map(entry => [entry.requestId,entry])).values()];
  }
  async function recover(id) {
    if (!id) {
      id = read()?.requestId;
      if (!id) {
        // An IndexedDB-only attempt must also be discoverable when reopening the route.
        let names;
        try { names = await transact('readonly', store => store.getAllKeys()); } catch { return null; }
        const identifiers = names.filter(n => typeof n === 'string' &&
          (n.startsWith(prefix + 'id/') || n.startsWith(prefix + 'attempt/')));
        for (const name of identifiers) {
          const requestId = name.slice(name.lastIndexOf('/') + 1);
          const locator = slot('id',requestId);
          if (!get(locator)) memory.set(locator,{requestId,attempted:name.startsWith(prefix + 'attempt/')});
        }
        if (identifiers.length) id = identifiers[0].slice(identifiers[0].lastIndexOf('/') + 1);
      }
    }
    if (!id) return null;
    const seen = new Set();
    while (!seen.has(id)) {
      seen.add(id);
      const terminal = await safeDbGet(slot('terminal',id));
      const retired = get(slot('retired',id)) || terminal?.replacement;
      if (!retired) {
        if (terminal?.receipt) {
          const accepted = {...read(id),requestId:id,receipt:terminal.receipt};
          memory.set(slot('receipt',id),accepted);
          return accepted;
        }
        break;
      }
      memory.set(slot('retired',id), retired); id = retired.requestId;
    }
    const receipt = get(slot('receipt',id));
    if (receipt) { memory.set(slot('receipt',id), receipt); return receipt; }
    const entry = read(id) || await safeDbGet(slot('id',id));
    if (entry) return entry;
    const attempted = await readAttempt(id);
    return attempted ? {requestId:id,attempted:true} : seen.size > 1 ? {requestId:id} : null;
  }
  async function ensure(id) {
    const previous = await recover(id);
    if (previous?.receipt || (previous && previous.requestId !== id)) throw new Error('이미 접수되었거나 폐기된 임시저장입니다. 새로고침하여 접수 상태를 확인하세요.');
    const name = slot('id',id);
    selectDefault(id);
    if (raw(slot('draft',id))?.requestId === id || raw(name)?.requestId === id || put(name,{requestId:id})) return;
    try {
      await dbPut(name,{requestId:id});
      if ((await dbGet(name))?.requestId === id) return;
    } catch { /* failure to read back the identity must block create */ }
    throw new Error(requestStorageError);
  }
  function write(entry) {
    const id = entry.requestId;
    if (get(slot('retired',id)) || get(slot('receipt',id)) || (get(seed)?.requestId === id && get(seed)?.receipt)) return false;
    const ok = put(slot('draft',id),entry);
    selectDefault(id);
    return ok;
  }
  async function readAttempt(id) {
    const name = slot('attempt',id);
    // Memory alone can never authorize a closed-intake retry.
    return raw(name) || await safeDbGet(name);
  }
  async function prepare(id, fingerprint, snapshot, allowNew) {
    const name = slot('attempt',id);
    let previous = await readAttempt(id);
    if (!previous) {
      if (!allowNew) throw new Error('신규 접수가 종료되었습니다. 이전 제출 요청만 다시 확인할 수 있습니다.');
      const full = {requestId:id,fingerprint,snapshot};
      const small = {requestId:id,fingerprint};
      // add() serializes competing first attempts for the same request. A full
      // manuscript is optional when quota permits only a small attempt marker.
      for (const candidate of [full,small]) {
        try {
          await transact('readwrite', store => store.add(candidate,name));
          previous = await dbGet(name);
          if (previous) { put(name,previous); break; }
        } catch (error) {
          if (error?.name === 'ConstraintError') { previous = await dbGet(name); break; }
        }
      }
      if (!previous) {
        previous = raw(name);
        if (!previous && (put(name,full) || put(name,small))) previous = raw(name);
      }
    }
    if (!previous) throw new Error(requestStorageError);
    if (previous.fingerprint !== fingerprint) throw new Error('이전 제출과 제안 내용 또는 사진이 다릅니다. 원래 내용과 사진으로 다시 확인하세요.');
    return previous;
  }
  async function firstTerminal(id, candidate) {
    const name = slot('terminal',id);
    try {
      // add() gives concurrent tabs a single first terminal decision per request.
      await transact('readwrite', store => store.add(candidate,name));
      return candidate;
    } catch (error) {
      if (error?.name !== 'ConstraintError') throw error;
      return dbGet(name);
    }
  }
  function accept(entry) {
    const id = entry.requestId;
    if (get(slot('retired',id))) return {receipt:entry.receipt, saved:false};
    const prior = read(id);
    if (prior?.receipt) entry = prior;
    const saved = raw(slot('receipt',id))?.receipt?.proposal_no === entry.receipt.proposal_no || put(slot('receipt',id),entry);
    if (!get(seed)) selectDefault(id);
    // The fallback holds only the authoritative receipt. The manuscript is
    // already stored independently and can exceed the quota for a small marker.
    const durable = firstTerminal(id,{requestId:id,receipt:entry.receipt})
      .then(terminal => Boolean(terminal?.receipt), () => saved);
    return {receipt:entry.receipt, saved, durable};
  }
  async function replace(previous, next, acknowledgedReceipt = '') {
    if (get(slot('retired',previous))) return false;
    const accepted = read(previous)?.receipt?.proposal_no;
    if (accepted && accepted !== acknowledgedReceipt) return false;
    const mark = {requestId:next};
    // Reserve a separate successor identity before the first await. A late
    // response for the old request cannot change this slot or its manuscript.
    put(slot('id',next),mark);
    let databaseSaved = false;
    try {
      const terminal = await firstTerminal(previous,{replacement:mark});
      if (terminal?.receipt?.proposal_no === acknowledgedReceipt && acknowledgedReceipt) {
        await dbPut(slot('terminal',previous),{replacement:mark});
      } else if (terminal?.replacement?.requestId !== next) {
        erase(slot('id',next));
        return false;
      }
      databaseSaved = true;
    } catch { /* localStorage also supports recovery of the successor */ }
    const name = slot('retired',previous);
    const local = put(name,mark);
    if (!local && !databaseSaved) { memory.delete(name); erase(slot('id',next)); return false; }
    if (databaseSaved) await dbPut(slot('id',next),mark).catch(()=>{});
    for (const type of ['draft','id','receipt','attempt']) erase(slot(type,previous));
    if (databaseSaved) await transact('readwrite',store => store.delete(slot('attempt',previous))).catch(()=>{});
    if (get(seed)?.requestId === previous) put(seed,{requestId:previous});
    return true;
  }
  return {read, list, recover, ensure, readAttempt, prepare, write, accept, replace, receiptKey:id=>slot('receipt',id), retirementKey:id=>slot('retired',id)};
}

let imageDatabase;
function openImages() {
  if (!imageDatabase) {
    imageDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open('hana-proposal-draft-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); imageDatabase = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('사진 저장소가 다른 창에서 사용 중입니다.'));
    }).catch(error => { imageDatabase = null; throw error; });
  }
  return imageDatabase;
}

async function imageTransaction(mode, operation) {
  const db = await openImages();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', mode);
    const request = operation(tx.objectStore('images'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || request.error || new Error('브라우저 저장을 완료하지 못했습니다.'));
  });
}

function copyImages(selections) {
  const result = blankImages();
  for (const side of sides) {
    result[side].existing = [...(selections?.[side]?.existing || [])];
    result[side].files = [...(selections?.[side]?.files || [])];
  }
  return result;
}
function sameImages(a, b) {
  return sides.every(side => ['files','existing'].every(key =>
    a[side][key].length === b[side][key].length && a[side][key].every((v,i) => v === b[side][key][i])));
}
function imageManifest(selections, token) {
  return {token, ...Object.fromEntries(sides.map(side => [side, {
    existing: selections[side].existing, names: selections[side].files.map(file => file.name),
  }]))};
}
function hasFiles(manifest) {
  return sides.some(side => manifest?.[side]?.names?.length);
}
export function attachmentCheckpoint(transact = imageTransaction) {
  // A route may remount the editor before the IndexedDB transaction commits.
  const inFlight = new Map();
  return {
    async write(id, token, selections) {
      const entry = {token, selections:copyImages(selections)};
      inFlight.set(id, entry);
      await transact('readwrite', store => store.put(entry, id));
      if (inFlight.get(id) === entry) inFlight.delete(id);
    },
    async read(id, manifest) {
      if (!hasFiles(manifest)) {
        const result = blankImages();
        for (const side of sides) result[side].existing = manifest?.[side]?.existing || [];
        return result;
      }
      const record = inFlight.get(id) || await transact('readonly', store => store.get(id));
      if (record?.token !== manifest.token) throw new Error('저장한 사진을 찾지 못했습니다.');
      return copyImages(record.selections);
    },
    async remove(id) {
      inFlight.delete(id);
      await transact('readwrite', store => store.delete(id));
    },
  };
}
const attachments = attachmentCheckpoint();

export function recordReceipt(checkpoint, state, result) {
  const number = typeof result === 'string' ? result : result?.proposal_no;
  if (!number) throw new Error('접수번호가 필요합니다.');
  const receipt = {proposal_no:String(number)};
  return checkpoint.accept({...state, receipt, savedAt:new Date().toISOString()});
}

function addEvaluationBodies(form) {
  // One tbody per criterion gives mobile cards a real grouping and keeps desktop rowspans.
  const table = form.querySelector('[data-evaluation-prefix="first"] table');
  if (!table || table.tBodies.length !== 1) return;
  const source = table.tBodies[0];
  let group;
  for (const row of [...source.rows]) {
    if (row.querySelector('.eval-label') || !group) group = table.createTBody();
    group.append(row);
  }
  source.remove();
}

const fieldLabels = {proposer_name:'제안자', department:'부서', category:'제안종류', title:'제안명',
  current_problem:'현재 문제점', improvement_plan:'개선방안', expected_effect:'기대효과',
  cost_amount:'예상 투입비용', proposer_effect_amount:'예상 효과금액', implemented_date:'실시일',
  implementation_status:'실시상태', edit_pin:'4자리 수정번호', consent:'공개 동의'};
const scoreLabels = ['독창성','노력도','실현성','응용범위','지속성','유형효과'];

export function mountProposalDraft(form, options) {
  const {key, sourceUpdatedAt = '', syncEditors, restoreEditors, readImages, restoreImages, sanitizeHtml} = options;
  const doc = form.ownerDocument;
  const win = doc.defaultView;
  const checkpoint = options.checkpoint || textCheckpoint(key);
  const events = new AbortController();
  const on = (target, type, fn, capture = false) => target.addEventListener(type, fn, {signal:events.signal, capture});
  const el = (tag, text = '') => { const node = doc.createElement(tag); node.textContent = text; return node; };
  const actionButton = (name, label) => {
    const node = el('button', label); node.type = 'button'; node.dataset.draftAction = name; return node;
  };
  const panel = el('section');
  panel.className = 'draft-panel';
  panel.setAttribute('aria-label','작성 진행 및 임시저장');
  panel.innerHTML = '<div class="draft-head"><div><strong>작성 진행</strong> <span data-draft-count></span></div></div><progress max="7" aria-label="필수 작성 항목"></progress><div class="draft-missing"></div><p class="draft-status" role="status"></p><p class="draft-warning" role="alert"></p><div class="draft-recovery" hidden></div>';
  const head = panel.querySelector('.draft-head');
  const progress = panel.querySelector('progress');
  const count = panel.querySelector('[data-draft-count]');
  const links = panel.querySelector('.draft-missing');
  const status = panel.querySelector('.draft-status');
  const warning = panel.querySelector('.draft-warning');
  const prompt = panel.querySelector('.draft-recovery');
  head.append(actionButton('preview', '제출 전 미리보기'));
  form.prepend(panel);
  addEvaluationBodies(form);
  const plainText = html => {
    const template = el('template'); template.innerHTML = sanitizeHtml(html);
    return template.content.textContent.replace(/\u00a0/g, ' ').trim();
  };

  const tabKey = 'hana.proposal.tab.' + key;
  function selectedInTab() {
    try {
      const pinned = win.history.state?.hanaProposalDraft;
      if (pinned?.key === key) return pinned.id;
    } catch { /* sessionStorage is an independent tab-local locator */ }
    try { return win.sessionStorage.getItem(tabKey); } catch { return null; }
  }
  function pin(id) {
    try { win.history.replaceState({...win.history.state, hanaProposalDraft:{key,id}}, ''); } catch { /* try the other locator */ }
    try { win.sessionStorage.setItem(tabKey,id); } catch { /* history state survives reload */ }
    return selectedInTab() === id;
  }
  const preferred = selectedInTab();
  let saved;
  let storageWarning = '', submissionWarning = '';
  try { saved = preferred ? checkpoint.read(preferred) : checkpoint.read(); } catch { storageWarning = '이 브라우저에서 임시저장 내용을 읽지 못했습니다.'; }
  let requestId = saved?.requestId || preferred || makeId();
  let attempt = null;
  let revision = sourceUpdatedAt;
  let pending = saved?.fields && !saved.receipt ? saved : null;
  let receipt = saved?.receipt || null;
  let dirty = false, destroyed = false, restoring = false, initializing = true;
  let timer, dialog, imageJob, lastGroupSignature;
  let images = copyImages(readImages());
  let manifest = imageManifest(images, '');
  let missingImageWarning = '';
  let unresolvedImages = false;
  let lastWritten = '';
  let wroteImages = !!saved?.hasStoredPhotos || hasFiles(saved?.images);
  const initial = captureFields(form, sanitizeHtml);
  const initialImages = copyImages(images);
  const initialSubmitDisabled = form.querySelector('[type=submit]')?.disabled;
  const controlsToLock = [...form.children].filter(child => child !== panel && !child.hidden);

  function showWarnings() {
    const stale = revision && sourceUpdatedAt && revision !== sourceUpdatedAt;
    const pendingStale = pending?.sourceUpdatedAt && sourceUpdatedAt && pending.sourceUpdatedAt !== sourceUpdatedAt;
    warning.textContent = [storageWarning, submissionWarning, missingImageWarning, (stale || pendingStale) &&
      '임시저장한 뒤 원본 제안이 변경되었습니다. 복원하기 전에 최신 원본 내용을 확인하세요.'].filter(Boolean).join(' ');
  }
  const intakeClosed = () => form.dataset.intakeBlocked == null ? !!options.recoveryOnly : form.dataset.intakeBlocked === 'true';
  const canRetrySubmission = () => Boolean(attempt && !receipt && !pending && !restoring && !initializing && !destroyed);
  function gate() {
    const locked = Boolean(receipt || pending || restoring || initializing);
    form.dataset.draftLocked = String(locked);
    form.dataset.draftCanRetry = String(canRetrySubmission());
    controlsToLock.forEach(child => { child.inert = locked; });
    const submit = form.querySelector('[type=submit]');
    if (submit && locked) submit.disabled = true;
    else if (submit && !submit.dataset.submitting) submit.disabled = intakeClosed() ? !canRetrySubmission() : !!initialSubmitDisabled && !options.recoveryOnly;
    head.querySelector('button').disabled = locked;
    links.hidden = locked;
    options.onStateChange?.();
  }
  function refreshProgress() {
    const groups = requiredGroups(form, plainText);
    const signature = JSON.stringify(groups);
    if (signature === lastGroupSignature) return;
    lastGroupSignature = signature;
    const missing = groups.filter(g => g.missing);
    progress.value = 7 - missing.length;
    count.textContent = `${progress.value}/7 완료`;
    links.replaceChildren(...missing.map(g => {
      const button = el('button', fieldLabels[g.missing] || '자기평가 점수');
      button.type = 'button'; button.dataset.draftJump = g.missing;
      button.setAttribute('aria-label', g.label + ' · ' + button.textContent + ' 입력으로 이동');
      return button;
    }));
  }
  function recoveryPrompt() {
    prompt.replaceChildren();
    prompt.hidden = !(pending || receipt || attempt);
    if (receipt) {
      prompt.append(el('strong', '접수 완료 · ' + receipt.proposal_no), actionButton('fresh', form.dataset.edit === 'true' ? '새 수정 시작' : '새 제안 작성'));
    } else if (pending) {
      const date = new Date(pending.savedAt);
      const when = Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR') + ' · ' : '';
      prompt.append(el('strong', when + '이 브라우저에 임시저장한 내용이 있습니다.'), actionButton('restore','복원하기'), actionButton('discard','폐기'));
    }
    if (attempt && !receipt && !pending) {
      prompt.append(el('strong', '제출을 시도한 제안입니다. 원래 내용·사진과 수정번호로 접수 여부를 다시 확인하세요.'));
      if (!intakeClosed()) prompt.append(actionButton('discard','임시저장 폐기'));
    }
    const others = checkpoint.list().filter(entry => entry.requestId !== requestId && (entry.fields || entry.receipt || entry.attempted));
    if (others.length && !dirty && !initializing) {
      const choices = el('details');
      choices.append(el('summary', '이 브라우저의 다른 제안'));
      for (const entry of others) {
        const button = actionButton('switch', entry.receipt?.proposal_no || entry.fields?.title || (entry.attempted ? '이전 작성 요청 · ' + entry.requestId.slice(0,8) : '제목 미입력'));
        button.dataset.request = entry.requestId;
        choices.append(button);
      }
      prompt.append(choices);
      prompt.hidden = false;
    }
    gate(); showWarnings();
  }

  function flush() {
    clearTimeout(timer);
    if (destroyed || receipt || pending || restoring || initializing || attempt) return Promise.resolve(true);
    syncEditors(form);
    const data = captureFields(form, sanitizeHtml);
    const nextImages = copyImages(readImages());
    const changedImages = !sameImages(nextImages, images);
    if (!dirty && !changedImages && JSON.stringify(data) === JSON.stringify(initial)) return Promise.resolve(true);
    dirty = true;
    if (changedImages) {
      images = nextImages;
      manifest = imageManifest(images, makeId());
      unresolvedImages = false;
      missingImageWarning = '';
      imageJob = null;
    }
    if (hasFiles(manifest)) wroteImages = true;
    const state = {requestId, sourceUpdatedAt:revision, ...data, images:manifest, hasStoredPhotos:wroteImages};
    const serialized = JSON.stringify(state);
    if (lastWritten !== serialized || storageWarning) {
      const ok = checkpoint.write({...state, savedAt:new Date().toISOString()});
      const current = checkpoint.read(requestId);
      if (current?.receipt) {
        acceptExternalReceipt(requestId,current.receipt);
        return Promise.resolve(false);
      }
      if (current && current.requestId !== requestId) {
        storageWarning = '다른 창에서 이 임시저장을 폐기했습니다. 입력 내용을 복사한 뒤 새로고침하세요.';
        showWarnings();
        return Promise.resolve(false);
      }
      storageWarning = ok ? '' : '이 브라우저에 글을 저장하지 못했습니다. 창을 닫기 전에 내용을 복사하세요.';
      if (ok) lastWritten = serialized;
    }
    if (hasFiles(manifest) && !unresolvedImages && !imageJob) {
      const token = manifest.token;
      imageJob = attachments.write(requestId, token, images).then(() => true, () => false).then(ok => {
        if (token === manifest.token && !destroyed && !receipt) {
          if (!ok) {
            missingImageWarning = '선택한 사진을 저장하지 못했습니다. 창을 닫으면 다시 첨부해야 합니다.';
            imageJob = null;
          }
          showWarnings();
          status.textContent = ok && !storageWarning ? '이 브라우저에 임시저장했습니다.' : '임시저장 상태를 확인하세요.';
        }
        return ok;
      });
    }
    status.textContent = storageWarning || missingImageWarning ? '임시저장 상태를 확인하세요.' :
      hasFiles(manifest) ? '글 임시저장 · 사진 저장 상태 확인 중' : '이 브라우저에 임시저장했습니다.';
    showWarnings();
    return Promise.resolve(imageJob ?? !unresolvedImages).then(ok => {
      if (ok && !destroyed && !storageWarning && !missingImageWarning && !receipt && !pending) status.textContent = '이 브라우저에 임시저장했습니다.';
      return ok && !storageWarning;
    });
  }

  async function restore() {
    if (!pending || restoring) return;
    restoring = true;
    const entry = pending;
    const id = requestId;
    prompt.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      let recovered;
      try { recovered = await attachments.read(id, entry.images); }
      catch {
        unresolvedImages = true;
        const names = sides.flatMap(side => entry.images?.[side]?.names || []);
        missingImageWarning = '사진을 복원하지 못했습니다. 다시 첨부하세요. ' + names.join(', ');
        recovered = blankImages();
        for (const side of sides) recovered[side].existing = entry.images?.[side]?.existing || [];
      }
      if (destroyed || id !== requestId || receipt) return;
      restoreImages(recovered);
      images = copyImages(readImages());
      manifest = entry.images || imageManifest(images,'');
      revision = entry.sourceUpdatedAt ?? sourceUpdatedAt;
      applyFields(form, entry, sanitizeHtml);
      restoreEditors(form);
      pending = null;
      dirty = true;
      status.textContent = '임시저장 내용을 복원했습니다. 수정번호와 공개 동의를 다시 확인하세요.';
      refreshProgress();
    } catch {
      storageWarning = '임시저장을 복원하지 못했습니다. 다시 시도하거나 원본에서 새로 작성하세요.';
    } finally {
      restoring = false;
      if (!destroyed) recoveryPrompt();
    }
  }
  async function clear() {
    if (initializing) await ready;
    if (destroyed || restoring) return false;
    if (form.querySelector('[type=submit]')?.dataset.submitting) {
      submissionWarning = '제출 결과를 확인하는 동안에는 임시저장을 폐기할 수 없습니다.';
      showWarnings(); return false;
    }
    clearTimeout(timer);
    const previousId = requestId;
    const hadFiles = wroteImages || hasFiles(pending?.images || manifest);
    const replacement = makeId();
    restoring = true;
    gate();
    const removed = await checkpoint.replace(previousId, replacement, receipt?.proposal_no);
    if (!removed || destroyed) {
      restoring = false;
      storageWarning = '임시저장 폐기를 확인하지 못했습니다. 이 창의 내용을 복사한 뒤 새로고침하세요.';
      if (!destroyed) recoveryPrompt();
      return false;
    }
    wroteImages = false;
    attempt = null; submissionWarning = '';
    requestId = replacement;
    pin(requestId);
    revision = sourceUpdatedAt; receipt = null; pending = null;
    dirty = false; restoring = false; unresolvedImages = false; imageJob = null; lastWritten = '';
    images = copyImages(initialImages); manifest = imageManifest(images,'');
    storageWarning = removed ? '' : '기기에 남은 임시저장 내용을 삭제하지 못했습니다.';
    missingImageWarning = '';
    if (!destroyed) {
      restoring = true;
      try {
        restoreImages(copyImages(initialImages));
        applyFields(form, initial, sanitizeHtml);
        restoreEditors(form);
      } finally { restoring = false; }
      status.textContent = '새로 작성하는 내용은 이 브라우저에 임시저장됩니다.';
      recoveryPrompt(); refreshProgress();
    }
    if (!hadFiles) return Promise.resolve(removed);
    return attachments.remove(previousId).then(() => true, () => false).then(ok => {
      if (!ok && !destroyed) { missingImageWarning = '기기에 남은 임시저장 사진을 삭제하지 못했습니다.'; showWarnings(); }
      return removed && ok;
    });
  }
  function markSubmitted(result) {
    clearTimeout(timer);
    const state = {requestId, sourceUpdatedAt:revision, images:manifest, hasStoredPhotos:wroteImages};
    // Receipt persistence remains independent of collecting any optional form data.
    try { Object.assign(state, captureFields(form,sanitizeHtml)); } catch { /* receipt is authoritative */ }
    const outcome = recordReceipt(checkpoint,state,result);
    receipt = outcome.receipt;
    submissionWarning = '';
    storageWarning = outcome.saved ? '' : '접수는 완료되었습니다. 이 브라우저의 접수번호 저장 상태를 확인하고 있습니다.';
    pending = null;
    if (!destroyed) { status.textContent = '제출한 제안은 접수번호로 확인하세요.'; recoveryPrompt(); }
    win.dispatchEvent(new CustomEvent('hana-proposal-receipt', {detail:{key, requestId, receipt}}));
    return Promise.resolve(outcome.durable ?? outcome.saved).then(ok => {
      if (!destroyed && receipt === outcome.receipt) {
        storageWarning = ok ? '' : '접수는 완료되었지만 이 브라우저에 접수번호를 저장하지 못했습니다.';
        showWarnings();
      }
      if (!ok) throw new Error('접수는 완료되었지만 이 브라우저에 접수번호를 저장하지 못했습니다.');
    });
  }
  function preview() {
    syncEditors(form);
    dialog?.remove();
    dialog = el('dialog');
    dialog.className = 'draft-preview';
    dialog.setAttribute('aria-label','제출 전 미리보기');
    const back = actionButton('close','닫기');
    const heading = el('div'); heading.className = 'draft-head';
    heading.append(el('h2',value(form,'title') || '제목 미입력'), back);
    dialog.append(heading, el('p',[value(form,'proposer_name'), value(form,'department'),value(form,'category')].filter(Boolean).join(' · ')));
    for (const name of richFields) {
      const rich = el('div'); rich.className = 'rich-text-display'; rich.innerHTML = sanitizeHtml(value(form,name));
      dialog.append(el('h3', fieldLabels[name]), rich);
    }
    const facts = el('dl');
    const fact = (k,v) => facts.append(el('dt',k),el('dd',v));
    for (const name of ['cost_amount','proposer_effect_amount']) fact(fieldLabels[name], Number(value(form,name) || 0).toLocaleString('ko-KR') + '원');
    fact('실시현황',[value(form,'implementation_status'),value(form,'implemented_date')].filter(Boolean).join(' · '));
    fact('1차 자기평가',scoreNames.map((name,i) => scoreLabels[i]+' '+(value(form,name) || '–')).join(' · '));
    const selections = readImages();
    for (const side of sides) {
      const selection = selections?.[side];
      const names = [...(selection?.existing || []).map(f => f.name || '기존 사진'), ...(selection?.files || []).map(f => f.name)];
      fact(side === 'before' ? '개선 전 사진' : '개선 후 사진', names.join(', ') || '없음');
      const gallery = el('div');
      gallery.className = 'draft-photo-grid';
      for (const selected of form.querySelectorAll(`#${side}Preview .preview-item img`)) {
        const src = selected.getAttribute('src') || '';
        if (!/^(https?:|blob:|data:image\/(jpeg|png|webp);base64,)/i.test(src)) continue;
        const image = el('img');
        image.src = src;
        image.alt = selected.alt;
        gallery.append(image);
      }
      if (gallery.childElementCount) facts.lastElementChild.append(gallery);
    }
    dialog.append(facts);
    back.onclick = () => dialog.close();
    dialog.addEventListener('close',() => { dialog?.remove(); head.querySelector('button').focus(); },{once:true});
    doc.body.append(dialog); dialog.showModal(); back.focus();
  }
  function changed(event) {
    if (pending || restoring || initializing || receipt) return;
    if (event.target === form || event.target.closest?.('[data-rich-field]')) syncEditors(form);
    refreshProgress();
    dirty = true;
    clearTimeout(timer); timer = setTimeout(flush,350);
  }
  on(form, 'input', changed);
  on(form, 'change', changed);
  on(form, 'submit', event => {
    if (receipt || pending || restoring || initializing || (intakeClosed() && !canRetrySubmission())) { event.preventDefault(); event.stopImmediatePropagation(); }
    else void flush();
  }, true);
  on(panel,'click',event => {
    const button = event.target.closest('button');
    if (!button) return;
    const name = button.dataset.draftJump;
    if (name) {
      if (pending || receipt) return;
      let field = form.elements[name];
      if (richFields.includes(name)) field = form.querySelector(`[data-rich-field="${name}"]`) || field;
      if (name === 'consent') field = consentInput(form);
      if (name === 'department' || name === 'proposer_name') field = form.querySelector('#employeeSearchInput') || form.elements.proposer_name;
      field?.focus(); field?.scrollIntoView({block:'center'}); return;
    }
    if (initializing || restoring) return;
    switch(button.dataset.draftAction) {
      case 'switch':
        if (!dirty && !form.querySelector('[type=submit]')?.dataset.submitting && pin(button.dataset.request)) win.location.reload();
        break;
      case 'preview': preview(); break;
      case 'restore': void restore(); break;
      case 'discard': void clear(); break;
      case 'fresh': void clear().then(ok => { if (ok) win.location.reload(); }); break;
    }
  });
  function acceptExternalReceipt(otherId, otherReceipt) {
    if (otherId !== requestId || receipt || !otherReceipt?.proposal_no) return;
    clearTimeout(timer);
    pending = null;
    receipt = {proposal_no:String(otherReceipt.proposal_no)};
    status.textContent = '제출한 제안은 접수번호로 확인하세요.';
    recoveryPrompt();
  }
  on(win, 'hana-proposal-receipt', event => {
    if (event.detail?.key === key) acceptExternalReceipt(event.detail.requestId, event.detail.receipt);
  });
  on(win, 'storage', event => {
    if (event.key === checkpoint.retirementKey(requestId) && event.newValue) {
      storageWarning = '다른 창에서 이 임시저장을 폐기했습니다. 입력 내용을 복사한 뒤 새로고침하세요.';
      showWarnings();
    }
    if (event.key !== checkpoint.receiptKey(requestId) || !event.newValue) return;
    try {
      const entry = JSON.parse(event.newValue);
      acceptExternalReceipt(entry.requestId, entry.receipt);
    } catch { /* malformed entries cannot establish a receipt */ }
  });
  on(win,'pagehide',flush);
  on(doc,'visibilitychange',() => { if (doc.hidden) void flush(); });
  status.textContent = '이 브라우저의 임시저장 내용을 확인하고 있습니다.';
  recoveryPrompt(); refreshProgress();
  const ready = checkpoint.recover(preferred || saved?.requestId).then(async entry => {
    if (destroyed) return;
    status.textContent = '이 브라우저에 임시저장됩니다. 수정번호는 저장하지 않습니다.';
    if (entry) {
      requestId = entry.requestId;
      receipt = entry.receipt || null;
      if (!receipt) attempt = await checkpoint.readAttempt(requestId);
      if (destroyed) return;
      pending = !receipt ? attempt?.snapshot || (entry.fields ? entry : null) : null;
      if (receipt) manifest = entry.images || manifest;
      if (!entry.fields && !receipt) status.textContent = '이전 요청번호로 작성을 계속합니다.';
      wroteImages = !!entry.hasStoredPhotos || hasFiles(entry.images);
    }
    pin(requestId);
  }).finally(() => {
    initializing = false;
    if (!destroyed) recoveryPrompt();
  });
  async function ensureRequestDurable() {
    await ready;
    if (destroyed || restoring || receipt || pending) throw new Error('현재 임시저장 상태를 확인한 뒤 제출하세요.');
    const id = requestId;
    try {
      await checkpoint.ensure(id);
      if (!pin(id) && (await checkpoint.recover())?.requestId !== id) throw new Error(requestStorageError);
      if (destroyed || id !== requestId || receipt || restoring) throw new Error('작성 상태가 변경되었습니다. 다시 확인하세요.');
    } catch (error) {
      storageWarning = error.message;
      showWarnings();
      throw error;
    }
  }
  async function prepareSubmission(payload, beforeFiles, afterFiles) {
    // Capture the manuscript and photo manifest beside the validated payload,
    // before hashing files or waiting on a storage transaction yields to typing.
    void flush();
    const id = requestId;
    const snapshot = {requestId:id,sourceUpdatedAt:revision,...captureFields(form,sanitizeHtml),images:manifest,hasStoredPhotos:wroteImages};
    await ensureRequestDurable();
    const fingerprint = await submissionFingerprint(payload,beforeFiles,afterFiles);
    if (destroyed || id !== requestId || receipt || restoring) throw new Error('작성 상태가 변경되었습니다. 다시 확인하세요.');
    try {
      attempt = await checkpoint.prepare(id,fingerprint,snapshot,!intakeClosed());
      if (destroyed || id !== requestId || receipt || restoring) throw new Error('작성 상태가 변경되었습니다. 다시 확인하세요.');
      submissionWarning = '';
      recoveryPrompt();
    } catch (error) { submissionWarning = error.message; showWarnings(); throw error; }
  }
  return {
    ready, flush, clear, markSubmitted, ensureRequestDurable, prepareSubmission, canRetrySubmission,
    getRequestId:() => requestId, getReceipt:() => receipt, getSourceUpdatedAt:() => revision,
    destroy() {
      if (destroyed) return;
      void flush(); destroyed = true; events.abort(); dialog?.remove(); panel.remove();
    },
  };
}
