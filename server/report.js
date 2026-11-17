'use strict';
/* v7 pages: the full report, the live "building your report" view and the before/after progress report. */
const R = require('./render');
const C = require('./config');
const { esc } = require('./util');
const SC = require('./engine/scan');
const I = require('./i18n7');

const prefix = (lang) => (lang === 'en' ? '/en' : '');
const pick = (lang, en, ar) => (lang === 'ar' ? (ar || en) : (en || ar)) || '';
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const tone = (n) => (n == null ? 'na' : n >= 70 ? 'hi' : n >= 40 ? 'mid' : 'lo');
const LABEL = (k) => (C.ai[k] ? C.ai[k].label : k);

function ring(n, size = 132, cls = '') {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, n || 0));
  return `<svg class="rp-ring rp-t-${tone(n)} ${cls}" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" class="rt"/><circle cx="60" cy="60" r="${r}" class="rp-arc" stroke-dasharray="${(c * v / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/></svg>`;
}
function quote(text, n = 420) {
  let t = String(text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '').replace(/[*#_`>]+/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > n) { const cut = t.slice(0, n); const i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('؟'), cut.lastIndexOf('. ')); t = (i > n * 0.5 ? cut.slice(0, i + 1) : cut) + ' …'; }
  return t;
}
const pillarName = (p, lang) => SC.PILLARS[p][lang === 'en' ? 'en' : 'ar'];
const fText = (k, lang) => SC.F[k] ? SC.F[k][lang === 'en' ? 3 : 4] : { t: k, why: '', fix: '' };

/* ------------------------------------------------------------------ full report */
function report({ run, answers, lang, name, site, token, canonical }) {
  const T = I[lang], sc = run.scan, p = run.profile || {};
  const en = lang === 'en';
  const disc = answers.filter((a) => a.kind !== 'brand'), brand = answers.filter((a) => a.kind === 'brand');
  const assistants = [...new Set(answers.map((a) => a.assistant))];
  const top = sc.rivals[0];
  const siteChecks = Object.entries(sc.checks).filter(([k, c]) => !['ai_named', 'brand_known'].includes(k) && c.status !== 'manual');
  const passN = siteChecks.filter(([, c]) => c.status === 'pass').length;
  const g = SC.GRADE[sc.grade];
  const url = `${R.CFG().domain}${prefix(lang)}/report/${token}/`;
  const wa = R.waHref(R.fill(T.cta_msg, { site: site || name, score: sc.overall }));

  const kpi = (big, small, label, t) => `<div class="rp-kpi rp-t-${t}"><b>${big}</b>${small ? `<span>${small}</span>` : ''}<p>${esc(label)}</p></div>`;
  const kpis = `<section class="rp-kpis" aria-label="${esc(T.pillars_h)}">
    ${sc.measured ? kpi(`${sc.named}<small>/${sc.total}</small>`, `${pct(sc.named, sc.total)}%`, T.kpi_named, tone(pct(sc.named, sc.total) * 1.6)) : kpi('–', T.not_measured, T.kpi_named, 'na')}
    ${sc.brandTotal ? kpi(`${sc.known}<small>/${sc.brandTotal}</small>`, '', T.kpi_known, tone(pct(sc.known, sc.brandTotal))) : kpi('–', T.not_measured, T.kpi_known, 'na')}
    ${kpi(`${passN}<small>/${siteChecks.length}</small>`, '', T.kpi_checks, tone(pct(passN, siteChecks.length)))}
    ${kpi(top ? `<span class="rp-kpi-name" dir="auto">${esc(top.name)}</span>` : esc(T.none), top ? `${top.count}×` : '', T.kpi_top, 'na')}</section>`;

  const pillars = `<section class="rp-pillars" aria-labelledby="pl-h"><h2 id="pl-h" class="sr">${esc(T.pillars_h)}</h2>${Object.keys(SC.PILLARS).map((k) => {
    const v = sc.pillars[k];
    return `<div class="rp-pillar rp-t-${tone(v)}"><div class="rp-pillar-top"><h3>${esc(pillarName(k, lang))}</h3><b>${v == null ? '–' : v}</b></div>
      <div class="rp-bar" role="img" aria-label="${v == null ? esc(T.not_measured) : v + '/100'}"><i style="--v:${v || 0}%"></i></div><p>${esc(SC.PILLARS[k][en ? 'den' : 'dar'])}</p></div>`;
  }).join('')}</section>`;

  const says = brand.length ? `<section class="ap-card rp-sec" aria-labelledby="sy-h"><h2 id="sy-h">${esc(T.says_h)}</h2><p class="rp-sub">${esc(T.says_t)}</p>
    <div class="rp-quotes">${brand.map((a) => `<figure class="rp-quote ${a.error ? 'is-err' : a.named ? 'is-yes' : 'is-no'}"><figcaption><b>${esc(LABEL(a.assistant))}</b><span class="rp-chip">${esc(a.error ? T.err : a.named ? T.knows : T.unknown)}</span></figcaption>
      <blockquote dir="auto">${esc(a.error ? '' : quote(a.answer))}</blockquote>${(a.sources || []).length ? `<p class="rp-src" dir="ltr">${(a.sources || []).slice(0, 3).map((u) => { try { return esc(new URL(u).hostname.replace(/^www\./, '')); } catch (e) { return ''; } }).filter(Boolean).join(' · ')}</p>` : ''}</figure>`).join('')}</div></section>` : '';

  const qs = [...new Set(disc.map((a) => a.question))];
  const matrix = qs.length ? `<section class="ap-card rp-sec" aria-labelledby="ak-h"><h2 id="ak-h">${esc(T.ask_h)}</h2><p class="rp-sub">${esc(T.ask_t)}</p>
    <div class="ap-tw"><table class="rp-matrix"><thead><tr><th scope="col">${esc(T.col_q)}</th>${assistants.map((a) => `<th scope="col">${esc(LABEL(a))}</th>`).join('')}<th scope="col">${esc(T.col_instead)}</th></tr></thead><tbody>
    ${qs.map((qq) => {
      const row = disc.filter((a) => a.question === qq); const names = [];
      row.forEach((a) => (a.mentions || []).forEach((m) => { if (!names.includes(m) && names.length < 3) names.push(m); }));
      return `<tr><th scope="row" dir="auto">${esc(qq)}</th>${assistants.map((as) => { const a = row.find((x) => x.assistant === as); const st = !a || a.error ? 'na' : a.named ? 'yes' : 'no';
        return `<td class="rp-cell rp-${st}"><span aria-hidden="true">${st === 'yes' ? '✓' : st === 'no' ? '✕' : '–'}</span><span class="sr">${st === 'yes' ? esc(T.yes) : st === 'no' ? esc(T.no) : esc(T.err)}</span></td>`; }).join('')}
        <td dir="auto" class="rp-names">${names.map(esc).join(en ? ', ' : '، ') || '–'}</td></tr>`;
    }).join('')}</tbody></table></div></section>` : '';

  const maxR = Math.max(1, sc.named, ...sc.rivals.map((r) => r.count));
  const rivals = sc.measured ? `<div class="ap-card rp-sec"><h2>${esc(T.rivals_h)}</h2><p class="rp-sub">${esc(T.rivals_t)}</p><ul class="rp-hbars">
    <li class="is-you"><span dir="auto">${esc(T.you)} · ${esc(name)}</span><i style="--v:${pct(sc.named, maxR)}%"></i><b>${sc.named}</b></li>
    ${sc.rivals.slice(0, 7).map((r) => `<li><span dir="auto">${esc(r.name)}</span><i style="--v:${pct(r.count, maxR)}%"></i><b>${r.count}</b></li>`).join('')}</ul></div>` : '';
  const maxS = Math.max(1, ...sc.sources.map((s) => s.count));
  const sources = sc.sources.length ? `<div class="ap-card rp-sec"><h2>${esc(T.sources_h)}</h2><p class="rp-sub">${esc(T.sources_t)}</p><ul class="rp-hbars rp-hbars-s">
    ${sc.sources.slice(0, 8).map((s) => `<li><span dir="ltr">${esc(s.domain)}</span><i style="--v:${pct(s.count, maxS)}%"></i><b>${s.count}</b></li>`).join('')}</ul></div>` : '';

  const buckets = ['quick', 'month', 'ongoing'].map((e) => [e, sc.findings.filter((f) => f.effort === e)]).filter((b) => b[1].length);
  const plan = sc.findings.length ? `<section class="ap-card rp-sec" aria-labelledby="pn-h"><h2 id="pn-h">${esc(T.plan_h)}</h2><p class="rp-sub">${esc(T.plan_t)}</p>
    <div class="rp-plan">${buckets.map(([e, list]) => `<div class="rp-col"><h3>${esc(T[e])} <span class="rp-count">${list.length}</span></h3>${list.map((f) => { const d = fText(f.key, lang);
      return `<details class="rp-find rp-sev-${f.severity}"><summary><span class="rp-chip">${esc(T.sev[f.severity])}</span><b>${esc(d.t)}</b><small>${esc(pillarName(f.pillar, lang))}</small></summary>
        <p><strong>${esc(T.why)}:</strong> ${esc(d.why)}</p><p><strong>${esc(T.fix)}:</strong> ${esc(d.fix)}</p>${f.note && !/^\d+ of \d+$/.test(f.note) ? `<p class="rp-ev"><strong>${esc(T.found)}:</strong> <span dir="auto">${esc(f.note)}</span></p>` : ''}</details>`; }).join('')}</div>`).join('')}</div></section>` : '';

  const checks = `<section class="ap-card rp-sec" aria-labelledby="ck-h"><h2 id="ck-h">${esc(T.checks_h)}</h2><div class="rp-checks">${['access', 'clarity', 'trust'].map((pl) => `<div><h3>${esc(pillarName(pl, lang))}</h3><ul>${
    Object.keys(SC.F).filter((k) => SC.F[k][0] === pl && sc.checks[k]).map((k) => { const c = sc.checks[k];
      return `<li class="rp-ck rp-ck-${c.status}"><span aria-hidden="true">${c.status === 'pass' ? '✓' : c.status === 'fail' ? '!' : '?'}</span><div><b>${esc(SC.LBL[k] ? SC.LBL[k][en ? 0 : 1] : k)}</b><small>${esc(c.status === 'pass' ? T.pass : c.status === 'fail' ? T.fail : T.manual)}${c.note ? ' · ' : ''}<span dir="auto">${esc(c.note || '')}</span></small></div></li>`; }).join('')}</ul></div>`).join('')}</div></section>`;

  const social = Object.entries(p.social || {});
  const row = (k, v, ltr) => (v ? `<div><dt>${esc(T[k])}</dt><dd${ltr ? ' dir="ltr"' : ''}>${v}</dd></div>` : '');
  const profile = `<section class="ap-card rp-sec" aria-labelledby="pf-h"><h2 id="pf-h">${esc(T.profile_h)}</h2><dl class="ap-dl rp-dl">
    ${row('p_name', esc([p.name, p.name_ar && p.name_ar !== p.name ? p.name_ar : ''].filter(Boolean).join(' · ')))}${row('p_cat', esc(pick(lang, p.category, p.category_ar)))}
    ${row('p_where', esc([pick(lang, p.area, p.area_ar), pick(lang, p.city, p.city_ar)].filter(Boolean).join(en ? ', ' : '، ')))}${row('p_phone', esc(p.phone || ''), true)}${row('p_email', esc(p.email || ''), true)}
    ${row('p_social', social.map(([k]) => esc(k)).join(' · '))}${row('p_lang', esc((p.languages || []).join(', ')))}${row('p_pages', String((run.audit && run.audit.pages || []).length || ''))}
    ${row('p_services', (p.services || []).slice(0, 6).map((s) => `<span class="rp-tag" dir="auto">${esc(s)}</span>`).join(' '))}</dl>
    <p class="ap-fine"><a href="${esc(R.waHref(R.fill(T.cta_msg, { site: site || name, score: sc.overall })))}" rel="noopener">${esc(T.p_wrong)}</a></p></section>`;

  const siteErr = run.audit && run.audit.error ? `<p class="ap-note warn">${esc(R.fill(T.no_site, { err: run.audit.error }))}</p>` : '';
  const summary = pick(lang, run.summary_en, run.summary_ar);
  const loc = [pick(lang, p.category, p.category_ar), [pick(lang, p.area, p.area_ar), pick(lang, p.city, p.city_ar)].filter(Boolean).join(en ? ', ' : '، ')].filter(Boolean).join(en ? ' in ' : ' في ');
  return `<article class="wrap rp" data-report="${esc(token)}">
  ${siteErr}
  <header class="rp-hero">
    <div class="rp-hero-l"><p class="v4-kicker">${esc(T.kicker)}</p><h1 dir="auto">${esc(name)}</h1>
      <p class="rp-meta"><span dir="ltr">${esc(site || '')}</span>${loc ? ` · ${esc(loc)}` : ''} · ${esc(T.checked)} ${esc(R.fmtDate(run.finished_at || run.started_at, lang))}</p>
      <p class="rp-verdict rp-t-${tone(sc.overall)}"><b>${esc(g[en ? 0 : 1])}.</b> ${esc(T.grade_t[sc.grade])}</p>
      <div class="rp-actions"><button class="v4-btn v4-btn-line v4-btn-sm" type="button" data-print>${esc(T.pdf)}</button>
        <button class="v4-btn v4-btn-line v4-btn-sm" type="button" data-copy="${esc(url)}" data-done="${esc(T.copied)}">${esc(T.copy)}</button>
        <a class="v4-btn v4-btn-line v4-btn-sm" href="https://wa.me/?text=${encodeURIComponent(name + ' · ' + T.kicker + ': ' + url)}" rel="noopener">${esc(T.share_wa)}</a></div></div>
    <div class="rp-gauge">${ring(sc.overall, 168)}<div class="rp-gauge-n"><b>${sc.overall}</b><span>${esc(T.score_of)}</span></div></div>
  </header>
  ${kpis}
  ${pillars}
  ${summary ? `<section class="ap-card rp-sec rp-summary"><h2>${esc(T.summary_h)}</h2><p class="ap-lead" dir="auto">${esc(summary)}</p></section>` : ''}
  ${says}
  ${matrix}
  ${rivals || sources ? `<section class="rp-two">${rivals}${sources}</section>` : ''}
  ${plan}
  ${checks}
  ${profile}
  <section class="rp-cta"><div><h2>${esc(T.cta_h)}</h2><p>${esc(T.cta_t)}</p></div><div class="rp-cta-b"><a class="v4-btn v4-btn-gold" href="${prefix(lang)}/plans/">${esc(T.cta_plans)}</a> <a class="v4-btn v4-btn-line" href="${esc(wa)}" rel="noopener">${esc(T.cta_wa)}</a></div></section>
  <p class="ap-fine">${esc(T.method)} <a href="${prefix(lang)}/method/">${esc(T.method_link)}</a></p>
</article>`;
}

/* ------------------------------------------------------------------ live view while the scan runs */
function live({ lang, site, token, state }) {
  const T = I[lang];
  return `<article class="wrap rp rp-live" data-live="${esc(token)}" data-lang="${lang}">
  <header class="rp-live-h"><p class="v4-kicker">${esc(T.live_k)}</p><h1 dir="ltr">${esc(site)}</h1><p class="lede">${esc(T.live_t)}</p></header>
  <div class="rp-live-grid">
    <div class="ap-card"><ol class="rp-steps">${T.steps.map((s, i) => `<li data-step="${i}"><span class="rp-dot" aria-hidden="true"></span><b>${esc(s)}</b><small data-sub></small></li>`).join('')}</ol>
      <div class="rp-bar rp-bar-live" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i style="--v:3%"></i></div>
      <p class="rp-found" data-found hidden></p><p class="ap-err" data-failed hidden>${esc(T.failed)}</p></div>
    <div class="ap-card"><ul class="rp-feed" data-feed aria-live="polite"><li class="rp-feed-wait">${esc(T.queued)}</li></ul></div>
  </div>
  <section class="ap-card rp-send" ${state && state.has_contact ? 'hidden' : ''}><h2>${esc(T.send_h)}</h2><p class="rp-sub">${esc(T.send_t)}</p>
    <form class="ap-form ap-inline" data-send novalidate><label class="sr" for="rp-c">${esc(T.send_ph)}</label><input id="rp-c" name="contact" type="text" autocomplete="email" maxlength="120" placeholder="${esc(T.send_ph)}" dir="ltr">
    <button class="v4-btn v4-btn-dark" type="submit">${esc(T.send_btn)}</button></form><p class="ap-ok" role="status" data-sent hidden>${esc(T.send_ok)}</p><p class="ap-err" role="alert" data-senderr hidden></p></section>
  <script type="application/json" id="rp-i18n">${JSON.stringify({ st_pages: T.st_pages, st_found: T.st_found, st_ai: T.st_ai, named: T.feed_named, not: T.feed_not, brand: T.feed_brand, queued: T.queued }).replace(/</g, '\\u003c')}</script>
</article>`;
}

/* ------------------------------------------------------------------ before / after */
function progress({ lang, name, site, a, b, answersA, answersB, tasks, token }) {
  const T = I[lang], en = lang === 'en';
  if (!b) return `<article class="wrap rp"><header class="rp-live-h"><p class="v4-kicker">${esc(T.prog_k)}</p><h1 dir="auto">${esc(name)}</h1><p class="lede">${esc(T.prog_none)}</p></header>
    ${a ? `<p><a class="v4-btn v4-btn-dark" href="${prefix(lang)}/report/${esc(a.token)}/">${esc(T.open_report)}</a></p>` : ''}</article>`;
  const cmp = SC.compare(a.scan, b.scan);
  const d = cmp.overall.delta;
  const delta = `<span class="rp-delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d} ${esc(T.points)}</span>`;
  const pair = (label, x, y) => `<div class="rp-kpi"><p>${esc(label)}</p><b class="rp-ba"><span>${x}</span><i aria-hidden="true">${en ? '→' : '←'}</i><span>${y}</span></b></div>`;
  const fr = (v) => (v[1] ? `${v[0]}/${v[1]}` : '–');
  const lbl = (k) => (SC.LBL[k] ? SC.LBL[k][en ? 0 : 1] : fText(k, lang).t);
  const listK = (keys, good) => keys.length ? `<ul class="rp-klist${good ? ' rp-fixed' : ''}">${keys.map((k) => `<li>${good ? '<span aria-hidden="true">✓</span> ' : ''}${esc(good ? lbl(k) : fText(k, lang).t)}</li>`).join('')}</ul>` : `<p class="ap-fine">${esc(T.nothing)}</p>`;
  const pRows = Object.keys(SC.PILLARS).map((k) => { const x = cmp.pillars[k]; const dd = x.before != null && x.after != null ? x.after - x.before : null;
    return `<tr><th scope="row">${esc(pillarName(k, lang))}</th><td><div class="rp-bar"><i style="--v:${x.before || 0}%"></i></div><span class="mono">${x.before == null ? '–' : x.before}</span></td>
      <td><div class="rp-bar rp-bar-after"><i style="--v:${x.after || 0}%"></i></div><span class="mono">${x.after == null ? '–' : x.after}</span></td><td class="mono ${dd > 0 ? 'up' : dd < 0 ? 'down' : ''}">${dd == null ? '–' : (dd > 0 ? '+' : '') + dd}</td></tr>`; }).join('');
  // same question before/after
  const qa = [...new Set(answersA.filter((x) => x.kind !== 'brand').map((x) => x.question))].filter((qq) => answersB.some((x) => x.question === qq));
  const assistants = [...new Set(answersB.map((x) => x.assistant))];
  const icon = (r) => (!r || r.error ? '–' : r.named ? '✓' : '✕');
  const same = qa.length ? `<section class="ap-card rp-sec"><h2>${esc(T.same_h)}</h2><div class="ap-tw"><table class="rp-matrix"><thead><tr><th scope="col">${esc(T.col_q)}</th>${assistants.map((x) => `<th scope="col">${esc(LABEL(x))}</th>`).join('')}</tr></thead><tbody>
    ${qa.slice(0, 12).map((qq) => `<tr><th scope="row" dir="auto">${esc(qq)}</th>${assistants.map((as) => { const r1 = answersA.find((x) => x.question === qq && x.assistant === as), r2 = answersB.find((x) => x.question === qq && x.assistant === as);
      return `<td class="rp-cell rp-${!r2 || r2.error ? 'na' : r2.named ? 'yes' : 'no'}"><span class="rp-pairc">${icon(r1)} ${en ? '→' : '←'} ${icon(r2)}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div></section>` : '';
  const work = tasks.length ? `<ul class="rp-klist rp-work">${tasks.map((t) => `<li><b dir="auto">${t.finding_key && SC.LBL[t.finding_key] ? '✓ ' + esc(SC.LBL[t.finding_key][en ? 0 : 1]) : esc(t.title)}</b><small>${esc(R.fmtDate(t.done_at, lang))}</small>${t.client_note ? `<p dir="auto">${esc(t.client_note)}</p>` : ''}</li>`).join('')}</ul>` : `<p class="ap-fine">${esc(T.nothing)}</p>`;
  return `<article class="wrap rp" data-progress="${esc(token)}">
  <header class="rp-hero">
    <div class="rp-hero-l"><p class="v4-kicker">${esc(T.prog_k)}</p><h1 dir="auto">${esc(name)}</h1>
      <p class="rp-meta"><span dir="ltr">${esc(site || '')}</span> · ${esc(R.fill(T.prog_from, { a: R.fmtDate(a.finished_at, lang), b: R.fmtDate(b.finished_at, lang) }))}</p>
      <p class="rp-verdict">${delta}</p>
      <div class="rp-actions"><button class="v4-btn v4-btn-line v4-btn-sm" type="button" data-print>${esc(T.pdf)}</button>
        <a class="v4-btn v4-btn-line v4-btn-sm" href="${prefix(lang)}/report/${esc(a.token)}/">${esc(T.baseline)}</a> <a class="v4-btn v4-btn-line v4-btn-sm" href="${prefix(lang)}/report/${esc(b.token)}/">${esc(T.latest)}</a></div></div>
    <div class="rp-ba-rings"><figure>${ring(cmp.overall.before, 120, 'is-before')}<figcaption><b>${cmp.overall.before}</b>${esc(T.before)}</figcaption></figure><span class="rp-arrow" aria-hidden="true">${en ? '→' : '←'}</span>
      <figure>${ring(cmp.overall.after, 150)}<figcaption><b>${cmp.overall.after}</b>${esc(T.after)}</figcaption></figure></div>
  </header>
  <section class="rp-kpis">${pair(T.kpi_named, fr(cmp.named.before), fr(cmp.named.after))}${pair(T.kpi_known, fr(cmp.known.before), fr(cmp.known.after))}
    ${pair(T.kpi_checks, a.scan.passed.length, b.scan.passed.length)}${pair(T.kpi_top, esc((a.scan.rivals[0] || {}).name || '–'), esc((b.scan.rivals[0] || {}).name || '–'))}</section>
  <section class="ap-card rp-sec"><h2>${esc(T.pillars_h)}</h2><div class="ap-tw"><table class="rp-ptable"><thead><tr><th scope="col"></th><th scope="col">${esc(T.before)}</th><th scope="col">${esc(T.after)}</th><th scope="col">${esc(T.change)}</th></tr></thead><tbody>${pRows}</tbody></table></div></section>
  <section class="rp-three"><div class="ap-card rp-sec rp-good"><h2>${esc(T.fixed_h)} <span class="rp-count">${cmp.fixed.length}</span></h2>${listK(cmp.fixed, true)}</div>
    <div class="ap-card rp-sec"><h2>${esc(T.still_h)} <span class="rp-count">${cmp.still.length}</span></h2>${listK(cmp.still)}</div>
    <div class="ap-card rp-sec"><h2>${esc(T.fresh_h)} <span class="rp-count">${cmp.fresh.length}</span></h2>${listK(cmp.fresh)}</div></section>
  ${same}
  <section class="ap-card rp-sec"><h2>${esc(T.work_h)}</h2>${work}</section>
  <section class="rp-cta"><div><h2>${esc(T.prog_cta_h)}</h2><p>${esc(T.prog_cta_t)}</p></div><div class="rp-cta-b"><a class="v4-btn v4-btn-gold" href="${prefix(lang)}/dashboard/">${esc(en ? 'Open dashboard' : 'لوحة التحكم')}</a></div></section>
  <p class="ap-fine">${esc(T.method)}</p>
</article>`;
}

module.exports = { report, live, progress, ring, tone };
