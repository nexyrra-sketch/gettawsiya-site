'use strict';
/* Background jobs (Postgres queue, safe with several instances) and the weekly scheduler.
   Job kinds: score {request_id}, weekly {business_id, manual?}. */
const { q } = require('../db');
const C = require('../config');
const U = require('../util');
const M = require('../mail');
const R = require('../render');
const { audit, norm } = require('./audit');
const AS = require('./assistants');
const PR = require('./profile');
const BR = require('./brand');
const SC = require('./scan');

const LABEL = (k) => (C.ai[k] ? C.ai[k].label : k);
const enqueue = (kind, payload, delaySec = 0) => q(`INSERT INTO jobs(kind,payload,run_at) VALUES($1,$2, now() + ($3 || ' seconds')::interval) RETURNING id`, [kind, payload, String(delaySec)]).then((r) => r.rows[0].id);

/* one full run: site audit -> detect the business -> AI answers (discovery + "what do you know about us") -> scores.
   Progress is written to runs.progress as it happens so the report page can show it live. */
function buildQuestions(biz, profile, n) {
  const base = Object.assign({}, profile || {}, biz || {});
  ['category', 'category_ar', 'area', 'city'].forEach((k) => { if (!base[k] && profile && profile[k]) base[k] = profile[k]; });
  if (!base.services && profile && profile.services) base.services = profile.services.join('\n');
  return AS.defaultQuestions(base, n);
}
async function execRun({ kind, business, request, questions, n = 4, lang }) {
  const site = (business && business.website) || (request && request.site);
  const name0 = business ? (business.name_en || business.name_ar) : (request.biz_name || site);
  const rlang = lang || (request && request.lang) || 'ar';
  const run = (await q('INSERT INTO runs(business_id,request_id,kind,site,business_name,token,stage,lang) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [business ? business.id : null, request ? request.id : null, kind, site, name0, U.token(16), 'site', rlang])).rows[0];
  const prog = { stage: 'site', pages: 0, found: null, done: 0, total: 0, feed: [] };
  let saving = Promise.resolve();
  const save = (stage) => { if (stage) prog.stage = stage; const snap = JSON.stringify(prog); saving = saving.then(() => q('UPDATE runs SET stage=$1, progress=$2 WHERE id=$3', [prog.stage, snap, run.id])).catch(() => {}); return saving; };
  try {
    const facts = business ? { name: business.name_en || business.name_ar, name_en: business.name_en, name_ar: business.name_ar, area: business.area, city: business.city }
      : { name: request.biz_name, area: request.area, city: request.city };
    const au = await audit(site, facts, { onStage: (st, d) => { Object.assign(prog, d); return save('site'); } });
    prog.pages = (au.pages || []).length; await save('profile');
    /* the business's real logo, fetched while the assistants answer */
    const logoP = au.error ? Promise.resolve(null) : BR.find(au.signals, au.host).then(async (lg) => {
      if (!lg) return null;
      await q('INSERT INTO run_logos(run_id,type,data,src,w,h) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (run_id) DO UPDATE SET type=EXCLUDED.type, data=EXCLUDED.data, src=EXCLUDED.src, w=EXCLUDED.w, h=EXCLUDED.h',
        [run.id, lg.type, lg.data, String(lg.src || '').slice(0, 500), lg.w || null, lg.h || null]);
      return lg;
    }).catch(() => null);
    const hint = business ? { name: business.name_en || business.name_ar, category: business.category || business.category_ar, area: business.area, city: business.city }
      : { name: request.biz_name, category: request.category, area: request.area, city: request.city && request.city !== 'Dubai' ? request.city : '' };
    const cleanHint = Object.fromEntries(Object.entries(hint).filter(([, v]) => v));
    const profile = au.error ? Object.assign({ name: hint.name || site, city: 'Dubai', city_ar: 'دبي' }, cleanHint) : await PR.detect(au, cleanHint);
    prog.found = { name: profile.name, category: profile.category, category_ar: profile.category_ar, area: profile.area, area_ar: profile.area_ar, city: profile.city, city_ar: profile.city_ar };
    const bname = business ? name0 : (request.biz_name || profile.name || name0);
    await q('UPDATE runs SET business_name=$1, profile=$2 WHERE id=$3', [U.str(bname, 120), JSON.stringify(profile), run.id]);
    const target = business || { name: bname, name_ar: profile.name_ar, website: site, aliases: '' };
    const on = C.assistantsOn();
    let qs = questions && questions.length ? questions : buildQuestions(business, profile, n);
    if (!on.length) qs = [];
    const all = qs.map((x) => Object.assign({ kind: 'discover' }, x));
    if (on.length && (profile.name || bname)) all.push({ q: AS.brandQuestion(Object.assign({}, profile, { name: bname }), rlang), lang: rlang, kind: 'brand' });
    prog.total = all.length * on.length; await save('ai');
    const tracked = business && Array.isArray(business.competitors) ? business.competitors.filter(Boolean) : [];
    let total = 0, named = 0, spent = 0; const counts = new Map(), trackedCounts = new Map(tracked.map((t) => [t, 0])); const rows = [];
    const selfV = AS.variants(target);
    await AS.runAll(target, all, async (row) => {
      row.mentions = row.mentions.filter((m) => !selfV.some((v) => norm(m).includes(v) || v.includes(norm(m))));
      if (!row.error && row.kind !== 'brand') {
        total++; if (row.named) named++;
        row.mentions.forEach((m) => { const k = norm(m); const e = counts.get(k) || { name: m, count: 0 }; e.count++; counts.set(k, e); });
        tracked.forEach((t) => { if (AS.isNamed(row.answer, row.sources, { name: t })) trackedCounts.set(t, trackedCounts.get(t) + 1); });
      }
      rows.push(row);
      spent += row.cost || 0;
      await q('INSERT INTO run_answers(run_id,assistant,question,lang,named,answer,sources,mentions,error,kind,cost_usd,model,searched) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [run.id, row.assistant, row.question, row.lang, row.named, row.answer, JSON.stringify(row.sources.slice(0, 15)), JSON.stringify(row.mentions), row.error || null, row.kind, row.cost || 0, row.model || null, row.searched !== false]);
      prog.done++;
      prog.feed.push({ a: LABEL(row.assistant), k: row.kind, q: row.question.slice(0, 120), y: !!row.named, e: !!row.error, n: row.mentions.slice(0, 3) });
      if (prog.feed.length > 14) prog.feed.shift();
      save();
    }, 6);
    await save('report');
    const competitors = [...trackedCounts].map(([nm, c]) => ({ name: nm, count: c, tracked: true }))
      .concat([...counts.values()].filter((e) => !tracked.some((t) => norm(t) === norm(e.name))).sort((a, b) => b.count - a.count).slice(0, 15));
    const logo = await logoP;
    if (logo) profile.logo = logo.type;
    if (au.signals && au.signals.theme) profile.theme = au.signals.theme;
    if (au.signals && au.signals.home) profile.website = au.signals.home;
    await q('UPDATE runs SET profile=$1 WHERE id=$2', [JSON.stringify(profile), run.id]);
    const sc = SC.compute(au, rows, profile);
    const r = (await q(`UPDATE runs SET status='done', stage='done', audit=$1, answers_total=$2, answers_named=$3, assistants=$4, competitors=$5, scan=$6, summary_en=$7, summary_ar=$8, progress=$9, cost_usd=$11, finished_at=now() WHERE id=$10 RETURNING *`,
      [au, total, named, JSON.stringify(on.map(LABEL)), JSON.stringify(competitors), JSON.stringify(sc), SC.summary(sc, bname, 'en'), SC.summary(sc, profile.name_ar || bname, 'ar'), JSON.stringify(prog), run.id, +spent.toFixed(4)])).rows[0];
    if (business && !business.baseline_run_id) await q('UPDATE businesses SET baseline_run_id=$1 WHERE id=$2 AND baseline_run_id IS NULL', [r.id, business.id]);
    return r;
  } catch (e) {
    await saving;
    await q("UPDATE runs SET status='failed', stage='failed', error=$1, finished_at=now() WHERE id=$2", [String(e.message).slice(0, 300), run.id]);
    throw e;
  }
}

/* estimated AI spend this calendar month (Dubai time), in USD and AED */
async function monthSpend() {
  const r = (await q("SELECT coalesce(sum(cost_usd),0)::float usd, count(*)::int runs FROM runs WHERE started_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'")).rows[0];
  return { usd: r.usd, aed: +(r.usd * C.usdAed).toFixed(2), runs: r.runs };
}
/* tell the owner once a day when the monthly AI budget is reached and free reports are paused */
async function budgetAlert(aed) {
  const day = new Date().toISOString().slice(0, 10);
  const got = (await q("INSERT INTO settings(key,value) VALUES('_budget_alert',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now() WHERE settings.value IS DISTINCT FROM EXCLUDED.value RETURNING key", [JSON.stringify(day)])).rows.length;
  if (!got || !C.mail.admin()) return;
  await M.send(C.mail.admin(), 'budget', 'en', 'Tawsiya: monthly AI budget reached, free reports paused',
    [`Estimated AI spend this month is AED ${Math.round(aed)}, and your budget is AED ${C.aiBudget()}.`, 'New free reports wait in Admin > Scans until you raise the budget (Admin > Money) or the month ends. Paid clients\' weekly scans and your own scans keep running.']);
}

/* report body from a run */
async function questionSummary(runId) {
  const rows = (await q('SELECT question, named, mentions FROM run_answers WHERE run_id=$1 AND error IS NULL ORDER BY id', [runId])).rows;
  const by = new Map();
  rows.forEach((r) => { const e = by.get(r.question) || { q: r.question, named: [], you: false }; if (r.named) e.you = true; (r.mentions || []).forEach((m) => { if (!e.named.includes(m) && e.named.length < 6) e.named.push(m); }); by.set(r.question, e); });
  return [...by.values()];
}
function checksFromAudit(au) {
  const out = {}; R.CHECKS().forEach((c) => { const e = au.checks[c.key] || { status: 'manual', note: '' }; out[c.key] = { pass: e.status === 'pass', status: e.status, note: U.str(e.note || '', 300) }; });
  return out;
}
function summary(checks, lang) {
  const fails = R.CHECKS().filter((c) => checks[c.key] && checks[c.key].status === 'fail').slice(0, 3).map((c) => c[lang]);
  if (!fails.length) return lang === 'en' ? 'Every automatic check passed. Keep facts current and watch the weekly AI answers.' : 'اجتازت جميع الفحوصات التلقائية. حافظ على تحديث المعلومات وتابع إجابات الذكاء الاصطناعي أسبوعياً.';
  return (lang === 'en' ? 'Fix these first:\n' : 'ابدأ بإصلاح هذه:\n') + fails.map((f, i) => `${i + 1}. ${f}`).join('\n');
}

async function jobScore({ request_id }) {
  const rq = (await q('SELECT * FROM score_requests WHERE id=$1', [request_id])).rows[0];
  if (!rq || rq.status === 'done' || rq.status === 'closed') return 'skip';
  const admin = rq.source === 'admin';
  const today = (await q("SELECT count(*)::int n FROM runs WHERE kind='score' AND started_at > now() - interval '1 day'")).rows[0].n;
  if (!admin && today >= C.freePerDay()) return 'daily_cap: left for manual check';
  if (!admin && C.aiBudget() > 0 && C.assistantsOn().length) {
    const m = await monthSpend();
    if (m.aed >= C.aiBudget()) { budgetAlert(m.aed).catch(() => {}); return 'budget_cap: left for manual check'; }
  }
  await q("UPDATE score_requests SET status='working', updated_at=now() WHERE id=$1", [rq.id]);
  const biz = rq.business_id ? (await q('SELECT * FROM businesses WHERE id=$1', [rq.business_id])).rows[0] : null;
  const run = await execRun({ kind: 'score', business: biz && biz.website ? biz : null, request: rq, questions: null, n: 4, lang: rq.lang });
  const qs = (await q("SELECT DISTINCT question FROM run_answers WHERE run_id=$1 AND kind='discover'", [run.id])).rows;
  const checks = checksFromAudit(run.audit);
  const score = Object.values(checks).filter((c) => c.pass).length;
  const publish = admin || (C.autoPublish() && C.assistantsOn().length > 0 && qs.length > 0);
  const token = U.token(18);
  const rep = (await q(`INSERT INTO score_reports(request_id,business_id,token,site,business_name,score,checks,answers_total,answers_named,assistants,questions,summary_en,summary_ar,published,auto,run_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15)
    ON CONFLICT (request_id) DO UPDATE SET score=EXCLUDED.score, checks=EXCLUDED.checks, answers_total=EXCLUDED.answers_total, answers_named=EXCLUDED.answers_named,
      assistants=EXCLUDED.assistants, questions=EXCLUDED.questions, summary_en=EXCLUDED.summary_en, summary_ar=EXCLUDED.summary_ar, run_id=EXCLUDED.run_id, auto=TRUE
    RETURNING *`,
    [rq.id, rq.business_id, token, rq.site, run.business_name, score, checks, run.answers_total, run.answers_named, JSON.stringify(run.assistants),
      JSON.stringify(await questionSummary(run.id)), summary(checks, 'en'), summary(checks, 'ar'), publish, run.id])).rows[0];
  await q('UPDATE score_requests SET status=$1, run_id=$2, updated_at=now() WHERE id=$3', ['done', run.id, rq.id]);
  const fresh = (await q('SELECT contact FROM score_requests WHERE id=$1', [rq.id])).rows[0];
  if (!admin && fresh && fresh.contact && U.isEmail(fresh.contact.toLowerCase())) {
    await M.tpl('report', fresh.contact, rq.lang, rq.site, run.scan ? run.scan.overall : score, run.answers_named, run.answers_total, `${C.publicUrl()}${rq.lang === 'en' ? '/en' : ''}/report/${rq.token}/`);
  }
  return `report ready: ${run.scan ? run.scan.overall : '?'} / 100` + (publish ? '' : ' (no AI answers: check connections)');
}

async function syncTasks(biz, sc, lang) {
  /* one task per problem found; closes itself when a later check passes. Tasks belong to Tawsiya by default (done-for-you). */
  if (!sc) return;
  const open = (await q("SELECT id, finding_key, check_key FROM tasks WHERE business_id=$1 AND status<>'done' AND (finding_key IS NOT NULL OR check_key IS NOT NULL)", [biz.id])).rows;
  const en = lang === 'en';
  for (const f of sc.findings) {
    if (open.some((t) => (t.finding_key || t.check_key) === f.key)) continue;
    const d = SC.F[f.key][en ? 3 : 4];
    await q('INSERT INTO tasks(business_id,title,body,check_key,finding_key,priority,owner) VALUES($1,$2,$3,$4,$4,$5,$6)',
      [biz.id, d.t, d.fix + (f.note ? '\n' + f.note : ''), f.key, f.severity === 'high' ? 1 : f.severity === 'medium' ? 2 : 3, ['reviews', 'gbp'].includes(f.key) ? 'client' : 'tawsiya']);
  }
  for (const t of open) { const k = t.finding_key || t.check_key; if (sc.checks[k] && sc.checks[k].status === 'pass') await q("UPDATE tasks SET status='done', done_at=now(), updated_at=now() WHERE id=$1", [t.id]); }
}

async function jobWeekly({ business_id, manual }) {
  const biz = (await q('SELECT * FROM businesses WHERE id=$1', [business_id])).rows[0];
  if (!biz || !biz.website) return 'skip: no website';
  if (!biz.category && !biz.category_ar) { // borrow the category from a Score request for the same site
    const sr = (await q("SELECT category, area FROM score_requests WHERE (business_id=$1 OR site=$2) AND category IS NOT NULL ORDER BY id DESC LIMIT 1", [biz.id, biz.website])).rows[0];
    if (sr) { const ar = /[\u0600-\u06FF]/.test(sr.category); biz[ar ? 'category_ar' : 'category'] = sr.category; biz.area = biz.area || sr.area;
      await q(`UPDATE businesses SET ${ar ? 'category_ar' : 'category'}=$1, area=COALESCE(area,$2) WHERE id=$3`, [sr.category, sr.area, biz.id]); }
  }
  const owner = (await q('SELECT id,email,lang,name FROM users WHERE id=$1', [biz.owner_id])).rows[0];
  const B = require('../billing');
  const ent = owner ? await B.entitlement(owner.id) : { limits: { questions: 4 } };
  let qs = (Array.isArray(biz.questions) ? biz.questions : []).filter((x) => x && x.q).slice(0, ent.limits.questions);
  if (!qs.length && biz.baseline_run_id) { // same questions as the "before" scan, so before/after is a fair comparison
    qs = (await q("SELECT question AS q, min(lang) AS lang FROM run_answers WHERE run_id=$1 AND kind='discover' GROUP BY question ORDER BY min(id)", [biz.baseline_run_id])).rows.slice(0, Math.max(4, ent.limits.questions));
  }
  /* the plan sets how many questions are asked: keep the baseline questions first (fair before/after), then top up to the plan's number */
  const own = Array.isArray(biz.questions) && biz.questions.some((x) => x && x.q);   // questions the client chose themselves are never changed
  if (!own && qs.length && qs.length < ent.limits.questions) {
    const base = biz.baseline_run_id ? (await q('SELECT profile FROM runs WHERE id=$1', [biz.baseline_run_id])).rows[0] : null;
    const have = new Set(qs.map((x) => norm(x.q)));
    const extra = buildQuestions(biz, base && base.profile, ent.limits.questions + 8).filter((x) => !have.has(norm(x.q)));
    qs = qs.concat(extra).slice(0, ent.limits.questions);
  }
  const run = await execRun({ kind: manual ? 'manual' : 'weekly', business: biz, questions: qs.length ? qs : null, n: ent.limits.questions, lang: owner && owner.lang === 'en' ? 'en' : 'ar' });
  const prev = (await q('SELECT answers_named, answers_total FROM ai_checks WHERE business_id=$1 ORDER BY week_of DESC LIMIT 1', [biz.id])).rows[0];
  if (run.answers_total > 0) {
    await q(`INSERT INTO ai_checks(business_id,week_of,answers_total,answers_named,assistants,note,run_id) VALUES($1, date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date, $2,$3,$4,$5,$6)
      ON CONFLICT (business_id, week_of) DO UPDATE SET answers_total=EXCLUDED.answers_total, answers_named=EXCLUDED.answers_named, assistants=EXCLUDED.assistants, run_id=EXCLUDED.run_id`,
      [biz.id, run.answers_total, run.answers_named, JSON.stringify(run.assistants), null, run.id]);
  }
  const lang = owner && owner.lang === 'en' ? 'en' : 'ar';
  await syncTasks(biz, run.scan, lang);
  await q('UPDATE businesses SET last_run_at=now() WHERE id=$1', [biz.id]);
  if (owner && run.answers_total > 0) {
    await M.tpl('weekly', owner.email, owner.lang, biz.name_en || biz.name_ar, run.answers_named, run.answers_total, prev ? `${prev.answers_named}/${prev.answers_total}` : null, `${C.publicUrl()}${lang === 'en' ? '/en' : ''}/dashboard/`);
  }
  return `run ${run.id}: ${run.answers_named}/${run.answers_total}`;
}

const HANDLERS = { score: jobScore, weekly: jobWeekly };

async function claim() {
  const r = await q(`UPDATE jobs SET status='running', locked_at=now(), attempts=attempts+1 WHERE id=(
    SELECT id FROM jobs WHERE status='queued' AND run_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
  return r.rows[0] || null;
}
async function runOne() {
  const job = await claim();
  if (!job) return false;
  try {
    const out = await HANDLERS[job.kind](job.payload || {});
    await q("UPDATE jobs SET status='done', done_at=now(), last_error=$1 WHERE id=$2", [out ? String(out).slice(0, 300) : null, job.id]);
  } catch (e) {
    const again = job.attempts < 3;
    await q(`UPDATE jobs SET status=$1, last_error=$2, run_at=now() + ($3 || ' minutes')::interval WHERE id=$4`, [again ? 'queued' : 'failed', String(e.message).slice(0, 300), String(5 * job.attempts), job.id]);
    console.error('job', job.id, job.kind, e.message);
  }
  return true;
}

/* enqueue weekly runs for paying businesses that are due */
async function schedule() {
  await q("UPDATE jobs SET status='queued' WHERE status='running' AND locked_at < now() - interval '30 minutes'");
  try { await require('../billing').housekeeping(); } catch (e) { console.error('billing housekeeping', e.message); }
  const due = (await q(`SELECT DISTINCT b.id FROM businesses b
    JOIN subscriptions s ON s.user_id=b.owner_id AND s.status = ANY($1) AND (s.current_period_end IS NULL OR s.current_period_end > now())
    JOIN plans p ON p.key=s.plan_key AND COALESCE((p.limits->>'weekly')::boolean, false)
    WHERE b.website IS NOT NULL AND (b.last_run_at IS NULL OR b.last_run_at < now() - interval '7 days')
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.kind='weekly' AND j.status IN ('queued','running') AND j.payload->>'business_id' = b.id::text)`, [['active']])).rows;
  for (const d of due) await enqueue('weekly', { business_id: d.id });
  return due.length;
}

let timer = null, busy = 0, lastSchedule = 0;
function start({ concurrency = 2, intervalMs = 4000 } = {}) {
  if (timer || !C.worker()) return;
  const tick = async () => {
    try {
      if (Date.now() - lastSchedule > 10 * 60e3) { lastSchedule = Date.now(); await schedule(); }
      while (busy < concurrency) {
        busy++;
        const had = await runOne().finally(() => { busy--; });
        if (!had) break;
      }
    } catch (e) { console.error('worker', e.message); }
  };
  timer = setInterval(tick, intervalMs); timer.unref();
  setTimeout(tick, 500).unref();
  console.log('worker on');
}
async function drain(max = 50) { let n = 0; while (n < max && (await runOne())) n++; return n; }
module.exports = { monthSpend, start, enqueue, runOne, drain, schedule, execRun, jobScore, jobWeekly, syncTasks, buildQuestions };
