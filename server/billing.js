'use strict';
/* Plans and payments through Ziina (UAE). Ziina takes one-off card / Apple Pay / Google Pay payments, so plans are
   PREPAID: each payment buys one period (month or year). Before the period ends we email a renewal link; if it is not
   renewed, the account returns to the free plan after a short grace period. Nothing is charged automatically. */
const express = require('express');
const crypto = require('crypto');
const { q, pool } = require('./db');
const U = require('./util');
const A = require('./auth');
const C = require('./config');
const M = require('./mail');

const GRACE_DAYS = 0, MIN_FILS = 200; // a plan ends exactly when its paid period ends // Ziina minimum is AED 2
const ZIINA_IPS = ['3.29.184.186', '3.29.190.95', '20.233.47.127', '13.202.161.181'];
const wrap = U.wrap;

/* ---------------- Ziina client ---------------- */
async function ziina(method, path, body) {
  if (!C.ziina.key()) U.fail(503, 'billing_off');
  const r = await fetch(C.ziina.base() + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + C.ziina.key(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) { const e = new Error('ziina ' + r.status + ' ' + ((j && (j.message || j.error)) || t).toString().slice(0, 200)); e.status = 502; e.code = 'billing_error'; e.provider = true; throw e; }
  return j || {};
}
function verifySig(raw, header, secret) {
  if (!secret || !header) return false;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const got = String(header).trim().toLowerCase();
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/* ---------------- plans + entitlement ---------------- */
async function getPlan(key) { return (await q('SELECT * FROM plans WHERE key=$1', [key])).rows[0] || null; }
async function freePlan() {
  return (await getPlan('free')) || { key: 'free', name_en: 'Free', name_ar: 'مجانية', price_fils: 0, interval: 'month', limits: { questions: 4, weekly: false, competitors: 0, manual_runs_per_week: 0 } };
}
/* a live plan: active and inside its paid period. Plans bought with Ziina test payments only count while test mode is on. */
const LIVE_SQL = () => `status='active' AND (current_period_end IS NULL OR current_period_end > now() - interval '${GRACE_DAYS} days')${C.ziina.test() ? '' : ' AND NOT test'}`;
async function currentSub(userId) { return (await q(`SELECT * FROM subscriptions WHERE user_id=$1 AND ${LIVE_SQL()} ORDER BY id DESC LIMIT 1`, [userId])).rows[0] || null; }
async function entitlement(userId) {
  const sub = await currentSub(userId);
  const plan = (sub && (await getPlan(sub.plan_key))) || (await freePlan());
  return { plan, sub, limits: Object.assign({ questions: 4, weekly: false, competitors: 0, manual_runs_per_week: 0 }, plan.limits || {}) };
}
const pubPlan = (p) => ({ key: p.key, name_en: p.name_en, name_ar: p.name_ar, blurb_en: p.blurb_en, blurb_ar: p.blurb_ar, price: p.price_fils / 100, currency: p.currency,
  interval: p.interval, features_en: p.features_en, features_ar: p.features_ar, limits: p.limits, featured: p.featured });
const pubSub = (s) => s && { plan_key: s.plan_key, status: s.current_period_end && new Date(s.current_period_end) < new Date() ? 'grace' : s.status, source: s.source,
  current_period_end: s.current_period_end, renew_soon: !!(s.current_period_end && new Date(s.current_period_end) - Date.now() < 10 * 86400e3) };
/* one calendar month (or year) later, same time of day; 31 Jan -> 28/29 Feb, never spilling into the next month */
const addPeriod = (from, interval) => {
  const d = new Date(from), day = d.getUTCDate();
  d.setUTCDate(1);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
};

/* What a checkout for this plan costs now, and what it buys.
   renew: same plan -> one more period added after the current end.
   change: different plan -> starts today; unused days of the current paid period are credited. */
async function quote(userId, plan) {
  const sub = await currentSub(userId);
  if (plan.interval === 'once') return { kind: 'once', amount: plan.price_fils, credit: 0 };
  if (!sub || sub.source === 'manual' && !sub.current_period_end) return { kind: 'new', amount: plan.price_fils, credit: 0 };
  if (sub.plan_key === plan.key) return { kind: 'renew', amount: plan.price_fils, credit: 0 };
  const cur = await getPlan(sub.plan_key);
  let credit = 0;
  if (cur && cur.price_fils > 0 && sub.current_period_end && sub.source === 'ziina') {
    const left = Math.max(0, new Date(sub.current_period_end) - Date.now());
    credit = Math.floor(cur.price_fils * left / addPeriod(0, cur.interval).getTime());
  }
  const amount = Math.max(MIN_FILS, plan.price_fils - credit);
  // credit larger than the new price becomes extra time on the new plan
  const leftover = Math.max(0, credit - (plan.price_fils - amount));
  const bonus = plan.price_fils > 0 ? Math.floor(leftover / plan.price_fils * addPeriod(0, plan.interval).getTime() / 1000) : 0;
  return { kind: 'change', amount, credit, bonus };
}

const pre = (u) => (u.lang === 'en' ? '/en' : '');
const dashUrl = (u) => C.publicUrl() + pre(u) + '/dashboard/';
const plansUrl = (u) => C.publicUrl() + pre(u) + '/plans/';

/* Apply a payment intent: always re-read it from Ziina (never trust a webhook body), then activate once. */
async function applyIntent(intentId) {
  const co = (await q('SELECT * FROM checkouts WHERE intent_id=$1', [intentId])).rows[0];
  if (!co) return { status: 'unknown' };
  if (co.status !== 'pending') return { status: co.status };
  const pi = await ziina('GET', '/payment_intent/' + encodeURIComponent(intentId));
  if (pi.status === 'failed' || pi.status === 'canceled') { await q("UPDATE checkouts SET status=$1 WHERE id=$2 AND status='pending'", [pi.status === 'failed' ? 'failed' : 'canceled', co.id]); return { status: pi.status }; }
  if (pi.status !== 'completed') return { status: pi.status || 'pending' };
  if (Number(pi.amount) !== co.amount_fils || String(pi.currency_code).toUpperCase() !== 'AED') { console.error('ziina amount mismatch', intentId, pi.amount, co.amount_fils); return { status: 'mismatch' }; }

  const c = await pool.connect(); let done = false, plan, user;
  try {
    await c.query('BEGIN');
    const claim = await c.query("UPDATE checkouts SET status='completed', completed_at=now() WHERE id=$1 AND status='pending' RETURNING *", [co.id]);
    if (claim.rowCount) {
      plan = (await c.query('SELECT * FROM plans WHERE key=$1', [co.plan_key])).rows[0];
      user = (await c.query('SELECT id,email,lang,name FROM users WHERE id=$1', [co.user_id])).rows[0];
      const biz = (await c.query('SELECT id FROM businesses WHERE owner_id=$1 ORDER BY id LIMIT 1', [co.user_id])).rows[0];
      await c.query(`INSERT INTO payments(user_id,provider_ref,amount_fils,currency,description,status,plan_key) VALUES($1,$2,$3,'aed',$4,'paid',$5) ON CONFLICT (provider_ref) DO NOTHING`,
        [co.user_id, intentId, co.amount_fils, `${plan ? plan.name_en : co.plan_key} (${co.kind})${co.test ? ' [TEST]' : ''}`, co.plan_key]);
      if (co.kind === 'once') {
        if (biz) await c.query('INSERT INTO tasks(business_id,title,body) VALUES($1,$2,$3)', [biz.id, (user.lang === 'en' ? 'Paid: ' : 'مدفوع: ') + (user.lang === 'en' ? plan.name_en : plan.name_ar),
          user.lang === 'en' ? 'Thank you. Our team will contact you on WhatsApp within one working day to start.' : 'شكراً لك. سيتواصل فريقنا معك عبر واتساب خلال يوم عمل لبدء العمل.']);
        await c.query("INSERT INTO leads(kind,name,contact,intent,payload,lang,status) VALUES('project',$1,$2,'paid',$3,$4,'won')", [user.name, user.email, { plan: co.plan_key, amount: String(co.amount_fils / 100) }, user.lang]);
      } else {
        const sub = (await c.query(`SELECT * FROM subscriptions WHERE user_id=$1 AND ${LIVE_SQL()} ORDER BY id DESC LIMIT 1`, [co.user_id])).rows[0];
        if (co.kind === 'renew' && sub && sub.plan_key === co.plan_key) {
          const from = sub.current_period_end && new Date(sub.current_period_end) > new Date() ? sub.current_period_end : new Date();
          await c.query("UPDATE subscriptions SET current_period_end=$1, status='active', source='ziina', reminded_at=NULL, updated_at=now() WHERE id=$2", [addPeriod(from, plan.interval), sub.id]);
        } else {
          await c.query("UPDATE subscriptions SET status='canceled', updated_at=now() WHERE user_id=$1 AND status='active'", [co.user_id]);
          const end = new Date(addPeriod(new Date(), plan.interval).getTime() + (co.bonus_seconds || 0) * 1000);
          await c.query("INSERT INTO subscriptions(user_id,business_id,plan_key,status,source,current_period_end,test) VALUES($1,$2,$3,'active','ziina',$4,$5)", [co.user_id, biz ? biz.id : null, co.plan_key, end, !!co.test]);
        }
        /* a paying client shows up in Admin > Leads (new) and the overview count, and by email below */
        if (co.kind !== 'renew') await c.query("INSERT INTO leads(kind,name,contact,intent,payload,lang,status) VALUES('project',$1,$2,'paid',$3,$4,'new')", [(co.test ? '[TEST] ' : '') + (user.name || ''), user.email, { plan: co.plan_key, amount: String(co.amount_fils / 100), kind: co.kind }, user.lang]);
        if (biz && co.kind === 'new') await c.query(`INSERT INTO jobs(kind,payload) SELECT 'weekly', $1 WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind='weekly' AND status IN ('queued','running') AND payload->>'business_id'=$2)`, [{ business_id: biz.id }, String(biz.id)]);
      }
      done = true;
    }
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; } finally { c.release(); }
  if (done && C.mail.admin()) {
    const amt = (co.amount_fils / 100) + ' AED', who = `${user.name || ''} <${user.email}>`;
    const grow = plan && plan.limits && plan.limits.manual_runs_per_week >= 2;
    M.send(C.mail.admin(), 'paid-admin', 'en', `${co.test ? '[TEST] ' : ''}New payment: ${plan ? plan.name_en : co.plan_key}, ${amt}`,
      [`${who} paid ${amt} for ${plan ? plan.name_en : co.plan_key} (${co.kind}).`, grow ? 'This plan includes doing the fixes for them. Open Admin > Clients and start their action plan.' : 'Their first scan starts automatically. Open Admin > Clients to follow their action plan.']).catch(() => {});
  }
  if (done && co.kind !== 'once') M.tpl('paid', user.email, user.lang, user.lang === 'en' ? plan.name_en : plan.name_ar, dashUrl(user)).catch(() => {});
  return { status: 'completed' };
}

/* ---------------- routes ---------------- */
const router = express.Router();

router.get('/api/plans', wrap(async (req, res) => {
  const r = await q('SELECT * FROM plans WHERE active ORDER BY sort, price_fils');
  res.json({ plans: r.rows.map(pubPlan), billing: !!C.ziina.key() });
}));

router.get('/api/billing', A.requireRole('client'), wrap(async (req, res) => {
  const e = await entitlement(req.user.id);
  const pays = (await q('SELECT amount_fils,currency,description,status,created_at FROM payments WHERE user_id=$1 ORDER BY id DESC LIMIT 24', [req.user.id])).rows;
  res.json({ plan: pubPlan(e.plan), limits: e.limits, subscription: pubSub(e.sub), payments: pays.map((p) => Object.assign(p, { amount: p.amount_fils / 100 })), billing: !!C.ziina.key() });
}));

router.get('/api/billing/quote', A.requireRole('client'), wrap(async (req, res) => {
  const plan = await getPlan(U.str(req.query.plan, 30));
  if (!plan || !plan.active || plan.price_fils <= 0) U.fail(400, 'plan');
  const qt = await quote(req.user.id, plan);
  res.json({ kind: qt.kind, amount: qt.amount / 100, credit: qt.credit / 100, bonus_days: Math.round((qt.bonus || 0) / 86400) });
}));

router.post('/api/billing/checkout', A.requireRole('client'), U.limit('checkout', 20, 3600e3), wrap(async (req, res) => {
  const plan = await getPlan(U.str((req.body || {}).plan, 30));
  if (!plan || !plan.active || plan.price_fils <= 0) U.fail(400, 'plan');
  if (!C.ziina.key()) U.fail(503, 'billing_off');
  const qt = await quote(req.user.id, plan);
  const test = C.ziina.test();
  const co = (await q('INSERT INTO checkouts(user_id,plan_key,kind,amount_fils,bonus_seconds,test) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [req.user.id, plan.key, qt.kind, qt.amount, qt.bonus || 0, test])).rows[0];
  const per = plan.interval === 'once' ? '' : plan.interval === 'year' ? ' – 1 year' : ' – 1 month';
  const pi = await ziina('POST', '/payment_intent', {
    amount: qt.amount, currency_code: 'AED', message: `Tawsiya ${plan.name_en}${per}`.slice(0, 120), test,
    success_url: dashUrl(req.user) + '?checkout=success&pi={PAYMENT_INTENT_ID}',
    cancel_url: plansUrl(req.user) + '?checkout=cancel', failure_url: plansUrl(req.user) + '?checkout=failed'
  });
  if (!pi.id || !pi.redirect_url) U.fail(502, 'billing_error');
  await q('UPDATE checkouts SET intent_id=$1 WHERE id=$2', [pi.id, co.id]);
  res.json({ url: pi.redirect_url, kind: qt.kind, amount: qt.amount / 100 });
}));

/* called by the dashboard when the customer returns from Ziina (works even if the webhook is late) */
router.post('/api/billing/confirm', A.requireRole('client'), U.limit('confirm', 30, 600e3), wrap(async (req, res) => {
  const id = U.str((req.body || {}).pi, 100);
  const co = (await q('SELECT user_id FROM checkouts WHERE intent_id=$1', [id])).rows[0];
  if (!co || co.user_id !== req.user.id) U.fail(404, 'not_found');
  res.json(await applyIntent(id));
}));

function webhook() {
  return [express.raw({ type: '*/*', limit: '512kb' }), wrap(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (C.ziina.checkIp() && !ZIINA_IPS.includes(String(req.ip).replace(/^::ffff:/, ''))) return res.status(403).json({ error: 'ip' });
    if (C.ziina.whsec() && !verifySig(raw, req.headers['x-hmac-signature'], C.ziina.whsec())) return res.status(400).json({ error: 'signature' });
    let ev; try { ev = JSON.parse(raw); } catch (e) { return res.status(400).json({ error: 'bad_json' }); }
    if (ev && ev.event === 'payment_intent.status.updated' && ev.data && typeof ev.data.id === 'string') {
      try { await applyIntent(ev.data.id); } catch (e) { console.error('ziina webhook', e.message); return res.status(500).json({ error: 'handler' }); }
    }
    res.json({ received: true });
  })];
}

/* daily: renewal reminders (7 days and 1 day before the end) and expiry after the grace period */
async function housekeeping() {
  await q(`UPDATE subscriptions SET status='expired', updated_at=now() WHERE status='active' AND current_period_end <= now() - interval '${GRACE_DAYS} days'`);
  /* live mode: plans that came from test payments stop counting */
  if (!C.ziina.test()) await q("UPDATE subscriptions SET status='expired', updated_at=now() WHERE status='active' AND test");
  const due = (await q(`SELECT s.*, u.email, u.lang, p.name_en, p.name_ar, p.price_fils FROM subscriptions s JOIN users u ON u.id=s.user_id JOIN plans p ON p.key=s.plan_key
    WHERE s.status='active' AND s.source='ziina'${C.ziina.test() ? '' : ' AND NOT s.test'} AND s.current_period_end IS NOT NULL AND s.current_period_end > now() AND s.current_period_end < now() + interval '7 days'
      AND (s.reminded_at IS NULL OR (s.current_period_end < now() + interval '1 day' AND s.reminded_at < now() - interval '2 days'))`)).rows;
  for (const s of due) {
    await M.tpl('renew', s.email, s.lang, s.lang === 'en' ? s.name_en : s.name_ar, s.current_period_end, s.price_fils / 100, dashUrl(s));
    await q('UPDATE subscriptions SET reminded_at=now() WHERE id=$1', [s.id]);
  }
  return due.length;
}

module.exports = { router, webhook, entitlement, getPlan, pubPlan, pubSub, applyIntent, housekeeping, ziina, verifySig, quote, addPeriod, GRACE_DAYS };
