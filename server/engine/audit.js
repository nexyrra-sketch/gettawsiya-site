'use strict';
/* Automatic site audit for the 15 published checks. Each check returns pass / fail / manual with a short note.
   "manual" means we could not decide automatically (for example no Google Places key); it does not count as passed. */
const F = require('./fetchsafe');
const C = require('../config');

const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const LB_TYPES = /LocalBusiness|Restaurant|Cafe|CafeOrCoffeeShop|FoodEstablishment|Bakery|BarOrPub|MedicalClinic|Dentist|Physician|MedicalBusiness|HealthAndBeautyBusiness|BeautySalon|HairSalon|DaySpa|NailSalon|Store|ClothingStore|ProfessionalService|LegalService|AccountingService|RealEstateAgent|Hotel|LodgingBusiness|AutomotiveBusiness|SportsActivityLocation|ExerciseGym|EducationalOrganization|TravelAgency|HomeAndConstructionBusiness/;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ًͯ-ٰٟ]/g, '')
  .replace(/[أإآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));

function parse(html, base) {
  const out = { title: '', ogName: '', desc: '', lang: '', hreflang: [], ld: [], links: [], text: '', viewport: false, noindex: false, h1: '' };
  const m = (re) => { const x = html.match(re); return x ? decode(x[1]).trim() : ''; };
  out.title = m(/<title[^>]*>([\s\S]*?)<\/title>/i).slice(0, 200);
  out.ogName = m(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name/i);
  out.desc = m(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i);
  out.lang = m(/<html[^>]*\blang=["']([^"']+)/i).toLowerCase();
  out.h1 = m(/<h1[^>]*>([\s\S]*?)<\/h1>/i).replace(/<[^>]+>/g, ' ').trim().slice(0, 200);
  out.heads = []; html.replace(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, (_, x) => { const t = decode(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); if (t) out.heads.push(t); return ''; });
  out.viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  out.noindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  html.replace(/<link[^>]+hreflang=["']([^"']+)["']/gi, (_, l) => { out.hreflang.push(l.toLowerCase()); return ''; });
  html.replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, (_, j) => {
    try { const v = JSON.parse(j.trim()); const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { out.ld.push(o); if (o['@graph']) walk(o['@graph']); } }; walk(v); } catch (e) { out.ldErrors = (out.ldErrors || 0) + 1; }
    return '';
  });
  html.replace(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => {
    try { out.links.push({ url: new URL(decode(href), base).toString(), href: decode(href), text: decode(txt.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 80) }); } catch (e) {}
    return '';
  });
  // brand: logo candidates, best first (structured data logo, logo image in the page, touch icon, large icon, og:image)
  const abs = (u) => { try { const x = new URL(decode(String(u || '').trim()), base); return /^https?:$/.test(x.protocol) ? x.toString() : ''; } catch (e) { return ''; } };
  const attr = (tag, a) => { const x = tag.match(new RegExp('\\b' + a + '\\s*=\\s*["\']([^"\']*)["\']', 'i')); return x ? x[1] : ''; };
  const ldLogo = []; out.ld.forEach((o) => { const l = o.logo; [].concat(l || []).forEach((v) => ldLogo.push(typeof v === 'string' ? v : (v && (v.url || v.contentUrl)) || '')); });
  const imgLogo = []; html.replace(/<img\b[^>]*>/gi, (tag) => { if (imgLogo.length < 3 && /logo/i.test(attr(tag, 'class') + ' ' + attr(tag, 'id') + ' ' + attr(tag, 'alt') + ' ' + attr(tag, 'src'))) { const src = attr(tag, 'src') || (attr(tag, 'data-src')) || (attr(tag, 'srcset').split(/\s/)[0]); if (src && !/^data:/i.test(src)) imgLogo.push(src); } return ''; });
  const icons = []; html.replace(/<link\b[^>]*>/gi, (tag) => { const rel = attr(tag, 'rel').toLowerCase(); if (/icon/.test(rel)) { const sz = parseInt((attr(tag, 'sizes').match(/\d+/) || ['0'])[0], 10); icons.push({ u: attr(tag, 'href'), touch: /apple-touch/.test(rel), sz: sz || (/apple-touch/.test(rel) ? 180 : 16) }); } return ''; });
  icons.sort((a, b) => (b.touch - a.touch) || (b.sz - a.sz));
  const ogImg = m(/<meta[^>]+property=["']og:image(?::url)?["'][^>]*content=["']([^"']*)/i) || m(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:image["']/i);
  out.logos = [...new Set(ldLogo.concat(imgLogo, icons.filter((i) => i.sz >= 64).map((i) => i.u)).map(abs).filter(Boolean))].slice(0, 6);
  out.icons = [...new Set(icons.map((i) => abs(i.u)).filter(Boolean))].slice(0, 3);
  out.ogImage = abs(ogImg);
  out.theme = (m(/<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']*)/i).match(/^#[0-9a-f]{3,8}$/i) || [''])[0];
  out.text = decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200000);
  return out;
}
const types = (o) => [].concat(o['@type'] || []).join(' ');

function robotsBlocks(txt) {
  const groups = []; let cur = null, lastWasAgent = false;
  String(txt || '').split(/\r?\n/).forEach((line) => {
    const l = line.replace(/#.*/, '').trim(); const i = l.indexOf(':'); if (i < 0) return;
    const k = l.slice(0, i).trim().toLowerCase(), v = l.slice(i + 1).trim();
    if (k === 'user-agent') { if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (cur && (k === 'disallow' || k === 'allow')) cur.rules.push([k, v]); }
  });
  const blocked = (bot) => {
    const g = groups.find((x) => x.agents.includes(bot.toLowerCase())) || groups.find((x) => x.agents.includes('*'));
    if (!g) return false;
    const dis = g.rules.some(([k, v]) => k === 'disallow' && v === '/'), allowRoot = g.rules.some(([k, v]) => k === 'allow' && (v === '/' || v === '/$'));
    return dis && !allowRoot;
  };
  return AI_BOTS.filter(blocked);
}

async function places(name, city, host) {
  if (!C.places.key() || !name) return null;
  const r = await fetch(C.places.base() + '/v1/places:searchText', {
    method: 'POST', signal: AbortSignal.timeout(12000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': C.places.key(), 'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.formattedAddress,places.googleMapsUri' },
    body: JSON.stringify({ textQuery: `${name} ${city || 'Dubai'}`, regionCode: 'AE', maxResultCount: 5 })
  });
  if (!r.ok) throw new Error('places ' + r.status);
  const j = await r.json();
  const list = j.places || [];
  const nn = norm(name);
  const match = list.find((p) => p.websiteUri && host && p.websiteUri.toLowerCase().includes(host)) || list.find((p) => { const d = norm(p.displayName && p.displayName.text); return d && (d.includes(nn) || nn.includes(d)); });
  return match ? { name: match.displayName && match.displayName.text, rating: match.rating || null, reviews: match.userRatingCount || 0, address: match.formattedAddress, url: match.googleMapsUri } : { none: true };
}

const R = (status, note) => ({ status, pass: status === 'pass', note: note || '' });

async function audit(site, facts = {}, opts = {}) {
  const res = { checks: {}, found: {}, pages: [], error: null, at: new Date().toISOString() };
  const s = String(site || '').trim();
  const checks = res.checks;
  if (/^@|instagram\.com/i.test(s)) {
    ['https', 'name', 'area', 'hours', 'contact', 'services', 'prices', 'languages', 'faq', 'schema', 'about', 'crawl'].forEach((k) => { checks[k] = R('fail', 'No website: only an Instagram account.'); });
  } else {
    const host = s.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    let home; const t0 = Date.now();
    try { home = await F.get('https://' + s.replace(/^https?:\/\//i, '')); }
    catch (e) { try { home = await F.get('http://' + s.replace(/^https?:\/\//i, '')); } catch (e2) { res.error = 'unreachable: ' + e2.message; } }
    if (!home || home.status >= 400) {
      res.error = res.error || 'status ' + (home && home.status);
      ['https', 'name', 'area', 'hours', 'contact', 'services', 'prices', 'languages', 'faq', 'schema', 'about', 'crawl'].forEach((k) => { checks[k] = R('fail', 'The website did not load (' + res.error + ').'); });
    } else {
      const loadMs = Date.now() - t0;
      const P0 = parse(home.body, home.finalUrl); res.pages.push(home.finalUrl);
      if (opts.onStage) await opts.onStage('pages', { pages: 1 });
      const sameHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') === new URL(home.finalUrl).hostname.replace(/^www\./, ''); } catch (e) { return false; } };
      const KEY = /about|contact|faq|menu|price|pricing|services|treatments|our-story|team|doctors|reviews|testimonials|location|من-نحن|تواصل|اتصل|الأسئلة|خدمات|الأسعار|اسعار|القائمة|فريق/i;
      const extra = []; const seen = new Set([home.finalUrl]);
      P0.links.forEach((l) => { if (extra.length < 7 && sameHost(l.url) && !seen.has(l.url) && !/\.(pdf|jpe?g|png|webp|zip|docx?)(\?|$)/i.test(l.url) && (KEY.test(l.href) || KEY.test(l.text))) { seen.add(l.url); extra.push(l.url); } });
      const pages = [P0];
      await Promise.all(extra.map(async (u) => { try { const r = await F.get(u, { timeout: 10000 }); if (r.status < 400) { pages.push(parse(r.body, r.finalUrl)); res.pages.push(r.finalUrl); } } catch (e) {} }));
      if (opts.onStage) await opts.onStage('pages', { pages: pages.length });
      let robots = '';
      try { const r = await F.get(new URL('/robots.txt', home.finalUrl).toString(), { timeout: 8000, maxBytes: 200000 }); if (r.status === 200 && !/<html/i.test(r.body)) robots = r.body; } catch (e) {}
      const smUrl = ((robots.match(/^\s*sitemap:\s*(\S+)/im) || [])[1]) || new URL('/sitemap.xml', home.finalUrl).toString();
      let sitemapN = -1, llms = false;
      try { const r = await F.get(smUrl, { timeout: 8000, maxBytes: 800000 }); if (r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) sitemapN = (r.body.match(/<loc>/gi) || []).length; } catch (e) {}
      try { const r = await F.get(new URL('/llms.txt', home.finalUrl).toString(), { timeout: 6000, maxBytes: 200000 }); llms = r.status === 200 && r.body.trim().length > 20 && !/<html/i.test(r.body); } catch (e) {}

      const all = pages.map((p) => p.text).join(' ');
      const ld = [].concat(...pages.map((p) => p.ld));
      const links = [].concat(...pages.map((p) => p.links));
      const biz = ld.find((o) => LB_TYPES.test(types(o))) || null;
      const org = ld.find((o) => /Organization/.test(types(o)));
      const nameFound = (biz && biz.name) || P0.ogName || (org && org.name) || P0.title.split(/[|\-–—:]/)[0].trim();
      res.found = { title: P0.title, name: nameFound, description: P0.desc, lang: P0.lang, schema_types: [...new Set(ld.map(types).filter(Boolean))].slice(0, 12) };
      const nAll = norm(all + ' ' + P0.title), want = [facts.name, facts.name_ar, facts.name_en].filter(Boolean).map(norm);

      // https + phone
      const https = /^https:/.test(home.finalUrl);
      checks.https = https && P0.viewport ? R('pass', 'Loads over HTTPS and has a mobile viewport.') : R('fail', !https ? 'The site does not load over HTTPS.' : 'No mobile viewport tag: the page may not work well on phones.');
      // name
      const nameHit = want.length ? want.some((w) => w && (norm(P0.title).includes(w) || norm(P0.ogName).includes(w) || norm(P0.h1).includes(w) || (biz && norm(biz.name).includes(w)))) : !!(P0.title && (P0.ogName || (biz && biz.name)));
      checks.name = nameHit ? R('pass', 'Business name found in the page title or structured data: ' + (nameFound || '').slice(0, 60)) : R('fail', 'The exact business name is not clear in the page title, main heading or structured data.');
      // area
      const addr = biz && biz.address ? JSON.stringify(biz.address) : '';
      const places_ = [facts.area, facts.city].filter(Boolean).map(norm);
      const areaHit = places_.length ? places_.some((a) => a && (nAll.includes(a) || norm(addr).includes(a))) : !!addr || /dubai|abu dhabi|sharjah|ajman|دبي|أبوظبي|ابوظبي|الشارقة/i.test(all);
      checks.area = areaHit ? R('pass', 'Area or city is stated on the site.') : R('fail', 'The area and city are not stated clearly on the site.');
      // hours
      const hasHoursLd = ld.some((o) => o.openingHours || o.openingHoursSpecification);
      const hoursText = /(\b\d{1,2}(:\d{2})?\s?(am|pm)\b)|((opening|working|business)\s+hours)|ساعات العمل|أوقات العمل|مفتوح|open daily|24\/7/i.test(all);
      checks.hours = hasHoursLd || hoursText ? R('pass', hasHoursLd ? 'Opening hours are in the structured data.' : 'Opening hours appear in the page text.') : R('fail', 'No opening hours found.');
      // contact
      const tel = links.some((l) => /^tel:|wa\.me|api\.whatsapp|whatsapp\.com\/send|^mailto:/i.test(l.href)) || /(\+971|00971|\b0[2-9])[\d\s-]{7,}/.test(all) || (biz && biz.telephone);
      checks.contact = tel ? R('pass', 'Phone, WhatsApp or email is on the site.') : R('fail', 'No phone, WhatsApp or email found.');
      // services
      const svcLd = ld.some((o) => o.hasOfferCatalog || o.makesOffer || o.hasMenu || /Service|Product|Menu|Offer/.test(types(o)));
      const svcPage = pages.length > 1 && res.pages.some((u) => /services|menu|treatments|خدمات|القائمة/i.test(u));
      checks.services = svcLd || svcPage || /our services|services we offer|what we do|menu|خدماتنا|قائمة الطعام/i.test(all) ? R('pass', 'Services or menu are listed.') : R('fail', 'Services are not listed clearly.');
      // prices
      const priceHit = /(AED|Dhs?\.?|د\.إ|درهم)\s?\d|\d[\d,.]*\s?(AED|Dhs|درهم|د\.إ)/i.test(all) || ld.some((o) => o.priceRange || (o.offers && JSON.stringify(o.offers).includes('price')));
      checks.prices = priceHit ? R('pass', 'Prices or a price range are shown.') : R('fail', 'No prices or price range found.');
      // languages
      const ar = (all.match(/[؀-ۿ]/g) || []).length, en = (all.match(/[A-Za-z]/g) || []).length;
      const hl = pages.some((p) => p.hreflang.some((l) => l.startsWith('ar')) && p.hreflang.some((l) => l.startsWith('en')));
      const arLink = links.some((l) => /\/ar(\/|$)|lang=ar|العربية/i.test(l.href + ' ' + l.text)), enLink = links.some((l) => /\/en(\/|$)|lang=en|english/i.test(l.href + ' ' + l.text));
      checks.languages = hl || (ar > 80 && en > 300) || (ar > 80 && enLink) || (en > 300 && arLink) ? R('pass', 'Arabic and English are both available.') : R('fail', ar > 80 ? 'Only Arabic content found.' : 'Only English content found; no Arabic version.');
      // faq
      const faqLd = ld.some((o) => /FAQPage/.test(types(o)));
      checks.faq = faqLd || /\bFAQs?\b|frequently asked|الأسئلة الشائعة|أسئلة شائعة/i.test(all) || res.pages.some((u) => /faq/i.test(u)) ? R('pass', faqLd ? 'FAQ with structured data.' : 'FAQ section found.') : R('fail', 'No questions-and-answers section found.');
      // schema
      checks.schema = biz ? R('pass', 'Structured data type: ' + types(biz)) : R('fail', org ? 'Has Organization data, but no LocalBusiness-type data with address and hours.' : 'No business structured data (JSON-LD) found.');
      // about
      checks.about = links.some((l) => /about|our-story|من-نحن|من نحن|قصتنا/i.test(l.href + ' ' + l.text)) || /about us|our story|من نحن|قصتنا/i.test(all) ? R('pass', 'About page or story found.') : R('fail', 'No About page explaining who is behind the business.');
      // crawl
      const blocked = robotsBlocks(robots);
      const thin = P0.text.length < 250;
      checks.crawl = !blocked.length && !P0.noindex && !thin ? R('pass', 'AI crawlers are allowed and the page has readable text.')
        : R('fail', [blocked.length ? 'robots.txt blocks: ' + blocked.join(', ') : '', P0.noindex ? 'The home page is set to noindex.' : '', thin ? 'Very little readable text without JavaScript.' : ''].filter(Boolean).join(' '));
      // listings (social / directory profiles linked or in sameAs)
      const same = [].concat(...ld.map((o) => [].concat(o.sameAs || []))).concat(links.map((l) => l.url));
      const profiles = new Set(same.map((u) => (String(u).match(/(instagram|facebook|tiktok|linkedin|tripadvisor|talabat|deliveroo|zomato|bayut|propertyfinder|fresha|booksy|practo|okadoc|yelp|x\.com|twitter)\./i) || [])[1]).filter(Boolean).map((x) => x.toLowerCase()));
      checks.listings = profiles.size >= 2 ? R('pass', 'Linked profiles: ' + [...profiles].join(', ')) : R('fail', profiles.size ? 'Only one other profile is linked: ' + [...profiles][0] : 'No directory or social profiles are linked from the site.');
      // ---- extra signals for the deep report (v7)
      const allHtmlLinks = links.map((l) => l.href);
      const blockedBots = robotsBlocks(robots);
      checks.ai_bots = blockedBots.length ? R('fail', 'robots.txt blocks: ' + blockedBots.join(', ')) : R('pass', robots ? 'robots.txt allows the AI crawlers we test.' : 'No robots.txt rules block AI crawlers.');
      checks.sitemap = sitemapN > 0 ? R('pass', `Sitemap found with ${sitemapN} links.`) : R('fail', 'No sitemap.xml found.');
      checks.llms = llms ? R('pass', 'llms.txt found.') : R('fail', 'No llms.txt file (an optional summary file some AI tools read).');
      checks.speed = loadMs <= 2500 ? R('pass', `Home page loaded in ${(loadMs / 1000).toFixed(1)} s.`) : R('fail', `Home page took ${(loadMs / 1000).toFixed(1)} s to load from our server.`);
      const descOk = P0.desc && P0.desc.length >= 50 && P0.desc.length <= 300, titleOk = P0.title && P0.title.length >= 10 && P0.title.length <= 90;
      checks.meta = titleOk && descOk ? R('pass', 'Page title and description are set.') : R('fail', !P0.title ? 'The home page has no title.' : !P0.desc ? 'The home page has no meta description.' : !titleOk ? 'The page title is too short or too long.' : 'The meta description is too short or too long.');
      const wa = allHtmlLinks.find((x) => /wa\.me|api\.whatsapp|whatsapp\.com\/send/i.test(x));
      checks.whatsapp = wa ? R('pass', 'WhatsApp link found.') : R('fail', 'No WhatsApp link: most UAE customers prefer WhatsApp.');
      const map = allHtmlLinks.find((x) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(x)) || /<iframe[^>]+google\.[a-z.]+\/maps/i.test(home.body);
      checks.map = map || addr ? R('pass', map ? 'Google Maps link or map found.' : 'Address in structured data.') : R('fail', 'No map link or address found.');
      checks.testimonials = /testimonial|what (our )?(clients|customers|patients) say|reviews|آراء العملاء|تقييمات|ماذا يقول/i.test(all) ? R('pass', 'Customer reviews or testimonials on the site.') : R('fail', 'No customer reviews or testimonials on the site.');
      const phones = [...new Set((all.match(/(?:\+971|00971|\b0)(?:[\s-]?\d){8,9}/g) || []).map((x) => x.replace(/[\s-]/g, '')))].slice(0, 3);
      const emails = [...new Set(links.filter((l) => /^mailto:/i.test(l.href)).map((l) => l.href.replace(/^mailto:/i, '').split('?')[0]).concat(all.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) || []))].filter((e) => !/\.(png|jpe?g|webp|svg)$/i.test(e)).slice(0, 3);
      const social = {}; same.forEach((u) => { const m = String(u).match(/(instagram|facebook|tiktok|linkedin|tripadvisor|talabat|deliveroo|zomato|bayut|propertyfinder|fresha|booksy|okadoc|yelp|youtube|x|twitter)\.com\/[^\s"'?#]*/i); if (m && !social[m[1].toLowerCase()]) social[m[1].toLowerCase()] = 'https://' + m[0].replace(/^www\./, ''); });
      const heads = [].concat(...pages.map((p) => p.heads || [])).filter((x) => x.length > 2 && x.length < 60);
      res.signals = { loadMs, bytes: home.body.length, pages: pages.length, sitemapN, llms, robots: !!robots, blockedBots, ldErrors: pages.reduce((a, p) => a + (p.ldErrors || 0), 0),
        phones, emails, whatsapp: wa || null, social, address: addr ? (typeof biz.address === 'string' ? biz.address : [biz.address.streetAddress, biz.address.addressLocality].filter(Boolean).join(', ')) : '', hours: biz && (biz.openingHours || null),
        ar: ar > 80, en: en > 300, logos: P0.logos, icons: P0.icons, ogImage: P0.ogImage, theme: P0.theme, home: home.finalUrl, heads: [...new Set(heads)].slice(0, 40), text: all.slice(0, 7000), h1: P0.h1, desc: P0.desc, title: P0.title, ldTypes: res.found.schema_types, bizType: biz ? types(biz) : '', areaText: addr };
      res.host = host;
    }
  }
  // Google profile + reviews
  try {
    const g = await places(facts.name || res.found.name, facts.city, res.host);
    if (!g) { checks.gbp = R('manual', 'Google profile not checked automatically (no Places key).'); checks.reviews = R('manual', 'Reviews not checked automatically.'); }
    else if (g.none) { checks.gbp = R('fail', 'No matching Google Business Profile found.'); checks.reviews = R('fail', 'No Google reviews found.'); }
    else {
      res.found.google = g;
      checks.gbp = R('pass', 'Google profile: ' + g.name + (g.address ? ', ' + g.address : ''));
      checks.reviews = g.reviews >= 10 && (g.rating || 0) >= 4 ? R('pass', `${g.rating} stars from ${g.reviews} Google reviews.`) : R('fail', `${g.rating || '–'} stars from ${g.reviews} Google reviews (aim for 10+ at 4.0+).`);
    }
  } catch (e) { checks.gbp = R('manual', 'Google check failed: ' + e.message); checks.reviews = R('manual', 'Google check failed.'); }
  if (!checks.listings) checks.listings = R('manual', 'Listings could not be checked.');
  ['ai_bots', 'sitemap', 'llms', 'speed', 'meta', 'whatsapp', 'map', 'testimonials'].forEach((k) => { if (!checks[k]) checks[k] = R('fail', res.error ? 'The website did not load.' : 'No website.'); });
  if (!res.signals) res.signals = { pages: 0, social: {}, phones: [], emails: [], heads: [], text: '', loadMs: null };
  return res;
}
module.exports = { audit, parse, robotsBlocks, norm };
