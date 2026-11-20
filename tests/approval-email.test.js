import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the deployed handler with only its external boundaries replaced. These
// two scalar annotations are the only TypeScript syntax in the worker; its npm
// import is supplied by the in-memory database, so this suite has no network I/O.
const workerSource = readFileSync(new URL('../supabase/functions/approval-email/index.ts', import.meta.url), 'utf8')
  .replace(/^import \{ createClient \} from "npm:@supabase\/supabase-js@2";\n/m, '')
  .replace('(value: unknown)', '(value)')
  .replace('(type: string)', '(type)');

const member = (id, overrides = {}) => ({
  proposal_id: id,
  proposal_no: `P-${id}`,
  title: `Proposal ${id}`,
  department: '생산부',
  proposer_name: `Proposer ${id}`,
  actionable_at: '2026-01-01T00:00:00+00:00',
  pending_days: 8,
  ...overrides,
});

const notification = (overrides = {}) => ({
  id: 91,
  proposal_id: null,
  step_id: 6,
  recipient_email: 'ceo@example.test',
  recipient_name: '대표이사',
  notification_type: 'ceo_reminder_7d',
  status: 'pending',
  attempts: 0,
  ceo_batch_id: null,
  available_at: '2020-01-01T00:00:00.000Z',
  created_at: '2020-01-01T00:00:00.000Z',
  proposals: null,
  approval_steps: { role_name: '대표이사', step_order: 6 },
  ...overrides,
});

function createHarness(options = {}) {
  const state = {
    queue: structuredClone(options.queue ?? [notification()]),
    assignments: structuredClone(options.assignments ?? [{ id: 5, step_id: 6, email: 'ceo@example.test', department: null, active: true }]),
    approvals: structuredClone(options.approvals ?? []),
    proposals: structuredClone(options.proposals ?? []),
    rpcCalls: [],
    requests: [],
    queries: [],
  };
  const tables = {
    proposal_notification_queue: state.queue,
    approval_assignments: state.assignments,
    approval_records: state.approvals,
    proposals: state.proposals,
  };

  class Query {
    constructor(table) {
      assert.ok(table in tables, `Unexpected database table: ${table}`);
      this.table = table;
      this.filters = [];
    }
    select() { return this; }
    update(values) { this.values = values; return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    lte(key, value) { this.filters.push(row => row[key] <= value); return this; }
    order(key, options) { this.sort = { key, ascending: options?.ascending !== false }; return this; }
    limit(count) { this.count = count; return this; }
    async execute(single = false) {
      state.queries.push({ table: this.table, update: this.values ?? null });
      let rows = tables[this.table].filter(row => this.filters.every(filter => filter(row)));
      if (this.sort) {
        const { key, ascending } = this.sort;
        rows.sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * (ascending ? 1 : -1));
      }
      if (this.count !== undefined) rows = rows.slice(0, this.count);
      if (this.values) {
        if (options.updateError?.(this.values)) return { data: null, error: { message: 'Queue write failed' } };
        rows.forEach(row => Object.assign(row, structuredClone(this.values)));
      }
      const data = structuredClone(rows);
      return { data: single ? data[0] ?? null : data, error: null };
    }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }

  const supabase = {
    from: table => new Query(table),
    async rpc(name, args) {
      assert.equal(name, 'v2916_get_ceo_reminder_items');
      assert.deepEqual(Object.keys(args), ['p_notification_id']);
      state.rpcCalls.push({ name, id: args.p_notification_id, status: state.queue.find(row => row.id === args.p_notification_id)?.status });
      return options.rpcResult ? await options.rpcResult(state, args) : { data: structuredClone(options.members ?? [member(1)]), error: null };
    },
  };
  let handler;
  const secrets = {
    SUPABASE_URL: 'https://database.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    RESEND_API_KEY: 'fake-resend-key',
    RESEND_FROM_EMAIL: 'system@example.test',
    APPROVAL_EMAIL_HOOK_SECRET: 'fake-hook-secret',
    SITE_URL: 'https://site.example.test/',
    ...options.secrets,
  };
  vm.runInNewContext(workerSource, {
    createClient: () => supabase,
    Deno: { env: { get: key => secrets[key] }, serve: fn => { handler = fn; } },
    Request,
    Response,
    async fetch(url, init) {
      assert.equal(url, 'https://api.resend.com/emails');
      state.requests.push({ url, ...init, payload: JSON.parse(init.body) });
      return options.fetchResult ? await options.fetchResult(state.requests.length) : new Response('{"id":"test-only"}', { status: 200 });
    },
  }, { filename: 'approval-email/index.ts' });

  return {
    state,
    invoke: (requestOptions = {}) => handler(new Request('https://worker.example.test', {
      method: 'POST',
      headers: { 'x-approval-hook-secret': 'fake-hook-secret' },
      ...requestOptions,
    })),
  };
}

test('one claimed CEO digest sends all 25 eligible members in one email', async () => {
  const harness = createHarness({ members: Array.from({ length: 25 }, (_, i) => member(i + 1)) });
  const response = await harness.invoke();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, sent: 1, failed: 0, cancelled: 0, uncertain: 0 });
  assert.equal(harness.state.requests.length, 1);
  const { payload, headers } = harness.state.requests[0];
  assert.equal(payload.subject, '[하나금속 제안관리] 대표이사 미결재 제안 25건 안내');
  assert.deepEqual(payload.to, ['ceo@example.test']);
  assert.equal(headers['Idempotency-Key'], 'hana-proposal/91/ceo_reminder_7d');
  assert.equal((payload.html.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) ?? []).length, 25);
  assert.match(payload.html, /Proposal 25/);
  assert.match(payload.html, /https:\/\/site\.example\.test\/#admin\/inbox/);
  assert.match(payload.html, /상신일/);
  assert.match(payload.html, /대기일/);
  assert.match(payload.html, /7일/);
  assert.match(payload.html, /대기 기간.*1회/);
  assert.equal(harness.state.queue[0].status, 'sent');
  assert.ok(harness.state.queue[0].sent_at);
  assert.equal(harness.state.queue[0].digest_sent_items.length, 25);
  assert.deepEqual(harness.state.queue[0].digest_sent_items[24], { proposal_id: 25, actionable_at: '2026-01-01T00:00:00+00:00' });
  assert.deepEqual(harness.state.rpcCalls, [{ name: 'v2916_get_ceo_reminder_items', id: 91, status: 'sending' }]);
});

test('fresh RPC members determine the payload and sent history after approval changes', async () => {
  const harness = createHarness({
    queue: [notification({ digest_items: [{ proposal_id: 1, actionable_at: '2026-01-01T00:00:00+00:00' }, { proposal_id: 2, actionable_at: '2026-01-01T00:00:00.123456+00:00' }] })],
    members: [member(2, { actionable_at: '2026-01-01T00:00:00.123456+00:00' })],
  });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  assert.doesNotMatch(harness.state.requests[0].payload.html, /Proposal 1</);
  assert.match(harness.state.requests[0].payload.html, /Proposal 2</);
  assert.deepEqual(harness.state.queue[0].digest_sent_items, [{ proposal_id: 2, actionable_at: '2026-01-01T00:00:00.123456+00:00' }]);
});

test('empty revalidated digest cancels without making an email request', async () => {
  const harness = createHarness({ members: [] });
  const response = await harness.invoke();
  assert.deepEqual(await response.json(), { processed: 1, sent: 0, failed: 0, cancelled: 1, uncertain: 0 });
  assert.equal(harness.state.requests.length, 0);
  assert.equal(harness.state.queue[0].status, 'cancelled');
  assert.equal(harness.state.queue[0].sent_at, undefined);
});

test('RPC errors fail the queue row instead of cancelling it as an empty digest', async () => {
  const harness = createHarness({ rpcResult: () => ({ data: null, error: { message: 'Revalidation unavailable' } }) });
  const response = await harness.invoke();
  assert.deepEqual(await response.json(), { processed: 1, sent: 0, failed: 1, cancelled: 0, uncertain: 0 });
  assert.equal(harness.state.requests.length, 0);
  assert.equal(harness.state.queue[0].status, 'failed');
  assert.match(harness.state.queue[0].last_error, /Revalidation unavailable/);
});

test('malformed RPC response fails closed without sending', async () => {
  const harness = createHarness({ rpcResult: () => ({ data: null, error: null }) });
  await harness.invoke();
  assert.equal(harness.state.rpcCalls.length, 1);
  assert.equal(harness.state.requests.length, 0);
  assert.equal(harness.state.queue[0].status, 'failed');
  assert.match(harness.state.queue[0].last_error, /형식/);
});

test('digest HTML escapes every user-controlled text field', async () => {
  const input = `<script>"'&`;
  const escaped = '&lt;script&gt;&quot;&#039;&amp;';
  const harness = createHarness({
    queue: [notification({ recipient_name: input })],
    members: [member(1, { proposal_no: input, title: input, department: input, proposer_name: input, pending_days: input })],
  });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  const { html } = harness.state.requests[0].payload;
  assert.doesNotMatch(html, /<script>/);
  assert.equal(html.split(escaped).length - 1, 6);
});

test('two overlapping worker invocations claim a digest once', async () => {
  const harness = createHarness();
  await Promise.all([harness.invoke(), harness.invoke()]);
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.rpcCalls.length, 1);
  assert.equal(harness.state.queue[0].attempts, 1);
});

test('an explicit provider 429 rejection keeps the queue ID and idempotency key for retry', async () => {
  const harness = createHarness({ fetchResult: number => new Response(number === 1 ? 'Rate limit exceeded' : '{}', { status: number === 1 ? 429 : 200 }) });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.queue[0].status, 'failed');
  assert.equal(harness.state.queue[0].digest_sent_items, undefined);
  assert.match(harness.state.queue[0].last_error, /429/);
  harness.state.queue[0].status = 'pending';
  await harness.invoke();
  assert.equal(harness.state.queue[0].id, 91);
  assert.equal(harness.state.queue[0].status, 'sent');
  assert.equal(harness.state.queue[0].attempts, 2);
  assert.deepEqual(harness.state.requests.map(request => request.headers['Idempotency-Key']), ['hana-proposal/91/ceo_reminder_7d', 'hana-proposal/91/ceo_reminder_7d']);
});

test('a provider-accepted email with a failed sent-history write cannot be retried by the worker', async () => {
  const harness = createHarness({ updateError: values => values.status === 'sent' });
  const response = await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.queue[0].status, 'sending');
  assert.match(harness.state.queue[0].last_error, /^발송 확인 필요:/);
  assert.match(harness.state.queue[0].last_error, /Queue write failed/);
  assert.deepEqual(await response.json(), { processed: 1, sent: 0, failed: 0, cancelled: 0, uncertain: 1 });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.queue[0].attempts, 1);
});

test('a connection error after provider acceptance holds the digest for verification without retry', async () => {
  let acceptedCount = 0;
  const harness = createHarness({ fetchResult: () => {
    acceptedCount += 1;
    throw new Error('Connection closed after provider acceptance');
  } });
  const response = await harness.invoke();
  assert.equal(acceptedCount, 1);
  assert.equal(harness.state.queue[0].status, 'sending');
  assert.match(harness.state.queue[0].last_error, /^발송 확인 필요:/);
  assert.equal((await response.json()).uncertain, 1);
  await harness.invoke();
  assert.equal(acceptedCount, 1);
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.queue[0].attempts, 1);
});

test('a successful provider response with a body read failure cannot trigger another delivery', async () => {
  const harness = createHarness({ fetchResult: () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('Response body stream failed')); },
  }), { status: 200 }) });
  await harness.invoke();
  assert.equal(harness.state.queue[0].status, 'sending');
  assert.match(harness.state.queue[0].last_error, /^발송 확인 필요:/);
  assert.match(harness.state.queue[0].last_error, /Response body stream failed/);
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
});

for (const outcome of ['empty', 'rpc_error', 'accepted', 'unknown']) {
  test(`digest ${outcome} completion cannot overwrite a row whose sending claim has ended`, async () => {
    const endClaim = state => {
      state.queue[0].status = 'cancelled';
      state.queue[0].last_error = 'Changed by another owner';
    };
    const harness = createHarness({
      rpcResult: state => {
        if (outcome === 'empty' || outcome === 'rpc_error') endClaim(state);
        return { data: outcome === 'empty' ? [] : [member(1)], error: outcome === 'rpc_error' ? { message: 'RPC failed' } : null };
      },
      fetchResult: () => {
        endClaim(harness.state);
        if (outcome === 'unknown') throw new Error('Unknown provider outcome');
        return new Response('{}', { status: 200 });
      },
    });
    await harness.invoke();
    assert.equal(harness.state.queue[0].status, 'cancelled');
    assert.equal(harness.state.queue[0].last_error, 'Changed by another owner');
  });
}

test('legacy CEO day-one, day-three and day-seven individual reminders are cancelled', async () => {
  const harness = createHarness({
    queue: ['reminder_1d', 'reminder_3d', 'reminder_7d'].map((type, index) => notification({ id: 101 + index, proposal_id: 1, notification_type: type })),
    approvals: [{ proposal_id: 1, step_id: 6, status: '대기', actionable_at: '2026-01-01T00:00:00.000Z' }],
  });
  const response = await harness.invoke();
  assert.deepEqual(await response.json(), { processed: 3, sent: 0, failed: 0, cancelled: 3, uncertain: 0 });
  assert.equal(harness.state.requests.length, 0);
  assert.ok(harness.state.queue.every(row => row.status === 'cancelled'));
});

test('CEO-step admin escalation skips the current CEO but still reaches other admins', async () => {
  const harness = createHarness({
    queue: [notification({ id: 201, proposal_id: 1, notification_type: 'admin_7d', recipient_email: 'CEO@EXAMPLE.TEST' }), notification({ id: 202, proposal_id: 1, notification_type: 'admin_7d', recipient_email: 'admin@example.test' })],
    approvals: [{ proposal_id: 1, step_id: 6, status: '대기', actionable_at: '2026-01-01T00:00:00.000Z' }],
  });
  const response = await harness.invoke();
  assert.deepEqual(await response.json(), { processed: 2, sent: 1, failed: 0, cancelled: 1, uncertain: 0 });
  assert.equal(harness.state.requests.length, 1);
  assert.deepEqual(harness.state.requests[0].payload.to, ['admin@example.test']);
  assert.equal(harness.state.queue[0].status, 'cancelled');
  assert.equal(harness.state.queue[1].status, 'sent');
});

test('a whitespace-only department still identifies the global CEO for admin escalation suppression', async () => {
  const harness = createHarness({
    queue: [notification({ proposal_id: 1, notification_type: 'admin_7d' })],
    assignments: [{ id: 5, step_id: 6, email: 'ceo@example.test', department: '   ', active: true }],
    approvals: [{ proposal_id: 1, step_id: 6, status: '대기', actionable_at: '2026-01-01T00:00:00.000Z' }],
  });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 0);
  assert.equal(harness.state.queue[0].status, 'cancelled');
});

test('non-CEO reminders retain individual delivery and proposal links', async () => {
  const harness = createHarness({
    queue: ['reminder_1d', 'reminder_3d', 'reminder_7d'].map((type, index) => notification({ id: 301 + index, proposal_id: 5, step_id: 2, notification_type: type, recipient_email: 'reviewer@example.test', approval_steps: { role_name: '부서장', step_order: 2 }, proposals: { proposal_no: 'P-5', title: 'Existing proposal', department: '생산부', proposer_name: '제안자' } })),
    assignments: [{ id: 4, step_id: 2, email: 'reviewer@example.test', department: '생산부', active: true }],
    approvals: [{ proposal_id: 5, step_id: 2, status: '대기', actionable_at: '2026-01-01T00:00:00.000Z' }],
  });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 3);
  assert.equal(harness.state.rpcCalls.length, 0);
  assert.ok(harness.state.requests.every(request => request.payload.html.includes('/#admin/review/5')));
  assert.ok(harness.state.queue.every(row => row.status === 'sent'));
});

test('first CEO submission keeps its original batch subject, payload and idempotency key', async () => {
  const harness = createHarness({
    queue: [notification({ proposal_id: 1, notification_type: 'ceo_batch', ceo_batch_id: 'batch-1' })],
    proposals: [1, 2].map(id => ({ id, proposal_no: `P-${id}`, title: `Original ${id}`, department: '생산부', proposer_name: '제안자', review_result: '승인', score: 90, award_amount: 0, proposer_effect_amount: 0, effect_amount: 0, ceo_batch_id: 'batch-1', ceo_submission_status: '상신완료' })),
  });
  await harness.invoke();
  assert.equal(harness.state.requests.length, 1);
  assert.equal(harness.state.requests[0].payload.subject, '[하나금속 제안관리] 대표이사 결재 2건이 상신되었습니다.');
  assert.equal(harness.state.requests[0].headers['Idempotency-Key'], 'hana-proposal/91/ceo_batch');
  assert.match(harness.state.requests[0].payload.html, /Original 1/);
  assert.match(harness.state.requests[0].payload.html, /Original 2/);
  assert.equal(harness.state.rpcCalls.length, 0);
  assert.equal(harness.state.queue[0].digest_sent_items, undefined);
});

test('the existing hook secret still protects the worker before any database or email access', async () => {
  const harness = createHarness();
  const response = await harness.invoke({ headers: { 'x-approval-hook-secret': 'wrong' } });
  assert.equal(response.status, 401);
  assert.equal(harness.state.queries.length, 0);
  assert.equal(harness.state.rpcCalls.length, 0);
  assert.equal(harness.state.requests.length, 0);
});
