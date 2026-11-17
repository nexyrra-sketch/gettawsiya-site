'use strict';
/* Admin API. Every route requires role=admin. */
const express = require('express');
const { q, pool } = require('./db');
const U = require('./util');
const A = require('./auth');
const R = require('./render');

const router = express.Router();
const wrap = U.wrap;
router.use(A.requireRole('admin'));

router.get('/overview', wrap(async (req, res) => {
  const n = async (sql) => (await q(sql)).rows[0].n;
  res.json({
    requests_new: await n("SELECT count(*)::int n FROM score_requests WHERE status='new'"),
    requests_working: await n("SELECT count(*)::int n FROM score_requests WHERE status='working'"),
    businesses_pending: await n("SELECT count(*)::int n FROM businesses WHERE status='pending'"),
    needs_review: await n("SELECT count(*)::int n FROM businesses WHERE needs_review"),
    resets_open: await n('SELECT count(*)::int n FROM reset_requests WHERE NOT handled'),
    leads_new: await n("SELECT count(*)::int n FROM leads WHERE status='new'"),
    partners_pending: await n("SELECT count(*)::int n FROM partners WHERE status='pending'"),
    users: await n('SELECT count(*)::int n FROM users'),
    verified: await n("SELECT count(*)::int n FROM businesses WHERE status='verified'"),
    subscribers: await n("SELECT count(DISTINCT user_id)::int n FROM subscriptions WHERE status IN ('active','trialing','past_due')"),
    jobs_failed: await n("SELECT count(*)::int n FROM jobs WHERE status='failed'"),
    runs_week: await n("SELECT count(*)::int n FROM runs WHERE started_at > now() - interval '7 days'"),
    checks: R.CHECKS().map((c) => ({ key: c.key, en: c.en }))
  });
}));

/* ---------- score requests and reports ---------- */
router.get('/requests', wrap(async (req, res) => {
  const st = ['new', 'working', 'done', 'closed'].includes(req.query.status) ? req.query.status : null;
  const r = await q(`SELECT r.*, rep.id AS report_id, rep.published, rep.token AS report_token, rep.score FROM score_requests r LEFT JOIN score_reports rep ON rep.request_id=r.id
                     WHERE ($1::text IS NULL OR r.status=$1) ORDER BY (r.status='new') DESC, r.id DESC LIMIT 200`, [st]);
  res.json({ items: r.rows });
}));
router.get('/requests/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const r = (await q('SELECT * FROM score_requests WHERE id=$1', [id])).rows[0]; if (!r) U.fail(404, 'not_found');
  const rep = (await q('SELECT * FROM score_reports WHERE request_id=$1', [id])).rows[0] || null;
  res.json({ request: r, report: rep });
}));
router.put('/requests/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const st = req.body.status;
  if (!['new', 'working', 'done', 'closed'].includes(st)) U.fail(400, 'status');
  const bid = req.body.business_id == null || req.body.business_id === '' ? null : U.int(req.body.business_id, 1);
  await q('UPDATE score_requests SET status=$1, business_id=COALESCE($2,business_id), updated_at=now() WHERE id=$3', [st, bid, id]);
  res.json({ ok: true });
}));

function cleanReport(b) {
  const keys = R.CHECKS().map((c) => c.key), checks = {};
  keys.forEach((k) => { const e = (b.checks || {})[k] || {}; checks[k] = { pass: e.pass === true, note: U.str(e.note || '', 300) }; });
  const score = keys.filter((k) => checks[k].pass).length;
  const total = U.int(b.answers_total, 0, 5000) || 0, named = U.int(b.answers_named, 0, 5000) || 0;
  if (named > total) U.fail(400, 'answers');
  const arr = (v, n, m) => (Array.isArray(v) ? v.slice(0, n).map((x) => U.str(String(x), m)).filter(Boolean) : []);
  const questions = (Array.isArray(b.questions) ? b.questions : []).slice(0, 40).map((x) => ({ q: U.str((x || {}).q, 240), named: arr((x || {}).named, 10, 80), you: (x || {}).you === true })).filter((x) => x.q);
  const day = U.isDate(String(b.checked_on || '')) ? b.checked_on : null;
  return { score, checks, total, named, assistants: arr(b.assistants, 10, 40), questions, summary_en: U.optStr(b.summary_en, 3000), summary_ar: U.optStr(b.summary_ar, 3000), day,
    business_name: U.optStr(b.business_name, 120), published: b.published === true };
}
router.post('/requests/:id/report', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const rq = (await q('SELECT * FROM score_requests WHERE id=$1', [id])).rows[0]; if (!rq) U.fail(404, 'not_found');
  const c = cleanReport(req.body || {});
  const bid = req.body.business_id ? U.int(req.body.business_id, 1) : rq.business_id;
  const existing = (await q('SELECT id,token FROM score_reports WHERE request_id=$1', [id])).rows[0];
  let rep;
  if (existing) {
    rep = (await q(`UPDATE score_reports SET business_id=$1, site=$2, business_name=$3, score=$4, checks=$5, answers_total=$6, answers_named=$7, assistants=$8, questions=$9,
      summary_en=$10, summary_ar=$11, published=$12, checked_on=COALESCE($13::date, checked_on) WHERE id=$14 RETURNING *`,
      [bid, rq.site, c.business_name, c.score, c.checks, c.total, c.named, JSON.stringify(c.assistants), JSON.stringify(c.questions), c.summary_en, c.summary_ar, c.published, c.day, existing.id])).rows[0];
  } else {
    rep = (await q(`INSERT INTO score_reports(request_id,business_id,token,site,business_name,score,checks,answers_total,answers_named,assistants,questions,summary_en,summary_ar,published,checked_on)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::date, CURRENT_DATE)) RETURNING *`,
      [id, bid, U.token(18), rq.site, c.business_name, c.score, c.checks, c.total, c.named, JSON.stringify(c.assistants), JSON.stringify(c.questions), c.summary_en, c.summary_ar, c.published, c.day])).rows[0];
  }
  await q('UPDATE score_requests SET status=$1, business_id=COALESCE($2,business_id), updated_at=now() WHERE id=$3', [c.published ? 'done' : 'working', bid, id]);
  res.json({ report: rep });
}));

/* ---------- businesses ---------- */
const BF = ['name_en', 'name_ar', 'category', 'city', 'area', 'website', 'instagram', 'phone', 'whatsapp', 'email', 'address', 'hours', 'languages', 'services', 'price_range', 'desc_en', 'desc_ar'];
const BL = { name_en: 120, name_ar: 120, category: 80, city: 60, area: 80, website: 200, instagram: 120, phone: 30, whatsapp: 30, email: 254, address: 240, hours: 400, languages: 120, services: 1200, price_range: 120, desc_en: 700, desc_ar: 700 };
router.get('/businesses', wrap(async (req, res) => {
  const r = await q(`SELECT b.id,b.slug,b.name_en,b.name_ar,b.website,b.status,b.needs_review,b.verified_at,b.created_at,u.email AS owner_email
                     FROM businesses b LEFT JOIN users u ON u.id=b.owner_id ORDER BY b.needs_review DESC, (b.status='pending') DESC, b.id DESC LIMIT 300`);
  res.json({ items: r.rows });
}));
router.get('/businesses/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = (await q('SELECT b.*, u.email AS owner_email FROM businesses b LEFT JOIN users u ON u.id=b.owner_id WHERE b.id=$1', [id])).rows[0]; if (!b) U.fail(404, 'not_found');
  res.json({ business: b,
    checks: (await q('SELECT * FROM ai_checks WHERE business_id=$1 ORDER BY week_of DESC', [id])).rows,
    tasks: (await q('SELECT * FROM tasks WHERE business_id=$1 ORDER BY id DESC', [id])).rows,
    reports: (await q('SELECT id,request_id,token,score,published,checked_on FROM score_reports WHERE business_id=$1 ORDER BY id DESC', [id])).rows });
}));
async function bizFields(body, partial) {
  const sets = {}, out = {};
  BF.forEach((k) => { if (!partial || k in body) sets[k] = U.optStr(body[k], BL[k]); });
  if (sets.website) { sets.website = U.cleanSite(sets.website); if (!sets.website) U.fail(400, 'website'); }
  if (sets.email && !U.isEmail(sets.email.toLowerCase())) U.fail(400, 'email');
  Object.assign(out, sets);
  if ('owner_email' in body) {
    const em = U.str(body.owner_email, 254).toLowerCase();
    if (!em) out.owner_id = null;
    else { const u = (await q('SELECT id FROM users WHERE email=$1', [em])).rows[0]; if (!u) U.fail(400, 'owner'); out.owner_id = u.id; }
  }
  return out;
}
router.post('/businesses', wrap(async (req, res) => {
  const f = await bizFields(req.body || {}, false);
  if (!f.name_en && !f.name_ar) U.fail(400, 'name');
  const slugBase = U.slugify(f.name_en || '') || U.slugify(req.body.slug || '') || 'business';
  let slug = slugBase;
  for (let i = 0; i < 8 && (await q('SELECT 1 FROM businesses WHERE slug=$1', [slug])).rowCount; i++) slug = `${slugBase}-${U.shortCode(3)}`;
  const cols = ['slug', ...Object.keys(f)], vals = [slug, ...Object.values(f)];
  const r = await q(`INSERT INTO businesses(${cols.join(',')}) VALUES(${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, vals);
  res.json({ business: r.rows[0] });
}));
router.put('/businesses/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const f = await bizFields(req.body || {}, true);
  if (req.body.slug) { const s = U.slugify(req.body.slug); if (s.length < 2) U.fail(400, 'slug'); if ((await q('SELECT 1 FROM businesses WHERE slug=$1 AND id<>$2', [s, id])).rowCount) U.fail(409, 'slug_taken'); f.slug = s; }
  const keys = Object.keys(f); if (!keys.length) U.fail(400, 'empty');
  const r = await q(`UPDATE businesses SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=$${keys.length + 1} RETURNING *`, [...Object.values(f), id]);
  if (!r.rowCount) U.fail(404, 'not_found');
  res.json({ business: r.rows[0] });
}));
router.post('/businesses/:id/verify', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const a = req.body.action, note = U.optStr(req.body.note, 400);
  if (!['verify', 'suspend', 'pending', 'reviewed'].includes(a)) U.fail(400, 'action');
  const b = (await q('SELECT * FROM businesses WHERE id=$1', [id])).rows[0]; if (!b) U.fail(404, 'not_found');
  if (a === 'verify') {
    if (!b.website || !(b.name_en || b.name_ar) || !(b.phone || b.whatsapp || b.email) || !(b.address || b.area)) U.fail(400, 'incomplete');
    await q("UPDATE businesses SET status='verified', verified_at=now(), verified_note=$1, needs_review=FALSE WHERE id=$2", [note, id]);
  } else if (a === 'reviewed') await q('UPDATE businesses SET needs_review=FALSE, verified_note=COALESCE($1,verified_note) WHERE id=$2', [note, id]);
  else await q('UPDATE businesses SET status=$1, verified_note=$2 WHERE id=$3', [a === 'suspend' ? 'suspended' : 'pending', note, id]);
  res.json({ ok: true });
}));
router.post('/businesses/:id/checks', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = req.body || {}, week = String(b.week_of || '');
  const total = U.int(b.answers_total, 1, 5000), named = U.int(b.answers_named, 0, 5000);
  if (!U.isDate(week) || total == null || named == null || named > total) U.fail(400, 'values');
  const ass = (Array.isArray(b.assistants) ? b.assistants : []).slice(0, 10).map((x) => U.str(String(x), 40)).filter(Boolean);
  const r = await q(`INSERT INTO ai_checks(business_id,week_of,answers_total,answers_named,assistants,note) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (business_id,week_of) DO UPDATE SET answers_total=EXCLUDED.answers_total, answers_named=EXCLUDED.answers_named, assistants=EXCLUDED.assistants, note=EXCLUDED.note RETURNING *`,
    [id, week, total, named, JSON.stringify(ass), U.optStr(b.note, 300)]);
  res.json({ check: r.rows[0] });
}));
router.delete('/checks/:id', wrap(async (req, res) => { await q('DELETE FROM ai_checks WHERE id=$1', [U.int(req.params.id, 1) || 0]); res.json({ ok: true }); }));
router.post('/businesses/:id/tasks', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const t = U.str(req.body.title, 160); if (!t) U.fail(400, 'title');
  const r = await q('INSERT INTO tasks(business_id,title,body) VALUES($1,$2,$3) RETURNING *', [id, t, U.optStr(req.body.body, 600)]);
  res.json({ task: r.rows[0] });
}));
router.delete('/tasks/:id', wrap(async (req, res) => { await q('DELETE FROM tasks WHERE id=$1', [U.int(req.params.id, 1) || 0]); res.json({ ok: true }); }));

/* ---------- users, resets ---------- */
router.get('/users', wrap(async (req, res) => {
  const r = await q(`SELECT u.id,u.email,u.name,u.role,u.phone,u.disabled,u.created_at,u.last_login,u.ref_code,
    (SELECT string_agg(COALESCE(b.name_en,b.name_ar),', ') FROM businesses b WHERE b.owner_id=u.id) AS businesses FROM users u ORDER BY u.id DESC LIMIT 300`);
  res.json({ items: r.rows });
}));
router.put('/users/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  if (id === req.user.id) U.fail(400, 'self');
  const sets = [], vals = [];
  if (['admin', 'client', 'partner'].includes(req.body.role)) { vals.push(req.body.role); sets.push(`role=$${vals.length}`); }
  if (typeof req.body.disabled === 'boolean') { vals.push(req.body.disabled); sets.push(`disabled=$${vals.length}`); }
  if (!sets.length) U.fail(400, 'empty');
  vals.push(id);
  await q(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length}`, vals);
  if (req.body.disabled === true) await q('DELETE FROM sessions WHERE user_id=$1', [id]);
  res.json({ ok: true });
}));
router.post('/users/:id/reset-link', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const u = (await q('SELECT id FROM users WHERE id=$1', [id])).rows[0]; if (!u) U.fail(404, 'not_found');
  const t = U.token(24);
  await q("INSERT INTO resets(token_hash,user_id,expires_at) VALUES($1,$2,now() + interval '48 hours')", [U.sha(t), id]);
  res.json({ url: `${R.CFG().domain}/signin/?reset=${t}`, expires_hours: 48 });
}));
router.get('/resets', wrap(async (req, res) => {
  const r = await q('SELECT r.id,r.email,r.user_id,r.handled,r.created_at,u.name,u.phone FROM reset_requests r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.handled, r.id DESC LIMIT 100');
  res.json({ items: r.rows });
}));
router.post('/resets/:id/handled', wrap(async (req, res) => { await q('UPDATE reset_requests SET handled=TRUE WHERE id=$1', [U.int(req.params.id, 1) || 0]); res.json({ ok: true }); }));

/* ---------- partners and leads ---------- */
router.get('/partners', wrap(async (req, res) => {
  const r = await q(`SELECT p.*, u.name, u.email, u.phone,
    (SELECT count(*)::int FROM ref_clicks c WHERE c.code=p.code) AS clicks,
    (SELECT count(*)::int FROM score_requests s WHERE s.ref_code=p.code) AS requests,
    (SELECT count(*)::int FROM leads l WHERE l.ref_code=p.code) AS leads,
    (SELECT count(*)::int FROM leads l WHERE l.ref_code=p.code AND l.status='won') AS won,
    (SELECT count(*)::int FROM users x WHERE x.ref_code=p.code) AS signups
    FROM partners p JOIN users u ON u.id=p.user_id ORDER BY (p.status='pending') DESC, p.created_at DESC`);
  res.json({ items: r.rows });
}));
router.put('/partners/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  if (!['pending', 'approved', 'paused'].includes(req.body.status)) U.fail(400, 'status');
  await q('UPDATE partners SET status=$1 WHERE user_id=$2', [req.body.status, id]);
  res.json({ ok: true });
}));
router.get('/leads', wrap(async (req, res) => {
  const r = await q('SELECT * FROM leads ORDER BY (status=\'new\') DESC, id DESC LIMIT 300');
  res.json({ items: r.rows });
}));
router.put('/leads/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  if (!['new', 'contacted', 'won', 'lost'].includes(req.body.status)) U.fail(400, 'status');
  await q('UPDATE leads SET status=$1, note=COALESCE($2,note) WHERE id=$3', [req.body.status, U.optStr(req.body.note, 400), id]);
  res.json({ ok: true });
}));

/* ---------- AI Visibility Index ---------- */
router.get('/index', wrap(async (req, res) => {
  res.json({ items: (await q('SELECT id,slug,title_en,title_ar,sector,period,published,published_at,answers_total FROM index_editions ORDER BY id DESC')).rows });
}));
router.get('/index/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const e = (await q('SELECT * FROM index_editions WHERE id=$1', [id])).rows[0]; if (!e) U.fail(404, 'not_found');
  res.json({ edition: e, rows: (await q('SELECT rank,name,named_count,note FROM index_rows WHERE edition_id=$1 ORDER BY rank,id', [id])).rows });
}));
async function saveEdition(id, b) {
  const title_en = U.str(b.title_en, 160), title_ar = U.str(b.title_ar, 160);
  if (!title_en || !title_ar) U.fail(400, 'title');
  const total = U.int(b.answers_total, 0, 100000); if (total == null) U.fail(400, 'answers');
  const arr = (v, n, m) => (Array.isArray(v) ? v.slice(0, n).map((x) => U.str(String(x), m)).filter(Boolean) : []);
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 50).map((r, i) => ({ rank: U.int((r || {}).rank, 1, 1000) || i + 1, name: U.str((r || {}).name, 120), named: U.int((r || {}).named_count, 0, 100000), note: U.optStr((r || {}).note, 160) })).filter((r) => r.name && r.named != null);
  if (rows.some((r) => r.named > total)) U.fail(400, 'rows');
  const slug = U.slugify(b.slug || title_en); if (slug.length < 2) U.fail(400, 'slug');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const pub = b.published === true;
    const vals = [slug, title_en, title_ar, U.optStr(b.sector, 80), U.optStr(b.period, 60), JSON.stringify(arr(b.assistants, 10, 40)), JSON.stringify(arr(b.prompts, 40, 240)), total, U.optStr(b.notes_en, 2000), U.optStr(b.notes_ar, 2000), pub];
    let eid = id;
    if (id) {
      await c.query(`UPDATE index_editions SET slug=$1,title_en=$2,title_ar=$3,sector=$4,period=$5,assistants=$6,prompts=$7,answers_total=$8,notes_en=$9,notes_ar=$10,published=$11,
        published_at=CASE WHEN $11 AND published_at IS NULL THEN now() WHEN NOT $11 THEN NULL ELSE published_at END WHERE id=$12`, [...vals, id]);
    } else {
      eid = (await c.query(`INSERT INTO index_editions(slug,title_en,title_ar,sector,period,assistants,prompts,answers_total,notes_en,notes_ar,published,published_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11 THEN now() END) RETURNING id`, vals)).rows[0].id;
    }
    await c.query('DELETE FROM index_rows WHERE edition_id=$1', [eid]);
    for (const r of rows) await c.query('INSERT INTO index_rows(edition_id,rank,name,named_count,note) VALUES($1,$2,$3,$4,$5)', [eid, r.rank, r.name, r.named, r.note]);
    await c.query('COMMIT');
    return eid;
  } catch (e) { await c.query('ROLLBACK'); if (e.code === '23505') U.fail(409, 'slug_taken'); throw e; } finally { c.release(); }
}
router.post('/index', wrap(async (req, res) => res.json({ id: await saveEdition(null, req.body || {}) })));
router.put('/index/:id', wrap(async (req, res) => { const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id'); res.json({ id: await saveEdition(id, req.body || {}) }); }));
router.delete('/index/:id', wrap(async (req, res) => { await q('DELETE FROM index_editions WHERE id=$1', [U.int(req.params.id, 1) || 0]); res.json({ ok: true }); }));


/* ================= v6: integrations, plans, billing, automation ================= */
const C = require('./config');
const W = require('./engine/worker');
const AS = require('./engine/assistants');
const B = require('./billing');

router.get('/integrations', wrap(async (req, res) => {
  const jobs = (await q("SELECT status, count(*)::int n FROM jobs GROUP BY status")).rows;
  const today = (await q("SELECT count(*)::int n FROM runs WHERE kind='score' AND started_at > now() - interval '1 day'")).rows[0].n;
  res.json(Object.assign(C.status(), { jobs, free_scores_today: today, webhook_url: C.publicUrl() + '/api/ziina/webhook' }));
}));
router.post('/integrations/test', U.limit('itest', 30, 3600e3), wrap(async (req, res) => {
  const name = U.str((req.body || {}).name, 20);
  try {
    if (C.ai[name]) {
      if (!C.ai[name].key()) U.fail(400, 'not_connected');
      const r = await AS.ask(name, 'Name one well-known coffee shop in Dubai. Answer in one short line.', 'en');
      return res.json({ ok: true, sample: r.text.slice(0, 200), sources: r.sources.slice(0, 3) });
    }
    if (name === 'ziina') { const pi = await B.ziina('POST', '/payment_intent', { amount: 200, currency_code: 'AED', message: 'Tawsiya connection test (not charged)', test: true }); return res.json({ ok: !!pi.id, sample: 'Connected: test payment ' + pi.id + ' created (test mode, nothing charged)' + (C.ziina.test() ? '. Checkout is in TEST mode.' : '. Checkout is LIVE.') }); }
    if (name === 'email') { const M = require('./mail'); const r = await M.send(C.mail.admin() || req.user.email, 'test', 'en', 'Tawsiya email test', ['If you can read this, email sending works.']); return res.json({ ok: !!r.ok, sample: r.ok ? 'Sent to ' + (C.mail.admin() || req.user.email) : (r.error || 'not connected') }); }
    U.fail(400, 'unknown');
  } catch (e) { if (e.status && e.code && !e.provider) throw e; return res.json({ ok: false, sample: String(e.message).slice(0, 200) }); }
}));

/* plans */
router.get('/plans', wrap(async (req, res) => res.json({ items: (await q('SELECT * FROM plans ORDER BY sort, price_fils')).rows })));
router.put('/plans/:key', wrap(async (req, res) => {
  const key = U.str(req.params.key, 30).toLowerCase(); if (!/^[a-z0-9-]{2,30}$/.test(key)) U.fail(400, 'key');
  const b = req.body || {};
  const price = Math.round(Number(b.price) * 100); if (!Number.isFinite(price) || price < 0 || price > 10000000) U.fail(400, 'price');
  if (key === 'free' && price !== 0) U.fail(400, 'price');
  const interval = ['month', 'year', 'once'].includes(b.interval) ? b.interval : 'month';
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => U.str(String(x), 160)).filter(Boolean).slice(0, 12);
  const L = b.limits || {};
  const limits = { questions: U.int(L.questions, 1, 60) || 4, weekly: L.weekly === true, competitors: U.int(L.competitors, 0, 30) || 0, manual_runs_per_week: U.int(L.manual_runs_per_week, 0, 14) || 0 };
  const name_en = U.str(b.name_en, 60), name_ar = U.str(b.name_ar, 60); if (!name_en || !name_ar) U.fail(400, 'name');
  const prev = (await q('SELECT price_fils, interval, name_en FROM plans WHERE key=$1', [key])).rows[0];
  await q(`INSERT INTO plans(key,name_en,name_ar,blurb_en,blurb_ar,price_fils,interval,features_en,features_ar,limits,active,featured,sort,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()) ON CONFLICT (key) DO UPDATE SET name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, blurb_en=EXCLUDED.blurb_en, blurb_ar=EXCLUDED.blurb_ar,
    price_fils=EXCLUDED.price_fils, interval=EXCLUDED.interval, features_en=EXCLUDED.features_en, features_ar=EXCLUDED.features_ar, limits=EXCLUDED.limits, active=EXCLUDED.active,
    featured=EXCLUDED.featured, sort=EXCLUDED.sort, updated_at=now()`,
    [key, name_en, name_ar, U.optStr(b.blurb_en, 200), U.optStr(b.blurb_ar, 200), price, interval, JSON.stringify(list(b.features_en)), JSON.stringify(list(b.features_ar)), limits, b.active !== false, b.featured === true, U.int(b.sort, 0, 99) || 0]);
  res.json({ ok: true, changed_price: !!(prev && (prev.price_fils !== price || prev.interval !== interval)) });
}));

/* billing */
router.get('/subscriptions', wrap(async (req, res) => {
  const r = await q(`SELECT s.*, u.email, u.name, p.price_fils FROM subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN plans p ON p.key=s.plan_key ORDER BY (s.status='active') DESC, s.current_period_end NULLS FIRST, s.id DESC LIMIT 300`);
  const mrr = (await q(`SELECT COALESCE(sum(CASE WHEN p.interval='year' THEN p.price_fils/12 ELSE p.price_fils END),0)::int n FROM subscriptions s JOIN plans p ON p.key=s.plan_key WHERE s.status='active' AND s.source='ziina' AND (s.current_period_end IS NULL OR s.current_period_end > now())`)).rows[0].n;
  const month = (await q(`SELECT COALESCE(sum(amount_fils),0)::int n FROM payments WHERE status='paid' AND created_at > date_trunc('month', now() AT TIME ZONE 'Asia/Dubai')`)).rows[0].n;
  res.json({ items: r.rows, mrr: mrr / 100, month: month / 100 });
}));
router.post('/ziina/webhook', U.limit('zwh', 10, 3600e3), wrap(async (req, res) => {
  if (!C.ziina.key()) U.fail(503, 'billing_off');
  const body = { url: C.publicUrl() + '/api/ziina/webhook' };
  if (C.ziina.whsec()) body.secret = C.ziina.whsec();
  try { const r = await B.ziina('POST', '/webhook', body); return res.json({ ok: r.success !== false, sample: r.success !== false ? 'Webhook registered: ' + body.url + (body.secret ? ' (signed)' : ' (unsigned: set ZIINA_WEBHOOK_SECRET)') : (r.error || 'failed') }); }
  catch (e) { return res.json({ ok: false, sample: e.message }); }
}));
router.post('/payments/check/:intent', wrap(async (req, res) => res.json(await B.applyIntent(U.str(req.params.intent, 100)))));
router.get('/checkouts', wrap(async (req, res) => res.json({ items: (await q('SELECT c.*, u.email FROM checkouts c JOIN users u ON u.id=c.user_id ORDER BY c.id DESC LIMIT 200')).rows })));
router.get('/payments', wrap(async (req, res) => {
  const r = await q('SELECT p.*, u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT 300');
  res.json({ items: r.rows });
}));

/* automation */
router.get('/runs', wrap(async (req, res) => {
  const r = await q(`SELECT id,business_id,request_id,kind,status,site,business_name,answers_total,answers_named,assistants,error,started_at,finished_at FROM runs ORDER BY id DESC LIMIT 200`);
  res.json({ items: r.rows });
}));
router.get('/runs/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const run = (await q('SELECT * FROM runs WHERE id=$1', [id])).rows[0]; if (!run) U.fail(404, 'not_found');
  const answers = (await q('SELECT * FROM run_answers WHERE run_id=$1 ORDER BY id', [id])).rows;
  res.json({ run, answers });
}));
router.post('/businesses/:id/run', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = (await q('SELECT id, website FROM businesses WHERE id=$1', [id])).rows[0]; if (!b) U.fail(404, 'not_found');
  if (!b.website) U.fail(400, 'website');
  res.json({ job: await W.enqueue('weekly', { business_id: id, manual: false }) });
}));
router.post('/requests/:id/auto', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  await q("UPDATE score_requests SET status='new' WHERE id=$1 AND status<>'done'", [id]);
  res.json({ job: await W.enqueue('score', { request_id: id }) });
}));
router.get('/jobs', wrap(async (req, res) => res.json({ items: (await q('SELECT * FROM jobs ORDER BY id DESC LIMIT 200')).rows })));
router.post('/jobs/:id/retry', wrap(async (req, res) => {
  await q("UPDATE jobs SET status='queued', run_at=now(), attempts=0 WHERE id=$1 AND status IN ('failed','done')", [U.int(req.params.id, 1) || 0]);
  res.json({ ok: true });
}));
router.post('/scheduler/run', wrap(async (req, res) => res.json({ enqueued: await W.schedule() })));
router.get('/emails', wrap(async (req, res) => res.json({ items: (await q('SELECT * FROM emails ORDER BY id DESC LIMIT 200')).rows })));
router.put('/businesses/:id/plan', wrap(async (req, res) => {
  /* put a business on a plan without online payment (e.g. founding clients paying by bank transfer) */
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = (await q('SELECT owner_id FROM businesses WHERE id=$1', [id])).rows[0]; if (!b || !b.owner_id) U.fail(404, 'not_found');
  const key = U.str((req.body || {}).plan, 30);
  await q("UPDATE subscriptions SET status='canceled', updated_at=now() WHERE user_id=$1 AND status='active'", [b.owner_id]);
  if (key && key !== 'free') {
    if (!(await B.getPlan(key))) U.fail(400, 'plan');
    const until = U.isDate(String((req.body || {}).until || '')) ? req.body.until : null;
    await q("INSERT INTO subscriptions(user_id,business_id,plan_key,status,source,current_period_end) VALUES($1,$2,$3,'active','manual',$4)", [b.owner_id, id, key, until]);
  }
  res.json({ ok: true });
}));

module.exports = { router };
