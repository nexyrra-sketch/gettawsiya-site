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
async function hook(ev, secret = 'zsecret') {
  const raw = JSON.stringify(ev);
  const r = await fetch(BASE + '/api/ziina/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hmac-Signature': sign(raw, secret) }, body: raw });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const pay = (pid, status = 'completed') => fetch(MOCK + '/_pay/' + pid + '?status=' + status).then((r) => r.json());
async function waitFor(fn, ms = 40000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(700); } return null; }
const mock = async () => (await fetch(MOCK + '/_log')).json();
const uniq = Date.now().toString(36);

(async () => {
  const anon = new Client(), admin = new Client(), cl = new Client();
  await admin.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });

  console.log('plans');
  let r = await anon.req('GET', '/api/plans'); ok(r.status === 200 && r.json.plans.length === 3 && r.json.billing === true, 'public plans list');
  ok(r.json.plans.find((p) => p.key === 'track').price === 199, 'track price 199');
  r = await anon.req('GET', '/en/plans/'); ok(r.status === 200 && /Choose Track/.test(r.text) && /199/.test(r.text) && /"@type":"Product"/.test(r.text), 'EN plans page SSR');
  r = await anon.req('GET', '/plans/'); ok(r.status === 200 && /اختر المتابعة/.test(r.text) && /lang="ar"/.test(r.text), 'AR plans page SSR');
  r = await anon.req('GET', '/plans'); ok(r.status === 301, 'plans redirect to slash');
  r = await anon.req('POST', '/api/billing/checkout', { plan: 'track' }); ok(r.status === 401, 'checkout needs login');

  console.log('automatic free Score');
  r = await anon.req('POST', '/api/score-requests', { site: 'mondri.test', biz_name: 'Mondri Coffee', category: 'specialty coffee', area: 'Al Quoz', contact: `owner${uniq}@mondri.test`, consent: true, lang: 'en' });
  ok(r.status === 200 && r.json.auto === true, 'auto score request accepted');
  const tok = r.json.token;
  const st = await waitFor(async () => { const x = await anon.req('GET', '/api/score-requests/' + tok); return x.json.report ? x.json : null; });
  ok(st && st.status === 'done', 'report auto-published');
  r = await anon.req('GET', `/en/score/r/${st.report}/`); ok(r.status === 302 && r.headers.get('location') === `/en/report/${tok}/`, 'old report link redirects to v7 report');
  r = await anon.req('GET', `/en/report/${tok}/`);
  ok(r.status === 200 && /AI visibility report/.test(r.text) && /rp-gauge/.test(r.text), 'v7 report page');
  const m = r.text.match(/rp-gauge-n"><b>(\d+)<\/b>/); const score = m ? Number(m[1]) : -1;
  ok(score >= 70, 'good site scores high (' + score + ')');
  ok(/Mondri Coffee/.test(r.text) && /Raw Coffee Company/.test(r.text), 'report lists competitor names');
  ok(/href="\/en\/plans\/"/.test(r.text), 'report links to plans');
  let log = await mock();
  ok(log.emails.some((e) => e.to[0] === `owner${uniq}@mondri.test` && /report/i.test(e.subject)), 'report email sent');
  const runs = (await admin.req('GET', '/api/admin/runs')).json.items; const run = runs.find((x) => x.site === 'mondri.test');
  ok(run && run.answers_total >= 10 && run.answers_named >= 2 && run.answers_named < run.answers_total, `answers counted (${run && run.answers_named}/${run && run.answers_total})`);
  const det = (await admin.req('GET', '/api/admin/runs/' + run.id)).json;
  ok(det.answers.some((a) => a.kind === 'brand') && det.run.scan && det.run.scan.v === 7 && det.run.profile && det.run.profile.name, 'brand question + v7 scan + detected profile stored');
  ok(det.answers.some((a) => a.assistant === 'perplexity' && a.named && a.sources.includes('https://mondri.test/menu')), 'perplexity named + sources');
  ok(det.answers.some((a) => a.lang === 'en') && det.run.audit.checks.gbp.status === 'pass' && det.run.audit.checks.reviews.status === 'pass', 'Google profile + reviews via Places');
  ok(det.run.audit.checks.schema.status === 'pass' && det.run.audit.checks.crawl.status === 'pass' && det.run.audit.checks.languages.status === 'pass', 'schema/crawl/languages pass');
  ok(!det.run.competitors.some((c) => /mondri/i.test(c.name)) && det.run.competitors[0].name === 'Raw Coffee Company', 'competitors exclude self');

  console.log('bad site');
  r = await anon.req('POST', '/api/score-requests', { site: 'ghost.test', biz_name: 'Ghost Dental', category: 'dental clinic', contact: '+971501111111', consent: true, lang: 'ar' });
  const tokBad = r.json.token;
  const st2 = await waitFor(async () => { const x = await anon.req('GET', '/api/score-requests/' + r.json.token); return x.json.report ? x.json : null; });
  r = await anon.req('GET', `/report/${tokBad}/`); const s2 = Number((r.text.match(/rp-gauge-n"><b>(\d+)<\/b>/) || [])[1]);
  ok(s2 <= 35, 'weak site scores low (' + s2 + ')');
  ok(/GPTBot/.test(r.text), 'robots block of GPTBot reported');
  ok(/lang="ar"/.test(r.text) && /تقرير الظهور في الذكاء الاصطناعي/.test(r.text) && /خطة العمل/.test(r.text), 'AR report with action plan');

  console.log('client signup -> checkout -> webhook');
  r = await cl.req('POST', '/api/auth/register', { role: 'client', name: 'Layla', email: `layla${uniq}@mondri.test`, password: 'longenough1', business_name: 'Mondri Coffee', website: 'mondri.test', category: 'specialty coffee', area: 'Al Quoz', consent: true, lang: 'en' });
  ok(r.status === 200, 'client registered');
  log = await mock(); ok(log.emails.some((e) => e.to[0] === `layla${uniq}@mondri.test` && /Welcome/.test(e.subject)), 'welcome email');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'free' && r.json.subscription === null, 'starts on free');
  r = await cl.req('POST', '/api/client/run', {}); ok(r.status === 402 && r.json.error === 'limit_runs', 'free cannot run on demand');
  r = await cl.req('PUT', '/api/client/settings', { competitors: ['Abc Cafe'] }); ok(r.status === 400 && r.json.error === 'limit_competitors', 'free cannot track competitors');
  r = await cl.req('POST', '/api/billing/checkout', { plan: 'free' }); ok(r.status === 400, 'cannot checkout free');
  r = await cl.req('POST', '/api/billing/checkout', { plan: 'track' }); ok(r.status === 200 && /pay\.ziina\.test/.test(r.json.url) && r.json.kind === 'new', 'checkout -> Ziina redirect');
  log = await mock(); const pi = log.lastIntent;
  ok(pi.amount === 19900 && pi.currency_code === 'AED' && pi.test === true && /checkout=success&pi=/.test(pi.success_url) && pi.success_url.includes(pi.id), 'intent: 19900 fils AED, test, success_url with id');
  r = await cl.req('POST', '/api/billing/confirm', { pi: pi.id }); ok(r.json.status === 'requires_payment_instrument', 'not paid yet -> not active');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'free', 'still free before payment');
  const ev = { event: 'payment_intent.status.updated', data: { id: pi.id, status: 'completed', amount: 19900 } };
  r = await hook(ev, 'wrong'); ok(r.status === 400, 'bad HMAC rejected');
  r = await hook(ev); ok(r.status === 200, 'webhook accepted (but intent not completed at Ziina yet)');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'free', 'forged/early webhook does not activate (re-read from Ziina)');
  await pay(pi.id);
  r = await hook(ev); ok(r.status === 200, 'webhook after payment');
  r = await hook(ev); ok(r.status === 200, 'duplicate webhook ok');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'track' && r.json.subscription.source === 'ziina' && r.json.subscription.current_period_end, 'plan active after payment');
  const end1 = new Date(r.json.subscription.current_period_end); ok(Math.round((end1 - Date.now()) / 86400e3) >= 28, 'paid for ~1 month');
  ok(r.json.payments.length === 1 && r.json.payments[0].amount === 199, 'one payment recorded (idempotent)');
  { const lg = await mock(); ok(lg.emails.some((e) => /New payment: Track, 199 AED/.test(e.subject) && /admin@test.local/.test(JSON.stringify(e.to || e))), 'owner is emailed when a client pays');
    const adm0 = new Client(); await adm0.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    const ls = await adm0.req('GET', '/api/admin/leads?status=new'); ok(ls.status === 200 && JSON.stringify(ls.json).includes('"intent":"paid"'), 'paid client appears in Admin > Leads as new'); }
  r = await cl.req('POST', '/api/billing/confirm', { pi: pi.id }); ok(r.json.status === 'completed', 'confirm after webhook = completed');
  log = await mock(); ok(log.emails.some((e) => e.to[0] === `layla${uniq}@mondri.test` && /Track plan/.test(e.subject)), 'paid email');
  const other = new Client(); await other.req('POST', '/api/auth/register', { role: 'client', name: 'Eve', email: `eve${uniq}@x.test`, password: 'longenough1', business_name: 'Eve', website: 'eve.test', category: 'cafe', consent: true });
  r = await other.req('POST', '/api/billing/confirm', { pi: pi.id }); ok(r.status === 404, 'cannot confirm another user\'s payment');

  console.log('first weekly check after payment');
  const d1 = await waitFor(async () => { const x = await cl.req('GET', '/api/client/dashboard'); return x.json.run ? x.json : null; });
  ok(d1 && d1.run.answers_total > 0 && d1.answers.length > 0, 'first check ran automatically');
  ok(d1.checks.length === 1 && d1.checks[0].answers_total === d1.run.answers_total, 'weekly trend row written');
  ok(d1.limits.questions === 10 && d1.questions.length > 0, 'track limits + default questions');
  ok(d1.tasks.filter((t) => t.status === 'open').length > 0, 'action plan items created from findings');
  log = await mock(); ok(log.emails.some((e) => /This week/.test(e.subject)), 'weekly email');

  console.log('settings + on-demand run');
  r = await cl.req('PUT', '/api/client/settings', { questions: Array.from({ length: 13 }, (_, i) => ({ q: 'Best coffee question number ' + i, lang: 'en' })) }); ok(r.status === 400 && r.json.error === 'limit_questions', 'question limit');
  r = await cl.req('PUT', '/api/client/settings', { questions: [{ q: 'Best specialty coffee in Al Quoz?', lang: 'en' }, { q: 'أفضل قهوة مختصة في القوز؟', lang: 'ar' }], competitors: ['Raw Coffee Company', 'Nightjar Coffee'], aliases: 'Mondri, موندري' });
  ok(r.status === 200 && r.json.questions.length === 2 && r.json.competitors.length === 2, 'settings saved');
  r = await cl.req('PUT', '/api/client/settings', { competitors: ['Aaa', 'Bbb', 'Ccc', 'Ddd'] }); ok(r.status === 400, 'competitor limit 3');
  r = await cl.req('POST', '/api/client/run', {}); ok(r.status === 200 && r.json.queued, 'manual run queued');
  r = await cl.req('POST', '/api/client/run', {}); ok(r.status === 409 || r.status === 402, 'second run blocked');
  const d2 = await waitFor(async () => { const x = await cl.req('GET', '/api/client/dashboard'); return x.json.run && x.json.run.kind === 'manual' && !x.json.queued ? x.json : null; });
  ok(d2 && d2.run.answers_total === 8, 'manual run used custom questions (' + (d2 && d2.run.answers_total) + ')');
  ok(d2 && d2.run.competitors.filter((c) => c.tracked).length === 2 && d2.run.competitors.find((c) => c.name === 'Raw Coffee Company').count > 0, 'tracked competitors counted');
  r = await cl.req('POST', '/api/client/run', {}); ok(r.status === 402, 'track: 1 manual run per week');

  console.log('renew + plan change + expiry');
  r = await cl.req('POST', '/api/billing/checkout', { plan: 'track' }); ok(r.json.kind === 'renew', 'same plan = renew');
  log = await mock(); await pay(log.lastIntent.id); await hook({ event: 'payment_intent.status.updated', data: { id: log.lastIntent.id } });
  r = await cl.req('GET', '/api/billing'); const end2 = new Date(r.json.subscription.current_period_end);
  ok(Math.round((end2 - end1) / 86400e3) >= 28, 'renewal extends from current end');
  r = await cl.req('GET', '/api/billing/quote?plan=grow'); ok(r.json.kind === 'change' && r.json.credit > 300 && Math.abs(r.json.amount + r.json.credit - 799) < 0.02 && r.json.bonus_days === 0, `upgrade credit for unused days (credit ${r.json.credit}, pay ${r.json.amount})`);
  r = await cl.req('POST', '/api/billing/checkout', { plan: 'grow' }); ok(r.status === 200 && r.json.kind === 'change', 'upgrade checkout');
  log = await mock(); const gi = log.lastIntent; await pay(gi.id, 'failed');
  r = await cl.req('POST', '/api/billing/confirm', { pi: gi.id }); ok(r.json.status === 'failed', 'failed payment reported');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'track', 'failed payment changes nothing');
  r = await cl.req('POST', '/api/billing/checkout', { plan: 'grow' }); log = await mock(); await pay(log.lastIntent.id);
  r = await cl.req('POST', '/api/billing/confirm', { pi: log.lastIntent.id }); ok(r.json.status === 'completed', 'upgrade paid (via return confirm, no webhook)');
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'grow' && r.json.limits.questions === 20, 'now on grow');
  ok(Math.round((new Date(r.json.subscription.current_period_end) - Date.now()) / 86400e3) >= 28, 'upgrade starts a new month today');
  r = await cl.req('GET', '/api/billing/quote?plan=track'); ok(r.json.kind === 'change' && r.json.amount === 2 && r.json.bonus_days >= 20, `downgrade: credit above price becomes extra days (${r.json.bonus_days})`);
  r = await cl.req('POST', '/api/client/run', {}); ok(r.status === 200, 'grow allows another run');
  // reminder + expiry (move the end date)
  await admin.req('POST', '/api/admin/scheduler/run', {});
  const { Pool } = require('pg'); const db = new Pool({ connectionString: process.env.DATABASE_URL });
  await db.query("UPDATE subscriptions SET current_period_end=now() + interval '2 days', reminded_at=NULL WHERE status='active' AND source='ziina'");
  await admin.req('POST', '/api/admin/scheduler/run', {});
  log = await mock(); ok(log.emails.some((e) => /plan ends on/.test(e.subject)), 'renewal reminder email');
  await db.query("UPDATE subscriptions SET current_period_end=now() - interval '1 day' WHERE status='active' AND source='ziina'");
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'free' && !r.json.subscription, 'plan stops the moment the paid month ends (no extra days)');
  await db.query("UPDATE subscriptions SET current_period_end=now() + interval '1 hour' WHERE id=(SELECT max(id) FROM subscriptions WHERE source='ziina')");
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'grow', 'still on the plan in its last hour');
  await db.query("UPDATE subscriptions SET current_period_end=now() - interval '1 minute' WHERE id=(SELECT max(id) FROM subscriptions WHERE source='ziina')");
  await db.query("UPDATE subscriptions SET current_period_end=now() - interval '4 days' WHERE status='active' AND source='ziina'");
  await admin.req('POST', '/api/admin/scheduler/run', {});
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'free' && !r.json.subscription, 'expired -> free');
  await db.end();

  console.log('email password reset');
  r = await anon.req('POST', '/api/auth/forgot', { email: `layla${uniq}@mondri.test` }); ok(r.json.emailed === true, 'reset emailed');
  log = await mock(); const em = log.emails.filter((e) => /Reset/.test(e.subject)).pop();
  const link = em && (em.text.match(/reset=([A-Za-z0-9_-]+)/) || [])[1]; ok(!!link, 'reset link in email');
  r = await anon.req('POST', '/api/auth/reset', { token: link, password: 'resetbyemail1' }); ok(r.status === 200, 'reset via emailed link');

  console.log('admin');
  r = await admin.req('GET', '/api/admin/integrations'); ok(r.json.ziina && r.json.ziina_mode === 'test' && r.json.email && r.json.assistants.every((a) => a.on) && !JSON.stringify(r.json).includes('ziina_mock') && !JSON.stringify(r.json).includes('zsecret'), 'integrations status without secrets');
  r = await admin.req('POST', '/api/admin/integrations/test', { name: 'openai' }); ok(r.json.ok && /Raw Coffee/.test(r.json.sample), 'test openai');
  r = await admin.req('POST', '/api/admin/integrations/test', { name: 'ziina' }); ok(r.json.ok, 'test ziina');
  r = await admin.req('POST', '/api/admin/ziina/webhook', {}); log = await mock(); ok(r.json.ok && log.webhook.url.endsWith('/api/ziina/webhook') && log.webhook.secret === 'zsecret', 'register webhook with secret');
  r = await admin.req('GET', '/api/admin/checkouts'); ok(r.json.items.some((c) => c.status === 'failed') && r.json.items.some((c) => c.status === 'completed'), 'checkouts list');
  r = await admin.req('PUT', '/api/admin/plans/track', { name_en: 'Track', name_ar: 'المتابعة', price: 249, interval: 'month', features_en: ['a'], features_ar: ['ب'], limits: { questions: 15, weekly: true, competitors: 3, manual_runs_per_week: 1 }, active: true });
  ok(r.status === 200 && r.json.changed_price, 'admin changes price');
  r = await anon.req('GET', '/api/plans'); ok(r.json.plans.find((p) => p.key === 'track').price === 249, 'new price public');
  r = await admin.req('PUT', '/api/admin/plans/free', { name_en: 'Free', name_ar: 'مجانية', price: 5 }); ok(r.status === 400, 'free must stay 0');
  r = await admin.req('GET', '/api/admin/subscriptions'); ok(r.json.items.length >= 1, 'subscriptions list');
  r = await admin.req('GET', '/api/admin/payments'); ok(r.json.items.length >= 2, 'payments list');
  r = await admin.req('GET', '/api/admin/emails'); ok(r.json.items.some((e) => e.status === 'sent'), 'email log');
  const biz = (await admin.req('GET', '/api/admin/businesses')).json.items.find((b) => b.website === 'mondri.test' && b.owner_email);
  r = await admin.req('PUT', `/api/admin/businesses/${biz.id}/plan`, { plan: 'track', until: '2030-01-01' }); ok(r.status === 200, 'manual plan');
  r = await cl.req('POST', '/api/auth/login', { email: `layla${uniq}@mondri.test`, password: 'resetbyemail1' });
  r = await cl.req('GET', '/api/billing'); ok(r.json.plan.key === 'track', 'manual plan applies');
  r = await cl.req('GET', '/api/admin/integrations'); ok(r.status === 403, 'client cannot see integrations');
  r = await admin.req('GET', '/api/admin/overview'); ok(typeof r.json.subscribers === 'number' && r.json.runs_week >= 3, 'overview counts');

  console.log('static');
  for (const p of ['/sw.js', '/site.webmanifest', '/assets/js/plans.js', '/en/dashboard/']) { r = await anon.req('GET', p); ok(r.status === 200, 'GET ' + p); }
  r = await anon.req('GET', '/site.webmanifest'); ok(/dashboard/.test(r.text), 'manifest start_url');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
