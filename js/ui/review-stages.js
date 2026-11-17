/** V2.9.12: read-only public review-stage projection. No approval or scoring writes. */
const finalResults = new Set(['채택', '미채택', '보류', '중복제안', '건수처리']);
const str = value => String(value ?? '').trim();
const score = value => (typeof value === 'number' || typeof value === 'string') && str(value) !== '' &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
const fields = ['proposal_no', 'review_result', 'implementation_status', 'approval_required', 'score', 'award_grade',
  'payment_status', 'ceo_submission_status', 'first_evaluation_total', 'first_evaluation_completed_at',
  'legacy_first_evaluation_exempt', 'team_leader_evaluation_total', 'team_leader_evaluation_completed_at',
  'team_leader_evaluation_by_name', 'second_evaluation_total', 'second_evaluation_completed_at',
  'second_evaluation_by_name', 'third_review_mode', 'legacy_score_revision', 'legacy_score_registered_at',
  'legacy_result_revision', 'legacy_result_corrected_at'];
function publicFields(row) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}
function date(value) {
  if (!str(value) || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(str(value))) return '';
  const d = new Date(value); if (!Number.isFinite(d.valueOf())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replaceAll('-', '.');
}
function stage(label, value, status = '', tone = 'muted', note = '', at = null, by = '', dateLabel = '평가일') {
  return { label, value, status, tone, note, date: date(at), by: str(by), dateLabel };
}
export function reviewStages(p = {}) {
  const a = score(p.first_evaluation_total), b = score(p.team_leader_evaluation_total), c = score(p.second_evaluation_total);
  const rawResult = str(p.review_result) || '미심사', final = finalResults.has(rawResult);
  const thirdRecorded = c !== null || !!str(p.second_evaluation_completed_at);
  const protectedResult = p.payment_status === '완료' || ['상신완료', '승인완료'].includes(p.ceo_submission_status);
  const countCandidate = !thirdRecorded && !protectedResult && b !== null && b >= 50 && b < 65 &&
    (rawResult === '미심사' || rawResult === '건수처리' || (['미채택', '채택'].includes(rawResult) && p.award_grade === '건수처리'));
  const legacy = p.approval_required === false && final && !countCandidate;
  function early(number, total, key, at, by, later) {
    const label = number === 1 ? '1차 본인평가' : '2차 팀장평가';
    if (total !== null) return stage(label, `${total}점`, total < 50 ? '기준미달' : number === 2 && total < 65 ? '건수처리 후보' : '평가완료',
      total < 50 ? 'danger' : number === 2 && total < 65 ? 'warn' : 'ok',
      number === 2 && total >= 50 && total < 65 ? '최종결과와 별도' : '', at, by);
    if (number === 1 && p.legacy_first_evaluation_exempt === true) return stage(label, '기존건 면제', '명시된 면제 기록', 'muted');
    if (!Object.hasOwn(p, key)) return stage(label, '조회 정보 없음', '공개자료 확인 필요', 'warn');
    if (p[key] != null && str(p[key]) !== '') return stage(label, '점수 확인', '저장값 확인 필요', 'danger');
    if (str(at)) return stage(label, '평가기록 있음', '총점 미기록', 'warn', '', at, by);
    if (legacy || later) return stage(label, '기록 없음', '점수를 임의 생성하지 않음');
    if (number === 2 && (a !== null && a >= 50 || p.legacy_first_evaluation_exempt === true)) return stage(label, '평가 대기', '팀장평가 미입력', 'warn');
    return stage(label, '미평가', number === 1 ? '본인평가 미입력' : '1차 평가 후 진행', 'muted');
  }
  const first = early(1, a, 'first_evaluation_total', p.first_evaluation_completed_at, '', b !== null || thirdRecorded);
  const team = early(2, b, 'team_leader_evaluation_total', p.team_leader_evaluation_completed_at, p.team_leader_evaluation_by_name, thirdRecorded);
  let third;
  if (Number(p.legacy_result_revision) > 0) {
    third = stage('3차 심사위원', '과거 결과 정정', '결과만 정정', 'legacy', score(p.score) !== null ? `기존 ${score(p.score)}점 보존` : '신규 점수평가 아님', p.legacy_result_corrected_at, '', '정정일');
  } else if (score(p.score) !== null && ((Number(p.legacy_score_revision) > 0 && str(p.legacy_score_registered_at)) || p.approval_required === false && !thirdRecorded)) {
    third = stage('3차 심사위원', `${score(p.score)}점`, '기존 심사점수', 'legacy', '과거 총점 · 신규 3차와 별도', p.legacy_score_registered_at, '', '등록일');
  } else if (p.third_review_mode === 'outcome') {
    third = stage('3차 심사위원', '결과심사', str(p.second_evaluation_completed_at) && final ? '심사완료' : '완료 기록 확인', 'ok',
      c !== null ? `이전 3차 ${c}점 보존` : '점수 입력 없는 결과심사', p.second_evaluation_completed_at, p.second_evaluation_by_name);
  } else if (c !== null) {
    third = stage('3차 심사위원', `${c}점`, final ? '평가완료' : '결과 미확정', final ? 'ok' : 'warn', '', p.second_evaluation_completed_at, p.second_evaluation_by_name);
  } else if (p.second_evaluation_total != null && str(p.second_evaluation_total) !== '') {
    third = stage('3차 심사위원', '점수 확인', '저장값 확인 필요', 'danger');
  } else if (str(p.second_evaluation_completed_at)) {
    third = stage('3차 심사위원', '심사기록 있음', '총점 미기록', 'warn', '', p.second_evaluation_completed_at, p.second_evaluation_by_name);
  } else if (legacy || final && !countCandidate) {
    third = stage('3차 심사위원', '기록 없음', '최종결과만 등록', 'muted');
  } else if (!Object.hasOwn(p, 'second_evaluation_total')) {
    third = stage('3차 심사위원', '조회 정보 없음', '공개자료 확인 필요', 'warn');
  } else {
    third = stage('3차 심사위원', '미평가', b !== null && b >= 50 ? '3차·임원 결재 확인' : '선행 평가 후 진행', 'muted');
  }
  let progress = '1차 본인평가 확인';
  if (final && !countCandidate) progress = legacy && !thirdRecorded ? '과거 심사결과 · 단계별 기록 별도' : '최종결과 등록 · 결재/지급 별도';
  else if (thirdRecorded) progress = '3차 평가기록 있음 · 최종결과 미확정';
  else if (b !== null) progress = b >= 50 ? '3차 미평가 · 임원 결재 별도 확인' : '2차 기준미달 · 보완 확인';
  else if (a !== null && a >= 50 || p.legacy_first_evaluation_exempt === true) progress = '2차 팀장평가 대기';
  else if (a !== null && a < 50) progress = '1차 기준미달 · 보완 확인';
  return { stages: [first, team, third], result: countCandidate ? '미확정' : rawResult,
    resultNote: countCandidate ? '건수처리 후보 · 3차 심사 전' : '', progress };
}

/** Batch public reads; older RPC projections fall back to the app's paged public read. */
export function createReviewSource({ config = globalThis.window?.APP_CONFIG, fetcher = globalThis.fetch,
  readDemo = () => JSON.parse(globalThis.localStorage.getItem('proposal-system:v1:proposals') || '[]') } = {}) {
  const cache = new Map(), requests = new Set(); let disposed = false, snapshot = null, allReady = false;
  const live = !!(config && !config.demoMode && config.supabaseUrl && !config.supabaseUrl.includes('YOUR_PROJECT_REF') && config.supabaseAnonKey && !config.supabaseAnonKey.includes('YOUR_'));
  function endpoint() {
    const url = new URL('/rest/v1/rpc/get_public_proposals_v258', config.supabaseUrl);
    if (url.protocol !== 'https:') throw new Error('심사자료 조회 주소를 확인하세요.');
    return url;
  }
  async function request(url) {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Read-only public RPC, never private tables, auth-session changes or scoring mutations.
      const response = await fetcher(url.href, { method: 'POST', headers: { apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`, 'Content-Type': 'application/json', Prefer: 'count=exact' }, body: '{}', signal: controller.signal });
      if (disposed) throw new Error('목록 조회가 종료되었습니다.');
      if (!response.ok) return { status: response.status, rows: null };
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('심사자료 조회 응답을 확인할 수 없습니다.');
      const range = response.headers?.get('Content-Range') || '', match = range.match(/\/(\d+)$/);
      return { status: response.status || 200, rows, count: match ? Number(match[1]) : null };
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  function collect(rows, target, allowed = null) {
    for (const row of rows) {
      const id = str(row?.proposal_no);
      if (!id || allowed && !allowed.includes(id)) throw new Error('심사자료 조회 범위가 다릅니다.');
      if (target.has(id)) throw new Error('접수번호가 중복되어 심사자료를 표시하지 않았습니다.');
      target.set(id, publicFields(row));
    }
  }
  async function scanAll() {
    if (snapshot) return snapshot;
    snapshot = (async () => {
      const full = new Map(); let expected = null;
      for (let page = 0; page < 200; page++) {
        const url = endpoint(); url.searchParams.set('offset', String(full.size)); url.searchParams.set('limit', '500');
        const result = await request(url);
        if (!result.rows) throw new Error('심사자료 조회 실패 · 다시 조회하세요.');
        if (result.count !== null) {
          if (expected !== null && expected !== result.count) throw new Error('조회 중 자료가 변경되었습니다.');
          expected = result.count;
        }
        collect(result.rows, full);
        if (expected !== null && full.size > expected) throw new Error('심사자료 건수가 변경되었습니다.');
        if (!result.rows.length || expected !== null && full.size === expected) {
          if (expected !== null && full.size !== expected) throw new Error('일부 심사자료를 조회하지 못했습니다.');
          if (disposed) throw new Error('목록 조회가 종료되었습니다.');
          for (const [id, row] of full) cache.set(id, row);
          allReady = true; return;
        }
      }
      throw new Error('전체 심사자료 조회 범위를 초과했습니다.');
    })();
    try { await snapshot; } catch (error) { snapshot = null; throw error; }
  }
  return {
    async load(numbers) {
      if (disposed) throw new Error('목록 조회가 종료되었습니다.');
      const ids = [...new Set(numbers.map(str).filter(Boolean))];
      if (ids.length > 100) throw new Error('한 번에 100건까지 심사자료를 표시합니다.');
      if (snapshot) await snapshot;
      const missing = ids.filter(id => !cache.has(id));
      if (missing.length && !allReady) {
        let rows;
        if (!live) rows = readDemo().filter(row => missing.includes(str(row.proposal_no)));
        else {
          const url = endpoint();
          url.searchParams.set('proposal_no', `in.(${missing.map(id => JSON.stringify(id)).join(',')})`);
          url.searchParams.set('limit', String(missing.length + 1));
          const result = await request(url);
          // Some older SETOF JSON projections cannot filter individual JSON fields.
          // Fall back only within the SAME public RPC; permission errors remain errors.
          if (result.status === 400 || result.rows?.some(row => !missing.includes(str(row?.proposal_no)))) {
            await scanAll(); rows = [];
          } else {
            if (!result.rows) throw new Error('심사자료 조회 실패 · 다시 조회하세요.');
            rows = result.rows;
          }
        }
        if (disposed) throw new Error('목록 조회가 종료되었습니다.');
        if (!Array.isArray(rows)) throw new Error('심사자료 조회 응답을 확인할 수 없습니다.');
        const received = new Map(); collect(rows, received, missing);
        for (const [id, row] of received) cache.set(id, row);
      }
      return new Map(ids.filter(id => cache.has(id)).map(id => [id, cache.get(id)]));
    },
    dispose() { disposed = true; for (const controller of requests) controller.abort(); requests.clear(); cache.clear(); }
  };
}
