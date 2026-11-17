'use strict';
/* Public forms, referral links, client dashboard API, partner dashboard API. */
const express = require('express');
const { q, pool } = require('./db');
const U = require('./util');
const A = require('./auth');
const R = require('./render');
const C = require('./config');
const W = require('./engine/worker');
const B = require('./billing');
const AS = require('./engine/assistants');

const router = express.Router();
const wrap = U.wrap;

async function validRef(code) {
  if (!code || !/^[a-z0-9]{4,12}$/.test(code)) return null;
  return (await q("SELECT code FROM partners WHERE code=$1 AND status<>'paused'", [code])).rows[0] ? code : null;
}
const contactOk = (c) => U.isEmail(c.toLowerCase()) || /^\+?[\d\s()-]{7,20}$/.test(c);

/* ---------- referral links: /r/CODE ---------- */
router.get('/r/:code', wrap(async (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const to = { en: '/en/', ar: '/', score: '/score/', 'score-en': '/en/score/', partners: '/partners/' }[req.query.to] || (req.query.l === 'en' ? '/en/' : '/');
  if (await validRef(code)) {
    await q('INSERT INTO ref_clicks(code) VALUES($1)', [code]);
    A.setCookie(res, A.REF, code, 60 * 86400);
  }
  res.redirect(302, to);
}));

/* ---------- score requests ---------- */
router.post('/api/score-requests', U.limit('score', 8, 3600e3), wrap(async (req, res) => {
  const b = req.body || {};
  const site = U.cleanSite(b.site);
  if (!site) U.fail(400, 'site');
  if (b.consent !== true) U.fail(400, 'consent');
  let name = U.optStr(b.name, 100), contact = U.str(b.contact, 120), userId = null, businessId = null;
  if (req.user && req.user.role === 'client') {
    userId = req.user.id; name = name || req.user.name; contact = contact || req.user.email;
    const bz = (await q('SELECT id FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
    if (bz) businessId = bz.id;
  }
  if (contact && !contactOk(contact)) U.fail(400, 'contact');
  const ref = await validRef(req.cookies && req.cookies.tw_ref);
  const token = U.token(18);
  const r = await q(`INSERT INTO score_requests(token,site,name,contact,business_id,user_id,ref_code,lang,source,biz_name,category,area,city) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [token, site, name, contact || null, businessId, userId, ref, b.lang === 'en' ? 'en' : 'ar', U.optStr(b.source, 30), U.optStr(b.biz_name, 120), U.optStr(b.category, 80), U.optStr(b.area, 80), U.optStr(b.city, 60) || 'Dubai']);
  const auto = C.worker();
  await W.enqueue('score', { request_id: r.rows[0].id });
  res.json({ id: r.rows[0].id, token, auto });
}));
router.get('/api/score-requests/:token', U.limit('score-get', 60, 60e3), wrap(async (req, res) => {
  const r = (await q(`SELECT r.status, r.site, r.created_at, rep.token AS report_token, rep.published FROM score_requests r
                      LEFT JOIN score_reports rep ON rep.request_id=r.id WHERE r.token=$1`, [U.str(req.params.token, 64)])).rows[0];
  if (!r) U.fail(404, 'not_found');
  res.json({ status: r.status, site: r.site, created_at: r.created_at, report: r.published ? r.report_token : null, auto: C.assistantsOn().length > 0 });
}));

/* ---------- leads (project wizard, "notify me") ---------- */
router.post('/api/leads', U.limit('leads', 10, 3600e3), wrap(async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'notify' ? 'notify' : 'project';
  if (b.consent !== true) U.fail(400, 'consent');
  const contact = U.str(b.contact, 120);
  if (kind === 'notify' && !contactOk(contact)) U.fail(400, 'contact');
  const name = U.optStr(b.name, 100);
  if (kind === 'project' && !name) U.fail(400, 'name');
  let payload = {};
  if (b.payload && typeof b.payload === 'object' && !Array.isArray(b.payload)) {
    Object.keys(b.payload).slice(0, 14).forEach((k) => { const v = U.str(String(b.payload[k]), 600); if (v) payload[U.str(k, 30)] = v; });
  }
  const ref = await validRef(req.cookies && req.cookies.tw_ref);
  const r = await q('INSERT INTO leads(kind,name,contact,site,intent,payload,ref_code,lang) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [kind, name, contact || null, U.cleanSite(b.site) || null, U.optStr(b.intent, 20), payload, ref, b.lang === 'en' ? 'en' : 'ar']);
  res.json({ id: r.rows[0].id });
}));

/* ================================================================ client ================== */
const client = express.Router();
client.use(A.requireRole('client'));
const BFIELDS = { name_en: 120, name_ar: 120, category: 80, category_ar: 80, city: 60, area: 80, instagram: 120, phone: 30, whatsapp: 30, email: 254, address: 240, hours: 400, languages: 120, services: 1200, price_range: 120, desc_en: 700, desc_ar: 700 };

client.get('/dashboard', wrap(async (req, res) => {
  const b = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0] || null;
  let reports = [], checks = [], tasks = [], requests = [];
  if (b) {
    reports = (await q(`SELECT r.id,r.token,r.score,r.answers_total,r.answers_named,r.checked_on,r.assistants,r.checks FROM score_reports r WHERE r.business_id=$1 AND r.published ORDER BY r.checked_on, r.id`, [b.id])).rows;
    checks = (await q('SELECT id,week_of,answers_total,answers_named,assistants,note FROM ai_checks WHERE business_id=$1 ORDER BY week_of DESC LIMIT 26', [b.id])).rows.reverse();
    tasks = (await q("SELECT id,title,body,status,created_at FROM tasks WHERE business_id=$1 ORDER BY (status='open') DESC, id DESC LIMIT 30", [b.id])).rows;
  }
  requests = (await q('SELECT id,site,status,created_at FROM score_requests WHERE user_id=$1 ORDER BY id DESC LIMIT 10', [req.user.id])).rows;
  const ent = await B.entitlement(req.user.id);
  let run = null, answers = [], manualUsed = 0, queued = false, questions = [];
  if (b) {
    run = (await q("SELECT id,kind,status,site,audit,answers_total,answers_named,assistants,competitors,started_at,finished_at FROM runs WHERE business_id=$1 AND status='done' ORDER BY id DESC LIMIT 1", [b.id])).rows[0] || null;
    if (run) answers = (await q('SELECT assistant,question,lang,named,answer,sources,mentions,error FROM run_answers WHERE run_id=$1 AND kind<>\'brand\' ORDER BY id', [run.id])).rows;
    manualUsed = (await q("SELECT count(*)::int n FROM runs WHERE business_id=$1 AND kind='manual' AND started_at > now() - interval '7 days'", [b.id])).rows[0].n;
    queued = (await q("SELECT 1 FROM jobs WHERE kind='weekly' AND status IN ('queued','running') AND payload->>'business_id'=$1", [String(b.id)])).rowCount > 0;
    questions = (Array.isArray(b.questions) && b.questions.length) ? b.questions : AS.defaultQuestions(b, ent.limits.questions);
  }
  res.json({ user: { name: req.user.name, email: req.user.email }, business: b, reports, checks, tasks, requests,
    plan: B.pubPlan(ent.plan), limits: ent.limits, subscription: B.pubSub(ent.sub),
    run, answers, questions, manual_used: manualUsed, queued, assistants: C.status().assistants.filter((a) => a.on).map((a) => a.label), billing: !!C.ziina.key() });
}));

client.put('/business', wrap(async (req, res) => {
  const b = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!b) U.fail(404, 'no_business');
  const body = req.body || {}, sets = [], vals = [];
  const add = (k, v) => { vals.push(v); sets.push(`${k}=$${vals.length}`); };
  Object.keys(BFIELDS).forEach((k) => { if (k in body) add(k, U.optStr(body[k], BFIELDS[k])); });
  if ('website' in body) { const w = U.cleanSite(body.website); if (!w) U.fail(400, 'website'); add('website', w); }
  if ('email' in body && body.email && !U.isEmail(String(body.email).toLowerCase())) U.fail(400, 'email');
  if (!sets.length) U.fail(400, 'empty');
  add('needs_review', b.status === 'verified');
  sets.push('updated_at=now()');
  vals.push(b.id);
  const r = await q(`UPDATE businesses SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
  res.json({ business: r.rows[0] });
}));

client.post('/score-request', U.limit('cscore', 6, 3600e3), wrap(async (req, res) => {
  const b = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!b || !b.website) U.fail(400, 'website');
  const open = await q("SELECT 1 FROM score_requests WHERE user_id=$1 AND status IN ('new','working')", [req.user.id]);
  if (open.rowCount) U.fail(409, 'open_request');
  const r = await q(`INSERT INTO score_requests(token,site,name,contact,business_id,user_id,lang,source) VALUES($1,$2,$3,$4,$5,$6,$7,'dashboard') RETURNING id,site,status,created_at,token`,
    [U.token(18), b.website, req.user.name, req.user.email, b.id, req.user.id, req.user.lang]);
  await W.enqueue('score', { request_id: r.rows[0].id });
  res.json({ request: r.rows[0] });
}));

/* questions, competitors and name variants used by the automatic checks (limited by plan) */
client.put('/settings', wrap(async (req, res) => {
  const b = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!b) U.fail(404, 'no_business');
  const ent = await B.entitlement(req.user.id), body = req.body || {};
  const sets = [], vals = []; const add = (k, v) => { vals.push(v); sets.push(`${k}=$${vals.length}`); };
  if (Array.isArray(body.questions)) {
    const qs = body.questions.map((x) => ({ q: U.str((x || {}).q, 200), lang: (x || {}).lang === 'en' ? 'en' : 'ar' })).filter((x) => x.q.length >= 8);
    if (qs.length > ent.limits.questions) U.fail(400, 'limit_questions');
    add('questions', JSON.stringify(qs));
  }
  if (Array.isArray(body.competitors)) {
    const cs = [...new Set(body.competitors.map((x) => U.str(String(x || ''), 80)).filter((x) => x.length >= 2))];
    if (cs.length > (ent.limits.competitors || 0)) U.fail(400, 'limit_competitors');
    add('competitors', JSON.stringify(cs));
  }
  if ('aliases' in body) add('aliases', U.optStr(body.aliases, 300));
  if (!sets.length) U.fail(400, 'empty');
  vals.push(b.id);
  const r = await q(`UPDATE businesses SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length} RETURNING questions, competitors, aliases`, vals);
  res.json(r.rows[0]);
}));

client.post('/run', U.limit('crun', 10, 3600e3), wrap(async (req, res) => {
  const b = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!b || !b.website) U.fail(400, 'website');
  if (!C.assistantsOn().length) U.fail(503, 'checks_off');
  const ent = await B.entitlement(req.user.id);
  const used = (await q("SELECT count(*)::int n FROM runs WHERE business_id=$1 AND kind='manual' AND started_at > now() - interval '7 days'", [b.id])).rows[0].n;
  if (used >= (ent.limits.manual_runs_per_week || 0)) U.fail(402, 'limit_runs');
  const busy = await q("SELECT 1 FROM jobs WHERE kind='weekly' AND status IN ('queued','running') AND payload->>'business_id'=$1", [String(b.id)]);
  if (busy.rowCount) U.fail(409, 'run_queued');
  await W.enqueue('weekly', { business_id: b.id, manual: true });
  res.json({ queued: true });
}));

client.get('/runs', wrap(async (req, res) => {
  const b = (await q('SELECT id FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!b) return res.json({ items: [] });
  const r = await q("SELECT id,kind,answers_total,answers_named,assistants,started_at FROM runs WHERE business_id=$1 AND status='done' ORDER BY id DESC LIMIT 52", [b.id]);
  res.json({ items: r.rows });
}));

client.post('/tasks/:id/done', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1);
  if (!id) U.fail(400, 'id');
  const r = await q(`UPDATE tasks t SET status='done', done_at=now() FROM businesses b WHERE t.id=$1 AND b.id=t.business_id AND b.owner_id=$2 RETURNING t.id`, [id, req.user.id]);
  if (!r.rowCount) U.fail(404, 'not_found');
  res.json({ ok: true });
}));

/* ================================================================ partner ================= */
const partner = express.Router();
partner.use(A.requireRole('partner'));
partner.get('/dashboard', wrap(async (req, res) => {
  const p = (await q('SELECT * FROM partners WHERE user_id=$1', [req.user.id])).rows[0];
  if (!p) U.fail(404, 'no_partner');
  const clicks = (await q('SELECT count(*)::int AS n FROM ref_clicks WHERE code=$1', [p.code])).rows[0].n;
  const refs = (await q(`
    SELECT 'score' AS kind, site AS label, status, created_at FROM score_requests WHERE ref_code=$1
    UNION ALL SELECT 'project', COALESCE(site, name, ''), status, created_at FROM leads WHERE ref_code=$1 AND kind='project'
    UNION ALL SELECT 'signup', '', 'signed_up', created_at FROM users WHERE ref_code=$1
    ORDER BY created_at DESC LIMIT 100`, [p.code])).rows;
  const won = (await q("SELECT count(*)::int AS n FROM leads WHERE ref_code=$1 AND status='won'", [p.code])).rows[0].n;
  res.json({ partner: p, phone: req.user.phone || '', link: `${R.CFG().domain}/r/${p.code}`, clicks, referrals: refs, won, commission_pct: R.CFG().partner_commission_pct, commission_approved: !!R.CFG().partner_terms_approved });
}));
partner.put('/profile', wrap(async (req, res) => {
  const b = req.body || {};
  await q('UPDATE partners SET company=$1, kind=$2 WHERE user_id=$3', [U.optStr(b.company, 120), U.optStr(b.kind, 40), req.user.id]);
  if (b.phone !== undefined) await q('UPDATE users SET phone=$1 WHERE id=$2', [U.optStr(b.phone, 30), req.user.id]);
  res.json({ ok: true });
}));

module.exports = { router, client, partner };
