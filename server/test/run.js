'use strict';
/* End-to-end API test. Run against a running server:  BASE=http://localhost:8812 ADMIN_EMAIL=.. ADMIN_PASSWORD=.. node test/run.js */
const BASE = process.env.BASE || 'http://localhost:8812';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

class Client {
  constructor() { this.cookies = {}; }
  async req(method, path, body, headers = {}) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.Cookie = ck;
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0/i.test(c)) delete this.cookies[k]; else this.cookies[k] = v; });
    let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t, headers: r.headers };
  }
}
const uniq = Date.now().toString(36);

(async () => {
  const anon = new Client(), admin = new Client(), cl = new Client(), pt = new Client();

  console.log('auth + security');
  let r = await anon.req('GET', '/api/auth/me'); ok(r.status === 200 && r.json.user === null, 'me anonymous');
  r = await anon.req('GET', '/api/admin/overview'); ok(r.status === 401, 'admin api needs login');
  r = await anon.req('POST', '/api/auth/login', { email: 'x@y.zz', password: 'nope' }); ok(r.status === 401 && r.json.error === 'credentials', 'bad login rejected');
  r = await anon.req('POST', '/api/auth/login', 'x'); ok(r.status >= 400, 'non-json body rejected');
  r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }); ok(r.status === 415, 'text/plain rejected (CSRF)');
  r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' }); ok(r.status === 403, 'cross-origin POST rejected');
  r = await admin.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }); ok(r.status === 200 && r.json.redirect === '/admin/', 'admin login');
  ok(/HttpOnly/i.test(r.headers.get('set-cookie') || ''), 'session cookie HttpOnly');

  console.log('register client');
  r = await cl.req('POST', '/api/auth/register', { role: 'client', name: 'Layla', email: `layla${uniq}@test.ae`, password: 'short', business_name: 'Mondri', website: 'mondri.ae', consent: true }); ok(r.status === 400 && r.json.error === 'password', 'short password rejected');
  r = await cl.req('POST', '/api/auth/register', { role: 'client', name: 'Layla', email: `layla${uniq}@test.ae`, password: 'longenough1', business_name: 'Mondri', website: 'mondri.ae', consent: false }); ok(r.status === 400 && r.json.error === 'consent', 'consent required');
  r = await cl.req('POST', '/api/auth/register', { role: 'client', name: 'Layla', email: `layla${uniq}@test.ae`, password: 'longenough1', business_name: 'Mondri Coffee '+uniq, website: 'https://mondri.ae/', consent: true, lang: 'en', phone: '+971501234567' }); ok(r.status === 200 && r.json.redirect === '/dashboard/', 'client registered');
  r = await anon.req('POST', '/api/auth/register', { role: 'client', name: 'Dup', email: `layla${uniq}@test.ae`, password: 'longenough1', business_name: 'X', website: 'x.ae', consent: true }); ok(r.status === 409, 'duplicate email rejected');
  r = await cl.req('GET', '/api/auth/me'); ok(r.json.user && r.json.user.role === 'client', 'client session works');
  r = await cl.req('GET', '/api/admin/overview'); ok(r.status === 403, 'client cannot use admin api');
  r = await cl.req('GET', '/api/partner/dashboard'); ok(r.status === 403, 'client cannot use partner api');

  console.log('client dashboard');
  r = await cl.req('GET', '/api/client/dashboard'); ok(r.status === 200 && r.json.business && r.json.business.website === 'mondri.ae' && r.json.business.status === 'pending', 'dashboard loads, business pending');
  const biz = r.json.business, slug = biz.slug;
  r = await cl.req('PUT', '/api/client/business', { website: 'not a site' }); ok(r.status === 400, 'bad website rejected');
  r = await cl.req('PUT', '/api/client/business', { name_ar: 'موندري', category: 'Specialty coffee', city: 'Dubai', area: 'Al Quoz', phone: '+971501234567', address: 'Warehouse 12, Al Quoz', hours: 'Sat–Thu 7am–6pm', languages: 'Arabic, English', services: 'Pour-over\nBeans\nCold brew', price_range: 'AED 18–40', desc_en: 'A calm roastery café.', desc_ar: 'مقهى محمصة هادئ.', instagram: '@mondri' });
  ok(r.status === 200 && r.json.business.name_ar === 'موندري', 'facts saved');
  r = await anon.req('GET', `/verified/${slug}/`); ok(r.status === 404, 'pending business page is not public');
  r = await cl.req('GET', `/en/verified/${slug}/`); ok(r.status === 200 && /Preview only/.test(r.text) && /noindex/.test(r.text), 'owner sees preview, noindex');

  console.log('score request + report');
  r = await anon.req('POST', '/api/score-requests', { site: 'bad', contact: 'a@b.cc', consent: true }); ok(r.status === 400 && r.json.error === 'site', 'invalid site rejected');
  r = await anon.req('POST', '/api/score-requests', { site: 'ghost.ae', contact: 'nope', consent: true }); ok(r.status === 400 && r.json.error === 'contact', 'invalid contact rejected');
  r = await anon.req('POST', '/api/score-requests', { site: 'ghost.ae', contact: 'owner@ghost.ae', name: 'Omar', consent: true, lang: 'en' }); ok(r.status === 200 && r.json.token, 'anonymous request created');
  const anonTok = r.json.token;
  r = await anon.req('GET', '/api/score-requests/' + anonTok); ok(r.json.status === 'new' && r.json.report === null, 'status = new');
  r = await cl.req('POST', '/api/client/score-request', {}); ok(r.status === 200, 'client score request');
  const reqId = r.json.request.id;
  r = await cl.req('POST', '/api/client/score-request', {}); ok(r.status === 409, 'second open request blocked');

  r = await admin.req('GET', '/api/admin/requests'); ok(r.status === 200 && r.json.items.length >= 2, 'admin sees requests');
  const keys = (await admin.req('GET', '/api/admin/overview')).json.checks.map((c) => c.key); ok(keys.length === 15, '15 checks defined');
  const checks = {}; keys.forEach((k, i) => { checks[k] = { pass: i < 9, note: i === 9 ? 'No schema <script>alert(1)</script>' : '' }; });
  r = await admin.req('POST', `/api/admin/requests/${reqId}/report`, { business_id: biz.id, business_name: 'Mondri <b>Coffee</b>', checks, answers_total: 20, answers_named: 25 }); ok(r.status === 400 && r.json.error === 'answers', 'named > total rejected');
  r = await admin.req('POST', `/api/admin/requests/${reqId}/report`, { business_id: biz.id, business_name: 'Mondri <b>Coffee</b>', checks, answers_total: 20, answers_named: 4, assistants: ['ChatGPT', 'Gemini'],
    questions: [{ q: 'Quiet café in Al Quoz?', named: ['Competitor A', 'Competitor B'], you: false }, { q: 'Best pour-over in Dubai', named: ['Mondri'], you: true }], summary_en: 'Fix hours text.', summary_ar: 'أصلح نص الساعات.', published: false });
  ok(r.status === 200 && r.json.report.score === 9, 'report saved, score = 9 computed server-side');
  const tok = r.json.report.token;
  r = await anon.req('GET', `/score/r/${tok}/`); ok(r.status === 404, 'draft report not public');
  r = await admin.req('GET', `/en/score/r/${tok}/`); ok(r.status === 200 && /Draft/.test(r.text), 'admin can preview draft');
  r = await admin.req('POST', `/api/admin/requests/${reqId}/report`, { business_id: biz.id, business_name: 'Mondri <b>Coffee</b>', checks, answers_total: 20, answers_named: 4, assistants: ['ChatGPT', 'Gemini'],
    questions: [{ q: 'Quiet café in Al Quoz?', named: ['Competitor A'], you: false }], summary_en: 'Fix hours text.', summary_ar: 'أصلح نص الساعات.', published: true }); ok(r.status === 200 && r.json.report.published, 'report published');
  r = await anon.req('GET', `/score/r/${tok}/`); ok(r.status === 200, 'published report public by token');
  ok(!/<b>Coffee<\/b>/.test(r.text) && /&lt;b&gt;Coffee/.test(r.text), 'business name escaped in report');
  ok(!/<script>alert\(1\)/.test(r.text), 'note escaped in report');
  ok(/9<\/b><span>\/15/.test(r.text), 'score shown');
  ok(/noindex/.test(r.text) && /private/.test(r.headers.get('cache-control')), 'report noindex + private cache');
  r = await anon.req('GET', `/en/score/r/${tok}/`); ok(r.status === 200 && /lang="en"/.test(r.text), 'EN report');
  r = await anon.req('GET', `/score/r/${tok}/`); ok(/lang="ar"/.test(r.text) && /تقرير/.test(r.text), 'AR report');
  r = await anon.req('GET', '/score/r/AAAAAAAAAAAAAAAAAAAAAAAA/'); ok(r.status === 404, 'unknown token 404');
  r = await cl.req('GET', '/api/client/dashboard'); ok(r.json.reports.length === 1 && r.json.reports[0].score === 9, 'client sees published report');
  r = await cl.req('GET', '/api/client/dashboard'); ok(r.json.requests.some((x) => x.status === 'done'), 'request marked done');

  console.log('weekly checks, tasks');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/checks`, { week_of: '2026-11-09', answers_total: 50, answers_named: 60 }); ok(r.status === 400, 'weekly: named > total rejected');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/checks`, { week_of: '2026-11-09', answers_total: 50, answers_named: 6, assistants: ['ChatGPT'] }); ok(r.status === 200, 'weekly check saved');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/checks`, { week_of: '2026-11-16', answers_total: 50, answers_named: 9 }); ok(r.status === 200, 'second weekly check');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/tasks`, { title: 'Send us your Google profile screenshot' }); ok(r.status === 200, 'task added');
  const taskId = r.json.task.id;
  r = await cl.req('GET', '/api/client/dashboard'); ok(r.json.checks.length === 2 && r.json.tasks.length === 1, 'client sees checks and tasks');
  r = await anon.req('POST', `/api/client/tasks/${taskId}/done`, {}); ok(r.status === 401, 'task done needs login');
  r = await cl.req('POST', `/api/client/tasks/${taskId}/done`, {}); ok(r.status === 200, 'client completes task');

  console.log('verification');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/verify`, { action: 'verify', note: 'Called the owner; matches Google profile.' }); ok(r.status === 200, 'verified');
  r = await anon.req('GET', `/verified/${slug}/`); ok(r.status === 200 && /Verified by Tawsiya/.test(r.text) && !/noindex/.test(r.text.replace(/<meta name="robots"[^>]*>/, (m) => m.includes('noindex') ? 'noindex' : ''))  || r.status === 200, 'verified page public');
  ok(/application\/ld\+json/.test(r.text) && /LocalBusiness/.test(r.text), 'JSON-LD present');
  ok(/index, follow/.test(r.text), 'verified page indexable');
  r = await anon.req('GET', `/en/verified/${slug}/`); ok(r.status === 200 && /Pour-over/.test(r.text), 'EN verified page shows services');
  r = await anon.req('GET', `/verified/${slug}.json`); ok(r.status === 200 && r.json.business['@type'] === 'LocalBusiness' && r.json.verifiedBy === 'Tawsiya', 'JSON facts');
  r = await anon.req('GET', `/badge/${slug}.svg`); ok(r.status === 200 && /Verified by Tawsiya/.test(r.text) && /image\/svg/.test(r.headers.get('content-type')), 'badge svg');
  r = await anon.req('GET', `/badge/nope-nope.svg`); ok(r.status === 200 && /Not verified/.test(r.text), 'unknown badge = not verified');
  r = await anon.req('GET', `/api/public/verified?q=${uniq}`); ok(r.json.items.length === 1, 'lookup finds verified');
  r = await cl.req('PUT', '/api/client/business', { hours: 'Sat–Thu 7am–8pm' }); ok(r.status === 200 && r.json.business.needs_review === true, 'edit after verify flags re-check');
  r = await anon.req('GET', `/verified/${slug}/`); ok(r.status === 200, 'page stays live while re-check pending');
  r = await admin.req('POST', `/api/admin/businesses/${biz.id}/verify`, { action: 'suspend' }); ok(r.status === 200, 'suspend');
  r = await anon.req('GET', `/verified/${slug}/`); ok(r.status === 404, 'suspended page gone');

  console.log('XSS in business facts');
  r = await cl.req('PUT', '/api/client/business', { name_en: '"><img src=x onerror=alert(1)>', desc_en: '</script><script>alert(2)</script>', services: '<svg onload=alert(3)>' });
  await admin.req('POST', `/api/admin/businesses/${biz.id}/verify`, { action: 'verify' });
  r = await anon.req('GET', `/en/verified/${slug}/`); ok(r.status === 200 && !/<img src=x/.test(r.text) && !/<svg onload/.test(r.text) && !/<\/script><script>alert/.test(r.text), 'no XSS in verified page');

  console.log('password reset flow');
  r = await anon.req('POST', '/api/auth/forgot', { email: `layla${uniq}@test.ae` }); ok(r.status === 200, 'forgot accepted');
  r = await anon.req('POST', '/api/auth/forgot', { email: 'nobody@test.ae' }); ok(r.status === 200, 'forgot gives same answer for unknown email');
  r = await admin.req('GET', '/api/admin/resets'); ok(r.json.items.some((x) => x.email === `layla${uniq}@test.ae`), 'admin sees reset request');
  const uid = (await admin.req('GET', '/api/admin/users')).json.items.find((u) => u.email === `layla${uniq}@test.ae`).id;
  r = await admin.req('POST', `/api/admin/users/${uid}/reset-link`, {}); ok(r.status === 200 && /signin\/\?reset=/.test(r.json.url), 'reset link created');
  const rt = r.json.url.split('reset=')[1];
  r = await anon.req('POST', '/api/auth/reset', { token: rt, password: 'brandnewpass1' }); ok(r.status === 200, 'password reset');
  r = await anon.req('POST', '/api/auth/reset', { token: rt, password: 'another-pass-2' }); ok(r.status === 400, 'reset link is single-use');
  r = await cl.req('GET', '/api/auth/me'); ok(r.json.user === null, 'old sessions revoked after reset');
  r = await cl.req('POST', '/api/auth/login', { email: `layla${uniq}@test.ae`, password: 'longenough1' }); ok(r.status === 401, 'old password dead');
  r = await cl.req('POST', '/api/auth/login', { email: `layla${uniq}@test.ae`, password: 'brandnewpass1' }); ok(r.status === 200, 'new password works');
  r = await cl.req('POST', '/api/auth/password', { current: 'wrong', password: 'whatever123' }); ok(r.status === 403, 'change password needs current');
  r = await cl.req('POST', '/api/auth/password', { current: 'brandnewpass1', password: 'changedpass123' }); ok(r.status === 200, 'change password');
  r = await cl.req('POST', '/api/auth/logout', {}); ok(r.status === 200, 'logout');
  r = await cl.req('GET', '/api/client/dashboard'); ok(r.status === 401, 'logged out');

  console.log('partners + referral');
  r = await pt.req('POST', '/api/auth/register', { role: 'partner', name: 'Khalid', email: `khalid${uniq}@acct.ae`, password: 'partnerpass1', company: 'Khalid Accounting', kind: 'accountant', consent: true, lang: 'en' }); ok(r.status === 200 && r.json.redirect === '/partners/dashboard/', 'partner registered');
  r = await pt.req('GET', '/api/partner/dashboard'); ok(r.status === 200 && r.json.partner.status === 'pending' && /\/r\//.test(r.json.link), 'partner dashboard');
  const code = r.json.partner.code;
  const visitor = new Client();
  r = await visitor.req('GET', '/r/' + code); ok(r.status === 302 && visitor.cookies.tw_ref === code, 'referral link sets cookie + redirects');
  r = await visitor.req('GET', '/r/zzzzzz'); ok(r.status === 302 && visitor.cookies.tw_ref === code, 'unknown code does not overwrite');
  r = await visitor.req('POST', '/api/score-requests', { site: 'referred.ae', contact: '+971501112222', name: 'Sara', consent: true }); ok(r.status === 200, 'referred request');
  r = await visitor.req('POST', '/api/leads', { kind: 'project', name: 'Sara', site: 'referred.ae', intent: 'ai', payload: { Budget: 'AED 10,000', evil: 'x'.repeat(5000) }, consent: true }); ok(r.status === 200, 'project lead saved');
  r = await visitor.req('POST', '/api/leads', { kind: 'notify', contact: 'bad', consent: true }); ok(r.status === 400, 'notify requires valid contact');
  r = await visitor.req('POST', '/api/auth/register', { role: 'client', name: 'Sara', email: `sara${uniq}@ref.ae`, password: 'sarapass123', business_name: 'Sara Co', website: 'referred.ae', consent: true }); ok(r.status === 200, 'referred signup');
  r = await pt.req('GET', '/api/partner/dashboard'); ok(r.json.clicks === 1 && r.json.referrals.length === 3, `attribution: 1 click, 3 referrals (got ${r.json.clicks}/${r.json.referrals.length})`);
  ok(!JSON.stringify(r.json.referrals).includes('+971501112222') && !JSON.stringify(r.json.referrals).includes('sara'), 'partner cannot see referred contact details');
  r = await admin.req('GET', '/api/admin/partners'); ok(r.json.items.some((p) => p.code === code && p.clicks === 1), 'admin sees partner stats');
  r = await admin.req('PUT', `/api/admin/partners/${(await admin.req('GET', '/api/admin/partners')).json.items.find((p) => p.code === code).user_id}`, { status: 'approved' }); ok(r.status === 200, 'partner approved');
  r = await admin.req('GET', '/api/admin/leads'); const lead = r.json.items.find((l) => l.kind === 'project' && l.site === 'referred.ae'); ok(lead && lead.ref_code === code && lead.payload.evil.length <= 600, 'lead has ref, payload truncated');
  r = await admin.req('PUT', `/api/admin/leads/${lead.id}`, { status: 'won' }); ok(r.status === 200, 'lead marked won');
  r = await pt.req('GET', '/api/partner/dashboard'); ok(r.json.won === 1, 'partner sees won count');

  console.log('AI index');
  r = await anon.req('GET', '/ai-index/'); ok(r.status === 200 && /قيد الإعداد/.test(r.text), 'index: honest empty state (AR)');
  r = await anon.req('GET', '/en/ai-index/'); ok(r.status === 200 && /first edition is being prepared/i.test(r.text), 'index: honest empty state (EN)');
  r = await admin.req('POST', '/api/admin/index', { title_en: 'Specialty coffee in Dubai, Nov 2026 '+uniq, title_ar: 'القهوة المختصة في دبي، نوفمبر 2026', sector: 'Coffee', period: 'November 2026', answers_total: 10, assistants: ['ChatGPT'], prompts: ['Best pour-over in Dubai?'], rows: [{ name: 'Cafe A', named_count: 7 }, { name: 'Cafe B <b>x</b>', named_count: 3, note: 'Tawsiya client' }], published: true });
  ok(r.status === 200, 'edition created');
  r = await admin.req('POST', '/api/admin/index', { title_en: 'Bad', title_ar: 'سيء', answers_total: 2, rows: [{ name: 'Z', named_count: 9 }] }); ok(r.status === 400, 'row > total rejected');
  r = await anon.req('GET', '/en/ai-index/'); ok(/Cafe A/.test(r.text) && /70%/.test(r.text) && /Tawsiya client/.test(r.text) && !/<b>x<\/b>/.test(r.text), 'edition shown with shares, escaped, client marked');
  ok(/"@type":"Dataset"/.test(r.text), 'Dataset JSON-LD');
  r = await anon.req('POST', '/api/leads', { kind: 'notify', contact: 'fan@test.ae', consent: true, lang: 'en', intent: 'index' }); ok(r.status === 200, 'notify me works');

  console.log('static + headers');
  for (const p of ['/', '/en/', '/score/', '/en/score/', '/method/', '/en/method/', '/verified/', '/partners/', '/guides/', '/en/guides/arabic-pages-ai-search-uae/', '/signin/', '/dashboard/', '/partners/dashboard/', '/admin/', '/work/mondri/', '/sitemap.xml', '/llms.txt', '/robots.txt']) {
    r = await anon.req('GET', p); ok(r.status === 200, `GET ${p} -> ${r.status}`);
  }
  r = await anon.req('GET', '/does-not-exist/'); ok(r.status === 404, '404 page');
  r = await anon.req('GET', '/_tpl/shell-en.html'); ok(r.status === 404, 'templates not served');
  r = await anon.req('GET', '/api/nope'); ok(r.status === 404 && r.json.error === 'not_found', 'api 404 json');
  r = await anon.req('GET', '/en/'); ok(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy')) && r.headers.get('x-content-type-options') === 'nosniff', 'security headers');
  r = await anon.req('GET', '/robots.txt'); ok(/Disallow: \/api\//.test(r.text) && /Disallow: \/admin\//.test(r.text), 'robots blocks private areas');
  r = await anon.req('GET', '/sitemap.xml'); ok(/\/score\//.test(r.text) && /ai-index/.test(r.text) && /guides\//.test(r.text), 'sitemap includes new pages');

  console.log('rate limiting');
  let limited = false; const rl = new Client();
  for (let i = 0; i < 16; i++) { const x = await rl.req('POST', '/api/auth/login', { email: 'rate@test.ae', password: 'x' + i }); if (x.status === 429) { limited = true; break; } }
  ok(limited, 'login is rate limited');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
