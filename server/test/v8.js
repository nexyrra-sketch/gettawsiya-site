'use strict';
/* v8: cost tracking, admin settings, monthly budget guard, model fallbacks, new plan defaults.
   Needs: server with mock env (/tmp/env6.sh) and test/mock.js running, on a clean database. */
const BASE = process.env.BASE || 'http://localhost:8812', MOCK = 'http://127.0.0.1:9900';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Client {
  constructor() { this.cookies = {}; }
  async req(method, path, body) {
    const h = { 'Content-Type': 'application/json' };
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); if (ck) h.Cookie = ck;
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t };
  }
}
const waitFor = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(600); } return null; };
const mock = async (p) => (await fetch(MOCK + p)).json();

(async () => {
  const admin = new Client(), anon = new Client();
  await admin.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  console.log('plans and home page');
  let r = await anon.req('GET', '/api/plans'); const P = (k) => r.json.plans.find((p) => p.key === k);
  ok(P('track').price === 199 && P('grow').price === 799 && P('free').price === 0, 'plan prices 0 / 199 / 799');
  r = await anon.req('GET', '/en/'); ok(r.status === 200 && /data-plan-price="grow">799</.test(r.text) && /v9-hero/.test(r.text) && !/2,800|3,500/.test(r.text), 'home shows the same plans, no old prices');
  r = await anon.req('GET', '/'); ok(r.status === 200 && /data-plan-price="track">199</.test(r.text) && /lang="ar"/.test(r.text), 'Arabic home shows the plans');

  console.log('settings');
  r = await anon.req('GET', '/api/admin/money'); ok(r.status === 401 || r.status === 403, 'money needs admin');
  r = await admin.req('GET', '/api/admin/money'); ok(r.status === 200 && r.json.free_per_day === 10 && r.json.budget === 300 && r.json.unit.length === 3, 'money defaults (10 free a day, AED 300 budget)');
  const grow = r.json.unit.find((u) => u.key === 'grow'), track = r.json.unit.find((u) => u.key === 'track');
  ok(track.left > 150 && track.left < 199 && grow.left > 650 && grow.left_min > 500 && grow.fee > 20, 'each plan leaves a healthy margin (track ' + track.left + ', grow ' + grow.left + ')');
  r = await admin.req('PUT', '/api/admin/settings', { free_per_day: 'abc' }); ok(r.status === 400, 'bad setting rejected');
  r = await admin.req('PUT', '/api/admin/settings', { model_openai: 'bad model; drop' }); ok(r.status === 400, 'bad model name rejected');
  r = await admin.req('PUT', '/api/admin/settings', { free_per_day: 7, fixed_costs_aed: 80, model_openai: 'retired-x' }); ok(r.status === 200, 'settings saved');
  r = await admin.req('GET', '/api/admin/money'); ok(r.json.free_per_day === 7 && r.json.fixed === 80 && r.json.models.find((m) => m.key === 'openai').chosen === 'retired-x', 'settings applied without a restart');

  console.log('model fallback + cost');
  await mock('/_nosearch?v=1');
  r = await admin.req('POST', '/api/admin/scans', { site: 'glow.test', lang: 'en' }); ok(r.status === 200, 'scan started');
  const sid = r.json.id;
  const done = await waitFor(async () => { const x = await admin.req('GET', '/api/admin/scans'); const row = x.json.items.find((i) => i.id === sid); return row && row.overall != null ? row : null; });
  ok(!!done, 'scan finished');
  const log = await mock('/_log');
  ok(log.retired >= 1 && log.models && log.models.openai === 'gpt-6-luna', 'retired OpenAI model fell back to ' + (log.models && log.models.openai));
  ok(log.agent >= 5, 'Perplexity used the Agent API');
  r = await admin.req('GET', '/api/admin/money');
  const ai = (n) => r.json.by_ai.find((a) => a.assistant === n);
  ok(r.json.ai > 0 && r.json.ai < 5 && r.json.by_ai.length === 4, 'scan cost recorded: AED ' + r.json.ai);
  ok(ai('Gemini') && ai('Gemini').searched === false && ai('ChatGPT').searched === true, 'Gemini answered without web search when grounding is unavailable');
  ok(ai('ChatGPT').model === 'gpt-6-luna' && ai('Perplexity').model === 'perplexity/sonar' && ai('Perplexity').aed > 0, 'model in use and cost per assistant');
  ok(r.json.models.find((m) => m.key === 'openai').in_use === 'gpt-6-luna', 'admin sees the model actually in use');
  await mock('/_nosearch?v=0');
  await admin.req('PUT', '/api/admin/settings', { model_openai: '' });

  console.log('budget guard');
  for (const site of ['mondri.test', 'glow.test']) {   /* spend a little more so the month passes AED 1 */
    const x = await admin.req('POST', '/api/admin/scans', { site, lang: 'en' });
    await waitFor(async () => { const y = await admin.req('GET', '/api/admin/scans'); const row = y.json.items.find((i) => i.id === x.json.id); return row && row.overall != null ? row : null; });
  }
  r = await admin.req('PUT', '/api/admin/settings', { ai_budget_aed: 1 }); ok(r.status === 200, 'tiny budget set');
  r = await admin.req('GET', '/api/admin/money'); ok(r.json.paused === true, 'money tab says free reports are paused');
  r = await anon.req('POST', '/api/score-requests', { site: 'mondri.test', consent: true, lang: 'en' }); ok(r.status === 200 && r.json.token, 'public request accepted');
  const tok = r.json.token;
  const held = await waitFor(async () => { const x = await anon.req('GET', '/api/scan/' + tok); return x.json && x.json.stage === 'held' ? x.json : null; }, 30000);
  ok(!!held, 'free report held while over budget');
  const before = (await mock('/_log')).ai.length;
  r = await admin.req('POST', '/api/admin/scans', { site: 'mondri.test', lang: 'en' });
  const s2 = r.json.id;
  const d2 = await waitFor(async () => { const x = await admin.req('GET', '/api/admin/scans'); const row = x.json.items.find((i) => i.id === s2); return row && row.overall != null ? row : null; });
  ok(!!d2 && (await mock('/_log')).ai.length > before, 'admin scans still run over budget');
  r = await admin.req('PUT', '/api/admin/settings', { ai_budget_aed: 0 }); r = await admin.req('GET', '/api/admin/money'); ok(r.json.paused === false && r.json.budget === 0, 'budget 0 means no cap');

  console.log('paid plan fills its question count');
  const uniq = Date.now().toString(36);
  r = await anon.req('POST', '/api/auth/register', { role: 'client', name: 'Rana', email: `rana${uniq}@glow.test`, password: 'longenough1', business_name: 'Glow Dental Clinic', website: 'glow.test', consent: true, lang: 'en' });
  ok(r.status === 200, 'client registered');
  const sc = await admin.req('POST', '/api/admin/scans', { site: 'glow.test', lang: 'en', contact: `rana${uniq}@glow.test` });
  await waitFor(async () => { const y = await admin.req('GET', '/api/admin/scans'); const row = y.json.items.find((i) => i.id === sc.json.id); return row && row.overall != null ? row : null; });
  r = await admin.req('POST', `/api/admin/scans/${sc.json.id}/client`, { owner_email: `rana${uniq}@glow.test` }); ok(r.status === 200 && r.json.business_id, 'scan made into a client');
  const bid = r.json.business_id;
  r = await admin.req('PUT', `/api/admin/businesses/${bid}/plan`, { plan: 'grow', until: '2030-01-01' }); ok(r.status === 200, 'client put on Grow ' + r.status + ' ' + JSON.stringify(r.json));
  r = await admin.req('POST', `/api/admin/businesses/${bid}/run`, {});
  const w = await waitFor(async () => { const x = await admin.req('GET', '/api/admin/clients/' + bid); const runs = x.json.runs.filter((y) => y.status === 'done'); return runs.length >= 2 ? x.json : null; }, 90000);
  ok(!!w, 'weekly scan on Grow finished');
  const doneRuns = w ? w.runs.filter((y) => y.status === 'done').sort((a, b) => a.id - b.id) : [];
  const last = doneRuns[doneRuns.length - 1];
  const rd = last && (await admin.req('GET', '/api/admin/runs/' + last.id)).json;
  const qn = rd ? new Set(rd.answers.filter((a) => a.kind === 'discover').map((a) => a.question)).size : 0;
  ok(qn >= 16 && qn <= 20, 'Grow asks up to its 20 questions, not just the 4 from the free report (' + qn + ')');
  const first = doneRuns[0];
  const fd = first && (await admin.req('GET', '/api/admin/runs/' + first.id)).json;
  const fq = fd ? fd.answers.filter((a) => a.kind === 'discover').map((a) => a.question) : [];
  ok(fq.length > 0 && fq.every((x) => rd.answers.some((a) => a.question === x)), 'the original questions are kept for a fair before/after');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
