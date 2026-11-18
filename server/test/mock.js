'use strict';
/* Test doubles: Stripe, OpenAI, Gemini, Anthropic, Perplexity, Resend, Google Places (port 9900) and fake business websites (port 80). */
const http = require('http');
const log = { emails: [], stripe: [], ai: [] };
let seq = 0, FIXED = false, NOSEARCH = false; const id = (p) => `${p}_${++seq}`;
const subs = {}, intents = {};
const read = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const parseForm = (s) => { const o = {}; new URLSearchParams(s).forEach((v, k) => { o[k] = v; }); return o; };

function answer(q, who) {
  q = String(q || '');
  if (/^Read this business website text/.test(q)) {
    if (/mondri/i.test(q)) return '```json\n{"name":"Mondri Coffee","name_ar":"موندري","category_en":"coffee shop","category_ar":"مقهى","city":"Dubai","area":"Al Quoz","services":["Specialty coffee","Brunch","Beans to take home"],"confident":true}\n```';
    return '{"name":"","category_en":"","category_ar":"","city":"","area":"","services":[],"confident":false}';
  }
  if (/^What do you know about|^ماذا تعرف عن/.test(q) && !/glow/i.test(q)) {
    if ((who === 'openai' || who === 'perplexity') && /mondri|موندري/i.test(q)) return 'Mondri Coffee is a specialty roastery and café in Al Quoz, Dubai, known for calm interiors and single-origin beans. Reviews mention friendly staff.';
    return "I couldn't find specific information about this business. You may want to check Google Maps or their Instagram.";
  }
  if (/glow/i.test(q) && /^What do you know|^ماذا تعرف/.test(q)) return FIXED && who !== 'gemini' ? 'Glow Dental Clinic is a dental clinic in JLT, Dubai offering implants and whitening, with strong Google reviews.' : "I couldn't find specific information about Glow Dental.";
  if (/dental|dentist|أسنان/i.test(q)) return `Top picks:\n1. **Smile Studio JLT** – cosmetic dentistry\n2. **Bright Teeth Clinic** – family dentist\n${FIXED && who !== 'gemini' ? '3. **Glow Dental Clinic** – implants and whitening\n' : ''}- **Dr. Sara Dental** - orthodontics`;
  const en = /[a-z]/i.test(q) && !/[؀-ۿ]/.test(q);
  if (who === 'anthropic' && /reviews/.test(q)) return { error: true };
  const named = (who === 'openai' || who === 'perplexity') && en;
  return `Here are some options:\n1. **Raw Coffee Company** – roastery in Al Quoz\n2. **Nightjar Coffee**: Alserkal Avenue\n${named ? '3. **Mondri Coffee** – calm roastery café\n' : ''}- Tom & Serg - brunch`;
}

const api = http.createServer(async (req, res) => {
  const body = await read(req); const u = new URL(req.url, 'http://x');
  const J = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  // ---- Ziina
  if (u.pathname.startsWith('/ziina/')) {
    if (req.headers.authorization !== 'Bearer ziina_mock') return J({ message: 'Unauthorized' }, 401);
    let jb = {}; try { jb = JSON.parse(body || '{}'); } catch (e) {}
    log.ziina = log.ziina || []; log.ziina.push({ m: req.method, p: u.pathname, b: jb });
    if (u.pathname === '/ziina/payment_intent' && req.method === 'POST') {
      if (!Number.isInteger(jb.amount) || jb.amount < 200) return J({ message: 'amount' }, 400);
      const pid = 'pi' + (++seq) + 'x' + Date.now().toString(36);
      intents[pid] = { id: pid, account_id: 'acc', amount: jb.amount, currency_code: jb.currency_code, status: 'requires_payment_instrument', message: jb.message, test: jb.test,
        success_url: String(jb.success_url || '').replace('{PAYMENT_INTENT_ID}', pid), redirect_url: 'https://pay.ziina.test/' + pid, created_at: String(Date.now()) };
      log.lastIntent = intents[pid]; return J(intents[pid]);
    }
    const m2 = u.pathname.match(/^\/ziina\/payment_intent\/(.+)$/);
    if (m2) return intents[m2[1]] ? J(intents[m2[1]]) : J({ message: 'not found' }, 404);
    if (u.pathname === '/ziina/webhook') { log.webhook = jb; return J({ success: true }); }
    return J({ message: 'not mocked' }, 404);
  }
  if (u.pathname.startsWith('/_pay/')) { const pid = u.pathname.slice(6); if (intents[pid]) intents[pid].status = u.searchParams.get('status') || 'completed'; return J(intents[pid] || {}); }
  // ---- Stripe
  if (u.pathname.startsWith('/v1/') && req.headers.authorization === 'Bearer sk_test_mock') {
    const f = parseForm(body); log.stripe.push({ m: req.method, p: u.pathname, f });
    if (u.pathname === '/v1/customers') return J({ id: id('cus') });
    if (u.pathname === '/v1/products') return J({ id: id('prod') });
    if (u.pathname === '/v1/balance') return J({ livemode: false });
    if (u.pathname === '/v1/billing_portal/sessions') return J({ url: 'https://billing.stripe.test/p/' + id('bps') });
    if (u.pathname === '/v1/checkout/sessions') {
      const sid = id('cs');
      if (f.mode === 'subscription') {
        const sub = id('sub');
        subs[sub] = { id: sub, object: 'subscription', status: 'active', customer: f.customer, cancel_at_period_end: false,
          metadata: { user_id: f['subscription_data[metadata][user_id]'], plan_key: f['subscription_data[metadata][plan_key]'], business_id: f['subscription_data[metadata][business_id]'] },
          items: { data: [{ id: id('si'), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { unit_amount: Number(f['line_items[0][price_data][unit_amount]']) } }] } };
        log.lastCheckout = { sid, sub, f };
      } else log.lastCheckout = { sid, f };
      return J({ id: sid, url: 'https://checkout.stripe.test/c/' + sid });
    }
    const m = u.pathname.match(/^\/v1\/subscriptions\/(.+)$/);
    if (m && subs[m[1]]) {
      if (req.method === 'POST') { subs[m[1]].metadata = Object.assign({}, subs[m[1]].metadata, { plan_key: f['metadata[plan_key]'] }); subs[m[1]].items.data[0].price.unit_amount = Number(f['items[0][price_data][unit_amount]']); }
      return J(subs[m[1]]);
    }
    return J({ error: { message: 'not mocked ' + u.pathname } }, 404);
  }
  if (u.pathname.startsWith('/v1/') && /^Bearer sk_/.test(req.headers.authorization || '')) return J({ error: { message: 'bad key' } }, 401);
  let j = {}; try { j = JSON.parse(body || '{}'); } catch (e) {}
  if (process.env.MOCK_DELAY && /responses|generateContent|messages|chat\/completions|agent/.test(u.pathname)) await new Promise((r) => setTimeout(r, Math.random() * +process.env.MOCK_DELAY));
  // ---- OpenAI Responses
  if (u.pathname === '/v1/responses' && /^retired/.test(j.model || '')) { log.retired = (log.retired || 0) + 1; return J({ error: { message: 'The model `' + j.model + '` does not exist or you do not have access to it.', type: 'invalid_request_error' } }, 404); }
  if (u.pathname === '/v1/responses') { log.ai.push('openai'); log.models = log.models || {}; log.models.openai = j.model; return J({ usage: { input_tokens: 8000, output_tokens: 400 }, output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: answer(j.input, 'openai'), annotations: [{ type: 'url_citation', url: 'https://www.timeout.com/dubai/coffee' }] }] }] }); }
  // ---- Gemini
  if (/generateContent$/.test(u.pathname) && NOSEARCH && j.tools) return J({ error: { message: 'Grounding with Google Search is not available on the free tier for this model.', status: 'RESOURCE_EXHAUSTED' } }, 429);
  if (/generateContent$/.test(u.pathname)) { log.ai.push('gemini'); return J({ candidates: [{ content: { parts: [{ text: answer(j.contents[0].parts[0].text, 'gemini') }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/x', title: 'whatson.ae' } }] } }] }); }
  // ---- Anthropic
  if (u.pathname === '/v1/messages') { log.ai.push('anthropic'); const a = answer(j.messages[0].content, 'anthropic'); if (a.error) return J({ error: { type: 'overloaded_error', message: 'Overloaded' } }, 529); return J({ content: [{ type: 'web_search_tool_result', content: [{ url: 'https://mondri.test/' }] }, { type: 'text', text: a, citations: [{ url: 'https://www.tripadvisor.com/x' }] }] }); }
  // ---- Perplexity
  if (u.pathname === '/v1/agent') { log.ai.push('perplexity'); log.agent = (log.agent || 0) + 1; const tx = answer(j.input, 'perplexity'); return J({ object: 'response', status: 'completed', usage: { input_tokens: 900, output_tokens: 300, cost: { currency: 'USD', total_cost: 0.0041 } },
    output: j.tools ? [{ type: 'search_results', results: [{ id: 1, url: 'https://mondri.test/menu', title: 'Menu' }] }, { type: 'message', content: [{ type: 'output_text', text: tx + ' [1]', annotations: [] }] }] : [{ type: 'message', content: [{ type: 'output_text', text: tx, annotations: [] }] }] }); }
  if (u.pathname === '/chat/completions') { log.ai.push('perplexity'); return J({ choices: [{ message: { content: answer(j.messages[1].content, 'perplexity') } }], search_results: [{ url: 'https://mondri.test/menu' }] }); }
  // ---- Resend
  if (u.pathname === '/emails') { log.emails.push(j); return J({ id: id('em') }); }
  // ---- Places
  if (u.pathname === '/v1/places:searchText' && /glow/i.test(j.textQuery || '')) return J(FIXED ? { places: [{ displayName: { text: 'Glow Dental Clinic' }, rating: 4.8, userRatingCount: 64, websiteUri: 'http://glow.test/', formattedAddress: 'JLT, Dubai' }] } : { places: [] });
  if (u.pathname === '/v1/places:searchText') { const t = j.textQuery || ''; return J(/mondri/i.test(t) ? { places: [{ displayName: { text: 'Mondri Coffee' }, rating: 4.7, userRatingCount: 132, websiteUri: 'http://mondri.test/', formattedAddress: 'Al Quoz, Dubai' }] } : { places: [] }); }
  // ---- test hooks
  if (u.pathname === '/_log') return J(log);
  if (u.pathname === '/_nosearch') { NOSEARCH = u.searchParams.get('v') !== '0'; return J({ nosearch: NOSEARCH }); }
  if (u.pathname === '/_fix') { FIXED = u.searchParams.get('v') !== '0'; return J({ fixed: FIXED }); }
  J({ error: 'unknown ' + u.pathname }, 404);
});

const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mondri Coffee | Specialty coffee in Al Quoz</title>
<meta property="og:site_name" content="Mondri Coffee"><link rel="icon" href="/favicon.ico"><link rel="apple-touch-icon" href="/logo.png"><meta name="theme-color" content="#2B5B4A"><link rel="alternate" hreflang="ar" href="/ar/"><link rel="alternate" hreflang="en" href="/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"CafeOrCoffeeShop","name":"Mondri Coffee","address":{"@type":"PostalAddress","addressLocality":"Al Quoz, Dubai"},"openingHours":"Mo-Sa 07:00-18:00","priceRange":"AED 18-40","sameAs":["https://instagram.com/mondri","https://www.tripadvisor.com/mondri"]}</script></head>
<body><h1>Mondri Coffee</h1><p>A calm roastery café in Al Quoz, Dubai. Pour-over from AED 22. Call +971 50 123 4567 or <a href="https://wa.me/971501234567">WhatsApp</a>.</p>
<a href="/about/">About us</a> <a href="/menu/">Menu</a> <a href="/faq/">FAQ</a> <a href="/ar/">العربية</a>
<p>${'We roast single-origin beans every week and brew them slowly. '.repeat(12)}</p><p>مقهى هادئ في القوز يقدم قهوة مختصة محمصة أسبوعياً لعشاق القهوة في دبي.</p></body></html>`;
const BAD = `<html><head><title>Welcome</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const site = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host === 'glow.test') {
    if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(FIXED ? 'User-agent: *\nAllow: /\nSitemap: http://glow.test/sitemap.xml' : 'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /'); }
    if (req.url === '/sitemap.xml') { if (!FIXED) { res.writeHead(404); return res.end(''); } res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end('<urlset><url><loc>http://glow.test/</loc></url><url><loc>http://glow.test/services/</loc></url></urlset>'); }
    if (req.url === '/llms.txt') { res.writeHead(FIXED ? 200 : 404, { 'Content-Type': 'text/plain' }); return res.end(FIXED ? '# Glow Dental Clinic\nDental clinic in JLT, Dubai. Implants, whitening, Invisalign.' : ''); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (!FIXED) return res.end(`<!doctype html><html><head><title>Home</title></head><body><h1>Welcome</h1><p>${'We care about your smile. Our dentists provide gentle dental care for the whole family. '.repeat(6)}</p><a href="/services/">Services</a></body></html>`);
    return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Glow Dental Clinic | Dentist in JLT, Dubai</title>
<meta name="description" content="Glow Dental Clinic in JLT, Dubai: implants, whitening and Invisalign. Open daily 9am to 9pm. Book on WhatsApp.">
<link rel="alternate" hreflang="ar" href="/ar/"><link rel="alternate" hreflang="en" href="/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Glow Dental Clinic","telephone":"+97145550000","address":{"@type":"PostalAddress","streetAddress":"Cluster D, JLT","addressLocality":"Dubai"},"openingHours":"Mo-Su 09:00-21:00","priceRange":"AED 250-6000","sameAs":["https://instagram.com/glowdental","https://www.okadoc.com/glow","https://facebook.com/glowdental"]}</script></head>
<body><h1>Glow Dental Clinic, JLT Dubai</h1><p>Dentist in Jumeirah Lake Towers, Dubai. Call +971 4 555 0000 or <a href="https://wa.me/97145550000">WhatsApp</a>. <a href="https://maps.app.goo.gl/glow">Map</a></p>
<a href="/about/">About us</a> <a href="/services/">Our services</a> <a href="/faq/">FAQ</a> <a href="/ar/">العربية</a>
<h2>Teeth whitening</h2><h2>Dental implants</h2><h2>Invisalign</h2><p>Whitening from AED 900. Opening hours 9am to 9pm daily.</p><h2>What our patients say</h2><p>Testimonials: "Best dentist in JLT" – Sara.</p>
<p>${'Our team of licensed dentists offers implants, whitening and Invisalign in JLT. '.repeat(8)}</p><p>عيادة أسنان في أبراج بحيرات جميرا في دبي تقدم زراعة الأسنان والتبييض والتقويم الشفاف لجميع أفراد العائلة.</p></body></html>`);
  }
  if (host === 'mondri.test' && req.url === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'static', 'assets', 'img', 'icon-192.png'))); }
  if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(host === 'ghost.test' ? 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow:' : 'User-agent: *\nAllow: /'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (host === 'mondri.test') return res.end(req.url === '/' ? GOOD : `<html><head><title>Mondri Coffee</title></head><body><h1>Page ${req.url}</h1><p>Frequently asked questions and our story. Menu: flat white AED 22.</p></body></html>`);
  res.end(BAD);
});
api.listen(9900, () => site.listen(80, () => console.log('mocks up')));
