'use strict';
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const shortCode = (n = 8) => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; const b = crypto.randomBytes(n); for (let i = 0; i < n; i++) s += a[b[i] % a.length]; return s; };

function hashPassword(pw) {
  return new Promise((res, rej) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, key) => e ? rej(e) : res('scrypt$' + salt.toString('base64') + '$' + key.toString('base64')));
  });
}
function verifyPassword(pw, stored) {
  return new Promise((res) => {
    try {
      const [alg, s, k] = String(stored).split('$');
      if (alg !== 'scrypt') return res(false);
      const salt = Buffer.from(s, 'base64'), want = Buffer.from(k, 'base64');
      crypto.scrypt(pw, salt, want.length, { N: 16384, r: 8, p: 1 }, (e, key) => res(!e && crypto.timingSafeEqual(key, want)));
    } catch (e) { res(false); }
  });
}

/* ---- input cleaning ---- */
const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const optStr = (v, max = 200) => { const s = str(v, max); return s || null; };
const int = (v, lo = 0, hi = 1e9) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const isEmail = (s) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) && s.length <= 254;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
function cleanSite(v) {
  let s = str(v, 200).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (/^@[\w.]{2,40}$/.test(s)) return s;
  if (/instagram\.com\//i.test(s)) return s;
  return /^[a-z0-9\u0600-\u06FF][a-z0-9\u0600-\u06FF.-]*\.[a-z\u0600-\u06FF]{2,}(\/\S*)?$/i.test(s) ? s : '';
}
const isHttpUrl = (s) => { try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return /^https?:$/.test(u.protocol); } catch (e) { return false; } };
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/* ---- tiny in-memory rate limiter (one instance; fine for this size) ---- */
const hits = new Map();
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const k = name + ':' + req.ip, now = Date.now();
    let e = hits.get(k);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(k, e); }
    if (++e.n > max) { res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000))); return res.status(429).json({ error: 'too_many' }); }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (e.reset < now) hits.delete(k); }, 60000).unref();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new HttpError(status, code); };

module.exports = { sha, token, shortCode, hashPassword, verifyPassword, str, optStr, int, isEmail, isDate, cleanSite, isHttpUrl, slugify, esc, jsonLd, limit, wrap, HttpError, fail };
