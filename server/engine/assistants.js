'use strict';
/* Ask real AI assistants real customer questions (with web search on, like the consumer apps), then check whether
   the business is named. API answers can differ from what a signed-in person sees in the app; the method page says so. */
const C = require('../config');
const { norm } = require('./audit');

const SYSTEM = {
  en: 'You are a helpful assistant answering a customer in the United Arab Emirates. Recommend specific businesses by name when asked, and be concise.',
  ar: 'أنت مساعد يجيب عميلاً في الإمارات العربية المتحدة. عند السؤال اذكر أنشطة محددة بالاسم، وكن موجزاً.'
};
async function post(url, headers, body, timeout = 90000) {
  const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) { const e = new Error(`${r.status} ${(j && j.error && (j.error.message || j.error.type)) || t.slice(0, 160)}`); e.http = r.status; throw e; }
  return j || {};
}
const uniq = (a) => [...new Set(a.filter(Boolean))].slice(0, 20);

/* Model names are retired often. Try the chosen model, then the fallbacks; remember the one that answered. */
const GOOD = {};
const badModel = (e) => e.http === 404 || ((e.http === 400 || e.http === 403 || e.http === 410) && /model/i.test(e.message) && /not[ _]?found|does not exist|deprecat|retired|shut ?down|unsupported|not supported|invalid|unknown|no longer|not available|access|permission/i.test(e.message));
async function withModel(p, fn) {
  const list = C.ai[p].models();
  const first = GOOD[p] && list.includes(GOOD[p].model) && GOOD[p].chosen === list[0] ? [GOOD[p].model].concat(list.filter((m) => m !== GOOD[p].model)) : list;
  let last;
  for (const m of first) {
    try { const r = await fn(m); GOOD[p] = { model: m, chosen: list[0] }; r.model = m; return r; }
    catch (e) { last = e; if (!badModel(e)) throw e; }
  }
  throw last;
}
const modelInUse = (p) => (GOOD[p] && GOOD[p].chosen === C.ai[p].model() ? GOOD[p].model : C.ai[p].model());

/* Estimated cost in USD. Token prices are per 1M tokens; "search" is the provider's fee per web search.
   These are planning estimates (checked Nov 2026); the real bill is on each provider's usage page. */
const PRICE = [
  [/luna|haiku-5/, 0.10, 0.50], [/terra/, 1, 5], [/gpt-5-mini/, 0.25, 2], [/haiku-4/, 1, 5],
  [/flash-lite/, 0.10, 0.40], [/gemini-3.*flash/, 1.5, 9], [/gemini-2\.5-flash/, 0.30, 2.5], [/sonar/, 0.25, 2.5]
];
const SEARCH_FEE = { openai: 0.01, anthropic: 0.01, gemini: 0.014, perplexity: 0.0025 };
function cost(p, model, u, text) {
  if (u && u.usd != null) return +Number(u.usd).toFixed(5);
  const pr = PRICE.find((x) => x[0].test(model || '')) || [null, 1, 5];
  const searches = u && u.searches != null ? u.searches : 1;
  const tin = u && u.in ? u.in : (searches ? 6000 : 300), tout = u && u.out ? u.out : Math.ceil(String(text || '').length / 3);
  return +(tin / 1e6 * pr[1] + tout / 1e6 * pr[2] + searches * SEARCH_FEE[p]).toFixed(5);
}

const PROVIDERS = {
  openai(qn, lang) {
    const c = C.ai.openai;
    return withModel('openai', async (model) => {
      const j = await post(c.base() + '/v1/responses', { Authorization: 'Bearer ' + c.key() },
        { model, instructions: SYSTEM[lang], input: qn, tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'AE', city: 'Dubai' } }] });
      let text = j.output_text || '', sources = [], searches = 0;
      (j.output || []).forEach((o) => {
        if (o.type === 'web_search_call') searches++;
        (o.content || []).forEach((c2) => { if (c2.type === 'output_text') { if (!j.output_text) text += c2.text || ''; (c2.annotations || []).forEach((a) => { if (a.url) sources.push(a.url); }); } });
      });
      const u = j.usage || {};
      return { text, sources: uniq(sources), searched: true, usage: { in: u.input_tokens, out: u.output_tokens, searches: j.usage ? searches : null } };
    });
  },
  gemini(qn, lang) {
    const c = C.ai.gemini;
    return withModel('gemini', async (model) => {
      const url = `${c.base()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, hd = { 'x-goog-api-key': c.key() };
      const body = { systemInstruction: { parts: [{ text: SYSTEM[lang] }] }, contents: [{ role: 'user', parts: [{ text: qn }] }] };
      let j, searched = true;
      try { j = await post(url, hd, Object.assign({ tools: [{ google_search: {} }] }, body)); }
      catch (e) {
        /* the free tier of newer models has no Google Search; answer from the model's own knowledge instead */
        if (badModel(e) || !(e.http === 400 || e.http === 403 || e.http === 429) || !/search|grounding|tool|free tier|quota|billing/i.test(e.message)) throw e;
        j = await post(url, hd, body); searched = false;
      }
      const cand = (j.candidates || [])[0] || {}, gm = cand.groundingMetadata || {};
      const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
      const sources = (gm.groundingChunks || []).map((g) => g.web && (g.web.title && /\./.test(g.web.title) ? 'https://' + g.web.title : g.web.uri));
      const u = j.usageMetadata || {};
      return { text, sources: uniq(sources), searched, usage: { in: u.promptTokenCount, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), searches: searched ? Math.max(1, (gm.webSearchQueries || []).length) : 0 } };
    });
  },
  anthropic(qn, lang) {
    const c = C.ai.anthropic;
    return withModel('anthropic', async (model) => {
      const j = await post(c.base() + '/v1/messages', { 'x-api-key': c.key(), 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 1200, system: SYSTEM[lang], messages: [{ role: 'user', content: qn }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', country: 'AE', city: 'Dubai', timezone: 'Asia/Dubai' } }] });
      let text = '', sources = [];
      (j.content || []).forEach((b) => {
        if (b.type === 'text') { text += b.text || ''; (b.citations || []).forEach((ci) => { if (ci.url) sources.push(ci.url); }); }
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => { if (r.url) sources.push(r.url); });
      });
      const u = j.usage || {};
      return { text, sources: uniq(sources), searched: true, usage: { in: u.input_tokens, out: u.output_tokens, searches: u.server_tool_use ? (u.server_tool_use.web_search_requests || 0) : null } };
    });
  },
  perplexity(qn, lang) {
    const c = C.ai.perplexity;
    return withModel('perplexity', async (model) => {
      /* Agent API (replaced Sonar chat completions in Sept 2026); a bare "sonar" uses the old endpoint as a last resort */
      if (!/\//.test(model)) {
        const j = await post(c.base() + '/chat/completions', { Authorization: 'Bearer ' + c.key() }, { model, messages: [{ role: 'system', content: SYSTEM[lang] }, { role: 'user', content: qn }] });
        const u = j.usage || {};
        return { text: (((j.choices || [])[0] || {}).message || {}).content || '', sources: uniq((j.search_results || []).map((r) => r.url).concat(j.citations || [])), searched: true,
          usage: { in: u.prompt_tokens, out: u.completion_tokens, searches: 1, usd: u.cost && u.cost.total_cost } };
      }
      const j = await post(c.base() + '/v1/agent', { Authorization: 'Bearer ' + c.key() }, { model, instructions: SYSTEM[lang], input: qn, tools: [{ type: 'web_search' }] });
      let text = j.output_text || '', sources = [];
      (j.output || []).forEach((o) => {
        if (o.type === 'message') (o.content || []).forEach((x) => { if (x.type === 'output_text') { if (!j.output_text) text += x.text || ''; (x.annotations || []).forEach((a) => { if (a.url) sources.push(a.url); }); } });
        if (o.type === 'search_results') (o.results || []).forEach((r) => { if (r.url) sources.push(r.url); });
      });
      const u = j.usage || {};
      return { text: text.replace(/\[(?:web:)?\d+\]/g, ''), sources: uniq(sources), searched: true, usage: { in: u.input_tokens, out: u.output_tokens, searches: 1, usd: u.cost && u.cost.total_cost } };
    });
  }
};

/* Is the business named? name variants + aliases + domain (in text or in cited sources). */
function variants(biz) {
  const v = [biz.name_en, biz.name_ar, biz.name].concat(String(biz.aliases || '').split(/[,\n،]/)).map((x) => norm(x)).filter((x) => x && x.length >= 3);
  return [...new Set(v)];
}
function isNamed(answer, sources, biz) {
  const t = ' ' + norm(answer) + ' ';
  if (variants(biz).some((v) => t.includes(' ' + v + ' ') || (v.length >= 6 && t.includes(v)))) return true;
  const host = String(biz.website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  if (host && host.includes('.')) {
    if (String(answer).toLowerCase().includes(host)) return true;
    if ((sources || []).some((u) => { try { return new URL(u).hostname.replace(/^www\./, '') === host; } catch (e) { return false; } })) return true;
  }
  return false;
}
/* Names the answer recommends: bold text and list-item leads. Heuristic, shown as "names mentioned". */
const STOP = /^(note|tip|tips|summary|conclusion|overview|location|address|price|prices|hours|why|features|pros|cons|ملاحظة|الموقع|العنوان|السعر|الأسعار|الخلاصة|نصيحة|المميزات)$/i;
function mentions(answer) {
  const out = [];
  String(answer || '').replace(/\*\*([^*\n]{2,60})\*\*/g, (_, x) => { out.push(x); return ''; });
  String(answer || '').split('\n').forEach((l) => {
    const m = l.match(/^\s*(?:\d+[.)]|[-*•])\s+(?:\*\*)?([^:–—\-*(\n]{2,50})/);
    if (m) out.push(m[1]);
  });
  const clean = out.map((x) => x.replace(/[*_`#\[\]]/g, '').replace(/\s+/g, ' ').trim().replace(/[.:،,]+$/, '')).filter((x) => x.length >= 2 && x.length <= 50 && !STOP.test(x) && !/^https?:/.test(x));
  const seen = new Set(), res = [];
  clean.forEach((x) => { const k = norm(x); if (k && !seen.has(k)) { seen.add(k); res.push(x); } });
  return res.slice(0, 12);
}

/* Default customer questions in both languages from the business facts. */
const isAr = (x) => /[؀-ۿ]/.test(x || '');
function defaultQuestions(biz, n) {
  const c1 = (biz.category || '').trim(), c2 = (biz.category_ar || '').trim();
  const catEn = c1 && !isAr(c1) ? c1 : '', catAr = c2 || (isAr(c1) ? c1 : '');
  const area = (biz.area || '').trim(), city = (biz.city || 'Dubai').trim();
  const cityAr = { dubai: 'دبي', 'abu dhabi': 'أبوظبي', sharjah: 'الشارقة', ajman: 'عجمان' }[city.toLowerCase()] || city;
  const where = area ? `${area}, ${city}` : city, whereAr = area ? `${area}، ${cityAr}` : cityAr;
  const services = String(biz.services || '').split(/\n|,|،/).map((s) => s.trim()).filter((s) => s && s.length < 50).slice(0, 3);
  const en = !catEn ? [] : [`What is the best ${catEn} in ${where}?`, `Can you recommend a good ${catEn} in ${city}?`, `Which ${catEn} in ${where} has the best reviews?`,
    ...services.filter((s) => !isAr(s)).map((s) => `Where can I get ${s} in ${city}?`), `${catEn} near ${area || city} that locals recommend`,
    `Who is the most trusted ${catEn} in ${where}?`, `Affordable ${catEn} in ${city} with good reviews`, `Who should I call for a ${catEn} in ${where}?`,
    `Top rated ${catEn} near ${area || city}`, `Best ${catEn} in ${city} for first-time customers`, `Recommend a reliable ${catEn} in ${where}`,
    `Which ${catEn} in ${city} do people recommend on Google?`, `${catEn} in ${where}: who is best and why?`];
  const ar = !catAr ? [] : [`ما هو أفضل ${catAr} في ${whereAr}؟`, `أنصحني بـ${catAr} ممتاز في ${whereAr}`, `ما ${catAr} الذي يرشحه الناس في ${whereAr}؟`,
    ...services.filter(isAr).map((s) => `أين أجد ${s} في ${whereAr}؟`), `${catAr} قريب من ${area || cityAr} بتقييمات جيدة`,
    `من هو ${catAr} الأكثر ثقة في ${whereAr}؟`, `${catAr} بسعر مناسب في ${cityAr} وتقييمات جيدة`, `بمن أتصل لخدمة ${catAr} في ${whereAr}؟`,
    `أعلى ${catAr} تقييماً قرب ${area || cityAr}`, `أفضل ${catAr} في ${cityAr} للعملاء الجدد`, `رشّح لي ${catAr} موثوقاً في ${whereAr}`,
    `أي ${catAr} في ${cityAr} يوصي به الناس على Google؟`, `${catAr} في ${whereAr}: من الأفضل ولماذا؟`];
  const out = [];
  for (let i = 0; out.length < n && (i < en.length || i < ar.length); i++) {
    if (en[i]) out.push({ q: en[i], lang: 'en' });
    if (ar[i] && out.length < n) out.push({ q: ar[i], lang: 'ar' });
  }
  return out;
}

/* one plain completion (no web search) from the first connected model; used to read a website's text */
async function complete(prompt, { maxTokens = 500 } = {}) {
  const on = C.assistantsOn();
  const sys = 'You extract facts from text. Reply with JSON only.';
  for (const p of ['openai', 'anthropic', 'gemini', 'perplexity'].filter((x) => on.includes(x))) {
    const c = C.ai[p];
    try {
      const r = await withModel(p, async (model) => {
        if (p === 'openai') { const j = await post(c.base() + '/v1/responses', { Authorization: 'Bearer ' + c.key() }, { model, instructions: sys, input: prompt }, 40000);
          let t = j.output_text || ''; (j.output || []).forEach((o) => (o.content || []).forEach((x) => { if (x.type === 'output_text' && !j.output_text) t += x.text || ''; })); return { text: t }; }
        if (p === 'anthropic') { const j = await post(c.base() + '/v1/messages', { 'x-api-key': c.key(), 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: prompt }] }, 40000);
          return { text: (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('') }; }
        if (p === 'gemini') { const j = await post(`${c.base()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': c.key() }, { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }] }, 40000);
          return { text: (((((j.candidates || [])[0] || {}).content || {}).parts) || []).map((x) => x.text || '').join('') }; }
        if (!/\//.test(model)) { const j = await post(c.base() + '/chat/completions', { Authorization: 'Bearer ' + c.key() }, { model, messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }] }, 40000);
          return { text: (((j.choices || [])[0] || {}).message || {}).content || '' }; }
        const j = await post(c.base() + '/v1/agent', { Authorization: 'Bearer ' + c.key() }, { model, instructions: sys, input: prompt }, 40000);
        let t = j.output_text || ''; (j.output || []).forEach((o) => (o.content || []).forEach((x) => { if (x.type === 'output_text' && !j.output_text) t += x.text || ''; })); return { text: t };
      });
      if (r.text) return r.text;
    } catch (e) { /* try the next one */ }
  }
  return null;
}

/* "What do you know about X?" in the customer's language */
function brandQuestion(p, lang) {
  const name = p.name || p.name_ar, city = p.city || 'Dubai';
  if (lang === 'ar') return `ماذا تعرف عن ${p.name_ar || name}${p.category_ar ? ' (' + p.category_ar + ')' : ''} في ${p.city_ar || city}؟ هل تنصح به ولماذا؟`;
  return `What do you know about ${name}${p.category ? ' (' + p.category + ')' : ''} in ${city}? Would you recommend it, and why?`;
}
const UNKNOWN = /(couldn'?t|could not|can'?t|cannot|unable to|wasn'?t able to|did not|didn'?t) find|no (specific |reliable |detailed )?information|not (familiar|aware)|don'?t have (specific |any )?(information|details)|no results|لم أتمكن|لا تتوفر|لا أملك معلومات|لم أجد|ليس لدي معلومات/i;
function knows(answer, sources, biz) { return isNamed(answer, sources, biz) && !UNKNOWN.test(String(answer || '').slice(0, 600)); }

async function ask(provider, qn, lang) {
  const r = await PROVIDERS[provider](qn, lang === 'ar' ? 'ar' : 'en');
  r.cost = cost(provider, r.model, r.usage, r.text);
  return r;
}

/* run all questions on all connected assistants, limited concurrency */
async function runAll(biz, questions, onAnswer, concurrency = 5) {
  const on = C.assistantsOn();
  const jobs = [];
  questions.forEach((qq) => on.forEach((p) => jobs.push({ p, qq })));
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const { p, qq } = jobs[i++];
      let row;
      try {
        const r = await ask(p, qq.q, qq.lang);
        row = { assistant: p, question: qq.q, lang: qq.lang, kind: qq.kind || 'discover', answer: r.text.slice(0, 6000), sources: r.sources, named: qq.kind === 'brand' ? knows(r.text, r.sources, biz) : isNamed(r.text, r.sources, biz), mentions: qq.kind === 'brand' ? [] : mentions(r.text), cost: r.cost, model: r.model, searched: r.searched !== false };
      } catch (e) { row = { assistant: p, question: qq.q, lang: qq.lang, kind: qq.kind || 'discover', answer: '', sources: [], named: false, mentions: [], error: String(e.message).slice(0, 300) }; }
      await onAnswer(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return on;
}
module.exports = { cost, modelInUse, withModel, PROVIDERS, ask, runAll, isNamed, mentions, defaultQuestions, variants, complete, brandQuestion, knows, UNKNOWN };
