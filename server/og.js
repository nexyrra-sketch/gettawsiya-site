'use strict';
/* Link preview images (what WhatsApp, Instagram, X and LinkedIn show next to a shared link).
   Drawn as SVG and turned into a 1200x630 PNG with resvg (no browser needed). If anything fails the caller
   falls back to the static image, so a preview can never break a page. */
const fs = require('fs');
const path = require('path');

const FONT_DIR = path.join(__dirname, 'fonts');
const FILES = ['tw-mixed-600.ttf', 'tw-mixed-400.ttf'].map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));
/* one family holding both Arabic and Latin glyphs, so names that mix the two scripts draw correctly */
const BOLD = "'TW Mixed SemiBold'", BODY = "'TW Mixed'";
const CREAM = '#EDE3D1', BRASS = '#D4A24C', INK = '#0C0E13';

let Resvg = null;
try { Resvg = require('@resvg/resvg-js').Resvg; } catch (e) { Resvg = null; }
const available = () => !!Resvg && FILES.length > 0;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAr = (s) => /[؀-ۿ]/.test(String(s));
/* wrap text into at most `max` lines that fit `width` px at `size` px (rough width model, good enough for a card) */
function wrap(text, size, width, max) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const cw = (w) => [...w].reduce((n, ch) => n + (/[؀-ۿ]/.test(ch) ? 0.52 : /[A-Z0-9]/.test(ch) ? 0.64 : /[ilj.,'!:;|]/.test(ch) ? 0.3 : 0.55), 0) * size;
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cw(t) <= width || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) {
    const keep = lines.slice(0, max); let last = keep[max - 1];
    while (last.length > 1 && cw(last + ' …') > width) last = last.slice(0, -1);
    keep[max - 1] = last.trim() + ' …'; return keep;
  }
  return lines;
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '…' : s; };

/* shared pieces */
const defs = `<defs>
  <radialGradient id="g1" cx="0.88" cy="0.05" r="0.9"><stop offset="0" stop-color="#2D2517"/><stop offset="0.55" stop-color="#12141A"/><stop offset="1" stop-color="${INK}"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E7B964"/><stop offset="1" stop-color="#B98631"/></linearGradient>
</defs><rect width="1200" height="630" fill="url(#g1)"/><rect x="0" y="0" width="1200" height="8" fill="url(#gold)"/>`;
const mark = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${CREAM}" stroke-width="5.5" stroke-linecap="round"><path d="M4 12 C 6 30, 20 38, 32 38 C 44 38, 58 30, 60 12"/><circle cx="42" cy="3" r="3.4" fill="${BRASS}" stroke="none"/><circle cx="20" cy="18" r="2.4" fill="${CREAM}" stroke="none"/></g>`;
function brandRow(ar) {
  return ar
    ? `<g>${mark(1066, 52, 1)}<text x="1050" y="82" text-anchor="end" font-family="${BOLD}" font-size="34" fill="${CREAM}">توصية</text><text x="935" y="82" text-anchor="end" font-family="${BODY}" font-size="26" fill="#9A917F">Tawsiya</text></g>`
    : `<g>${mark(70, 52, 1)}<text x="150" y="82" font-family="${BOLD}" font-size="34" fill="${CREAM}">Tawsiya</text><text x="288" y="82" font-family="${BODY}" font-size="26" fill="#9A917F">توصية</text></g>`;
}
function pill(ar, text, y) {
  const w = Math.min(700, Math.max(260, text.length * (ar ? 17 : 16) + 90)), h = 66;
  const x = ar ? 1130 - w : 70;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="33" fill="url(#gold)"/><text x="${x + w / 2}" y="${y + 44}" text-anchor="middle" font-family="${BOLD}" font-size="28" fill="${INK}">${esc(text)}</text></g>`;
}
const tone = (n) => (n >= 70 ? '#4CC38A' : n >= 40 ? '#E8A93C' : '#EE6B58');

/* ----------------------------------------------------------------------------------------------
   Report preview: the business name, its score out of 100 and who AI names instead.
   ---------------------------------------------------------------------------------------------- */
function logoTile(ar, logo) {
  if (!logo || !logo.data || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(logo.type)) return '';
  const s = 104, x = ar ? 70 : 1130 - s, y = 34, pad = 12;
  const uri = `data:${logo.type};base64,${Buffer.from(logo.data).toString('base64')}`;
  return `<g><clipPath id="lc"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="24"/></clipPath><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="24" fill="#FFFFFF"/>
  <image clip-path="url(#lc)" x="${x + pad}" y="${y + pad}" width="${s - 2 * pad}" height="${s - 2 * pad}" preserveAspectRatio="xMidYMid meet" href="${uri}"/></g>`;
}
function reportSvg({ lang, name, score, named, total, measured, rival, logo }) {
  const ar = lang !== 'en', n = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const x = ar ? 1130 : 70, anchor = ar ? 'end' : 'start', cx = ar ? 285 : 915, cy = 330, r = 128, C = 2 * Math.PI * r;
  const nameSize = name.length > 34 ? 50 : name.length > 22 ? 58 : 68;
  const nameLines = wrap(name, nameSize, 640, 2);
  const kicker = ar ? 'تقرير الظهور في الذكاء الاصطناعي' : 'AI VISIBILITY REPORT';
  let y = 215;
  const nameSvg = nameLines.map((l, i) => `<text x="${x}" y="${y + i * (nameSize + 8)}" text-anchor="${anchor}" font-family="${BOLD}" font-size="${nameSize}" fill="${CREAM}">${esc(l)}</text>`).join('');
  y = y + (nameLines.length - 1) * (nameSize + 8) + 58;
  const lines = [];
  if (measured && total > 0) {
    lines.push(ar ? `ذكر المساعدون نشاطك في ${named} من ${total} إجابة` : `AI named this business in ${named} of ${total} answers`);
    if (rival && named < total) { lines.push(ar ? 'ويذكرون بدلاً منه' : 'and names instead'); lines.push({ rival: clip(rival, 30) }); }
  } else lines.push(ar ? 'شاهد ماذا يقول ChatGPT وGemini عن نشاطك' : 'See what ChatGPT and Gemini say about it');
  const sub = lines.map((l, i) => typeof l === 'string'
    ? `<text x="${x}" y="${y + i * 40}" text-anchor="${anchor}" font-family="${BODY}" font-size="29" fill="${i === 0 ? '#CFC6B3' : '#9A917F'}">${esc(l)}</text>`
    : `<text x="${x}" y="${y + i * 40 + 2}" text-anchor="${anchor}" font-family="${BOLD}" font-size="34" fill="${BRASS}">${esc(l.rival)}</text>`).join('');
  const subEnd = y + (lines.length - 1) * 40;
  const cta = pill(ar, ar ? 'شاهد التقرير الكامل' : 'See the full report', Math.max(470, subEnd + 40));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">${defs}${brandRow(ar)}${logoTile(ar, logo)}
  <text x="${x}" y="150" text-anchor="${anchor}" font-family="${BOLD}" font-size="${ar ? 26 : 22}" letter-spacing="${ar ? 0 : 3}" fill="${BRASS}">${esc(kicker)}</text>
  ${nameSvg}${sub}${cta}
  <g><circle cx="${cx}" cy="${cy}" r="${r + 38}" fill="#FFFFFF" fill-opacity="0.03"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="26"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${tone(n)}" stroke-width="26" stroke-linecap="round" stroke-dasharray="${(C * Math.max(n, 2) / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
  <text x="${cx}" y="${cy + 38}" text-anchor="middle" font-family="${BOLD}" font-size="124" fill="${CREAM}">${n}</text>
  <text x="${cx}" y="${cy + 90}" text-anchor="middle" font-family="${BODY}" font-size="30" fill="#9A917F">${ar ? 'من 100' : '/ 100'}</text></g>
  <text x="${ar ? 1130 : 70}" y="596" text-anchor="${anchor}" font-family="${BODY}" font-size="22" fill="#7C7567">gettawsiya.com</text></svg>`;
}

/* ----------------------------------------------------------------------------------------------
   Home preview: a question people already ask AI, and the answer that leaves their business out.
   ---------------------------------------------------------------------------------------------- */
function homeSvg(lang) {
  const ar = lang !== 'en';
  const T = ar
    ? { sub: 'افحص مجاناً: ماذا يقول الذكاء الاصطناعي عنك؟', cta: 'احصل على تقريرك المجاني', q: 'أفضل عيادة أسنان في جميرا؟', a: ['عيادتك', 'عيادة (ب)', 'عيادة (ج)'], badge: 'عملاء جدد', ai: 'ChatGPT' }
    : { sub: 'Free check: see what ChatGPT says about you', cta: 'Get my free report', q: 'Best dentist in JLT?', a: ['Your clinic', 'Clinic B', 'Clinic C'], badge: 'New clients', ai: 'ChatGPT' };
  const x = ar ? 1130 : 70, anchor = ar ? 'end' : 'start';
  const cardX = ar ? 70 : 720, cardW = 410;
  const rows = T.a.map((t, i) => {
    const me = i === 0, y = 312 + i * 58;
    return (me ? `<rect x="${cardX + 24}" y="${y - 30}" width="${cardW - 48}" height="52" rx="14" fill="#3DBB7E" fill-opacity="0.16" stroke="#3DBB7E" stroke-width="2"/>` : '') +
    `<circle cx="${cardX + 52}" cy="${y}" r="17" fill="${me ? '#3DBB7E' : '#FFFFFF'}" fill-opacity="${me ? 1 : 0.10}"/><text x="${cardX + 52}" y="${y + 8}" text-anchor="middle" font-family="${BOLD}" font-size="20" fill="${me ? '#0D1210' : CREAM}">${i + 1}</text>
    <text x="${ar ? cardX + cardW - 40 : cardX + 86}" y="${y + 9}" text-anchor="${ar ? 'end' : 'start'}" font-family="${me ? BOLD : BODY}" font-size="27" fill="${me ? '#7FE0AE' : '#9A917F'}">${esc(t)}</text>`;
  }).join('');
  const bx = ar ? cardX + 40 : cardX + cardW - 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${defs}${brandRow(ar)}
  ${ar
    ? `<text x="${x}" y="206" text-anchor="end" font-family="${BOLD}" font-size="62" fill="${CREAM}">خلّ الذكاء الاصطناعي</text>
  <text x="${x}" y="282" text-anchor="end" font-family="${BOLD}" font-size="62" fill="${BRASS}">يوصي بك</text>
  <text x="${x}" y="352" text-anchor="end" font-family="${BOLD}" font-size="46" fill="${CREAM}">واحصل على عملاء أكثر</text>
  <text x="${x}" y="412" text-anchor="end" font-family="${BODY}" font-size="27" fill="#CFC6B3">${esc(T.sub)}</text>`
    : `<text x="${x}" y="214" text-anchor="start" font-family="${BOLD}" font-size="66" fill="${CREAM}">Let AI</text>
  <text x="${x}" y="286" text-anchor="start" font-family="${BOLD}" font-size="66" fill="${BRASS}">recommend you.</text>
  <text x="${x}" y="350" text-anchor="start" font-family="${BOLD}" font-size="46" fill="${CREAM}">Get more clients.</text>
  <text x="${x}" y="406" text-anchor="start" font-family="${BODY}" font-size="27" fill="#CFC6B3">${esc(T.sub)}</text>`}
  ${pill(ar, T.cta, ar ? 456 : 440)}
  <g><rect x="${cardX}" y="150" width="${cardW}" height="400" rx="28" fill="#FFFFFF" fill-opacity="0.06" stroke="#FFFFFF" stroke-opacity="0.14"/>
  <rect x="${ar ? cardX + 40 : cardX + 70}" y="176" width="${cardW - 110}" height="52" rx="26" fill="#FFFFFF" fill-opacity="0.12"/>
  <text x="${ar ? cardX + cardW - 64 : cardX + 96}" y="211" text-anchor="${ar ? 'end' : 'start'}" font-family="${BODY}" font-size="23" fill="${CREAM}">${esc(T.q)}</text>
  <text x="${ar ? cardX + cardW - 40 : cardX + 40}" y="262" text-anchor="${ar ? 'end' : 'start'}" font-family="${BOLD}" font-size="18" letter-spacing="${ar ? 0 : 2}" fill="${BRASS}">${esc(T.ai)}</text>
  ${rows}
  <rect x="${cardX + 70}" y="${312 + 3 * 58 - 12}" width="${cardW - 140}" height="46" rx="23" fill="#3DBB7E"/>
  <text x="${cardX + cardW / 2}" y="${312 + 3 * 58 + 20}" text-anchor="middle" font-family="${BOLD}" font-size="24" fill="#0D1210">${ar ? '' : '+ '}${esc(T.badge)}</text></g>
  <text x="${ar ? 1130 : 70}" y="596" text-anchor="${anchor}" font-family="${BODY}" font-size="22" fill="#7C7567">gettawsiya.com</text></svg>`;
}

/* Arabic cards: tell the renderer the base direction is right-to-left so mixed Arabic/Latin lines order correctly */
const rtl = (svg) => svg.replace(/<text /g, '<text direction="rtl" ');
function png(svg) {
  const r = new Resvg(svg, { font: { fontFiles: FILES, loadSystemFonts: false, defaultFontFamily: 'TW Mixed' }, fitTo: { mode: 'width', value: 1200 } });
  return r.render().asPng();
}

/* tiny in-memory cache so a busy link does not redraw the picture on every preview fetch */
const cache = new Map();
function cached(key, make) {
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const v = make(); cache.set(key, v); if (cache.size > 200) cache.delete(cache.keys().next().value); return v;
}
function reportPng(o) {
  const name = clip(o.name, 80) || 'Your business';
  const key = ['r', o.lang, name, Math.round(o.score), o.named, o.total, o.measured ? 1 : 0, clip(o.rival, 28), o.logo ? o.logo.data.length : 0, o.logoKey || ''].join('|');
  const draw = (lg) => { const svg = reportSvg(Object.assign({}, o, { name, rival: clip(o.rival, 40), logo: lg })); return png(o.lang === 'en' ? svg : rtl(svg)); };
  return cached(key, () => { if (o.logo) { try { return draw(o.logo); } catch (e) { /* an image resvg cannot read: draw without it */ } } return draw(null); });
}
const homePng = (lang) => cached('h|' + lang, () => png(lang === 'en' ? homeSvg(lang) : rtl(homeSvg(lang))));

module.exports = { available, reportPng, homePng, reportSvg, homeSvg, png, isAr };
