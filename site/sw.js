/* Tawsiya service worker: makes the site installable and shows a small offline page. Never caches the API or private pages. */
const V = 'tw-v6';
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Tawsiya</h1><p>You are offline. Connect to the internet and try again.</p><p dir="rtl">أنت غير متصل بالإنترنت. اتصل وحاول مرة أخرى.</p></body>';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(V).then((c) => c.addAll(['/assets/css/site.css', '/assets/img/icon-192.png']))); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))); return; }
  if (u.pathname.startsWith('/assets/')) e.respondWith(fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(V).then((ca) => ca.put(r, c)); } return res; }).catch(() => caches.match(r)));
});
