'use strict';
/* Server-side page rendering. The shells (header, footer, fonts, CSS) are produced by src/build.py into site/_tpl,
   so server-rendered pages look exactly like the static ones. Everything user-supplied goes through esc(). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { esc } = require('./util');

const SITE_DIR = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..', 'site'));
const TPL = path.join(SITE_DIR, '_tpl');
let shells = {}, strings = {}, siteCfg = {}, checks = [], scriptHashes = [];

function load() {
  shells = { ar: fs.readFileSync(path.join(TPL, 'shell-ar.html'), 'utf8'), en: fs.readFileSync(path.join(TPL, 'shell-en.html'), 'utf8') };
  strings = JSON.parse(fs.readFileSync(path.join(TPL, 'strings.json'), 'utf8'));
  siteCfg = JSON.parse(fs.readFileSync(path.join(TPL, 'site.json'), 'utf8'));
  checks = JSON.parse(fs.readFileSync(path.join(TPL, 'checks.json'), 'utf8'));
  // CSP: allow only the one constant inline script (theme before paint), by hash.
  const set = new Set();
  Object.values(shells).forEach((s) => { for (const m of s.matchAll(/<script>([^<]*)<\/script>/g)) set.add("'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'"); });
  scriptHashes = [...set];
}
const S = (lang) => strings[lang === 'en' ? 'en' : 'ar'];
const CHECKS = () => checks;
const CFG = () => siteCfg;
const csp = () => ["default-src 'self'", "script-src 'self' " + scriptHashes.join(' '), "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');

const waHref = (text) => siteCfg.whatsapp ? `https://wa.me/${siteCfg.whatsapp}?text=${encodeURIComponent(text)}` : `mailto:${siteCfg.email}?subject=Tawsiya&body=${encodeURIComponent(text)}`;

/* opts: lang, title, desc, slug (path without lang prefix or trailing slash), content (html), index (bool), ld (object json string), extra (scripts html) */
function page(opts) {
  const lang = opts.lang === 'en' ? 'en' : 'ar';
  const otherPrefix = lang === 'ar' ? '/en/' : '/';
  const vals = {
    TITLE: esc(opts.title), DESC: esc(opts.desc || ''), SLUG: opts.slug || '',
    OTHER: otherPrefix + (opts.slug ? opts.slug + '/' : ''),
    CONTENT: opts.content, EXTRA: opts.extra || ''
  };
  let html = shells[lang].replace(/@@(TITLE|DESC|SLUG|OTHER|CONTENT|EXTRA)@@/g, (m, k) => vals[k]);
  html = html.replace(/(href="https?:\/\/[^"\/]+(?:\/en)?\/)\/"/g, '$1"');
  /* link preview: a page can bring its own picture (the report shows the business and its score) */
  if (opts.ogImage) {
    const img = esc(opts.ogImage), t = esc(opts.title), d = esc(opts.desc || '');
    html = html.replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")/g, `$1${img}$2`)
      .replace(/(<meta (?:property="og:image:alt") content=")[^"]*(")/, `$1${t}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`);
  }
  if (opts.index === false) html = html.replace('content="index, follow, max-image-preview:large"', 'content="noindex, nofollow"');
  if (opts.ld) html = html.replace('</head>', `<script type="application/ld+json">${opts.ld}</script>\n</head>`);
  return html;
}
const fmtDate = (d, lang) => { try { return new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' }); } catch (e) { return ''; } };
const fill = (s, m) => String(s).replace(/\{(\w+)\}/g, (_, k) => (m[k] != null ? m[k] : ''));

module.exports = { load, page, S, CHECKS, CFG, csp, waHref, fmtDate, fill, SITE_DIR };
