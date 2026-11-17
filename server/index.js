'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const { migrate, pool } = require('./db');
const R = require('./render');
const A = require('./auth');
const API = require('./api');
const ADMIN = require('./admin');
const PAGES = require('./pages');
const BILL = require('./billing');
const W = require('./engine/worker');
const V7 = require('./v7');
const TR = require('./traffic');

const PROD = process.env.NODE_ENV === 'production';

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': R.csp(),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
      'X-Frame-Options': 'DENY'
    });
    if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // visitor stats: counts page views after they are sent (no cookies, bots skipped)
  app.use(TR.count());

  app.get('/healthz', async (req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); } });

  // Ziina webhook: raw body, HMAC-verified, and the payment is always re-read from Ziina (mounted before the JSON-only guard)
  app.post('/api/ziina/webhook', ...BILL.webhook());

  // API: JSON only, same-origin only
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const o = req.headers.origin;
      if (o) { try { if (new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'origin' }); } catch (e) { return res.status(403).json({ error: 'origin' }); } }
      if (!/application\/json/i.test(req.headers['content-type'] || '')) return res.status(415).json({ error: 'json_only' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '100kb' }));
  app.use(A.loadUser);

  app.use(V7.router);
  app.use(TR.pub);
  app.use('/api/admin', TR.admin);
  app.use('/api/admin', V7.admin);
  app.use('/api/auth', A.router);
  app.use('/api/client', API.client);
  app.use('/api/partner', API.partner);
  app.use('/api/admin', ADMIN.router);
  app.use(BILL.router);
  app.use(API.router);
  app.use(PAGES.router);
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

  // static site (the _tpl folder holds server templates and is never served)
  app.use((req, res, next) => (/^\/(_tpl)(\/|$)/.test(req.path) ? PAGES.notFound(req, res) : next()));
  app.use(express.static(R.SITE_DIR, {
    dotfiles: 'ignore', index: 'index.html', redirect: true,
    setHeaders(res, file) {
      if (/\/assets\/fonts\//.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else if (/\/assets\/img\//.test(file)) res.set('Cache-Control', 'public, max-age=2592000');
      else if (/\/assets\/(css|js)\//.test(file)) res.set('Cache-Control', 'no-cache');
      else if (/\.html$/.test(file)) res.set('Cache-Control', 'no-cache');
    }
  }));
  app.use((req, res) => {
    if (req.path.startsWith('/en/')) return PAGES.notFound(req, res);
    const f = path.join(R.SITE_DIR, '404.html');
    res.status(404).set('Cache-Control', 'no-store');
    fs.existsSync(f) ? res.sendFile(f) : res.type('text').send('Not found');
  });

  app.use((err, req, res, next) => { // eslint-disable-line
    if (res.headersSent) return next(err);
    if (err && err.status && err.code) return res.status(err.status).json({ error: err.code });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(err);
    if (req.path.startsWith('/api')) return res.status(500).json({ error: 'server' });
    res.status(500).type('text').send('Server error');
  });
  return app;
}

async function start() {
  R.load();
  await migrate();
  require('./settings').start(); await require('./settings').load();
  await TR.ensureSalt();
  await A.ensureAdmin();
  const app = createApp();
  W.start();
  const port = Number(process.env.PORT) || 3000;
  const srv = app.listen(port, () => console.log(`Tawsiya server on :${port} (${PROD ? 'production' : 'dev'}), site: ${R.SITE_DIR}`));
  process.on('SIGTERM', () => srv.close(() => pool.end().then(() => process.exit(0))));
  return srv;
}
module.exports = { createApp, start };
if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
