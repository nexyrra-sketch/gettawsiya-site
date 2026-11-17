'use strict';
/* Public server-rendered pages: score report, verified business page + badge + JSON, UAE AI Visibility Index. */
const express = require('express');
const { q } = require('./db');
const U = require('./util');
const R = require('./render');
const { esc } = U;

const router = express.Router();
const LANGS = '(/en)?';
const langOf = (req) => (req.path.startsWith('/en/') ? 'en' : 'ar');
const prefix = (lang) => (lang === 'en' ? '/en' : '');
const DOMAIN = () => R.CFG().domain;
const pick = (lang, en, ar) => (lang === 'ar' ? (ar || en) : (en || ar)) || '';
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
function notFound(req, res) {
  const lang = langOf(req), S = R.S(lang);
  res.status(404).set('Cache-Control', 'no-store').send(R.page({ lang, title: S.nf.title, desc: S.nf.text, slug: '', index: false,
    content: `<div class="wrap narrow ap-simple"><p class="v4-kicker">404</p><h1>${esc(S.nf.title)}</h1><p class="lede">${esc(S.nf.text)}</p><p><a class="v4-btn v4-btn-dark" href="${prefix(lang)}/">${esc(S.nf.back)}</a></p></div>` }));
}
const isStaff = (req, ownerId) => req.user && (req.user.role === 'admin' || (ownerId && req.user.id === ownerId));

/* ----------------------------------------------------------------- score report ---------- */
router.get(new RegExp(`^${LANGS}/score/r/([A-Za-z0-9_-]{16,64})/?$`), U.wrap(async (req, res) => {
  const lang = langOf(req), S = R.S(lang), T = S.report, token = req.params[1];
  const r = (await q(`SELECT r.*, b.name_en, b.name_ar, b.slug, b.status AS bstatus, b.owner_id
                      FROM score_reports r LEFT JOIN businesses b ON b.id=r.business_id WHERE r.token=$1`, [token])).rows[0];
  if (!r || (!r.published && !isStaff(req, r.owner_id))) return notFound(req, res);
  if (r.run_id) { // v7 reports live at /report/<token>/
    const v = (await q('SELECT s.token FROM runs x JOIN score_requests s ON s.id=x.request_id WHERE x.id=$1 AND x.scan IS NOT NULL', [r.run_id])).rows[0];
    if (v) return res.redirect(302, `${prefix(lang)}/report/${v.token}/`);
  }
  const name = r.business_name || pick(lang, r.name_en, r.name_ar) || r.site;
  const checks = R.CHECKS(), ch = r.checks || {};
  const passN = checks.filter((c) => ch[c.key] && ch[c.key].pass).length;
  const circ = 2 * Math.PI * 30;
  const ring = `<svg class="v4-ring" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="30" class="rt"/><circle cx="38" cy="38" r="30" class="rv" stroke-dasharray="${(circ * passN / 15).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 38 38)"/></svg>`;
  const rows = checks.map((c) => {
    const e = ch[c.key] || {}; const ok = !!e.pass, man = e.status === 'manual';
    return `<li class="ap-ck ${ok ? 'ok' : man ? 'mn' : 'no'}"><span class="ap-ck-i" aria-hidden="true">${ok ? '✓' : man ? '?' : '!'}</span><div><b>${esc(c[lang])}</b><span class="ap-ck-s">${esc(ok ? T.pass : man ? T.manual : T.fix)}</span>${e.note ? `<p>${esc(e.note)}</p>` : ''}<small>${esc(T.why)}: ${esc(c['why_' + lang])}</small></div></li>`;
  }).join('');
  const ass = (r.assistants || []).map((a) => `<li>${esc(a)}</li>`).join('');
  const qs = (r.questions || []).map((x) => `<tr><td>${esc(x.q)}</td><td>${(x.named || []).map(esc).join('، ').replace(/، /g, lang === 'ar' ? '، ' : ', ') || '–'}</td><td class="${x.you ? 'y' : 'n'}">${esc(x.you ? T.q_you : T.q_noyou)}</td></tr>`).join('');
  const summary = pick(lang, r.summary_en, r.summary_ar);
  const msg = R.fill(T.cta_msg, { site: r.site || name });
  const content = `<article class="wrap ap-report">
  ${!r.published ? `<p class="ap-note warn">${esc(T.draft)}</p>` : ''}
  <header class="ap-head"><p class="v4-kicker">${esc(T.kicker)}</p><h1>${esc(name)}</h1>
    <p class="lede"><span dir="ltr">${esc(r.site || '')}</span> · ${esc(T.checked)} ${esc(R.fmtDate(r.checked_on, lang))}</p></header>
  <section class="ap-card ap-score" aria-labelledby="sc-h"><h2 id="sc-h">${esc(T.score_h)}</h2>
    <div class="ap-score-row">${ring}<p class="ap-big"><b>${passN}</b><span>/15</span></p><p>${esc(R.fill(T.score_of, { n: passN }))}<br><small>${esc(T.score_note)}</small></p></div></section>
  <section class="ap-card" aria-labelledby="ck-h"><h2 id="ck-h">${esc(T.checks_h)}</h2><ul class="ap-cks">${rows}</ul></section>
  <section class="ap-card" aria-labelledby="ai-h"><h2 id="ai-h">${esc(T.ai_h)}</h2>
    ${r.answers_total > 0 ? `<p class="ap-lead"><b>${r.answers_named}</b> / ${r.answers_total} — ${esc(R.fill(T.ai_t, { named: r.answers_named, total: r.answers_total, name }))}</p>
    <div class="ap-meter" role="img" aria-label="${pct(r.answers_named, r.answers_total)}%"><i style="--v:${pct(r.answers_named, r.answers_total)}%"></i></div>` : `<p>${esc(T.ai_none)}</p>`}
    ${ass ? `<h3>${esc(T.assistants)}</h3><ul class="v4-chips">${ass}</ul>` : ''}
    ${qs ? `<h3>${esc(T.q_h)}</h3><div class="ap-tw"><table class="ap-table"><thead><tr><th scope="col">${esc(T.q_col_q)}</th><th scope="col">${esc(T.q_col_named)}</th><th scope="col"></th></tr></thead><tbody>${qs}</tbody></table></div>` : ''}
  </section>
  ${summary ? `<section class="ap-card" aria-labelledby="su-h"><h2 id="su-h">${esc(T.summary_h)}</h2><p class="ap-pre">${esc(summary)}</p></section>` : ''}
  <p class="ap-fine">${r.auto ? esc(T.auto_note) + ' ' : ''}${esc(T.disclaimer)} <a href="${prefix(lang)}/method/">${esc(T.method_link)}</a></p>
  <section class="ap-card ap-track"><h2>${esc(T.track_h)}</h2><p>${esc(T.track_t)}</p><p><a class="v4-btn v4-btn-dark" href="${prefix(lang)}/plans/">${esc(T.track_btn)}</a></p></section>
  <section class="ap-cta"><h2>${esc(T.cta_h)}</h2><p>${esc(T.cta_t)}</p><a class="v4-btn v4-btn-gold" href="${esc(R.waHref(msg))}" rel="noopener">${esc(T.cta_btn)}</a></section>
</article>`;
  res.set('Cache-Control', 'private, no-store').set('X-Robots-Tag', 'noindex').send(R.page({ lang, title: `${name} · ${T.kicker}`, desc: T.kicker, slug: 'score/r/' + token, content, index: false }));
}));

/* ----------------------------------------------------------------- verified business ---------- */
async function getBiz(slug) { return (await q('SELECT * FROM businesses WHERE slug=$1', [slug])).rows[0]; }
function facts(b, lang) {
  const name = pick(lang, b.name_en, b.name_ar) || b.slug;
  const services = String(b.services || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return { name, services, about: pick(lang, b.desc_en, b.desc_ar) };
}
function bizLd(b) {
  const url = b.website ? (/^https?:/i.test(b.website) ? b.website : 'https://' + b.website) : null;
  const same = []; if (b.instagram) same.push(/^@/.test(b.instagram) ? 'https://www.instagram.com/' + b.instagram.slice(1) : (/^https?:/.test(b.instagram) ? b.instagram : 'https://' + b.instagram));
  const services = String(b.services || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const o = { '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': `${DOMAIN()}/verified/${b.slug}/#business`, name: b.name_en || b.name_ar,
    description: b.desc_en || b.desc_ar || undefined, url: url || undefined, telephone: b.phone || undefined, email: b.email || undefined,
    priceRange: b.price_range || undefined, knowsLanguage: b.languages ? b.languages.split(/[,،]\s*/).filter(Boolean) : undefined, sameAs: same.length ? same : undefined,
    address: { '@type': 'PostalAddress', streetAddress: b.address || undefined, addressLocality: b.city || undefined, addressCountry: 'AE' },
    areaServed: b.area || b.city || undefined, openingHours: undefined,
    makesOffer: services.length ? services.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s } })) : undefined,
    subjectOf: { '@type': 'WebPage', name: 'Verified by Tawsiya', url: `${DOMAIN()}/verified/${b.slug}/` } };
  if (b.name_en && b.name_ar) o.alternateName = b.name_ar;
  return o;
}
router.get(new RegExp(`^${LANGS}/verified/([a-z0-9-]{2,60})/?$`), U.wrap(async (req, res) => {
  const lang = langOf(req), S = R.S(lang), T = S.verified, slug = req.params[1];
  const b = await getBiz(slug);
  const staff = b && isStaff(req, b.owner_id);
  if (!b || (b.status !== 'verified' && !staff)) return notFound(req, res);
  const f = facts(b, lang), pub = b.status === 'verified';
  const row = (k, v, ltr) => (v ? `<div><dt>${esc(T[k])}</dt><dd${ltr ? ' dir="ltr"' : ''}>${v}</dd></div>` : '');
  const link = (u) => esc(u);
  const web = b.website ? `<a href="${esc(/^https?:/i.test(b.website) ? b.website : 'https://' + b.website)}" rel="noopener nofollow">${link(b.website)}</a>` : '';
  const ig = b.instagram ? esc(b.instagram) : '';
  const embed = `<a href="${DOMAIN()}/verified/${b.slug}/"><img src="${DOMAIN()}/badge/${b.slug}.svg" alt="${esc(T.badge)}" width="240" height="64"></a>`;
  const content = `<article class="wrap ap-verified">
  ${!pub ? `<p class="ap-note warn">${esc(T.preview)}</p>` : ''}
  <header class="ap-head"><p class="v4-kicker">${esc(T.kicker)}</p><h1>${esc(f.name)}</h1>
    <p class="lede">${esc([b.category, b.area, b.city].filter(Boolean).join(' · '))}</p>
    ${pub ? `<p class="ap-vbadge"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9v-5z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/></svg>${esc(T.badge)} · ${esc(R.fill(T.on, { date: R.fmtDate(b.verified_at, lang) }))}</p>` : ''}</header>
  <section class="ap-card" aria-labelledby="f-h"><h2 id="f-h">${esc(T.facts_h)}</h2>
    ${f.about ? `<p class="ap-lead">${esc(f.about)}</p>` : ''}
    <dl class="ap-dl">${row('website', web, true)}${row('instagram', ig, true)}${row('phone', esc(b.phone || ''), true)}${row('whatsapp', esc(b.whatsapp || ''), true)}${row('email', esc(b.email || ''), true)}
    ${row('address', esc(b.address || ''))}${row('area', esc([b.area, b.city].filter(Boolean).join(', ')))}${row('hours', esc(b.hours || ''))}${row('languages', esc(b.languages || ''))}${row('price', esc(b.price_range || ''))}</dl>
    ${f.services.length ? `<h3>${esc(T.services)}</h3><ul class="v4-chips">${f.services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
    <p class="ap-fine">${esc(R.fill(T.updated, { date: R.fmtDate(b.updated_at, lang) }))} · <a href="${prefix(lang)}/verified/${esc(b.slug)}.json">${esc(T.json)}</a></p></section>
  <section class="ap-two"><div class="ap-card"><h2>${esc(T.meaning_h)}</h2><p>${esc(T.meaning_t)}</p></div>
    <div class="ap-card"><h2>${esc(T.not_h)}</h2><p>${esc(T.not_t)}</p></div></section>
  <p class="ap-fine"><a href="${esc(R.waHref(R.fill(T.correct_msg, { name: f.name })))}" rel="noopener">${esc(T.correct)}</a> · <a href="${prefix(lang)}/method/">${esc(T.method_link)}</a> · <a href="${prefix(lang)}/verified/">${esc(T.about_link)}</a></p>
  ${pub && isStaff(req, b.owner_id) ? `<section class="ap-card"><h2>${esc(T.embed_h)}</h2><p>${esc(T.embed_t)}</p><p><img src="/badge/${esc(b.slug)}.svg" alt="" width="240" height="64"></p><pre class="ap-code" dir="ltr">${esc(embed)}</pre></section>` : ''}
</article>`;
  const out = R.page({ lang, title: `${f.name} · ${T.badge}`, desc: `${f.name}: ${f.about || [b.category, b.city].filter(Boolean).join(', ')}`.slice(0, 155), slug: 'verified/' + b.slug,
    content, index: pub, ld: pub ? U.jsonLd(bizLd(b)) : null });
  res.set('Cache-Control', pub && !req.user ? 'public, max-age=300' : 'private, no-store').send(out);
}));

router.get('/verified/:slug.json', U.wrap(async (req, res) => {
  const b = await getBiz(req.params.slug);
  if (!b || b.status !== 'verified') return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'public, max-age=300').json({ verifiedBy: 'Tawsiya', verifiedAt: b.verified_at, updatedAt: b.updated_at, page: `${DOMAIN()}/verified/${b.slug}/`, business: bizLd(b), hours: b.hours || null, languages: b.languages || null });
}));
router.get('/en/verified/:slug.json', (req, res) => res.redirect(301, `/verified/${req.params.slug}.json`));

router.get('/badge/:slug.svg', U.wrap(async (req, res) => {
  const b = await getBiz(req.params.slug);
  const ok = b && b.status === 'verified';
  const name = ok ? (b.name_en || b.name_ar || '').slice(0, 26) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64" role="img" aria-label="${ok ? 'Verified by Tawsiya' : 'Not verified'}">
<rect x=".5" y=".5" width="239" height="63" rx="14" fill="${ok ? '#0A0805' : '#EEEAE3'}" stroke="${ok ? '#C9953D' : '#C9C3B8'}"/>
<g transform="translate(14 14)" fill="none" stroke="${ok ? '#C9953D' : '#8a8479'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2l15 6.5v11C33 29 26.600 35.500 18 38 9.400 35.500 3 29 3 19.500v-11z" transform="scale(.9)"/><path d="M11 19l4.500 4.500L25 14" transform="translate(1 0)"/></g>
<text x="58" y="${ok ? 27 : 38}" font-family="Inter,Arial,sans-serif" font-size="15" font-weight="700" fill="${ok ? '#F4EEE3' : '#4a463f'}">${ok ? 'Verified by Tawsiya' : 'Not verified'}</text>
${ok ? `<text x="58" y="46" font-family="Inter,Arial,sans-serif" font-size="12" fill="#B9B2A4">${esc(name)}</text>` : ''}</svg>`;
  res.set({ 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'Cross-Origin-Resource-Policy': 'cross-origin' }).send(svg);
}));

router.get('/api/public/verified', U.limit('vlookup', 60, 60e3), U.wrap(async (req, res) => {
  const s = U.str(req.query.q, 60);
  if (s.length < 2) return res.json({ items: [] });
  const r = await q(`SELECT slug,name_en,name_ar,category,city FROM businesses WHERE status='verified' AND (name_en ILIKE $1 OR name_ar ILIKE $1 OR website ILIKE $1) ORDER BY name_en NULLS LAST LIMIT 12`, ['%' + s.replace(/[%_\\]/g, '') + '%']);
  res.json({ items: r.rows });
}));

/* ----------------------------------------------------------------- AI Visibility Index ---------- */
function editionHtml(e, rows, lang, T, S) {
  const title = pick(lang, e.title_en, e.title_ar), notes = pick(lang, e.notes_en, e.notes_ar);
  const max = Math.max(1, ...rows.map((r) => r.named_count));
  const trs = rows.map((r) => `<tr><td class="mono">${r.rank}</td><th scope="row">${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</th><td class="mono">${r.named_count}</td>
    <td><span class="cbar"><i style="--v:${Math.round(r.named_count / max * 100)}%"></i></span><span class="mono">${pct(r.named_count, e.answers_total)}%</span></td></tr>`).join('');
  return `<section class="ap-card"><h2>${esc(title)}</h2>
    <p class="ap-meta">${esc([e.sector, e.period].filter(Boolean).join(' · '))} · ${esc(R.fill(T.answers, { n: e.answers_total }))}</p>
    ${(e.assistants || []).length ? `<h3>${esc(T.assistants)}</h3><ul class="v4-chips">${e.assistants.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    <div class="ap-tw"><table class="ap-table"><thead><tr><th scope="col">${esc(T.col_rank)}</th><th scope="col">${esc(T.col_name)}</th><th scope="col">${esc(T.col_named)}</th><th scope="col">${esc(T.col_share)}</th></tr></thead><tbody>${trs}</tbody></table></div>
    ${(e.prompts || []).length ? `<h3>${esc(T.prompts_h)}</h3><ol class="ap-list">${e.prompts.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
    ${notes ? `<p class="ap-pre">${esc(notes)}</p>` : ''}
    <p class="ap-fine">${esc(T.method_t)} <a href="${prefix(lang)}/method/">${esc(T.method_link)}</a></p></section>`;
}
router.get(new RegExp(`^${LANGS}/ai-index/(?:([a-z0-9-]{2,60})/)?$`), U.wrap(async (req, res) => {
  const lang = langOf(req), S = R.S(lang), T = S.aiindex, slug = req.params[1];
  const eds = (await q('SELECT * FROM index_editions WHERE published ORDER BY published_at DESC, id DESC')).rows;
  const cur = slug ? eds.find((e) => e.slug === slug) : eds[0];
  if (slug && !cur) return notFound(req, res);
  let body = '';
  if (cur) {
    const rows = (await q('SELECT * FROM index_rows WHERE edition_id=$1 ORDER BY rank, id', [cur.id])).rows;
    body += editionHtml(cur, rows, lang, T, S);
    const others = eds.filter((e) => e.id !== cur.id);
    if (others.length) body += `<section class="ap-card"><h2>${esc(T.archive)}</h2><ul class="ap-links">${others.map((e) => `<li><a href="${prefix(lang)}/ai-index/${esc(e.slug)}/">${esc(pick(lang, e.title_en, e.title_ar))}</a> <span class="ap-meta">${esc(e.period || '')}</span></li>`).join('')}</ul></section>`;
  } else {
    body += `<section class="ap-card ap-empty"><h2>${esc(T.empty_h)}</h2><p>${esc(T.empty_t)}</p></section>`;
  }
  body += `<section class="ap-card"><h2>${esc(T.notify_h)}</h2><p>${esc(T.notify_t)}</p>
    <form class="ap-form ap-inline" data-notify-form novalidate><label class="sr" for="nf-c">${esc(T.notify_label)}</label>
    <input id="nf-c" name="contact" type="text" autocomplete="email" placeholder="${esc(T.notify_ph)}" maxlength="120" required aria-describedby="nf-e">
    <button class="v4-btn v4-btn-dark" type="submit">${esc(T.notify_btn)}</button></form>
    <p class="ap-err" id="nf-e" role="alert" hidden>${esc(T.notify_err)}</p><p class="ap-ok" role="status" hidden>${esc(T.notify_ok)}</p></section>
  <section class="ap-card"><h2>${esc(T.correct_h)}</h2><p>${esc(T.correct_t)}</p><a class="v4-btn v4-btn-line" href="${esc(R.waHref(T.correct_msg))}" rel="noopener">${esc(T.correct_btn)}</a></section>`;
  const content = `<div class="wrap ap-index"><header class="ap-head"><p class="v4-kicker">${esc(T.kicker)}</p><h1>${esc(T.h1)}</h1><p class="lede">${esc(T.lede)}</p></header>${body}</div>`;
  const ld = cur ? U.jsonLd({ '@context': 'https://schema.org', '@type': 'Dataset', name: pick(lang, cur.title_en, cur.title_ar), description: T.lede, creator: { '@type': 'Organization', name: 'Tawsiya', url: DOMAIN() },
    temporalCoverage: cur.period || undefined, inLanguage: lang, url: `${DOMAIN()}${prefix(lang)}/ai-index/${cur.slug}/` }) : null;
  res.set('Cache-Control', 'public, max-age=300').send(R.page({ lang, title: `${cur ? pick(lang, cur.title_en, cur.title_ar) + ' · ' : ''}${T.h1}`, desc: T.lede, slug: 'ai-index' + (slug ? '/' + slug : ''), content, ld,
    extra: '<script src="/assets/js/public.js" defer></script>' }));
}));

/* ----------------------------------------------------------------- plans + pricing --------- */
router.get(new RegExp(`^${LANGS}/plans/?$`), U.wrap(async (req, res) => {
  if (!/\/$/.test(req.path)) return res.redirect(301, req.path + '/');
  const lang = langOf(req), S = R.S(lang), T = S.plans;
  const plans = (await q('SELECT * FROM plans WHERE active ORDER BY sort, price_fils')).rows;
  const fmt = (f) => (f / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const per = (p) => (p.interval === 'year' ? T.year : p.interval === 'once' ? T.once : T.month);
  const cards = plans.map((p) => {
    const name = pick(lang, p.name_en, p.name_ar), blurb = pick(lang, p.blurb_en, p.blurb_ar);
    const feats = (lang === 'ar' ? p.features_ar : p.features_en) || [];
    const price = p.price_fils > 0 ? `<p class="ap-price"><b class="mono">${fmt(p.price_fils)}</b> <span>${esc(T.aed)} ${esc(per(p))}</span></p>` : `<p class="ap-price"><b>${esc(T.free)}</b></p>`;
    const btn = p.price_fils > 0
      ? `<button class="v4-btn ${p.featured ? 'v4-btn-gold' : 'v4-btn-dark'} v4-btn-block" type="button" data-plan="${esc(p.key)}">${esc(R.fill(T.choose, { plan: name }))}</button>`
      : `<a class="v4-btn v4-btn-line v4-btn-block" href="${prefix(lang)}/score/">${esc(T.start_free)}</a>`;
    return `<article class="ap-card ap-plan${p.featured ? ' is-featured' : ''}" data-key="${esc(p.key)}">${p.featured ? `<span class="ap-plan-tag">${esc(T.popular)}</span>` : ''}
      <h2>${esc(name)}</h2>${blurb ? `<p>${esc(blurb)}</p>` : ''}${price}${btn}<ul class="ap-ticks">${feats.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></article>`;
  }).join('');
  const faq = (T.faq || []).map(([a, b]) => `<details class="ap-faq"><summary>${esc(a)}</summary><p>${esc(b)}</p></details>`).join('');
  const offers = plans.filter((p) => p.price_fils > 0).map((p) => ({ '@type': 'Offer', name: p.name_en, price: (p.price_fils / 100).toFixed(2), priceCurrency: 'AED', category: p.interval === 'once' ? 'one-time' : 'subscription' }));
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: 'Tawsiya AI visibility tracking', brand: { '@type': 'Brand', name: 'Tawsiya' }, description: T.desc, offers };
  const data = { lang, ui: S.ui_plans, home: prefix(lang) + '/', wa: R.CFG().whatsapp, email: R.CFG().email };
  const content = `<section class="v4-sec ap-sec"><div class="wrap">
  <header class="ap-head"><p class="v4-kicker">${esc(T.kicker)}</p><h1>${esc(T.h1)}</h1><p class="lede">${esc(T.lede)}</p></header>
  <div class="ap-plans">${cards}</div><p class="ap-err" id="plans-err" role="alert" hidden></p>
  <p class="ap-fine">${esc(T.vat)} ${esc(T.unpriced)}</p></div></section>
<section class="v4-sec ap-sec"><div class="wrap ap-two-col"><div class="ap-card"><h2 class="ap-h3">${esc(T.services_h)}</h2><p>${esc(T.services_t)}</p>
  <p><a class="v4-btn v4-btn-dark" href="${esc(R.waHref(T.services_msg))}" rel="noopener">${esc(T.services_btn)}</a> <a class="v4-btn v4-btn-line" href="${prefix(lang)}/#pricing">${esc(lang === 'en' ? 'Studio packages' : 'باقات الاستوديو')}</a></p></div>
  <div><h2 class="ap-h2">${esc(T.faq_h)}</h2>${faq}</div></div></section>`;
  const extra = `<script type="application/json" id="tw-app">${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script src="/assets/js/core.js" defer></script><script src="/assets/js/plans.js" defer></script>`;
  res.set('Cache-Control', 'no-cache').send(R.page({ lang, title: `${T.title} | ${lang === 'en' ? 'Tawsiya' : 'توصية'}`, desc: T.desc, slug: 'plans', content, index: true, extra, ld: U.jsonLd(ld) }));
}));

module.exports = { router, notFound, langOf };
