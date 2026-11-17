'use strict';
/* Turns one run (website audit + AI answers) into the report numbers: 4 pillar scores, an overall 0-100 score,
   prioritised findings with plain-language fixes (Arabic + English), share of voice, sources AI used, brand knowledge.
   Pure functions: same input, same output, so before/after comparisons are fair. */

const PILLARS = {
  visibility: { w: 40, en: 'AI visibility', ar: 'الظهور في الذكاء الاصطناعي', den: 'Do AI assistants name you when customers ask?', dar: 'هل تذكرك مساعدات الذكاء الاصطناعي عندما يسأل العملاء؟' },
  access: { w: 20, en: 'AI can read your site', ar: 'قابلية قراءة موقعك', den: 'Can AI crawlers reach and understand your website?', dar: 'هل تستطيع برامج الذكاء الاصطناعي الوصول إلى موقعك وفهمه؟' },
  clarity: { w: 20, en: 'Clear business facts', ar: 'وضوح معلومات النشاط', den: 'Are the facts AI needs stated clearly?', dar: 'هل المعلومات التي يحتاجها الذكاء الاصطناعي واضحة؟' },
  trust: { w: 20, en: 'Trust and reputation', ar: 'الثقة والسمعة', den: 'Do other sites confirm you are real and good?', dar: 'هل تؤكد مواقع أخرى أنك نشاط حقيقي وجيد؟' }
};

/* key: [pillar, weight 1-3, effort, en {t, why, fix}, ar {t, why, fix}] */
const F = {
  ai_named: ['visibility', 3, 'ongoing',
    { t: 'AI does not recommend you yet', why: 'When customers ask AI for a business like yours, other names come up. Every one of those answers is a customer sent somewhere else.', fix: 'We make your facts consistent across your site, Google and the directories AI reads, then track the same questions every week until you appear.' },
    { t: 'الذكاء الاصطناعي لا يرشحك بعد', why: 'عندما يسأل العملاء الذكاء الاصطناعي عن نشاط مثل نشاطك تظهر أسماء أخرى، وكل إجابة منها عميل يذهب إلى غيرك.', fix: 'نوحّد معلوماتك في موقعك وفي Google والأدلة التي يقرأها الذكاء الاصطناعي، ثم نتابع الأسئلة نفسها أسبوعياً حتى تظهر.' }],
  brand_known: ['visibility', 2, 'month',
    { t: 'AI does not know your business well', why: 'When someone asks about you by name, the assistants have little or nothing to say, or they get facts wrong.', fix: 'Publish clear facts about who you are (About page, structured data, Google profile, a Tawsiya Verified page) so assistants can describe you correctly.' },
    { t: 'الذكاء الاصطناعي لا يعرف نشاطك جيداً', why: 'عندما يسأل أحد عنك بالاسم لا تجد المساعدات ما تقوله، أو تذكر معلومات خاطئة.', fix: 'انشر معلومات واضحة عنك (صفحة من نحن، بيانات منظمة، ملف Google، صفحة موثّقة من توصية) حتى تصفك المساعدات بشكل صحيح.' }],
  crawl: ['access', 3, 'quick',
    { t: 'AI cannot read your pages properly', why: 'If crawlers are blocked, the page is set to noindex, or the text only appears with JavaScript, AI sees an empty page.', fix: 'Allow crawlers, remove noindex, and make sure the main text is in the HTML.' },
    { t: 'الذكاء الاصطناعي لا يستطيع قراءة صفحاتك', why: 'إذا كانت برامج الزحف محجوبة أو الصفحة مضبوطة على عدم الفهرسة أو النص لا يظهر إلا بجافاسكربت، يرى الذكاء الاصطناعي صفحة فارغة.', fix: 'اسمح لبرامج الزحف، وأزل noindex، وتأكد أن النص الأساسي موجود في HTML.' }],
  ai_bots: ['access', 3, 'quick',
    { t: 'Your robots.txt blocks AI assistants', why: 'You are telling ChatGPT, Claude, Perplexity or Google AI not to read your site, so they cannot quote it.', fix: 'Edit robots.txt to allow GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Google-Extended.' },
    { t: 'ملف robots.txt يحجب مساعدات الذكاء الاصطناعي', why: 'أنت تطلب من ChatGPT وClaude وPerplexity وGoogle AI عدم قراءة موقعك، فلا يستطيعون الاستشهاد به.', fix: 'عدّل robots.txt للسماح لـ GPTBot وOAI-SearchBot وClaudeBot وPerplexityBot وGoogle-Extended.' }],
  schema: ['access', 3, 'quick',
    { t: 'No business structured data', why: 'Structured data (JSON-LD) is the machine-readable card that tells AI your name, address, hours and services without guessing.', fix: 'Add LocalBusiness JSON-LD with name, address, phone, hours, services and links to your profiles.' },
    { t: 'لا توجد بيانات منظمة للنشاط', why: 'البيانات المنظمة (JSON-LD) هي البطاقة التي تخبر الذكاء الاصطناعي باسمك وعنوانك وساعاتك وخدماتك دون تخمين.', fix: 'أضف بيانات LocalBusiness تتضمن الاسم والعنوان والهاتف والساعات والخدمات وروابط حساباتك.' }],
  https: ['access', 2, 'quick',
    { t: 'Site is not secure or not mobile-ready', why: 'Assistants and Google prefer secure, phone-friendly pages, and customers leave pages that look broken on a phone.', fix: 'Serve the site over HTTPS and add a mobile viewport.' },
    { t: 'الموقع غير آمن أو غير مهيأ للجوال', why: 'تفضّل المساعدات وGoogle الصفحات الآمنة المناسبة للجوال، والعملاء يغادرون الصفحات التي تظهر معطلة على الهاتف.', fix: 'شغّل الموقع عبر HTTPS وأضف إعداد العرض للجوال.' }],
  sitemap: ['access', 1, 'quick',
    { t: 'No sitemap', why: 'A sitemap lists your pages so search engines and AI crawlers find all of them.', fix: 'Publish sitemap.xml and point to it from robots.txt.' },
    { t: 'لا توجد خريطة موقع', why: 'خريطة الموقع تسرد صفحاتك حتى تجدها محركات البحث وبرامج الذكاء الاصطناعي.', fix: 'انشر ملف sitemap.xml وأشر إليه من robots.txt.' }],
  speed: ['access', 1, 'month',
    { t: 'Your site is slow to load', why: 'Slow pages are fetched less often and lose visitors.', fix: 'Compress images, use caching and a faster host.' },
    { t: 'موقعك بطيء في التحميل', why: 'الصفحات البطيئة تُقرأ أقل ويغادرها الزوار.', fix: 'اضغط الصور واستخدم التخزين المؤقت واستضافة أسرع.' }],
  meta: ['access', 1, 'quick',
    { t: 'Page title or description missing', why: 'The title and description are often the first summary of you that AI and Google read.', fix: 'Write a title with your name, category and area, and a one-line description.' },
    { t: 'عنوان الصفحة أو وصفها مفقود', why: 'العنوان والوصف غالباً أول ملخص عنك يقرأه الذكاء الاصطناعي وGoogle.', fix: 'اكتب عنواناً يضم اسمك ونوع نشاطك ومنطقتك، ووصفاً من سطر واحد.' }],
  llms: ['access', 1, 'quick',
    { t: 'No llms.txt summary file', why: 'An optional plain-text summary some AI tools read. Small effort, possible upside.', fix: 'Publish /llms.txt with who you are, what you offer, where, and links to key pages.' },
    { t: 'لا يوجد ملف llms.txt', why: 'ملف نصي اختياري تقرؤه بعض أدوات الذكاء الاصطناعي. جهد بسيط وفائدة محتملة.', fix: 'انشر ملف ‎/llms.txt يوضح من أنت وماذا تقدم وأين، مع روابط أهم الصفحات.' }],
  name: ['clarity', 2, 'quick',
    { t: 'Your business name is not clear', why: 'If the exact name is not in the title, main heading and structured data, AI may not connect your site to your brand.', fix: 'Use the exact same name everywhere: title, main heading, footer, Google profile.' },
    { t: 'اسم نشاطك غير واضح', why: 'إذا لم يظهر الاسم نفسه في العنوان والعنوان الرئيسي والبيانات المنظمة قد لا يربط الذكاء الاصطناعي موقعك بعلامتك.', fix: 'استخدم الاسم نفسه في كل مكان: العنوان والعنوان الرئيسي وأسفل الصفحة وملف Google.' }],
  area: ['clarity', 3, 'quick',
    { t: 'Your area and city are not stated', why: 'Most questions are local ("best dentist in JLT"). If AI cannot tell where you are, it cannot recommend you there.', fix: 'State your area, city and full address on the home and contact pages.' },
    { t: 'منطقتك ومدينتك غير مذكورة', why: 'معظم الأسئلة محلية ("أفضل طبيب أسنان في JLT"). إذا لم يعرف الذكاء الاصطناعي مكانك فلن يرشحك هناك.', fix: 'اذكر منطقتك ومدينتك وعنوانك الكامل في الصفحة الرئيسية وصفحة التواصل.' }],
  services: ['clarity', 3, 'month',
    { t: 'Your services are not listed clearly', why: 'AI matches questions to services. If "teeth whitening" is not written on your site, you will not be suggested for it.', fix: 'Create a services page with one short section per service, in Arabic and English.' },
    { t: 'خدماتك غير مذكورة بوضوح', why: 'يطابق الذكاء الاصطناعي الأسئلة مع الخدمات. إذا لم تُكتب "تبييض الأسنان" في موقعك فلن تُرشَّح لها.', fix: 'أنشئ صفحة خدمات بقسم قصير لكل خدمة، بالعربية والإنجليزية.' }],
  contact: ['clarity', 2, 'quick',
    { t: 'No phone, WhatsApp or email found', why: 'AI shares ways to reach you; customers will not search twice.', fix: 'Show phone and WhatsApp on every page and in structured data.' },
    { t: 'لا يوجد هاتف أو واتساب أو بريد', why: 'يشارك الذكاء الاصطناعي طرق التواصل معك، والعميل لن يبحث مرتين.', fix: 'أظهر الهاتف والواتساب في كل صفحة وفي البيانات المنظمة.' }],
  hours: ['clarity', 1, 'quick',
    { t: 'Opening hours are missing', why: '"Open now" questions are common; without hours you are skipped.', fix: 'Add opening hours to the site, structured data and Google profile.' },
    { t: 'ساعات العمل غير موجودة', why: 'أسئلة "مفتوح الآن" شائعة، وبدون ساعات العمل يتم تجاهلك.', fix: 'أضف ساعات العمل إلى الموقع والبيانات المنظمة وملف Google.' }],
  prices: ['clarity', 1, 'month',
    { t: 'No prices or price range', why: 'Questions like "affordable" or "under 200 AED" need a price signal.', fix: 'Show starting prices or a price range.' },
    { t: 'لا توجد أسعار أو نطاق أسعار', why: 'أسئلة مثل "بسعر مناسب" أو "أقل من 200 درهم" تحتاج إلى مؤشر سعر.', fix: 'اعرض أسعار البداية أو نطاق الأسعار.' }],
  languages: ['clarity', 2, 'month',
    { t: 'Only one language', why: 'In the UAE customers ask in Arabic and English. A one-language site misses half the questions.', fix: 'Publish your key pages in both Arabic and English.' },
    { t: 'لغة واحدة فقط', why: 'في الإمارات يسأل العملاء بالعربية والإنجليزية، والموقع بلغة واحدة يفوّت نصف الأسئلة.', fix: 'انشر صفحاتك الأساسية بالعربية والإنجليزية.' }],
  faq: ['clarity', 1, 'month',
    { t: 'No questions-and-answers section', why: 'AI likes direct answers to real questions; an FAQ gives it quotable text.', fix: 'Add 8 to 12 real customer questions with short answers.' },
    { t: 'لا يوجد قسم أسئلة وأجوبة', why: 'يفضّل الذكاء الاصطناعي الإجابات المباشرة، وقسم الأسئلة يعطيه نصاً قابلاً للاقتباس.', fix: 'أضف من 8 إلى 12 سؤالاً حقيقياً من العملاء مع إجابات قصيرة.' }],
  about: ['clarity', 1, 'quick',
    { t: 'No About page', why: 'Who is behind the business (doctor, chef, founder) builds trust and gives AI facts to describe you.', fix: 'Write an About page with your story, team, credentials and year founded.' },
    { t: 'لا توجد صفحة من نحن', why: 'معرفة من يقف خلف النشاط تبني الثقة وتعطي الذكاء الاصطناعي معلومات يصفك بها.', fix: 'اكتب صفحة من نحن تضم قصتك وفريقك ومؤهلاتك وسنة التأسيس.' }],
  gbp: ['trust', 3, 'quick',
    { t: 'No Google Business Profile found', why: 'Google Maps data feeds Gemini and many other answers. Without a profile you barely exist locally.', fix: 'Create or claim your Google Business Profile and complete every field.' },
    { t: 'لم يتم العثور على ملف Google التجاري', why: 'بيانات خرائط Google تغذي Gemini وإجابات كثيرة أخرى، وبدون ملف تكاد لا تظهر محلياً.', fix: 'أنشئ ملفك التجاري في Google أو استلمه، وأكمل جميع الحقول.' }],
  reviews: ['trust', 3, 'ongoing',
    { t: 'Not enough Google reviews', why: 'Assistants lean on ratings when choosing whom to recommend.', fix: 'Ask every happy customer for a review (a WhatsApp link after each visit works well). Aim for 10+ at 4.0+.' },
    { t: 'عدد تقييمات Google غير كافٍ', why: 'تعتمد المساعدات على التقييمات عند اختيار من ترشحه.', fix: 'اطلب تقييماً من كل عميل راضٍ (رابط عبر واتساب بعد كل زيارة يعمل جيداً). استهدف أكثر من 10 تقييمات بمعدل 4 أو أعلى.' }],
  listings: ['trust', 2, 'month',
    { t: 'Few profiles link to you', why: 'AI cross-checks you on Instagram, directories and booking sites. More consistent profiles, more confidence.', fix: 'Link your Instagram, TikTok and the directories of your sector from your site, with the same name and phone.' },
    { t: 'عدد قليل من الحسابات مرتبط بك', why: 'يتحقق الذكاء الاصطناعي منك عبر إنستغرام والأدلة ومواقع الحجز، وكلما زادت الحسابات المتسقة زادت الثقة.', fix: 'اربط حسابات إنستغرام وتيك توك وأدلة قطاعك من موقعك، بالاسم والهاتف نفسيهما.' }],
  whatsapp: ['trust', 1, 'quick',
    { t: 'No WhatsApp button', why: 'Most UAE customers prefer WhatsApp; it also shows you are reachable.', fix: 'Add a WhatsApp link on every page.' },
    { t: 'لا يوجد زر واتساب', why: 'يفضّل معظم العملاء في الإمارات واتساب، كما أنه يُظهر أنك متاح.', fix: 'أضف رابط واتساب في كل صفحة.' }],
  map: ['trust', 1, 'quick',
    { t: 'No map or address', why: 'A Google Maps link ties your site to your real location.', fix: 'Add your Google Maps link and full address.' },
    { t: 'لا توجد خريطة أو عنوان', why: 'رابط خرائط Google يربط موقعك بمكانك الحقيقي.', fix: 'أضف رابط خرائط Google وعنوانك الكامل.' }],
  testimonials: ['trust', 1, 'month',
    { t: 'No customer reviews on your site', why: 'Quotes from real customers are trust signals AI can read.', fix: 'Show a few real reviews (with first name and date) on your site.' },
    { t: 'لا توجد آراء عملاء في موقعك', why: 'اقتباسات العملاء الحقيقيين إشارات ثقة يستطيع الذكاء الاصطناعي قراءتها.', fix: 'اعرض بعض التقييمات الحقيقية (بالاسم الأول والتاريخ) في موقعك.' }]
};
/* neutral names for the check list */
const LBL = { ai_named: ['Named in AI answers', 'الذكر في إجابات الذكاء الاصطناعي'], brand_known: ['AI knows your business', 'معرفة الذكاء الاصطناعي بنشاطك'], crawl: ['Pages readable by AI', 'صفحات قابلة للقراءة'],
  ai_bots: ['AI crawlers allowed', 'السماح لبرامج الذكاء الاصطناعي'], schema: ['Business structured data', 'البيانات المنظمة للنشاط'], https: ['Secure and mobile-ready', 'آمن ومهيأ للجوال'], sitemap: ['Sitemap', 'خريطة الموقع'],
  speed: ['Loading speed', 'سرعة التحميل'], meta: ['Page title and description', 'عنوان الصفحة ووصفها'], llms: ['llms.txt file', 'ملف llms.txt'], name: ['Clear business name', 'اسم واضح للنشاط'], area: ['Area and city', 'المنطقة والمدينة'],
  services: ['Services listed', 'الخدمات مذكورة'], contact: ['Phone, WhatsApp or email', 'هاتف أو واتساب أو بريد'], hours: ['Opening hours', 'ساعات العمل'], prices: ['Prices or price range', 'الأسعار أو نطاقها'],
  languages: ['Arabic and English', 'العربية والإنجليزية'], faq: ['Questions and answers', 'أسئلة وأجوبة'], about: ['About page', 'صفحة من نحن'], gbp: ['Google Business Profile', 'ملف Google التجاري'], reviews: ['Google reviews', 'تقييمات Google'],
  listings: ['Profiles linked', 'الحسابات المرتبطة'], whatsapp: ['WhatsApp button', 'زر واتساب'], map: ['Map or address', 'الخريطة أو العنوان'], testimonials: ['Customer reviews on site', 'آراء العملاء في الموقع'] };
const SEV = (w) => (w >= 3 ? 'high' : w === 2 ? 'medium' : 'low');

/* answers: [{assistant, question, lang, kind, named, mentions, sources, error, answer}] */
function compute(au, answers, profile) {
  const checks = Object.assign({}, au.checks || {});
  const disc = answers.filter((a) => a.kind !== 'brand' && !a.error), brand = answers.filter((a) => a.kind === 'brand' && !a.error);
  const named = disc.filter((a) => a.named).length;
  const known = brand.filter((a) => a.named).length;
  const measured = disc.length > 0;
  if (measured) checks.ai_named = { status: named / disc.length >= 0.5 ? 'pass' : 'fail', note: `${named} of ${disc.length}` };
  if (brand.length) checks.brand_known = { status: known / brand.length >= 0.5 ? 'pass' : 'fail', note: `${known} of ${brand.length}` };

  const pillars = {};
  Object.keys(PILLARS).forEach((p) => {
    if (p === 'visibility') {
      if (!measured && !brand.length) { pillars[p] = null; return; }
      const r1 = measured ? named / disc.length : 0, r2 = brand.length ? known / brand.length : r1;
      pillars[p] = Math.round(100 * (measured ? 0.75 * Math.min(1, r1 / 0.8) + 0.25 * r2 : r2));
      return;
    }
    let got = 0, tot = 0;
    Object.keys(F).filter((k) => F[k][0] === p).forEach((k) => { const c = checks[k]; if (!c || c.status === 'manual') return; tot += F[k][1]; if (c.status === 'pass') got += F[k][1]; });
    pillars[p] = tot ? Math.round((100 * got) / tot) : null;
  });
  let wsum = 0, ssum = 0;
  Object.keys(pillars).forEach((p) => { if (pillars[p] != null) { wsum += PILLARS[p].w; ssum += PILLARS[p].w * pillars[p]; } });
  const overall = wsum ? Math.round(ssum / wsum) : 0;

  // share of voice: who the assistants named in discovery answers
  const counts = new Map();
  disc.forEach((a) => (a.mentions || []).forEach((m) => { const k = m.toLowerCase(); const e = counts.get(k) || { name: m, count: 0 }; e.count++; counts.set(k, e); }));
  const rivals = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  // where assistants got their information
  const doms = new Map();
  answers.filter((a) => !a.error).forEach((a) => (a.sources || []).forEach((u) => { try { const d = new URL(u).hostname.replace(/^www\./, ''); if (/vertexaisearch|googleusercontent/.test(d)) return; doms.set(d, (doms.get(d) || 0) + 1); } catch (e) {} }));
  const sources = [...doms].map(([d, n]) => ({ domain: d, count: n })).sort((a, b) => b.count - a.count).slice(0, 10);

  // findings, most important first
  const findings = Object.keys(F).filter((k) => checks[k] && checks[k].status === 'fail').map((k) => {
    const [pillar, w, effort] = F[k];
    return { key: k, pillar, weight: w, severity: SEV(w), effort, note: checks[k].note || '', rank: w * PILLARS[pillar].w + (effort === 'quick' ? 8 : 0) };
  }).sort((a, b) => b.rank - a.rank);
  const passed = Object.keys(F).filter((k) => checks[k] && checks[k].status === 'pass');
  const assistants = [...new Set(answers.map((a) => a.assistant))];
  return { v: 7, overall, grade: grade(overall), pillars, measured, named, total: disc.length, known, brandTotal: brand.length, rivals, sources, findings, passed,
    checks: Object.fromEntries(Object.keys(F).filter((k) => checks[k]).map((k) => [k, { status: checks[k].status, note: checks[k].note || '' }])), assistants };
}
function grade(n) { return n >= 85 ? 'A' : n >= 70 ? 'B' : n >= 50 ? 'C' : n >= 30 ? 'D' : 'E'; }
const GRADE = { A: ['Strong', 'قوي'], B: ['Good', 'جيد'], C: ['Needs work', 'يحتاج إلى عمل'], D: ['Weak', 'ضعيف'], E: ['Nearly invisible', 'شبه غير مرئي'] };

/* plain-language summary written from the numbers only */
function summary(sc, name, lang, label) {
  const en = lang === 'en', L = (k) => (label ? label(k) : k);
  const parts = [];
  if (sc.measured) {
    const top = sc.rivals.slice(0, 3).map((r) => r.name);
    parts.push(en ? `We asked ${sc.assistants.length} AI assistants ${sc.total / Math.max(1, sc.assistants.length) | 0} questions a customer would ask. ${name} was named in ${sc.named} of ${sc.total} answers.`
      : `سألنا ${sc.assistants.length} من مساعدات الذكاء الاصطناعي ${sc.total / Math.max(1, sc.assistants.length) | 0} أسئلة يطرحها العملاء. ظهر ${name} في ${sc.named} من ${sc.total} إجابة.`);
    if (top.length) parts.push(en ? `The names they recommend instead: ${top.join(', ')}.` : `الأسماء التي يرشحونها بدلاً منك: ${top.join('، ')}.`);
  } else parts.push(en ? 'AI answers were not measured in this report.' : 'لم تُقَس إجابات الذكاء الاصطناعي في هذا التقرير.');
  if (sc.brandTotal) parts.push(en ? `Asked about you by name, ${sc.known} of ${sc.brandTotal} assistants could describe you.` : `عند السؤال عنك بالاسم، استطاع ${sc.known} من ${sc.brandTotal} مساعدات وصفك.`);
  const high = sc.findings.filter((f) => f.severity === 'high').slice(0, 3).map((f) => (en ? F[f.key][3].t : F[f.key][4].t));
  if (high.length) parts.push((en ? 'Biggest gaps: ' : 'أكبر الثغرات: ') + high.join(en ? '; ' : '؛ ') + (en ? '.' : '.'));
  else parts.push(en ? 'No major gaps on your website: the work now is reputation and consistency.' : 'لا توجد ثغرات كبيرة في موقعك: العمل الآن على السمعة والاتساق.');
  return parts.join(' ');
}

/* compare two computed scans (before -> after) */
function compare(a, b) {
  const fixed = (a.findings || []).filter((f) => b.checks[f.key] && b.checks[f.key].status === 'pass').map((f) => f.key);
  const still = (b.findings || []).filter((f) => (a.findings || []).some((x) => x.key === f.key)).map((f) => f.key);
  const fresh = (b.findings || []).filter((f) => !(a.findings || []).some((x) => x.key === f.key) && a.checks[f.key] && a.checks[f.key].status === 'pass').map((f) => f.key);
  const pillars = {}; Object.keys(PILLARS).forEach((p) => { pillars[p] = { before: a.pillars[p], after: b.pillars[p] }; });
  return { overall: { before: a.overall, after: b.overall, delta: b.overall - a.overall }, pillars, fixed, still, fresh,
    named: { before: [a.named, a.total], after: [b.named, b.total] }, known: { before: [a.known, a.brandTotal], after: [b.known, b.brandTotal] } };
}

module.exports = { compute, summary, compare, grade, GRADE, PILLARS, F, LBL };
