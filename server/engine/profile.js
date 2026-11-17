'use strict';
/* Work out what the business is from its own website: name, category, city, area, services, contacts.
   Heuristics first (always available); if an AI key is connected we ask one model to read the page text and
   return JSON, and use its answer where it is confident. Nothing here is invented: unknown stays empty. */
const AS = require('./assistants');

const CATS = [
  ['dental clinic', 'عيادة أسنان', /dental|dentist|orthodont|teeth|implants?|veneers|أسنان|تقويم/i, /Dentist/],
  ['dermatology and aesthetics clinic', 'عيادة جلدية وتجميل', /dermatolog|aesthetic|botox|filler|laser hair|skin clinic|جلدية|تجميل|بوتوكس|ليزر/i, null],
  ['physiotherapy clinic', 'عيادة علاج طبيعي', /physiotherap|physio\b|chiropract|rehabilitation|علاج طبيعي/i, null],
  ['veterinary clinic', 'عيادة بيطرية', /veterinar|\bvet\b|pet clinic|بيطري/i, /VeterinaryCare/],
  ['medical clinic', 'عيادة طبية', /clinic|medical cent|doctor|physician|polyclinic|عيادة|مركز طبي|طبيب/i, /MedicalClinic|Physician|MedicalBusiness|Hospital/],
  ['pharmacy', 'صيدلية', /pharmacy|صيدلية/i, /Pharmacy/],
  ['optician', 'محل نظارات', /optic|eyewear|glasses|نظارات|بصريات/i, /Optician/],
  ['coffee shop', 'مقهى', /coffee|espresso|roaster|café|cafe\b|قهوة|مقهى|كافيه/i, /CafeOrCoffeeShop|Cafe/],
  ['bakery', 'مخبز', /bakery|patisserie|cakes|مخبز|حلويات|معجنات/i, /Bakery/],
  ['restaurant', 'مطعم', /restaurant|dining|cuisine|menu|brunch|grill|مطعم|مأكولات/i, /Restaurant|FoodEstablishment/],
  ['beauty salon', 'صالون تجميل', /beauty salon|ladies salon|nail|lashes|brows|hair salon|blow ?dry|صالون|أظافر|رموش/i, /BeautySalon|NailSalon|HairSalon/],
  ['barbershop', 'صالون حلاقة رجالي', /barber|gents salon|حلاق/i, null],
  ['spa', 'سبا', /\bspa\b|massage|hammam|wellness cent|مساج|حمام مغربي|سبا/i, /DaySpa/],
  ['gym', 'نادي رياضي', /\bgym\b|fitness|personal train|crossfit|pilates|yoga|نادي رياضي|لياقة/i, /ExerciseGym|SportsActivityLocation/],
  ['real estate agency', 'شركة عقارات', /real estate|property|properties|apartments? for (sale|rent)|villas?|brokerage|عقار|شقق/i, /RealEstateAgent/],
  ['law firm', 'مكتب محاماة', /law firm|lawyer|legal (services|consult)|advocate|محام|قانونية/i, /LegalService|Attorney/],
  ['accounting firm', 'شركة محاسبة', /accounting|bookkeeping|audit firm|\bvat\b|tax consult|محاسبة|تدقيق|ضريبة/i, /AccountingService/],
  ['business setup company', 'شركة تأسيس أعمال', /business setup|company formation|trade licen[cs]e|freezone|تأسيس شركات|رخصة تجارية/i, null],
  ['marketing agency', 'وكالة تسويق', /marketing agency|digital marketing|branding agency|social media agency|seo agency|تسويق رقمي|وكالة تسويق/i, null],
  ['interior design studio', 'استوديو تصميم داخلي', /interior design|fit-?out|تصميم داخلي/i, null],
  ['cleaning company', 'شركة تنظيف', /cleaning (services|company)|maid|deep clean|تنظيف/i, null],
  ['car rental', 'تأجير سيارات', /car rental|rent a car|car hire|تأجير سيارات/i, /AutoRental/],
  ['car repair garage', 'ورشة سيارات', /garage|car repair|auto service|car service|ورشة|صيانة سيارات/i, /AutoRepair|AutomotiveBusiness/],
  ['hotel', 'فندق', /hotel|resort|suites|فندق|منتجع/i, /Hotel|LodgingBusiness|Resort/],
  ['travel agency', 'وكالة سفر', /travel agency|tours|holiday packages|desert safari|سياحة|سفر|رحلات/i, /TravelAgency/],
  ['nursery', 'حضانة', /nursery|kindergarten|early years|حضانة|روضة/i, /ChildCare|Preschool/],
  ['school', 'مدرسة', /\bschool\b|curriculum|مدرسة/i, /School|EducationalOrganization/],
  ['training centre', 'مركز تدريب', /training cent|courses|institute|academy|tutoring|دورات|معهد|أكاديمية/i, null],
  ['florist', 'محل زهور', /florist|flowers|bouquet|زهور|ورد/i, /Florist/],
  ['perfume store', 'متجر عطور', /perfume|fragrance|oud|bakhoor|عطور|عود|بخور/i, null],
  ['jewellery store', 'متجر مجوهرات', /jewel|gold|diamond|مجوهرات|ذهب/i, /JewelryStore/],
  ['fashion boutique', 'بوتيك أزياء', /fashion|boutique|abaya|clothing|dresses|أزياء|عباي|ملابس/i, /ClothingStore/],
  ['furniture store', 'متجر أثاث', /furniture|sofa|أثاث/i, /FurnitureStore/],
  ['laundry', 'مغسلة', /laundry|dry clean|مغسلة/i, /DryCleaningOrLaundry/],
  ['photography studio', 'استوديو تصوير', /photograph|photo studio|تصوير/i, null],
  ['IT company', 'شركة تقنية', /software|it solutions|web development|app development|cloud|برمجيات|تطوير تطبيقات/i, null],
  ['online store', 'متجر إلكتروني', /add to cart|shop now|free delivery|checkout|أضف إلى السلة|تسوق الآن/i, /Store|OnlineStore/]
];

const CITIES = [['Dubai', 'دبي', /dubai|دبي/i], ['Abu Dhabi', 'أبوظبي', /abu ?dhabi|أبو ?ظبي|ابوظبي/i], ['Sharjah', 'الشارقة', /sharjah|الشارقة/i], ['Ajman', 'عجمان', /ajman|عجمان/i],
  ['Ras Al Khaimah', 'رأس الخيمة', /ras al ?khaimah|\brak\b|رأس الخيمة/i], ['Al Ain', 'العين', /al ?ain\b|العين/i], ['Fujairah', 'الفجيرة', /fujairah|الفجيرة/i], ['Umm Al Quwain', 'أم القيوين', /umm al ?quwain|أم القيوين/i]];
const AREAS = [
  ['Dubai Marina', 'دبي مارينا', 'Dubai', /dubai marina|marina walk|دبي مارينا/i], ['JLT', 'أبراج بحيرات جميرا', 'Dubai', /\bjlt\b|jumeirah lake/i], ['JBR', 'جي بي آر', 'Dubai', /\bjbr\b|jumeirah beach residence/i],
  ['Downtown Dubai', 'وسط مدينة دبي', 'Dubai', /downtown dubai|burj khalifa|dubai mall|وسط مدينة دبي/i], ['Business Bay', 'الخليج التجاري', 'Dubai', /business bay|الخليج التجاري/i], ['DIFC', 'مركز دبي المالي العالمي', 'Dubai', /\bdifc\b/i],
  ['Jumeirah', 'جميرا', 'Dubai', /jumeirah(?! lake| beach residence| village)|جميرا/i], ['Al Barsha', 'البرشاء', 'Dubai', /al ?barsha|البرشاء/i], ['Al Quoz', 'القوز', 'Dubai', /al ?quoz|alserkal|القوز/i],
  ['Deira', 'ديرة', 'Dubai', /deira|ديرة/i], ['Bur Dubai', 'بر دبي', 'Dubai', /bur dubai|بر دبي/i], ['Al Karama', 'الكرامة', 'Dubai', /karama|الكرامة/i], ['Mirdif', 'مردف', 'Dubai', /mirdif|مردف/i],
  ['Dubai Hills', 'دبي هيلز', 'Dubai', /dubai hills/i], ['JVC', 'قرية جميرا الدائرية', 'Dubai', /\bjvc\b|jumeirah village/i], ['Palm Jumeirah', 'نخلة جميرا', 'Dubai', /palm jumeirah|نخلة جميرا/i],
  ['Umm Suqeim', 'أم سقيم', 'Dubai', /umm suqeim|أم سقيم/i], ['Al Wasl', 'الوصل', 'Dubai', /al ?wasl|الوصل/i], ['City Walk', 'سيتي ووك', 'Dubai', /city ?walk/i], ['Dubai Silicon Oasis', 'واحة دبي للسيليكون', 'Dubai', /silicon oasis/i],
  ['Motor City', 'موتور سيتي', 'Dubai', /motor city/i], ['Arabian Ranches', 'المرابع العربية', 'Dubai', /arabian ranches/i], ['Dubai Healthcare City', 'مدينة دبي الطبية', 'Dubai', /healthcare city|\bdhcc\b/i],
  ['Al Satwa', 'السطوة', 'Dubai', /satwa|السطوة/i], ['Oud Metha', 'عود ميثاء', 'Dubai', /oud metha/i], ['Dubai Creek Harbour', 'خور دبي', 'Dubai', /creek harbour/i], ['Al Nahda', 'النهدة', null, /al ?nahda|النهدة/i],
  ['Al Reem Island', 'جزيرة الريم', 'Abu Dhabi', /reem island|جزيرة الريم/i], ['Yas Island', 'جزيرة ياس', 'Abu Dhabi', /yas island|جزيرة ياس/i], ['Saadiyat', 'السعديات', 'Abu Dhabi', /saadiyat|السعديات/i],
  ['Khalifa City', 'مدينة خليفة', 'Abu Dhabi', /khalifa city|مدينة خليفة/i], ['Al Khalidiyah', 'الخالدية', 'Abu Dhabi', /khalidiy|الخالدية/i], ['Mussafah', 'مصفح', 'Abu Dhabi', /mussafah|مصفح/i],
  ['Al Majaz', 'المجاز', 'Sharjah', /al ?majaz|المجاز/i], ['Al Khan', 'الخان', 'Sharjah', /al ?khan\b|الخان/i], ['Muwaileh', 'مويلح', 'Sharjah', /muwaileh|مويلح/i]];

function count(re, text) { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); return (String(text).match(g) || []).length; }
const GENERIC = /^(home|homepage|home page|welcome|index|untitled|main|default|الرئيسية|الصفحة الرئيسية|مرحبا|أهلا)$/i;
const cleanName = (s) => { const n = String(s || '').split(/\s[|\-–—:•]\s|[|•]/)[0].replace(/\s+/g, ' ').trim().slice(0, 80); return GENERIC.test(n) ? '' : n; };
const fromHost = (h) => String(h || '').replace(/^www\./, '').split('.')[0].split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function heuristic(au, hint = {}) {
  const sg = au.signals || {}, f = au.found || {};
  const head = [sg.title, sg.h1, sg.desc, (f.schema_types || []).join(' ')].join(' ');
  const text = head + ' ' + (sg.heads || []).join(' ') + ' ' + (sg.text || '');
  // category: structured data type first, then keyword weight (title/h1/description count 5x)
  let best = null, bestScore = 0;
  CATS.forEach((c) => {
    let sc = 0;
    if (c[3] && c[3].test(sg.bizType || '')) sc += 20;
    sc += count(c[2], head) * 5 + Math.min(count(c[2], text), 15);
    if (sc > bestScore) { best = c; bestScore = sc; }
  });
  const cat = bestScore >= 3 ? best : null;
  const where = [sg.areaText, sg.address, text].join(' ');
  const area = AREAS.find((a) => a[3].test(sg.areaText || sg.address || '')) || AREAS.map((a) => [a, count(a[3], where)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null;
  const cityHit = CITIES.map((c) => [c, count(c[2], where)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1])[0];
  const city = (area && area[2] && CITIES.find((c) => c[0] === area[2])) || (cityHit && cityHit[0]) || null;
  const name = hint.name || cleanName(f.name) || cleanName(sg.title) || cleanName(sg.h1) || fromHost(au.host) || '';
  const svc = (sg.heads || []).filter((x) => !/about|contact|faq|testimonial|review|blog|news|follow|subscribe|copyright|menu|home|why|our team|location|من نحن|تواصل|الأسئلة/i.test(x) && x.split(' ').length <= 6).slice(0, 8);
  return {
    name, name_ar: /[؀-ۿ]/.test(name) ? name : '',
    category: cat ? cat[0] : '', category_ar: cat ? cat[1] : '',
    city: city ? city[0] : '', city_ar: city ? city[1] : '', area: area ? area[0] : '', area_ar: area ? area[1] : '',
    services: svc, phone: (sg.phones || [])[0] || '', email: (sg.emails || [])[0] || '', whatsapp: sg.whatsapp || '', social: sg.social || {},
    languages: [sg.ar ? 'Arabic' : null, sg.en ? 'English' : null].filter(Boolean), source: 'site'
  };
}

/* optional: one short model call without web search to read the page text; returns null on any problem */
async function aiRead(au, base) {
  const sg = au.signals || {};
  if (!sg.text || sg.text.length < 120) return null;
  const prompt = `Read this business website text and return ONLY a JSON object with these keys:
{"name": business name as written, "name_ar": Arabic name if shown else "", "category_en": short plain category like "dental clinic" or "coffee shop", "category_ar": the same in Arabic,
"city": UAE city or "", "area": neighbourhood or "", "services": up to 6 main services or products (short), "confident": true or false}
Use only what the text says. If unsure, use "".
Title: ${sg.title || ''}
Heading: ${sg.h1 || ''}
Description: ${sg.desc || ''}
Text: ${sg.text.slice(0, 5000)}`;
  try {
    const out = await AS.complete(prompt, { maxTokens: 400 });
    if (!out) return null;
    const m = out.match(/\{[\s\S]*\}/); if (!m) return null;
    const j = JSON.parse(m[0]);
    const s = (x, n = 80) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
    const r = { name: s(j.name), name_ar: s(j.name_ar), category: s(j.category_en, 60).toLowerCase(), category_ar: s(j.category_ar, 60), city: s(j.city, 40), area: s(j.area, 60),
      services: Array.isArray(j.services) ? j.services.map((x) => s(x, 50)).filter(Boolean).slice(0, 6) : [] };
    const cityRow = CITIES.find((c) => c[2].test(r.city)); if (cityRow) { r.city = cityRow[0]; r.city_ar = cityRow[1]; }
    const areaRow = AREAS.find((a) => a[3].test(r.area)); if (areaRow) { r.area = areaRow[0]; r.area_ar = areaRow[1]; }
    return r;
  } catch (e) { return null; }
}

async function detect(au, hint = {}) {
  const base = heuristic(au, hint);
  const ai = await aiRead(au, base);
  const p = Object.assign({}, base);
  if (ai) {
    ['name', 'name_ar', 'category', 'category_ar', 'city', 'city_ar', 'area', 'area_ar'].forEach((k) => { if (ai[k] && !hint[k] && !(k === 'name' && GENERIC.test(ai[k]))) p[k] = ai[k]; });
    if (ai.services.length) p.services = ai.services;
    p.source = 'site+ai';
  }
  // what the visitor or admin typed always wins
  ['name', 'category', 'area', 'city'].forEach((k) => { if (hint[k]) p[k] = hint[k]; });
  if (hint.category && /[؀-ۿ]/.test(hint.category)) { p.category_ar = hint.category; const c = CATS.find((x) => x[1] === hint.category); p.category = c ? c[0] : ''; }
  else if (hint.category) { const c = CATS.find((x) => x[0] === hint.category.toLowerCase() || x[2].test(hint.category)); if (c && !p.category_ar) p.category_ar = c[1]; }
  if (p.category && !p.category_ar) { const c = CATS.find((x) => x[2].test(p.category)); if (c) p.category_ar = c[1]; }
  if (p.city && !p.city_ar) { const c = CITIES.find((x) => x[2].test(p.city)); if (c) { p.city = c[0]; p.city_ar = c[1]; } }
  if (!p.city) { p.city = 'Dubai'; p.city_ar = 'دبي'; p.city_guess = true; }
  return p;
}

module.exports = { detect, heuristic, CATS, CITIES, AREAS };
