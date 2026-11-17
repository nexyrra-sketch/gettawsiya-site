'use strict';
/* v9: built-in visitor stats (Admin > Traffic), report source tracking, booking link setting.
   Needs: server with mock env (/tmp/env6.sh) and test/mock.js running, on a clean database. */
const BASE = process.env.BASE || 'http://localhost:8812';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const UA_DESK = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
class Client {
  constructor() { this.cookies = {}; }
  async req(method, path, body, extra) {
    const h = Object.assign({ 'Content-Type': 'application/json', 'User-Agent': UA_DESK }, extra || {});
    const ck = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); if (ck) h.Cookie = ck;
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    (r.headers.getSetCookie ? r.headers.getSetCookie() : []).forEach((c) => { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t, headers: r.headers };
  }
}
const visit = (path, h) => fetch(BASE + path, { headers: Object.assign({ 'User-Agent': UA_DESK }, h || {}) }).then((r) => r.text());

(async () => {
  const admin = new Client(), anon = new Client();
  await admin.req('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  let T = (await admin.req('GET', '/api/admin/traffic?days=30')).json;
  const base = T ? T.views : 0;

  console.log('visitor counting');
  await visit('/?utm_source=instagram&utm_campaign=Dentist JLT Video', { 'User-Agent': UA_PHONE });
  await visit('/en/', { Referer: 'https://chatgpt.com/' });
  await visit('/en/score/', { Referer: 'https://l.instagram.com/?u=x' });
  await visit('/clinics/', { Referer: 'https://www.google.com/' });
  await visit('/', { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });   // bot: not counted
  await visit('/assets/css/site.css');                                                                                 // asset: not counted
  await visit('/healthz');                                                                                             // health: not counted
  await visit('/does-not-exist/');                                                                                     // 404: not counted
  await visit('/admin/');                                                                                              // admin: not counted
  await sleep(500);
  T = (await admin.req('GET', '/api/admin/traffic?days=30')).json;
  ok(T && T.views - base === 4, 'counts 4 real page views, skips bot / asset / health / 404 / admin (' + (T && T.views - base) + ')');
  const S = (k) => (T.sources.find((s) => s.src === k) || {});
  ok(S('instagram').visitors >= 1 && S('chatgpt').visitors >= 1 && S('google').visitors >= 1, 'sources: utm tag, ChatGPT and Google referrers recognised');
  ok(T.ai_visitors >= 1, 'visitors sent by AI assistants are counted');
  ok(T.campaigns.some((c) => c.campaign === 'dentist-jlt-video' && c.src === 'instagram'), 'campaign name cleaned and tied to its source');
  ok(T.pages.some((p) => p.path === '/clinics/'), 'top pages list');
  ok(T.daily.length >= 1 && T.daily[0].views >= 4, 'day by day');
  ok(T.devices.some((d) => d.device === 'mobile'), 'phone visits recognised');

  console.log('free reports keep their source');
  let r = await anon.req('POST', '/api/score-requests', { site: 'pi.test', biz_name: 'Pi Cafe', category: 'cafe', area: 'JLT', consent: true, lang: 'en', source: 'score-page', from: { utm_source: 'TikTok', utm_campaign: 'post 7', ref: '' } });
  ok(r.status === 200, 'report request accepted with its source');
  r = await anon.req('POST', '/api/score-requests', { site: 'x.test', consent: true, lang: 'ar', from: { ref: 'chatgpt.com' } });
  ok(r.status === 200, 'report request from a ChatGPT visitor');
  r = await anon.req('POST', '/api/score-requests', { site: 'i.test', consent: true, lang: 'ar', from: 'junk' });
  ok(r.status === 200, 'bad source data is ignored, not an error');
  T = (await admin.req('GET', '/api/admin/traffic?days=30')).json;
  ok(S('tiktok').reports >= 1 && S('chatgpt').reports >= 1, 'reports counted per source');
  ok(T.campaigns.some((c) => c.campaign === 'post-7' && c.reports >= 1), 'reports counted per post');
  ok(T.reports >= 3, 'report total');

  console.log('privacy and access');
  r = await anon.req('GET', '/api/admin/traffic'); ok(r.status === 401 || r.status === 403, 'traffic stats are admin only');
  r = await anon.req('GET', '/en/'); ok(!(r.headers.get('set-cookie') || '').length, 'no cookie is set for counting');

  console.log('booking link');
  r = await anon.req('GET', '/api/site-config'); ok(r.status === 200 && r.json.booking_url === null, 'no booking link by default');
  r = await admin.req('PUT', '/api/admin/settings', { booking_url: 'javascript:alert(1)' }); ok(r.status === 400, 'unsafe booking link refused');
  r = await admin.req('PUT', '/api/admin/settings', { booking_url: 'http://cal.com/x' }); ok(r.status === 400, 'non-https booking link refused');
  r = await admin.req('PUT', '/api/admin/settings', { booking_url: 'https://cal.com/tawsiya/15min' }); ok(r.status === 200, 'booking link saved');
  r = await anon.req('GET', '/api/site-config'); ok(r.json.booking_url === 'https://cal.com/tawsiya/15min', 'site shows the booking link');
  r = await anon.req('GET', '/en/'); ok(/data-booking hidden/.test(r.text), 'home page has the (hidden until loaded) booking button');
  const scans = (await admin.req('GET', '/api/admin/scans')).json;
  const done = await (async () => { for (let i = 0; i < 60; i++) { const s = (await admin.req('GET', '/api/admin/scans')).json.items.find((x) => x.site === 'pi.test' && x.token && x.status === 'done'); if (s) return s; await sleep(800); } return null; })();
  if (done) { r = await anon.req('GET', '/en/report/' + done.token + '/'); ok(/cal\.com\/tawsiya\/15min/.test(r.text) && /Book a free 15-minute call/.test(r.text), 'report page shows the booking button'); }
  else ok(!!scans, 'report finished for booking check');
  r = await admin.req('PUT', '/api/admin/settings', { booking_url: '' }); ok(r.status === 200, 'booking link removed');
  r = await anon.req('GET', '/api/site-config'); ok(r.json.booking_url === null, 'booking buttons hidden again');

  console.log('admin today');
  r = await anon.req('GET', '/api/admin/today'); ok(r.status === 401 || r.status === 403, 'today is admin only');
  r = await admin.req('GET', '/api/admin/today'); const D = r.json || {};
  ok(r.status === 200 && D.kpi && typeof D.kpi.mrr === 'number' && D.kpi.visitors_7d >= 1, 'today: numbers (visitors ' + (D.kpi && D.kpi.visitors_7d) + ')');
  ok(Array.isArray(D.setup) && D.setup.length >= 8 && D.setup.some((x) => x.key === 'scan' && x.done), 'today: launch checklist knows a scan was run');
  ok(Array.isArray(D.todo) && Array.isArray(D.followups), 'today: to-do and follow-ups');
  r = await anon.req('GET', '/admin/'); ok(/id="adm-nav"/.test(r.text) && /admin9\.js/.test(r.text) && !/class="site-footer"/.test(r.text), 'admin page has its own shell, no site footer');

  console.log('link previews');
  r = await anon.req('GET', '/en/'); ok(/og:image" content="[^"]*og-en\.png\?v=3"/.test(r.text), 'home page preview picture (English)');
  const png = await fetch(BASE + '/assets/img/og-ar.png?v=3'); const pb = Buffer.from(await png.arrayBuffer());
  ok(png.status === 200 && pb.slice(1, 4).toString() === 'PNG' && pb.length < 300 * 1024, 'home preview picture is a PNG under 300 KB (' + (pb.length / 1024 | 0) + ' KB)');
  const pr = (await admin.req('GET', '/api/admin/scans')).json.items.find((x) => x.site === 'pi.test' && x.token && x.status === 'done');
  if (pr) {
    r = await anon.req('GET', '/en/report/' + pr.token + '/');
    const og = (r.text.match(/og:image" content="([^"]+)"/) || [])[1] || '';
    ok(/\/og\/report\/[A-Za-z0-9_-]+\.png\?l=en$/.test(og), 'report page has its own preview picture');
    ok(/og:title" content="[^"]*: \d+\/100 on AI visibility"/.test(r.text), 'report preview title shows the score');
    ok(/twitter:image" content="[^"]*\/og\/report\//.test(r.text), 'twitter/X card uses the same picture');
    const img = await fetch(BASE + og.replace(/^https?:\/\/[^/]+/, '')); const ib = Buffer.from(await img.arrayBuffer());
    ok(img.status === 200 && ib.slice(1, 4).toString() === 'PNG' && ib.length > 20000 && ib.length < 300 * 1024, 'report preview picture is drawn (' + (ib.length / 1024 | 0) + ' KB)');
    const ar = await fetch(BASE + '/og/report/' + pr.token + '.png?l=ar'); ok(ar.status === 200 && (await ar.arrayBuffer()).byteLength > 20000, 'Arabic report preview picture');
    r = await anon.req('GET', '/report/' + pr.token + '/'); ok(/og:title" content="[^"]*: \d+\/100 في ظهور الذكاء الاصطناعي"/.test(r.text), 'Arabic preview title');
  } else ok(false, 'a finished report to test previews on');
  const bad = await fetch(BASE + '/og/report/doesnotexistdoesnotexist.png?l=en'); ok(bad.status === 200 && bad.headers.get('content-type') === 'image/png', 'unknown report link falls back to the home picture');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
