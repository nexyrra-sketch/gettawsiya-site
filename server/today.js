'use strict';
/* Admin "Today": one screen that says how the business is doing, what to do next,
   and what is still missing before Tawsiya can take money. Read-only. */
const express = require('express');
const { q } = require('./db');
const A = require('./auth');
const U = require('./util');
const C = require('./config');
const S = require('./settings');

const MONTH = "date_trunc('month', now() AT TIME ZONE 'Asia/Dubai') AT TIME ZONE 'Asia/Dubai'";
const safe = (p, d) => p.catch(() => d);
const one = (sql, args) => safe(q(sql, args).then((r) => r.rows[0] || {}), {});
const many = (sql, args) => safe(q(sql, args).then((r) => r.rows), []);

const router = express.Router();
router.use(A.requireRole('admin'));
router.get('/today', U.wrap(async (req, res) => {
  const [money, mrr, clients, vis, rep, leads, followups, expiring, abandoned, failed, resets, partners, review, mytasks, recentPays, runs, firstPaid] = await Promise.all([
    one(`SELECT coalesce(sum(amount_fils),0)::int fils, count(*)::int n FROM payments WHERE status='paid' AND created_at >= ${MONTH} AND coalesce(description,'') NOT LIKE '%[TEST]%'`),
    one(`SELECT coalesce(sum(CASE p.interval WHEN 'year' THEN p.price_fils/12.0 WHEN 'month' THEN p.price_fils ELSE 0 END),0)::int fils
         FROM subscriptions s JOIN plans p ON p.key=s.plan_key WHERE s.status='active' AND (s.current_period_end IS NULL OR s.current_period_end > now())`),
    one(`SELECT count(*)::int n FROM subscriptions WHERE status='active' AND (current_period_end IS NULL OR current_period_end > now())`),
    one(`SELECT count(DISTINCT vid) FILTER (WHERE at > now() - interval '7 days')::int now, count(DISTINCT vid) FILTER (WHERE at <= now() - interval '7 days')::int prev
         FROM visits WHERE at > now() - interval '14 days'`),
    one(`SELECT count(*) FILTER (WHERE created_at > now() - interval '7 days')::int now, count(*) FILTER (WHERE created_at <= now() - interval '7 days')::int prev
         FROM score_requests WHERE created_at > now() - interval '14 days'`),
    one(`SELECT count(*) FILTER (WHERE lead_status='new')::int fresh, count(*)::int open FROM score_requests
         WHERE business_id IS NULL AND lead_status IN ('new','contacted','talking') AND coalesce(contact,'') <> ''`),
    many(`SELECT s.id, s.token, s.site, s.contact, s.lang, s.lead_status, s.created_at, coalesce(r.business_name, s.biz_name, s.name) AS business_name,
           (r.scan->>'overall')::int AS overall, r.scan->>'grade' AS grade, r.answers_named, r.answers_total
         FROM score_requests s LEFT JOIN LATERAL (SELECT * FROM runs WHERE request_id=s.id ORDER BY id DESC LIMIT 1) r ON TRUE
         WHERE s.business_id IS NULL AND s.lead_status IN ('new','contacted','talking') AND coalesce(s.contact,'') <> ''
         ORDER BY (s.lead_status='new') DESC, s.id DESC LIMIT 6`),
    many(`SELECT s.id, s.plan_key, s.current_period_end, u.name, u.email, u.phone, b.id AS business_id, coalesce(b.name_en, b.name_ar) AS business
         FROM subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN businesses b ON b.id=s.business_id
         WHERE s.status='active' AND s.current_period_end BETWEEN now() AND now() + interval '7 days' ORDER BY s.current_period_end LIMIT 10`),
    many(`SELECT c.id, c.plan_key, c.amount_fils, c.created_at, u.name, u.email, u.phone FROM checkouts c JOIN users u ON u.id=c.user_id
         WHERE c.status='pending' AND NOT c.test AND c.created_at BETWEEN now() - interval '7 days' AND now() - interval '30 minutes'
         AND NOT EXISTS (SELECT 1 FROM checkouts c2 WHERE c2.user_id=c.user_id AND c2.status='completed' AND c2.created_at > c.created_at)
         ORDER BY c.id DESC LIMIT 10`),
    one(`SELECT (SELECT count(*) FROM jobs WHERE status='failed')::int jobs, (SELECT count(*) FROM runs WHERE status='failed' AND started_at > now() - interval '7 days')::int runs`),
    one('SELECT count(*)::int n FROM reset_requests WHERE NOT handled'),
    one("SELECT count(*)::int n FROM partners WHERE status='pending'"),
    one('SELECT count(*)::int n FROM businesses WHERE needs_review'),
    one("SELECT count(*)::int n, count(DISTINCT business_id)::int biz FROM tasks WHERE status <> 'done' AND coalesce(owner,'tawsiya')='tawsiya'"),
    many(`SELECT p.amount_fils, p.plan_key, p.description, p.created_at, u.name, u.email FROM payments p LEFT JOIN users u ON u.id=p.user_id
         WHERE p.status='paid' ORDER BY p.id DESC LIMIT 5`),
    one("SELECT count(*)::int n, count(*) FILTER (WHERE status='done')::int done FROM runs"),
    one("SELECT count(*)::int n FROM payments WHERE status='paid' AND coalesce(description,'') NOT LIKE '%[TEST]%'")
  ]);

  /* what to do next, most valuable first */
  const todo = [];
  const add = (key, n, text, tab, hint, level) => { if (n > 0) todo.push({ key, n, text, tab, hint: hint || '', level: level || 'do' }); };
  add('abandoned', abandoned.length, abandoned.length === 1 ? 'person opened a payment page but did not pay' : 'people opened a payment page but did not pay', 'billing', 'Message them: ask if they had a problem paying. This is your warmest lead.', 'money');
  add('expiring', expiring.length, expiring.length === 1 ? 'paid plan ends within 7 days' : 'paid plans end within 7 days', 'billing', 'They get reminders by email. A personal WhatsApp keeps more of them.', 'money');
  add('leads', leads.fresh || 0, leads.fresh === 1 ? 'new lead left a contact and has not been messaged' : 'new leads left a contact and have not been messaged', 'scans', 'Send each one their report on WhatsApp the same day.', 'do');
  add('tasks', mytasks.n || 0, (mytasks.n === 1 ? 'action-plan item' : 'action-plan items') + ' for you to do' + (mytasks.biz ? ' (' + mytasks.biz + ' client' + (mytasks.biz > 1 ? 's' : '') + ')' : ''), 'clients', 'Open each client and move items to Done.', 'do');
  add('failed', (failed.jobs || 0) + (failed.runs || 0), ((failed.jobs || 0) + (failed.runs || 0)) === 1 ? 'scan or job failed' : 'scans or jobs failed', 'auto', 'Open Connections, press Test on each assistant, then Retry.', 'fix');
  add('resets', resets.n || 0, resets.n === 1 ? 'password reset request' : 'password reset requests', 'users', 'Create a one-time link and send it on WhatsApp.', 'do');
  add('partners', partners.n || 0, partners.n === 1 ? 'partner sign-up to approve' : 'partner sign-ups to approve', 'partners', '', 'do');
  add('review', review.n || 0, review.n === 1 ? 'business changed its facts and needs a re-check' : 'businesses changed their facts and need a re-check', 'businesses', '', 'do');

  /* launch checklist: what is still missing before taking real money */
  const st = C.status();
  const aiOn = st.assistants.filter((a) => a.on);
  const pub = C.publicUrl();
  const custom = /^https:\/\//.test(pub) && !/onrender\.com|localhost|127\.0\.0\.1/.test(pub);
  const setup = [
    { key: 'ai', done: aiOn.length > 0, label: aiOn.length ? 'AI connected: ' + aiOn.map((a) => a.label).join(', ') : 'Connect at least one AI assistant', tab: 'auto',
      hint: aiOn.length ? (aiOn.length < 4 ? 'Reports are stronger with more assistants. Add OpenAI next when you have the first client.' : '') : 'Add GEMINI_API_KEY in Render > Environment (free).' , optional: aiOn.length > 0 && aiOn.length < 4 },
    { key: 'scan', done: (runs.done || 0) > 0, label: 'Run your first scan', tab: 'scans', hint: 'Scan your own site or a business you know, then open the report.' },
    { key: 'admin_email', done: !!C.mail.admin(), label: 'Admin alerts email (ADMIN_EMAIL)', tab: 'auto', hint: 'Add ADMIN_EMAIL in Render > Environment so new leads and payments reach you.' },
    { key: 'email', done: st.email, label: 'Email sending (Resend)', tab: 'auto', hint: 'Add RESEND_API_KEY and MAIL_FROM in Render > Environment.' },
    { key: 'domain', done: custom, label: custom ? 'Site address: ' + pub.replace(/^https:\/\//, '') : 'Use your own domain (PUBLIC_URL)', tab: 'auto',
      hint: 'Point gettawsiya.com to this service, then set PUBLIC_URL=https://gettawsiya.com in Render. Links in emails and reports use it.' },
    { key: 'places', done: !!st.places, label: 'Google rating and reviews on reports', tab: 'auto', optional: true,
      hint: 'Add GOOGLE_PLACES_API_KEY in Render > Environment. Reports then show each business\'s Google stars and review count.' },
    { key: 'booking', done: !!S.get('booking_url'), label: 'Booking link for free calls', tab: 'traffic', hint: 'Make a free 15-minute Cal.com event and paste the link in Traffic.', optional: true },
    { key: 'ziina', done: st.ziina, label: 'Ziina payments connected', tab: 'auto', hint: 'Add ZIINA_API_KEY in Render > Environment, then press Register webhook in Connections.' },
    { key: 'webhook', done: st.ziina && st.ziina_webhook, label: 'Ziina webhook secret', tab: 'auto', hint: 'Without it, payments are confirmed only when the customer returns to the site.' },
    { key: 'live', done: st.ziina_mode === 'live', label: 'Payments in live mode', tab: 'auto', hint: 'Make one test payment first, then set ZIINA_TEST_MODE=0 in Render.' },
    { key: 'first', done: (firstPaid.n || 0) > 0, label: 'First paying client', tab: 'scans', hint: 'Scan 10 local businesses, send each their report, offer Track at AED 199.' }
  ];

  const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
  res.json({
    now: new Date().toISOString(),
    kpi: {
      money_month: (money.fils || 0) / 100, payments_month: money.n || 0, mrr: (mrr.fils || 0) / 100, clients: clients.n || 0,
      visitors_7d: vis.now || 0, visitors_change: pct(vis.now || 0, vis.prev || 0),
      reports_7d: rep.now || 0, reports_change: pct(rep.now || 0, rep.prev || 0), open_leads: leads.open || 0
    },
    todo, followups, expiring, abandoned, recent_payments: recentPays, setup,
    setup_left: setup.filter((s) => !s.done && !s.optional).length
  });
}));

module.exports = { router };
