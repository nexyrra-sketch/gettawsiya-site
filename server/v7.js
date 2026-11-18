'use strict';
/* v7 routes: live report, report pages, before/after progress, the admin control room (scans, clients, action plans)
   and the client's progress API. */
const express = require('express');
const { q } = require('./db');
const U = require('./util');
const A = require('./auth');
const R = require('./render');
const C = require('./config');
const W = require('./engine/worker');
const SC = require('./engine/scan');
const P = require('./report');
const OG = require('./og');
const fs = require('fs');
const path = require('path');
const { notFound } = require('./pages');

const router = express.Router();
const wrap = U.wrap;
const LANGS = '(/en)?';
const langOf = (req) => (req.path.startsWith('/en/') ? 'en' : 'ar');
const TOK = /^[A-Za-z0-9_-]{16,64}$/;
const contactOk = (c) => U.isEmail(c.toLowerCase()) || /^\+?[\d\s()-]{7,20}$/.test(c);

/* a token is either a run token or a score-request token (the link a visitor gets straight away) */
async function resolve(token) {
  if (!TOK.test(token)) return null;
  let run = (await q('SELECT * FROM runs WHERE token=$1', [token])).rows[0];
  let rq = null;
  if (run) { if (run.request_id) rq = (await q('SELECT * FROM score_requests WHERE id=$1', [run.request_id])).rows[0]; }
  else {
    rq = (await q('SELECT * FROM score_requests WHERE token=$1', [token])).rows[0];
    if (!rq) return null;
    run = (await q('SELECT * FROM runs WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [rq.id])).rows[0] || null;
  }
  return { run, rq };
}
const answersOf = async (runId) => (await q('SELECT assistant,question,lang,kind,named,answer,sources,mentions,error FROM run_answers WHERE run_id=$1 ORDER BY id', [runId])).rows;
const extra = (lang) => `<script src="/assets/js/core.js" defer></script><script src="/assets/js/report.js" defer></script>`;

/* ------------------------------------------------------------------ link previews */
/* what WhatsApp & co. show next to a shared report link: the business, its score and who AI names instead */
const baseUrl = () => C.publicUrl();
const previewOf = (lang, name, sc) => {
  const en = lang === 'en', measured = sc && sc.measured && sc.total > 0;
  const score = Math.round(sc.overall);
  return {
    title: en ? `${name}: ${score}/100 on AI visibility` : `${name}: ${score}/100 في ظهور الذكاء الاصطناعي`,
    desc: measured
      ? (en ? `AI assistants named ${name} in ${sc.named} of ${sc.total} answers. See who they recommend instead and how to fix it.` : `ذكرت مساعدات الذكاء الاصطناعي ${name} في ${sc.named} من ${sc.total} إجابة. شاهد من توصي به بدلاً منه وكيف تصلح ذلك.`)
      : (en ? `See what AI assistants say about ${name} and what to fix first.` : `شاهد ماذا تقول مساعدات الذكاء الاصطناعي عن ${name} وما الذي يجب إصلاحه أولاً.`),
    image: `${baseUrl()}/og/report/${'__T__'}.png?l=${en ? 'en' : 'ar'}`
  };
};
const STATIC_OG = (lang) => path.join(R.SITE_DIR, 'assets', 'img', `og-${lang}.png`);
router.get(/^\/og\/report\/([A-Za-z0-9_-]{16,64})\.png$/, U.limit('og', 120, 60e3), wrap(async (req, res) => {
  const lang = req.query.l === 'en' ? 'en' : 'ar';
  const fallback = () => res.set('Cache-Control', 'public, max-age=300').type('png').sendFile(STATIC_OG(lang));
  try {
    if (!OG.available()) return fallback();
    const x = await resolve(req.params[0]);
    if (!x || !x.run || x.run.status !== 'done' || !x.run.scan) return fallback();
    const sc = x.run.scan, p = x.run.profile || {};
    const name = x.run.business_name || (lang === 'ar' ? p.name_ar || p.name : p.name) || x.run.site || (x.rq && x.rq.site) || '';
    const lg = p.logo ? (await q('SELECT type, data FROM run_logos WHERE run_id=$1', [x.run.id])).rows[0] : null;
    const buf = OG.reportPng({ lang, logo: lg || null, logoKey: x.run.id, name, score: sc.overall, named: sc.named, total: sc.total, measured: !!(sc.measured && sc.total > 0), rival: sc.rivals && sc.rivals[0] ? sc.rivals[0].name : '' });
    res.set('Cache-Control', 'public, max-age=600').type('png').send(buf);
  } catch (e) { fallback(); }
}));

/* the business's own logo, as found on its website when the report was made */
router.get(/^\/brand\/logo\/([A-Za-z0-9_-]{16,64})$/, U.limit('logo', 300, 60e3), wrap(async (req, res) => {
  const x = await resolve(req.params[0]);
  const lg = x && x.run ? (await q('SELECT type, data FROM run_logos WHERE run_id=$1', [x.run.id])).rows[0] : null;
  if (!lg) return res.status(404).set('Cache-Control', 'public, max-age=300').end();
  res.set({ 'Content-Type': lg.type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox", 'Cross-Origin-Resource-Policy': 'same-site' });
  res.send(lg.data);
}));

/* ------------------------------------------------------------------ public pages */
router.get(new RegExp(`^${LANGS}/report/([A-Za-z0-9_-]{16,64})/?$`), wrap(async (req, res) => {
  const lang = langOf(req), token = req.params[1];
  if (!/\/$/.test(req.path)) return res.redirect(301, req.path + '/');
  const x = await resolve(token);
  if (!x) return notFound(req, res);
  const { run, rq } = x;
  const site = (run && run.site) || (rq && rq.site) || '';
  res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex');
  if (run && run.status === 'done' && run.scan) {
    const answers = await answersOf(run.id);
    const p = run.profile || {};
    const name = run.business_name || (lang === 'ar' ? p.name_ar || p.name : p.name) || site;
    const content = P.report({ run, answers, lang, name, site, token });
    const pv = previewOf(lang, name, run.scan);
    return res.send(R.page({ lang, title: pv.title, desc: pv.desc, slug: 'report/' + token, content, index: false, extra: extra(lang), ogImage: pv.image.replace('__T__', token) }));
  }
  if (run && run.status === 'done' && !run.scan && rq) {
    const old = (await q('SELECT token FROM score_reports WHERE request_id=$1', [rq.id])).rows[0];
    if (old) return res.redirect(302, `${lang === 'en' ? '/en' : ''}/score/r/${old.token}/`);
  }
  const content = P.live({ lang, site, token, state: { has_contact: !!(rq && rq.contact) } });
  res.send(R.page({ lang, title: `${site} · ${lang === 'en' ? 'Building your report' : 'نجهز تقريرك'}`, desc: site, slug: 'report/' + token, content, index: false, extra: extra(lang) }));
}));

router.get('/api/scan/:token', U.limit('scan-get', 120, 60e3), wrap(async (req, res) => {
  const x = await resolve(U.str(req.params.token, 64));
  if (!x) U.fail(404, 'not_found');
  const { run, rq } = x;
  if (!run) {
    const queued = rq ? (await q("SELECT status, last_error FROM jobs WHERE kind='score' AND payload->>'request_id'=$1 ORDER BY id DESC LIMIT 1", [String(rq.id)])).rows[0] : null;
    const capped = queued && queued.status === 'done' && /daily_cap|budget_cap/.test(queued.last_error || '');
    return res.json({ stage: capped ? 'held' : 'queued', done: false, failed: false, progress: {}, has_contact: !!(rq && rq.contact) });
  }
  res.json({ stage: run.stage || (run.status === 'done' ? 'done' : 'site'), done: run.status === 'done', failed: run.status === 'failed', progress: run.progress || {}, has_contact: !!(rq && rq.contact),
    overall: run.scan ? run.scan.overall : null });
}));

router.post('/api/scan/:token/contact', U.limit('scan-contact', 10, 3600e3), wrap(async (req, res) => {
  const x = await resolve(U.str(req.params.token, 64));
  if (!x || !x.rq) U.fail(404, 'not_found');
  const c = U.str((req.body || {}).contact, 120);
  if (!c || !contactOk(c)) U.fail(400, 'contact');
  await q('UPDATE score_requests SET contact=COALESCE(contact,$1), updated_at=now() WHERE id=$2', [c, x.rq.id]);
  res.json({ ok: true });
}));

async function progressData(biz) {
  const runs = (await q("SELECT * FROM runs WHERE business_id=$1 AND status='done' AND scan IS NOT NULL ORDER BY id", [biz.id])).rows;
  const a = (biz.baseline_run_id && runs.find((r) => r.id === biz.baseline_run_id)) || runs[0] || null;
  const b = a ? runs.filter((r) => r.id > a.id).pop() || null : null;
  return { a, b, runs };
}
router.get(new RegExp(`^${LANGS}/progress/([A-Za-z0-9_-]{16,64})/?$`), wrap(async (req, res) => {
  const lang = langOf(req), token = req.params[1];
  if (!/\/$/.test(req.path)) return res.redirect(301, req.path + '/');
  const biz = (await q('SELECT * FROM businesses WHERE share_token=$1', [token])).rows[0];
  if (!biz) return notFound(req, res);
  const { a, b } = await progressData(biz);
  const tasks = a ? (await q("SELECT title, client_note, done_at, finding_key FROM tasks WHERE business_id=$1 AND status='done' AND visible AND done_at >= $2 ORDER BY done_at", [biz.id, a.started_at])).rows : [];
  const name = (lang === 'ar' ? biz.name_ar || biz.name_en : biz.name_en || biz.name_ar) || biz.website;
  const content = P.progress({ lang, name, site: biz.website, a, b, answersA: a ? await answersOf(a.id) : [], answersB: b ? await answersOf(b.id) : [], tasks, token });
  res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex')
    .send(R.page({ lang, title: `${name} · ${lang === 'en' ? 'Progress report' : 'تقرير التقدم'}`, desc: name, slug: 'progress/' + token, content, index: false, extra: extra(lang) }));
}));

/* ------------------------------------------------------------------ client */
const runBrief = (r) => r ? { id: r.id, token: r.token, at: r.finished_at || r.started_at, kind: r.kind, overall: r.scan ? r.scan.overall : null, grade: r.scan ? r.scan.grade : null,
  pillars: r.scan ? r.scan.pillars : null, named: r.answers_named, total: r.answers_total, known: r.scan ? r.scan.known : null, brandTotal: r.scan ? r.scan.brandTotal : null, findings: r.scan ? r.scan.findings.length : null } : null;
async function ensureShare(bizId) {
  const b = (await q('SELECT share_token FROM businesses WHERE id=$1', [bizId])).rows[0];
  if (b && b.share_token) return b.share_token;
  const t = U.token(18); await q('UPDATE businesses SET share_token=$1 WHERE id=$2', [t, bizId]); return t;
}
router.get('/api/client/progress', A.requireRole('client'), wrap(async (req, res) => {
  const biz = (await q('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [req.user.id])).rows[0];
  if (!biz) return res.json({ business: null });
  const { a, b, runs } = await progressData(biz);
  const latest = runs[runs.length - 1] || null;
  const tasks = (await q("SELECT id,title,body,status,owner,client_note,priority,done_at,updated_at FROM tasks WHERE business_id=$1 AND visible ORDER BY (status='done'), priority, id", [biz.id])).rows;
  res.json({ business: { id: biz.id }, baseline: runBrief(a), compare: runBrief(b), latest: runBrief(latest), share: runs.length ? await ensureShare(biz.id) : null, tasks });
}));

/* ------------------------------------------------------------------ admin control room */
const admin = express.Router();
admin.use(A.requireRole('admin'));
admin.post('/scans', U.limit('admin-scan', 120, 3600e3), wrap(async (req, res) => {
  const b = req.body || {};
  const site = U.cleanSite(b.site); if (!site) U.fail(400, 'site');
  const token = U.token(18);
  const bizId = U.int(b.business_id, 1) || null;
  const r = await q(`INSERT INTO score_requests(token,site,name,contact,business_id,lang,source,biz_name,category,area,city,status) VALUES($1,$2,$3,$4,$5,$6,'admin',$7,$8,$9,$10,'new') RETURNING id`,
    [token, site, U.optStr(b.contact_name, 100), U.optStr(b.contact, 120), bizId, b.lang === 'en' ? 'en' : 'ar', U.optStr(b.name, 120), U.optStr(b.category, 80), U.optStr(b.area, 80), U.optStr(b.city, 60)]);
  await W.enqueue('score', { request_id: r.rows[0].id });
  res.json({ id: r.rows[0].id, token });
}));
admin.get('/scans', wrap(async (req, res) => {
  const r = await q(`SELECT s.id,s.token,s.site,s.name,s.contact,s.source,s.status,s.lead_status,s.lead_note,s.lang,s.created_at,s.business_id,s.ref_code,
      r.id AS run_id, r.status AS run_status, r.stage, r.business_name, r.answers_named, r.answers_total, (r.scan->>'overall')::int AS overall, r.scan->>'grade' AS grade, r.profile->>'category' AS category, (r.profile->>'logo') IS NOT NULL AS has_logo
    FROM score_requests s LEFT JOIN LATERAL (SELECT * FROM runs WHERE request_id=s.id ORDER BY id DESC LIMIT 1) r ON TRUE ORDER BY s.id DESC LIMIT 300`);
  res.json({ items: r.rows });
}));
admin.put('/scans/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const st = (req.body || {}).lead_status;
  if (st && !['new', 'contacted', 'talking', 'won', 'lost'].includes(st)) U.fail(400, 'lead_status');
  await q('UPDATE score_requests SET lead_status=COALESCE($1,lead_status), lead_note=COALESCE($2,lead_note), updated_at=now() WHERE id=$3', [st || null, 'lead_note' in (req.body || {}) ? U.str(req.body.lead_note, 600) : null, id]);
  res.json({ ok: true });
}));
admin.post('/scans/:id/rerun', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = req.body || {};
  await q(`UPDATE score_requests SET status='new', source='admin', biz_name=COALESCE($1,biz_name), category=COALESCE($2,category), area=COALESCE($3,area), city=COALESCE($4,city) WHERE id=$5`,
    [U.optStr(b.name, 120), U.optStr(b.category, 80), U.optStr(b.area, 80), U.optStr(b.city, 60), id]);
  res.json({ job: await W.enqueue('score', { request_id: id }) });
}));
/* turn a scanned prospect into a client: business record from what the scan detected, the scan becomes the "before" */
admin.post('/scans/:id/client', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const rq = (await q('SELECT * FROM score_requests WHERE id=$1', [id])).rows[0]; if (!rq) U.fail(404, 'not_found');
  const run = (await q("SELECT * FROM runs WHERE request_id=$1 AND status='done' ORDER BY id DESC LIMIT 1", [id])).rows[0];
  let bizId = rq.business_id;
  const p = (run && run.profile) || {};
  let ownerId = null;
  const em = U.str((req.body || {}).owner_email, 254).toLowerCase();
  if (em) { const u = (await q('SELECT id FROM users WHERE email=$1', [em])).rows[0]; if (!u) U.fail(400, 'owner'); ownerId = u.id; }
  if (!bizId && ownerId) { // the owner already signed up: use their business
    const own = (await q('SELECT id, website FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [ownerId])).rows[0];
    if (own) { bizId = own.id; if (!own.website) await q('UPDATE businesses SET website=$1 WHERE id=$2', [rq.site, own.id]); }
  }
  if (!bizId) {
    const nameEn = /[؀-ۿ]/.test(p.name || '') ? null : (p.name || rq.biz_name || null), nameAr = p.name_ar || (/[؀-ۿ]/.test(p.name || '') ? p.name : null);
    const base = U.slugify(nameEn || rq.site.split('.')[0]) || 'business'; let slug = base;
    for (let i = 0; i < 8 && (await q('SELECT 1 FROM businesses WHERE slug=$1', [slug])).rowCount; i++) slug = `${base}-${U.shortCode(3)}`;
    const ins = await q(`INSERT INTO businesses(slug,owner_id,name_en,name_ar,category,category_ar,city,area,website,phone,email,services,baseline_run_id,stage)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'client') RETURNING id`,
      [slug, ownerId, nameEn || (!nameAr ? rq.site : null), nameAr, p.category || rq.category || null, p.category_ar || null, p.city || null, p.area || rq.area || null, rq.site,
        U.optStr(p.phone, 30), p.email && U.isEmail(String(p.email).toLowerCase()) ? p.email : null, (p.services || []).join('\n') || null, run ? run.id : null]);
    bizId = ins.rows[0].id;
  } else if (ownerId) await q('UPDATE businesses SET owner_id=$1 WHERE id=$2 AND owner_id IS NULL', [ownerId, bizId]);
  await q("UPDATE score_requests SET business_id=$1, lead_status='won' WHERE id=$2", [bizId, id]);
  if (run) {
    await q('UPDATE runs SET business_id=$1 WHERE request_id=$2', [bizId, id]);
    await q('UPDATE businesses SET baseline_run_id=COALESCE(baseline_run_id,$1) WHERE id=$2', [run.id, bizId]);
    const biz = (await q('SELECT * FROM businesses WHERE id=$1', [bizId])).rows[0];
    await W.syncTasks(biz, run.scan, rq.lang === 'en' ? 'en' : 'ar');
  }
  res.json({ business_id: bizId });
}));

admin.get('/clients', wrap(async (req, res) => {
  const r = await q(`SELECT b.id,b.slug,b.name_en,b.name_ar,b.website,b.status,b.category,b.area,b.city,b.last_run_at,b.baseline_run_id,b.share_token,u.email AS owner_email,
      (SELECT (scan->>'overall')::int FROM runs WHERE id=b.baseline_run_id) AS before,
      (SELECT (scan->>'overall')::int FROM runs WHERE business_id=b.id AND status='done' AND scan IS NOT NULL ORDER BY id DESC LIMIT 1) AS now,
      (SELECT count(*)::int FROM tasks WHERE business_id=b.id AND status<>'done') AS open_tasks,
      (SELECT count(*)::int FROM tasks WHERE business_id=b.id AND status='done') AS done_tasks,
      (SELECT plan_key FROM subscriptions s WHERE s.user_id=b.owner_id AND s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end > now()) ORDER BY id DESC LIMIT 1) AS plan
    FROM businesses b LEFT JOIN users u ON u.id=b.owner_id ORDER BY b.id DESC LIMIT 300`);
  res.json({ items: r.rows });
}));
admin.get('/clients/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = (await q('SELECT b.*, u.email AS owner_email, u.name AS owner_name, u.phone AS owner_phone FROM businesses b LEFT JOIN users u ON u.id=b.owner_id WHERE b.id=$1', [id])).rows[0];
  if (!b) U.fail(404, 'not_found');
  const runs = (await q('SELECT id,token,kind,status,stage,started_at,finished_at,answers_named,answers_total,scan,error FROM runs WHERE business_id=$1 ORDER BY id DESC LIMIT 60', [id])).rows;
  const latest = runs.find((r) => r.status === 'done' && r.scan);
  const tasks = (await q('SELECT * FROM tasks WHERE business_id=$1 ORDER BY (status=\'done\'), priority, id', [id])).rows;
  const sub = b.owner_id ? (await q("SELECT plan_key,status,source,current_period_end FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 1", [b.owner_id])).rows[0] : null;
  res.json({ business: b, runs: runs.map((r) => Object.assign(runBrief(r), { status: r.status, stage: r.stage, error: r.error })), latest: latest ? { id: latest.id, token: latest.token, findings: latest.scan.findings, rivals: latest.scan.rivals.slice(0, 6), sources: latest.scan.sources.slice(0, 6) } : null,
    tasks, sub, F: Object.fromEntries(Object.keys(SC.F).map((k) => [k, { en: SC.F[k][3].t, pillar: SC.F[k][0] }])) });
}));
admin.put('/clients/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = req.body || {};
  if ('baseline_run_id' in b) { const rid = U.int(b.baseline_run_id, 1); if (!rid || !(await q('SELECT 1 FROM runs WHERE id=$1 AND business_id=$2', [rid, id])).rowCount) U.fail(400, 'run'); await q('UPDATE businesses SET baseline_run_id=$1 WHERE id=$2', [rid, id]); }
  if ('admin_notes' in b) await q('UPDATE businesses SET admin_notes=$1 WHERE id=$2', [U.str(b.admin_notes, 4000), id]);
  res.json({ ok: true });
}));
admin.post('/clients/:id/share', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  if ((req.body || {}).rotate) await q('UPDATE businesses SET share_token=NULL WHERE id=$1', [id]);
  res.json({ token: await ensureShare(id) });
}));
admin.post('/clients/:id/sync', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const biz = (await q('SELECT * FROM businesses WHERE id=$1', [id])).rows[0]; if (!biz) U.fail(404, 'not_found');
  const run = (await q("SELECT scan FROM runs WHERE business_id=$1 AND status='done' AND scan IS NOT NULL ORDER BY id DESC LIMIT 1", [id])).rows[0];
  if (!run) U.fail(400, 'no_scan');
  const lang = (await q('SELECT lang FROM users WHERE id=$1', [biz.owner_id])).rows[0];
  await W.syncTasks(biz, run.scan, lang && lang.lang === 'en' ? 'en' : 'ar');
  res.json({ ok: true });
}));
admin.post('/clients/:id/tasks', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = req.body || {}; const t = U.str(b.title, 160); if (!t) U.fail(400, 'title');
  const r = await q('INSERT INTO tasks(business_id,title,body,owner,priority,visible) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, t, U.optStr(b.body, 1200), b.owner === 'client' ? 'client' : 'tawsiya', [1, 2, 3].includes(+b.priority) ? +b.priority : 2, b.visible !== false]);
  res.json({ task: r.rows[0] });
}));
admin.put('/tasks/:id', wrap(async (req, res) => {
  const id = U.int(req.params.id, 1); if (!id) U.fail(400, 'id');
  const b = req.body || {}, sets = [], vals = [];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if ('status' in b) { if (!['open', 'doing', 'done'].includes(b.status)) U.fail(400, 'status'); set('status', b.status); sets.push(b.status === 'done' ? 'done_at=COALESCE(done_at,now())' : 'done_at=NULL'); }
  if ('owner' in b) set('owner', b.owner === 'client' ? 'client' : 'tawsiya');
  if ('visible' in b) set('visible', !!b.visible);
  if ('client_note' in b) set('client_note', U.optStr(b.client_note, 800));
  if ('title' in b) { const t = U.str(b.title, 160); if (!t) U.fail(400, 'title'); set('title', t); }
  if ('body' in b) set('body', U.optStr(b.body, 1200));
  if ('priority' in b) set('priority', [1, 2, 3].includes(+b.priority) ? +b.priority : 2);
  if (!sets.length) U.fail(400, 'empty');
  vals.push(id);
  const r = await q(`UPDATE tasks SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`, vals);
  if (!r.rowCount) U.fail(404, 'not_found');
  res.json({ task: r.rows[0] });
}));

/* ---------- money: what came in, what it cost, what is left (estimates, AED) ---------- */
const MONTH = "date_trunc('month', now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'";
const ZIINA_FEE = (fils) => (fils * 0.029 + 100) * 1.05;   /* 2.9% + AED 1, plus 5% VAT on the fee */
admin.get('/money', wrap(async (req, res) => {
  const C = require('./config'), S = require('./settings'), AS = require('./engine/assistants');
  const pays = (await q(`SELECT amount_fils FROM payments WHERE status='paid' AND created_at >= ${MONTH} AND coalesce(description,'') NOT LIKE '%[TEST]%'`)).rows;
  const revenue = pays.reduce((n, p) => n + p.amount_fils, 0) / 100, fees = pays.reduce((n, p) => n + ZIINA_FEE(p.amount_fils), 0) / 100;
  const spend = await W.monthSpend();
  const kinds = (await q(`SELECT kind, count(*)::int n, coalesce(sum(cost_usd),0)::float usd FROM runs WHERE started_at >= ${MONTH} GROUP BY kind`)).rows;
  const byAi = (await q(`SELECT a.assistant, count(*)::int n, coalesce(sum(a.cost_usd),0)::float usd, bool_and(a.searched) searched, max(a.model) model FROM run_answers a JOIN runs r ON r.id=a.run_id WHERE r.started_at >= ${MONTH} GROUP BY a.assistant`)).rows;
  const all = (await q("SELECT count(*)::int n, coalesce(sum(cost_usd),0)::float usd FROM run_answers WHERE error IS NULL AND created_at > now() - interval '60 days'").catch(() => ({ rows: [{ n: 0, usd: 0 }] }))).rows[0];
  const on = C.assistantsOn().length || 4;
  /* cost of one answer: measured when we have data, otherwise the planning figure */
  const perAnswer = all.n >= 20 ? all.usd / all.n : 0.02;
  const plans = (await q('SELECT * FROM plans WHERE active ORDER BY sort, price_fils').catch(() => q('SELECT * FROM plans ORDER BY sort, price_fils'))).rows;
  const subs = (await q("SELECT plan_key, count(*)::int n FROM subscriptions WHERE status='active' GROUP BY plan_key")).rows;
  const unit = plans.map((p) => {
    const L = p.limits || {}, price = p.price_fils / 100, qn = (L.questions || 4) + 1;
    const scan = qn * on * perAnswer * C.usdAed;
    const typical = p.price_fils ? scan * (L.weekly ? 4.33 : 0) : scan, max = p.price_fils ? scan * ((L.weekly ? 4.33 : 0) + (L.manual_runs_per_week || 0) * 4.33) : scan;
    const fee = p.price_fils ? ZIINA_FEE(p.price_fils) / 100 : 0;
    return { key: p.key, name: p.name_en, price, interval: p.interval, scan: +scan.toFixed(2), ai: +typical.toFixed(2), ai_max: +max.toFixed(2), fee: +fee.toFixed(2), left: +(price - fee - typical).toFixed(2), left_min: +(price - fee - max).toFixed(2),
      clients: (subs.find((x) => x.plan_key === p.key) || { n: 0 }).n };
  });
  const mrr = unit.reduce((n, u) => n + (u.interval === 'month' ? u.price * u.clients : 0), 0);
  res.json({
    revenue: +revenue.toFixed(2), fees: +fees.toFixed(2), ai: spend.aed, fixed: C.fixedCosts(), left: +(revenue - fees - spend.aed - C.fixedCosts()).toFixed(2),
    mrr, budget: C.aiBudget(), free_per_day: C.freePerDay(), paused: C.aiBudget() > 0 && spend.aed >= C.aiBudget(), measured: all.n >= 20, per_answer_aed: +(perAnswer * C.usdAed).toFixed(3), assistants_on: C.assistantsOn().length,
    kinds: kinds.map((k) => ({ kind: k.kind, n: k.n, aed: +(k.usd * C.usdAed).toFixed(2) })),
    by_ai: byAi.map((a) => ({ assistant: (C.ai[a.assistant] || {}).label || a.assistant, n: a.n, aed: +(a.usd * C.usdAed).toFixed(2), searched: a.searched, model: a.model })),
    unit, breakeven: unit.filter((u) => u.left > 0 && u.price).map((u) => ({ name: u.name, clients: Math.ceil(C.fixedCosts() / u.left) })),
    settings: Object.fromEntries(Object.keys(S.KEYS).map((k) => [k, S.get(k) == null ? '' : S.get(k)])),
    models: Object.keys(C.ai).map((k) => ({ key: k, label: C.ai[k].label, on: !!C.ai[k].key(), chosen: C.ai[k].model(), in_use: AS.modelInUse(k) }))
  });
}));
admin.put('/settings', wrap(async (req, res) => {
  const S = require('./settings'), b = req.body || {};
  for (const k of Object.keys(S.KEYS)) if (k in b) { if (!(await S.set(k, b[k]))) U.fail(400, 'bad_' + k); }
  res.json({ ok: true });
}));

module.exports = { router, admin, resolve };
