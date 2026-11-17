'use strict';
/* Visitor stats, built in: counts page views on the server (no cookies, no third-party script, no IP stored).
   A visitor is a daily hash of IP + browser + date + a secret salt, so the same person is counted once a day
   and cannot be traced back. Sources come from utm_source or the site that linked here (Instagram, ChatGPT...).
   Free reports keep the source of the visit that led to them, so the admin sees which posts bring reports. */
const crypto = require('crypto');
const express = require('express');
const { q } = require('./db');
const A = require('./auth');
const U = require('./util');
const S = require('./settings');

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|monitor|uptime|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|scrapy|ahrefs|semrush|mj12|bytespider|gptbot|claudebot|perplexitybot|google-extended|ccbot/i;
const SKIP = /^\/(api|assets|admin|_tpl)(\/|$)|\.(js|css|png|jpe?g|webp|svg|ico|xml|txt|json|webmanifest|woff2?)$/i;
const MAP = [
  [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'x'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin'], [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)snapchat\.com$/, 'snapchat'], [/(^|\.)(wa\.me|whatsapp\.com)$/, 'whatsapp'], [/(^|\.)(chatgpt\.com|openai\.com)$/, 'chatgpt'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'], [/^gemini\.google\.com$/, 'gemini'], [/(^|\.)claude\.ai$/, 'claude'], [/(^|\.)copilot\.microsoft\.com$/, 'copilot'],
  [/(^|\.)google\.[a-z.]+$/, 'google'], [/(^|\.)bing\.com$/, 'bing'], [/(^|\.)duckduckgo\.com$/, 'duckduckgo'], [/(^|\.)yahoo\.com$/, 'yahoo']
];
const AI_SOURCES = ['chatgpt', 'perplexity', 'gemini', 'claude', 'copilot'];

const clean = (v, n) => { const s = String(v || '').toLowerCase().trim().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 40); return s || null; };
/* where a visit came from: the utm tag wins, then the site that linked here, else "direct" */
function sourceOf(utm, refHost, ownHost) {
  const u = clean(utm); if (u) return u;
  const h = String(refHost || '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  if (!h || (ownHost && h === String(ownHost).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, ''))) return 'direct';
  for (const [re, name] of MAP) if (re.test(h)) return name;
  return clean(h, 60) || 'direct';
}
const hostOf = (url) => { try { return new URL(url).host; } catch (e) { return ''; } };

let salt = null, n = 0;
async function ensureSalt() {
  salt = S.get('_visit_salt');
  if (!salt) { salt = crypto.randomBytes(24).toString('hex'); try { await S.set('_visit_salt', salt); } catch (e) { /* keep the in-memory one */ } }
}
function visitorId(req) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update([salt || 'x', req.ip || '', req.headers['user-agent'] || '', day].join('|')).digest('hex').slice(0, 16);
}

/* middleware: count successful HTML page views (after the response is sent, never slows a page) */
function count() {
  return (req, res, next) => {
    if (req.method !== 'GET' || SKIP.test(req.path)) return next();
    const ua = req.headers['user-agent'] || '';
    if (!ua || BOT.test(ua)) return next();
    res.on('finish', () => {
      if (res.statusCode !== 200 || !/text\/html/.test(String(res.getHeader('content-type') || ''))) return;
      const qy = req.query || {};
      const path = String(req.path).replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, '/:id').slice(0, 200);
      const lang = /^\/en(\/|$)/.test(path) ? 'en' : 'ar';
      const device = /mobile|iphone|android(?!.*tablet)/i.test(ua) ? 'mobile' : 'desktop';
      const src = sourceOf(qy.utm_source, hostOf(req.headers.referer), req.headers.host);
      q('INSERT INTO visits(path,src,medium,campaign,lang,device,vid) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [path, src, clean(qy.utm_medium), clean(qy.utm_campaign, 60), lang, device, visitorId(req)]).catch(() => {});
      if (++n % 500 === 0) q("DELETE FROM visits WHERE at < now() - interval '400 days'").catch(() => {});
    });
    next();
  };
}

/* the free-report form sends where the visitor first came from (kept in the browser tab only) */
function reportSource(b, req) {
  const s = (b && typeof b.from === 'object' && b.from) || {};
  return { src: sourceOf(s.utm_source, s.ref, req.headers.host), campaign: clean(s.utm_campaign, 60) };
}

const admin = express.Router();
admin.use(A.requireRole('admin'));
admin.get('/traffic', U.wrap(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const since = `now() - interval '${days} days'`;
  const [tot, daily, sources, pages, camps, rep, devices, langs] = await Promise.all([
    q(`SELECT count(*)::int views, count(DISTINCT vid)::int visitors FROM visits WHERE at > ${since}`),
    q(`SELECT to_char(d, 'YYYY-MM-DD') d, coalesce(v.views,0)::int views, coalesce(v.visitors,0)::int visitors, coalesce(r.reports,0)::int reports
       FROM generate_series((now() - interval '${Math.min(days, 30) - 1} days')::date, now()::date, '1 day') d
       LEFT JOIN (SELECT at::date AS dy, count(*) views, count(DISTINCT vid) visitors FROM visits WHERE at > now() - interval '31 days' GROUP BY 1) v ON v.dy = d
       LEFT JOIN (SELECT created_at::date AS dy, count(*) reports FROM score_requests WHERE created_at > now() - interval '31 days' GROUP BY 1) r ON r.dy = d ORDER BY d DESC`),
    q(`SELECT coalesce(v.src, r.src) src, coalesce(v.visitors,0)::int visitors, coalesce(v.views,0)::int views, coalesce(r.reports,0)::int reports FROM
       (SELECT src, count(DISTINCT vid) visitors, count(*) views FROM visits WHERE at > ${since} GROUP BY src) v
       FULL JOIN (SELECT coalesce(src,'unknown') src, count(*) reports FROM score_requests WHERE created_at > ${since} GROUP BY 1) r ON r.src = v.src
       ORDER BY 2 DESC, 4 DESC LIMIT 15`),
    q(`SELECT path, count(*)::int views, count(DISTINCT vid)::int visitors FROM visits WHERE at > ${since} GROUP BY path ORDER BY 2 DESC LIMIT 12`),
    q(`SELECT coalesce(v.campaign, r.campaign) campaign, coalesce(v.src, r.src) src, coalesce(v.visitors,0)::int visitors, coalesce(r.reports,0)::int reports FROM
       (SELECT campaign, max(src) src, count(DISTINCT vid) visitors FROM visits WHERE at > ${since} AND campaign IS NOT NULL GROUP BY campaign) v
       FULL JOIN (SELECT campaign, max(src) src, count(*) reports FROM score_requests WHERE created_at > ${since} AND campaign IS NOT NULL GROUP BY campaign) r ON r.campaign = v.campaign
       ORDER BY 3 DESC, 4 DESC LIMIT 15`),
    q(`SELECT count(*)::int reports, count(*) FILTER (WHERE contact IS NOT NULL AND contact <> '')::int with_contact FROM score_requests WHERE created_at > ${since}`),
    q(`SELECT device, count(DISTINCT vid)::int visitors FROM visits WHERE at > ${since} GROUP BY 1`),
    q(`SELECT lang, count(DISTINCT vid)::int visitors FROM visits WHERE at > ${since} GROUP BY 1`)
  ]);
  let clients = 0, paid = 0;
  try {
    clients = (await q(`SELECT count(*)::int n FROM users WHERE role='client' AND created_at > ${since}`)).rows[0].n;
    paid = (await q(`SELECT count(*)::int n FROM payments WHERE status='paid' AND created_at > ${since}`)).rows[0].n;
  } catch (e) { /* older schema */ }
  const t = tot.rows[0];
  res.json({ days, views: t.views, visitors: t.visitors, reports: rep.rows[0].reports, with_contact: rep.rows[0].with_contact, signups: clients, payments: paid,
    daily: daily.rows, sources: sources.rows, pages: pages.rows, campaigns: camps.rows, devices: devices.rows, langs: langs.rows,
    ai_visitors: sources.rows.filter((s) => AI_SOURCES.includes(s.src)).reduce((a, s) => a + s.visitors, 0),
    booking_url: S.get('booking_url') || '' });
}));

/* public: the few site settings the pages need (no secrets) */
const pub = express.Router();
pub.get('/api/site-config', (req, res) => res.json({ booking_url: S.get('booking_url') || null }));

module.exports = { count, admin, pub, reportSource, sourceOf, ensureSalt, AI_SOURCES };
