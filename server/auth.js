'use strict';
const express = require('express');
const { q, pool } = require('./db');
const U = require('./util');
const M = require('./mail');
const C = require('./config');

const COOKIE = 'tw_sid', REF = 'tw_ref';
const PROD = process.env.NODE_ENV === 'production';
const DAYS = 30;

function parseCookies(h) {
  const o = {};
  String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) { try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) {} } });
  return o;
}
function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (PROD) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? [].concat(prev) : [];
  res.setHeader('Set-Cookie', list.concat(parts.join('; ')));
}
const clearCookie = (res, name) => setCookie(res, name, '', 0);

async function startSession(res, userId) {
  const t = U.token(32);
  await q('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now() + ($3 || \' days\')::interval)', [U.sha(t), userId, String(DAYS)]);
  setCookie(res, COOKIE, t, DAYS * 86400);
}

/* attaches req.user (or null) and req.cookies */
async function loadUser(req, res, next) {
  try {
    req.cookies = parseCookies(req.headers.cookie);
    req.user = null;
    if (req.path.startsWith('/assets/')) return next();
    const t = req.cookies[COOKIE];
    if (t) {
      const r = await q(`SELECT u.id,u.email,u.name,u.role,u.phone,u.lang,u.disabled FROM sessions s JOIN users u ON u.id=s.user_id
                         WHERE s.token_hash=$1 AND s.expires_at>now()`, [U.sha(t)]);
      if (r.rows[0] && !r.rows[0].disabled) req.user = r.rows[0];
    }
    next();
  } catch (e) { next(e); }
}
const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'auth' }));
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'auth' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
};
const home = (role) => (role === 'admin' ? '/admin/' : role === 'partner' ? '/partners/dashboard/' : '/dashboard/');
const pubUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone, lang: u.lang });

async function uniqueSlug(base) {
  const root = U.slugify(base) || 'business';
  for (let i = 0; i < 8; i++) {
    const s = i === 0 ? root : `${root}-${U.shortCode(3)}`;
    const r = await q('SELECT 1 FROM businesses WHERE slug=$1', [s]);
    if (!r.rowCount) return s;
  }
  return `${root}-${U.shortCode(6)}`;
}
async function uniqueCode() {
  for (let i = 0; i < 10; i++) { const c = U.shortCode(6); if (!(await q('SELECT 1 FROM partners WHERE code=$1', [c])).rowCount) return c; }
  return U.shortCode(10);
}

const router = express.Router();

router.post('/register', U.limit('register', 8, 3600e3), U.wrap(async (req, res) => {
  const b = req.body || {};
  const role = b.role === 'partner' ? 'partner' : 'client';
  const name = U.str(b.name, 100), email = U.str(b.email, 254).toLowerCase(), pw = typeof b.password === 'string' ? b.password : '';
  const lang = b.lang === 'en' ? 'en' : 'ar', phone = U.optStr(b.phone, 30);
  if (!name) U.fail(400, 'name');
  if (!U.isEmail(email)) U.fail(400, 'email');
  if (pw.length < 8 || pw.length > 200) U.fail(400, 'password');
  if (b.consent !== true) U.fail(400, 'consent');
  let site = '', bname = '';
  if (role === 'client') {
    bname = U.str(b.business_name, 120); site = U.cleanSite(b.website);
    if (!bname) U.fail(400, 'business_name');
    if (!site) U.fail(400, 'website');
  }
  const hash = await U.hashPassword(pw);
  const ref = (req.cookies && req.cookies.tw_ref) || null;
  const c = await pool.connect();
  let user;
  try {
    await c.query('BEGIN');
    const ex = await c.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (ex.rowCount) { await c.query('ROLLBACK'); return U.fail(409, 'email_taken'); }
    const r = await c.query('INSERT INTO users(email,name,pass_hash,role,phone,lang,ref_code) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,email,name,role,phone,lang',
      [email, name, hash, role, phone, lang, role === 'client' ? ref : null]);
    user = r.rows[0];
    if (role === 'client') {
      const slug = await uniqueSlug(bname);
      const cat = U.optStr(b.category, 80);
      await c.query(`INSERT INTO businesses(owner_id,slug,name_en,name_ar,website,phone,email,city,category,category_ar,area) VALUES($1,$2,$3,$4,$5,$6,$7,'Dubai',$8,$9,$10)`,
        [user.id, slug, lang === 'en' ? bname : null, lang === 'ar' ? bname : null, site, phone, email, cat && !/[\u0600-\u06FF]/.test(cat) ? cat : null, cat && /[\u0600-\u06FF]/.test(cat) ? cat : null, U.optStr(b.area, 80)]);
    } else {
      await c.query('INSERT INTO partners(user_id,code,company,kind) VALUES($1,$2,$3,$4)', [user.id, await uniqueCode(), U.optStr(b.company, 120), U.optStr(b.kind, 40)]);
    }
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; } finally { c.release(); }
  await startSession(res, user.id);
  M.tpl('welcome', user.email, user.lang, user.name, C.publicUrl() + (user.lang === 'en' ? '/en' : '') + home(user.role)).catch(() => {});
  res.json({ user: pubUser(user), redirect: home(user.role) });
}));

router.post('/login', U.limit('login', 12, 15 * 60e3), U.wrap(async (req, res) => {
  const email = U.str((req.body || {}).email, 254).toLowerCase(), pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  const r = await q('SELECT * FROM users WHERE email=$1', [email]);
  const u = r.rows[0];
  const ok = u ? await U.verifyPassword(pw, u.pass_hash) : (await U.verifyPassword(pw, 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')), false);
  if (!u || !ok || u.disabled) return res.status(401).json({ error: 'credentials' });
  await q('UPDATE users SET last_login=now() WHERE id=$1', [u.id]);
  await startSession(res, u.id);
  res.json({ user: pubUser(u), redirect: home(u.role) });
}));

router.post('/logout', U.wrap(async (req, res) => {
  const t = req.cookies && req.cookies[COOKIE];
  if (t) await q('DELETE FROM sessions WHERE token_hash=$1', [U.sha(t)]);
  clearCookie(res, COOKIE);
  res.json({ ok: true });
}));

router.get('/me', (req, res) => res.json({ user: req.user ? pubUser(req.user) : null, redirect: req.user ? home(req.user.role) : null }));

/* With email on (RESEND_API_KEY) the reset link is emailed. Without it, the request is queued for the admin,
   who sends a one-time link by WhatsApp. The answer is the same either way, so emails cannot be probed. */
router.post('/forgot', U.limit('forgot', 5, 3600e3), U.wrap(async (req, res) => {
  const email = U.str((req.body || {}).email, 254).toLowerCase();
  if (U.isEmail(email)) {
    const u = (await q('SELECT id,lang,disabled FROM users WHERE email=$1', [email])).rows[0];
    if (u && !u.disabled && M.enabled()) {
      const t = U.token(24);
      await q("INSERT INTO resets(token_hash,user_id,expires_at) VALUES($1,$2,now() + interval '2 hours')", [U.sha(t), u.id]);
      const r = await M.tpl('reset', email, u.lang, `${C.publicUrl()}${u.lang === 'en' ? '/en' : ''}/signin/?reset=${t}`);
      await q('INSERT INTO reset_requests(email,user_id,handled) VALUES($1,$2,$3)', [email, u.id, !!r.ok]);
    } else {
      await q('INSERT INTO reset_requests(email,user_id) VALUES($1,$2)', [email, u ? u.id : null]);
    }
  }
  res.json({ ok: true, emailed: M.enabled() });
}));

router.post('/reset', U.limit('reset', 10, 3600e3), U.wrap(async (req, res) => {
  const t = U.str((req.body || {}).token, 100), pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  if (pw.length < 8 || pw.length > 200) U.fail(400, 'password');
  const r = await q('SELECT user_id FROM resets WHERE token_hash=$1 AND used=FALSE AND expires_at>now()', [U.sha(t)]);
  if (!r.rowCount) U.fail(400, 'token');
  const hash = await U.hashPassword(pw);
  await q('UPDATE users SET pass_hash=$1 WHERE id=$2', [hash, r.rows[0].user_id]);
  await q('UPDATE resets SET used=TRUE WHERE token_hash=$1', [U.sha(t)]);
  await q('DELETE FROM sessions WHERE user_id=$1', [r.rows[0].user_id]);
  await q('UPDATE reset_requests SET handled=TRUE WHERE user_id=$1', [r.rows[0].user_id]);
  res.json({ ok: true });
}));

router.post('/password', requireUser, U.limit('pw', 10, 3600e3), U.wrap(async (req, res) => {
  const cur = typeof req.body.current === 'string' ? req.body.current : '', pw = typeof req.body.password === 'string' ? req.body.password : '';
  if (pw.length < 8 || pw.length > 200) U.fail(400, 'password');
  const u = (await q('SELECT pass_hash FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await U.verifyPassword(cur, u.pass_hash))) U.fail(403, 'credentials');
  await q('UPDATE users SET pass_hash=$1 WHERE id=$2', [await U.hashPassword(pw), req.user.id]);
  res.json({ ok: true });
}));

async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(), pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) return;
  if (pw.length < 10) { console.warn('ADMIN_PASSWORD is shorter than 10 characters; admin not created'); return; }
  const r = await q('SELECT id,role FROM users WHERE email=$1', [email]);
  if (r.rowCount) { if (r.rows[0].role !== 'admin') await q("UPDATE users SET role='admin' WHERE id=$1", [r.rows[0].id]); return; }
  await q("INSERT INTO users(email,name,pass_hash,role,lang) VALUES($1,'Tawsiya admin',$2,'admin','en')", [email, await U.hashPassword(pw)]);
  console.log('admin account created for', email);
}

module.exports = { router, loadUser, requireUser, requireRole, parseCookies, setCookie, REF, home, ensureAdmin };
