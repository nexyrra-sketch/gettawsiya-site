'use strict';
/* v6 end-to-end: automatic Score, plans, Stripe checkout + webhooks, weekly checks, settings limits, email, admin automation.
   Needs: server with mock env (/tmp/env6.sh) and test/mock.js running. */
const crypto = require('crypto');
const BASE = process.env.BASE || 'http://localhost:8812', MOCK = 'http://127.0.0.1:9900';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Client {
  constructor() { this.cookies = {}; }
  async req(method, path, body, headers = {}) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); if (ck) h.Cookie = ck;
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); if (/Max-Age=0/i.test(c)) delete this.cookies[kv.slice(0, i)]; else this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t, headers: r.headers };
  }
}
const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const waitFor = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(700); } return null; };
const uniq = Date.now().toString(36);
(async () => {
  const anon = new Client(), admin = new Client(), cl = new Client(), other = new Client();
  await fetch(MOCK + '/_fix?v=0');
  await admin.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  console.log('URL-only scan');
  let r = await anon.req('POST', '/api/score-requests', { site: 'mondri.test', consent: true, lang: 'en' });
  ok(r.status === 200 && r.json.token, 'scan accepted with only a URL');
  const tok = r.json.token;
  r = await anon.req('GET', '/en/report/' + tok + '/'); ok(r.status === 200 && (/data-live=/.test(r.text) || /rp-gauge/.test(r.text)), 'report link works immediately (live view)');
  r = await anon.req('POST', `/api/scan/${tok}/contact`, { contact: 'nope' }); ok(r.status === 400, 'bad contact rejected');
  r = await anon.req('POST', `/api/scan/${tok}/contact`, { contact: `x${uniq}@mondri.test` }); ok(r.status === 200, 'contact captured during scan');
  const st = await waitFor(async () => { const x = await anon.req('GET', '/api/scan/' + tok); return x.json && x.json.done ? x.json : null; });
  ok(st && st.overall >= 60 && st.has_contact, 'scan finished (' + (st && st.overall) + ')');
  ok(st.progress.feed.length > 0 && st.progress.found && st.progress.found.name === 'Mondri Coffee' && /coffee/.test(st.progress.found.category), 'business detected from the site: ' + JSON.stringify(st.progress.found));
  r = await anon.req('GET', '/en/report/' + tok + '/');
  ['What AI says about you', 'When customers ask', 'Who AI recommends', 'Where AI gets its information', 'Action plan', 'What we understood'].forEach((t) => ok(r.text.includes(t), 'EN report has: ' + t));
  ok((r.text.match(/<script>/g) || []).length <= 1, 'no extra inline scripts (CSP)');
  r = await anon.req('GET', '/report/' + tok + '/'); ok(/lang="ar"/.test(r.text) && r.text.includes('ماذا يقول الذكاء الاصطناعي عنك'), 'AR report');
  r = await anon.req('GET', '/report/AAAAAAAAAAAAAAAAAAAAAAAA/'); ok(r.status === 404, 'unknown token 404');
  r = await anon.req('GET', '/api/scan/short'); ok(r.status === 404, 'bad token 404');
  let log = await (await fetch(MOCK + '/_log')).json(); ok(log.emails.some((e) => e.to[0] === `x${uniq}@mondri.test` && /report\//.test(JSON.stringify(e))), 'report emailed to late contact with v7 link');

  console.log('admin control room');
  r = await anon.req('POST', '/api/admin/scans', { site: 'glow.test' }); ok(r.status === 401 || r.status === 403, 'admin scan needs admin');
  r = await admin.req('POST', '/api/admin/scans', { site: 'glow.test', lang: 'en', contact: '+971501112233' }); ok(r.status === 200, 'admin scan started');
  const sid = r.json.id, gtok = r.json.token;
  await waitFor(async () => { const x = await anon.req('GET', '/api/scan/' + gtok); return x.json && x.json.done; });
  r = await admin.req('GET', '/api/admin/scans'); const row = r.json.items.find((x) => x.id === sid);
  ok(row && row.overall != null && row.overall < 30 && row.source === 'admin', 'weak prospect scored low (' + (row && row.overall) + ')');
  r = await admin.req('PUT', '/api/admin/scans/' + sid, { lead_status: 'contacted', lead_note: 'Called Monday' }); ok(r.status === 200, 'lead status saved');
  r = await admin.req('PUT', '/api/admin/scans/' + sid, { lead_status: 'bogus' }); ok(r.status === 400, 'bad lead status rejected');
  r = await cl.req('POST', '/api/auth/register', { role: 'client', name: 'Rana', email: `rana${uniq}@glow.test`, password: 'longenough1', business_name: 'Glow Dental Clinic', website: 'glow.test', consent: true, lang: 'en' });
  ok(r.status === 200, 'client registered');
  r = await admin.req('POST', `/api/admin/scans/${sid}/client`, { owner_email: `rana${uniq}@glow.test` }); ok(r.status === 200 && r.json.business_id, 'prospect turned into client (linked to their account)');
  const bid = r.json.business_id;
  r = await admin.req('GET', '/api/admin/clients/' + bid); const ws = r.json;
  ok(ws.business.baseline_run_id && ws.tasks.length >= 10, 'baseline set and action plan created (' + ws.tasks.length + ' items)');
  ok(ws.tasks.some((t) => t.owner === 'client') && ws.tasks.some((t) => t.owner === 'tawsiya'), 'items split between Tawsiya and client');
  const t0 = ws.tasks[0];
  r = await admin.req('PUT', '/api/admin/tasks/' + t0.id, { status: 'doing', client_note: 'On it this week' }); ok(r.status === 200 && r.json.task.status === 'doing', 'task moved to doing');
  r = await admin.req('PUT', '/api/admin/tasks/' + t0.id, { status: 'nope' }); ok(r.status === 400, 'bad task status rejected');
  r = await admin.req('POST', `/api/admin/clients/${bid}/tasks`, { title: 'Shoot new photos', owner: 'client', priority: 1 }); ok(r.status === 200 && r.json.task.owner === 'client', 'custom task added');
  r = await admin.req('PUT', '/api/admin/tasks/' + r.json.task.id, { visible: false }); ok(r.json.task.visible === false, 'task hidden from client');
  r = await cl.req('GET', '/api/client/progress'); ok(r.status === 200 && r.json.latest && r.json.tasks.some((t) => t.client_note === 'On it this week') && !r.json.tasks.some((t) => t.title === 'Shoot new photos'), 'client sees visible plan items only');
  r = await other.req('GET', '/api/client/progress'); ok(r.status === 401, 'progress API needs login');
  r = await admin.req('POST', `/api/admin/clients/${bid}/share`, {}); const share = r.json.token; ok(share && share.length >= 16, 'share link created');
  r = await anon.req('GET', `/en/progress/${share}/`); ok(r.status === 200 && /No second check yet/.test(r.text), 'progress page waits for second scan');

  console.log('after the work');
  await fetch(MOCK + '/_fix?v=1');
  r = await admin.req('POST', `/api/admin/businesses/${bid}/run`, {}); ok(r.status === 200, 'new scan queued');
  const w2 = await waitFor(async () => { const x = await admin.req('GET', '/api/admin/clients/' + bid); return x.json.runs.filter((y) => y.status === 'done').length >= 2 && x.json.tasks.filter((t) => t.status === 'done').length >= 10 ? x.json : null; }, 90000);
  ok(w2 && w2.runs[0].overall > w2.runs[w2.runs.length - 1].overall + 40, 'score went up after the fixes (' + (w2 && w2.runs.map((x) => x.overall).join(' <- ')) + ')');
  ok(w2.tasks.filter((t) => t.status === 'done').length >= 10, 'fixed items closed automatically (' + w2.tasks.map((t) => t.status).join(',') + ')');
  r = await anon.req('GET', `/en/progress/${share}/`);
  ok(r.status === 200 && /Progress report/.test(r.text) && /rp-delta up/.test(r.text) && /Same question, before and after/.test(r.text) && /Work done by Tawsiya/.test(r.text), 'EN before/after report');
  r = await anon.req('GET', `/progress/${share}/`); ok(/تقرير التقدم/.test(r.text) && /ما تم إصلاحه/.test(r.text), 'AR before/after report');
  r = await admin.req('POST', `/api/admin/clients/${bid}/share`, { rotate: true }); ok(r.json.token !== share, 'share link rotated');
  r = await anon.req('GET', `/en/progress/${share}/`); ok(r.status === 404, 'old share link stops working');
  r = await admin.req('PUT', '/api/admin/clients/' + bid, { baseline_run_id: 999999 }); ok(r.status === 400, 'baseline must be own run');
  await fetch(MOCK + '/_fix?v=0');
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
