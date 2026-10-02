// Real PostgreSQL (PGlite), production Next server, local Supabase transport stub.
// Does not connect to any user's account or call the real OpenAI/Twilio APIs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import twilio from 'twilio';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'second-start-test-'));
const db = new PGlite();
let app, logs = '', aiCalls = 0, failAi = false;
const key = 'sb_secret_LOCAL_TEST_ONLY';
const token = 'TWILIO_LOCAL_TEST_ONLY';
let api, base;
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
const body = async req => { let value = ''; for await (const chunk of req) value += chunk; return value ? JSON.parse(value) : {}; };
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const transport = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/mock-openai') {
      const input = await body(req); aiCalls++;
      assert.equal(input.model, 'gpt-4.1-mini'); assert.equal(input.store, false);
      assert.equal(input.text.format.type, 'json_schema'); assert.equal(input.text.format.strict, true);
      assert.equal(JSON.parse(input.input).question.key, 'work_hours');
      if (failAi) return json(res, { error: 'mock unavailable' }, 429);
      return json(res, { output: [{ content: [{ type: 'output_text', text: JSON.stringify({ value: '08:00-15:00', explanation: 'School pickup hours' }) }] }] });
    }
    assert.equal(req.headers.apikey, key);
    assert.equal(req.headers.authorization, undefined, 'An opaque secret key is not a JWT');
    if (url.pathname === '/rest/v1/rpc/second_start_import_dataset') {
      const b = await body(req); return json(res, (await query('select public.second_start_import_dataset($1::jsonb,$2::text) as value', [JSON.stringify(b.p_dataset), b.p_version]))[0].value);
    }
    if (url.pathname === '/rest/v1/rpc/second_start_dataset') return json(res, (await query('select public.second_start_dataset() as value'))[0].value);
    if (url.pathname === '/rest/v1/rpc/second_start_open_session') {
      const b = await body(req); return json(res, (await query('select public.second_start_open_session($1::jsonb) as value', [JSON.stringify(b.p_candidate)]))[0].value);
    }
    if (url.pathname === '/rest/v1/rpc/second_start_save_answer') {
      const b = await body(req); return json(res, (await query('select public.second_start_save_answer($1::jsonb, $2::integer, $3::text, $4::jsonb) as value', [JSON.stringify(b.p_candidate), b.p_old_revision, b.p_event_id, JSON.stringify(b.p_response)]))[0].value);
    }
    if (url.pathname === '/rest/v1/second_start_events' && req.method === 'GET') {
      return json(res, await query('select response from public.second_start_events where id = $1 and candidate_id = $2 and expires_at > $3::timestamptz limit 1', [url.searchParams.get('id').slice(3), url.searchParams.get('candidate_id').slice(3), url.searchParams.get('expires_at').slice(3)]));
    }
    if (url.pathname === '/rest/v1/second_start_events' && req.method === 'POST') {
      const b = await body(req);
      await query('insert into public.second_start_events(id,candidate_id,response,expires_at) values ($1,$2,$3::jsonb,$4::timestamptz) on conflict(id) do update set response=excluded.response,expires_at=excluded.expires_at', [b.id, b.candidate_id, JSON.stringify(b.response), b.expires_at]);
      res.writeHead(204); return res.end();
    }
    json(res, { error: 'Unhandled test endpoint' }, 404);
  } catch (e) { json(res, { error: e.message }, 500); }
});
const waitReady = async () => {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (app.exitCode !== null) throw new Error(`Next exited: ${logs}`);
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Next didn't become ready: ${logs}`);
};
const stop = async () => { if (app && app.exitCode === null) { const done = once(app, 'exit'); app.kill('SIGTERM'); await done; } };
const start = async () => {
  app = spawn(process.execPath, ['--import', join(temp, 'fetch-shim.mjs'), join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', new URL(base).port], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', SUPABASE_URL: api, SUPABASE_SECRET_KEY: key, SUPABASE_SERVICE_ROLE_KEY: '', OPENAI_API_KEY: 'OPENAI_LOCAL_TEST_ONLY', OPENAI_MODEL: 'gpt-4.1-mini', TWILIO_AUTH_TOKEN: token, WHATSAPP_WEBHOOK_URL: base + '/api/whatsapp', GOOGLE_MAPS_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', chunk => { logs += chunk; }); app.stderr.on('data', chunk => { logs += chunk; });
  await waitReady();
};
const open = async cookie => {
  const response = await fetch(base + '/api/session', { headers: cookie ? { cookie } : {} }); assert.equal(response.status, 200);
  return { view: await response.json(), cookie: cookie || response.headers.get('set-cookie').split(';')[0] };
};
const answer = async (session, value, action, options = {}) => {
  const b = { answer: value, action, revision: session.view.candidate.revision, eventId: crypto.randomUUID(), ...options };
  const response = await fetch(base + '/api/session', { method: 'POST', headers: { cookie: session.cookie, origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const valueOut = await response.json(); if (response.ok) session.view = valueOut;
  return { status: response.status, body: valueOut, request: b };
};

try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const bootstrap = readFileSync(join(root, 'supabase/bootstrap.sql'), 'utf8');
  await db.exec(bootstrap); await db.exec(bootstrap);
  assert.equal((await query('select count(*)::integer as count from public.second_start_jobs'))[0].count, 60);
  assert.equal((await query('select count(*)::integer as count from public.second_start_neighborhoods'))[0].count, 10);
  assert.equal((await query("select count(*)::integer as count from pg_class where relname like 'second_start_%' and relkind = 'r' and relrowsecurity"))[0].count, 5);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(query('select * from public.second_start_candidates'), /permission denied/);
    await assert.rejects(query('select public.second_start_dataset()'), /permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  // Simulate pasting only the schema into Supabase, without a data download.
  await db.exec('delete from public.second_start_jobs; delete from public.second_start_neighborhoods; delete from public.second_start_metadata;');
  api = await listen(transport);
  const reserve = createServer(); base = await listen(reserve); await new Promise(resolve => reserve.close(resolve));
  writeFileSync(join(temp, 'fetch-shim.mjs'), `const original = globalThis.fetch; globalThis.fetch = (input, init) => { const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url; return original(url === 'https://api.openai.com/v1/responses' ? ${JSON.stringify(api + '/mock-openai')} : input, init); };`);
  await start();
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.jobs, 60); assert.equal(health.neighborhoods, 10); assert.equal(health.openaiConfigured, true);
  const html = await (await fetch(base)).text(); assert.match(html, /Second Start/); assert.doesNotMatch(html, /sb_secret_LOCAL_TEST_ONLY|OPENAI_LOCAL_TEST_ONLY/);
  const a = await open(), b = await open(); assert.notEqual(a.view.candidate.id, b.view.candidate.id);
  const foreign = await fetch(base + '/api/session', { method: 'POST', headers: { cookie: a.cookie, origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ answer: 'not_found', revision: 0, eventId: crypto.randomUUID() }) });
  assert.equal(foreign.status, 403, 'Cross-origin writes must be rejected');
  const first = await answer(a, 'not_found'); assert.equal(first.status, 200);
  assert.equal((await answer(a, first.request.answer, undefined, first.request)).body.candidate.revision, 1, 'Retry should not advance twice');
  assert.equal((await answer(a, 'teaching', undefined, { revision: 0 })).status, 409);
  assert.equal((await open(b.cookie)).view.candidate.home_status, null, 'Visitors must be isolated');
  for (const value of ['teaching', 'primary', 'not_sure', 'own_or_family', 'full_time', 'within_1_month']) assert.equal((await answer(a, value)).status, 200);
  assert.equal(a.view.question.key, 'work_hours');
  const natural = await answer(a, 'I can start at eight, but I need to finish by three for school pickup.');
  assert.equal(natural.status, 200); assert.equal(natural.body.ai, 'used'); assert.equal(natural.body.candidate.work_constraints.latest_finish, '15:00'); assert.equal(aiCalls, 1);
  const saved = (await open(a.cookie)).view; assert.equal(saved.candidate.work_constraints.latest_finish, '15:00');
  assert.equal((await answer(a, 'yes')).status, 200);
  for (const value of ['30', 'skip', '2', '110000']) assert.equal((await answer(a, value)).status, 200);
  assert.equal(a.view.question.key, 'choose_neighborhood'); assert.equal(a.view.areas[0].id, 'khalifa_city');
  assert.equal((await answer(a, 'khalifa_city', 'select_area')).status, 200); assert.ok(a.view.jobs.length > 0);
  await stop(); await start();
  assert.equal((await open(a.cookie)).view.candidate.home_neighborhood, 'khalifa_city', 'A new server process must resume Supabase data');
  const competing = await open(); const one = answer(competing, 'not_found'), two = answer(competing, 'found');
  const statuses = (await Promise.all([one, two])).map(x => x.status);
  assert.equal(statuses.filter(s => s === 200).length, 1, 'Only one answer should win a revision');
  assert.equal((await open(competing.cookie)).view.candidate.revision, 1);
  const c = await open();
  for (const value of ['not_found', 'teaching', 'primary', 'not_sure', 'own_or_family', 'full_time', 'within_1_month']) assert.equal((await answer(c, value)).status, 200);
  failAi = true; const failure = await answer(c, 'Please interpret these hours from my sentence.');
  assert.equal(failure.body.ai, 'fallback'); assert.equal(failure.body.question.key, 'work_hours');
  assert.equal((await answer(c, '08:00-15:00')).body.candidate.work_constraints.latest_finish, '15:00');
  const params = { From: 'whatsapp:+971500000001', MessageSid: 'SM' + 'a'.repeat(32), Body: 'not_found' };
  const phone = signature => fetch(base + '/api/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature }, body: new URLSearchParams(params).toString() });
  assert.equal((await phone('invalid')).status, 403);
  const signature = twilio.getExpectedTwilioSignature(token, base + '/api/whatsapp', params);
  const message = await phone(signature); assert.equal(message.status, 200); const xml = await message.text(); assert.match(xml, /<Message>/);
  assert.equal(await (await phone(signature)).text(), xml, 'Twilio retries should return the saved reply');
  console.log('PASS: PostgreSQL schema/seed, RLS/grants, production Next, private sessions, retries, revision conflict, process restart, Sarah journey, mocked AI success/fallback, signed optional WhatsApp.');
} finally {
  await stop(); await new Promise(resolve => transport.close(resolve)); await db.close(); rmSync(temp, { recursive: true, force: true });
}
