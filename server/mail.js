'use strict';
/* Transactional email through Resend. If RESEND_API_KEY is missing, emails are logged as "skipped" and the
   flows fall back to the manual ones (admin sends links on WhatsApp). */
const { q } = require('./db');
const C = require('./config');
const U = require('./util');

const enabled = () => !!C.mail.key();

function layout(lang, title, paras, cta) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr', align = lang === 'ar' ? 'right' : 'left';
  const ps = paras.filter(Boolean).map((p) => `<p style="margin:0 0 14px;line-height:1.6">${U.esc(p)}</p>`).join('');
  const btn = cta ? `<p style="margin:22px 0"><a href="${U.esc(cta.url)}" style="background:#111;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;display:inline-block">${U.esc(cta.label)}</a></p>` : '';
  const foot = lang === 'ar' ? 'توصية · دبي، الإمارات' : 'Tawsiya · Dubai, UAE';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f5f4f0;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;padding:28px 20px;text-align:${align}"><p style="font-weight:700;font-size:18px;margin:0 0 20px">Tawsiya · توصية</p>
<div style="background:#fff;border-radius:16px;padding:24px"><h1 style="font-size:20px;margin:0 0 16px">${U.esc(title)}</h1>${ps}${btn}</div>
<p style="color:#777;font-size:12px;margin-top:16px">${foot} · ${U.esc(C.publicUrl())}</p></div></body></html>`;
}
const plain = (title, paras, cta) => [title, '', ...paras.filter(Boolean), cta ? `\n${cta.label}: ${cta.url}` : ''].join('\n');

async function send(to, kind, lang, title, paras, cta) {
  if (!to || !U.isEmail(String(to).toLowerCase())) return { ok: false, skipped: true };
  if (!enabled()) { await q('INSERT INTO emails(to_addr,kind,subject,status) VALUES($1,$2,$3,$4)', [to, kind, title, 'skipped']); return { ok: false, skipped: true }; }
  try {
    const r = await fetch(C.mail.base() + '/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: 'Bearer ' + C.mail.key(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: C.mail.from(), to: [to], subject: title, html: layout(lang, title, paras, cta), text: plain(title, paras, cta) })
    });
    if (!r.ok) throw new Error('resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
    await q('INSERT INTO emails(to_addr,kind,subject,status) VALUES($1,$2,$3,$4)', [to, kind, title, 'sent']);
    return { ok: true };
  } catch (e) {
    await q('INSERT INTO emails(to_addr,kind,subject,status,error) VALUES($1,$2,$3,$4,$5)', [to, kind, title, 'failed', String(e.message).slice(0, 300)]);
    return { ok: false, error: e.message };
  }
}

const L = (lang) => (lang === 'en' ? 'en' : 'ar');
const T = {
  reset: (lang, url) => L(lang) === 'en'
    ? ['Reset your Tawsiya password', ['Someone asked to reset the password for this email. If it was you, use the button below. The link works once and expires in 2 hours.', 'If you did not ask, ignore this email.'], { label: 'Choose a new password', url }]
    : ['إعادة تعيين كلمة المرور في توصية', ['طُلب إعادة تعيين كلمة المرور لهذا البريد. إن كنت أنت، استخدم الزر أدناه. الرابط يعمل مرة واحدة وتنتهي صلاحيته خلال ساعتين.', 'إن لم تطلب ذلك فتجاهل هذه الرسالة.'], { label: 'اختر كلمة مرور جديدة', url }],
  welcome: (lang, name, url) => L(lang) === 'en'
    ? ['Welcome to Tawsiya', [`Hello ${name},`, 'Your account is ready. Add your business facts, run your first Score, and see what AI assistants say about you.'], { label: 'Open your dashboard', url }]
    : ['أهلاً بك في توصية', [`مرحباً ${name}،`, 'حسابك جاهز. أضف معلومات نشاطك، وشغّل أول درجة، وشاهد ما تقوله مساعدات الذكاء الاصطناعي عنك.'], { label: 'افتح لوحتك', url }],
  report: (lang, site, score, named, total, url) => L(lang) === 'en'
    ? [`Your AI visibility report for ${site}: ${score}/100`, [`Your Tawsiya Score is ${score} out of 100.`, total ? `AI assistants named you in ${named} of ${total} answers.` : '', 'Open the report to see what each AI says about you, who it recommends instead, and your action plan.'], { label: 'Open my report', url }]
    : [`تقرير ظهورك في الذكاء الاصطناعي لـ ${site}: ${score}/100`, [`درجة توصية لنشاطك ${score} من 100.`, total ? `ذكرتك مساعدات الذكاء الاصطناعي في ${named} من ${total} إجابة.` : '', 'افتح التقرير لترى ماذا يقول كل مساعد عنك، ومن يرشح بدلاً منك، وخطة العمل.'], { label: 'افتح تقريري', url }],
  weekly: (lang, name, named, total, prev, url) => L(lang) === 'en'
    ? [`This week: named in ${named} of ${total} AI answers`, [`${name}: AI assistants named you in ${named} of ${total} answers this week${prev != null ? ` (last check: ${prev})` : ''}.`, 'Your dashboard shows each answer, the competitors named, and the sources used.'], { label: 'See this week', url }]
    : [`هذا الأسبوع: ذُكرت في ${named} من ${total} إجابة`, [`${name}: ذكرتك مساعدات الذكاء الاصطناعي في ${named} من ${total} إجابة هذا الأسبوع${prev != null ? ` (الفحص السابق: ${prev})` : ''}.`, 'تعرض لوحتك كل إجابة والمنافسين المذكورين والمصادر المستخدمة.'], { label: 'شاهد هذا الأسبوع', url }],
  paid: (lang, plan, url) => L(lang) === 'en'
    ? [`You are on the ${plan} plan`, ['Thank you. Your payment was received through Ziina and your plan is active. Weekly checks are switched on, and the first one has started.', 'Plans are prepaid: nothing renews automatically. We will email you before your plan ends.'], { label: 'Open your dashboard', url }]
    : [`أنت الآن على باقة ${plan}`, ['شكراً لك. استلمنا الدفع عبر Ziina وباقتك فعّالة. الفحوصات الأسبوعية مفعّلة وبدأ أول فحص.', 'الباقات مدفوعة مقدماً ولا تتجدد تلقائياً، وسنراسلك قبل انتهاء باقتك.'], { label: 'افتح لوحتك', url }],
  renew: (lang, plan, end, price, url) => L(lang) === 'en'
    ? [`Your ${plan} plan ends on ${new Date(end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}`, [`To keep weekly checks running, renew for AED ${price}. Nothing is charged automatically.`, 'If you do not renew, your account moves to the free plan and your history stays.'], { label: 'Renew my plan', url }]
    : [`تنتهي باقة ${plan} في ${new Date(end).toLocaleDateString('ar-AE-u-nu-latn', { day: 'numeric', month: 'long', timeZone: 'Asia/Dubai' })}`, [`لتستمر الفحوصات الأسبوعية، جدّد باقتك مقابل ${price} درهم. لا يُخصم أي مبلغ تلقائياً.`, 'إن لم تجدّد، ينتقل حسابك إلى الباقة المجانية ويبقى سجلك محفوظاً.'], { label: 'جدّد باقتي', url }],
  failed: (lang, url) => L(lang) === 'en'
    ? ['Your Tawsiya payment did not go through', ['Your card payment failed. Please update your card to keep weekly checks running.'], { label: 'Update payment method', url }]
    : ['لم تتم عملية الدفع في توصية', ['فشلت عملية الدفع بالبطاقة. يرجى تحديث بطاقتك لتستمر الفحوصات الأسبوعية.'], { label: 'تحديث وسيلة الدفع', url }]
};
const tpl = (name, to, lang, ...args) => { const [title, paras, cta] = T[name](lang, ...args); return send(to, name, L(lang), title, paras, cta); };
module.exports = { enabled, send, tpl };
