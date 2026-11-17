'use strict';
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const local = /localhost|127\.0\.0\.1|\/var\/run|%2F/.test(url);
const pool = new Pool({ connectionString: url, ssl: local || process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false }, max: 10 });
pool.on('error', (e) => console.error('pg pool error', e.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client','partner')),
  phone TEXT, lang TEXT NOT NULL DEFAULT 'ar', ref_code TEXT, disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS resets (
  token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reset_requests (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL, user_id INT REFERENCES users ON DELETE SET NULL,
  handled BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS businesses (
  id SERIAL PRIMARY KEY, owner_id INT REFERENCES users ON DELETE CASCADE, slug TEXT UNIQUE NOT NULL,
  name_en TEXT, name_ar TEXT, category TEXT, city TEXT, area TEXT, website TEXT, instagram TEXT,
  phone TEXT, whatsapp TEXT, email TEXT, address TEXT, hours TEXT, languages TEXT, services TEXT, price_range TEXT,
  desc_en TEXT, desc_ar TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','suspended')),
  verified_at TIMESTAMPTZ, verified_note TEXT, needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS score_requests (
  id SERIAL PRIMARY KEY, token TEXT UNIQUE NOT NULL, site TEXT NOT NULL, name TEXT, contact TEXT,
  business_id INT REFERENCES businesses ON DELETE SET NULL, user_id INT REFERENCES users ON DELETE SET NULL,
  ref_code TEXT, lang TEXT, source TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','working','done','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS score_reports (
  id SERIAL PRIMARY KEY, request_id INT NOT NULL REFERENCES score_requests ON DELETE CASCADE,
  business_id INT REFERENCES businesses ON DELETE SET NULL, token TEXT UNIQUE NOT NULL,
  site TEXT, business_name TEXT, score INT NOT NULL CHECK (score BETWEEN 0 AND 15),
  checks JSONB NOT NULL DEFAULT '{}', answers_total INT NOT NULL DEFAULT 0, answers_named INT NOT NULL DEFAULT 0,
  assistants JSONB NOT NULL DEFAULT '[]', questions JSONB NOT NULL DEFAULT '[]',
  summary_en TEXT, summary_ar TEXT, published BOOLEAN NOT NULL DEFAULT FALSE,
  checked_on DATE NOT NULL DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS score_reports_request ON score_reports(request_id);
CREATE TABLE IF NOT EXISTS ai_checks (
  id SERIAL PRIMARY KEY, business_id INT NOT NULL REFERENCES businesses ON DELETE CASCADE, week_of DATE NOT NULL,
  answers_total INT NOT NULL, answers_named INT NOT NULL, assistants JSONB NOT NULL DEFAULT '[]', note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (business_id, week_of));
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY, business_id INT NOT NULL REFERENCES businesses ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS index_editions (
  id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title_en TEXT NOT NULL, title_ar TEXT NOT NULL,
  sector TEXT, period TEXT, assistants JSONB NOT NULL DEFAULT '[]', prompts JSONB NOT NULL DEFAULT '[]',
  answers_total INT NOT NULL DEFAULT 0, notes_en TEXT, notes_ar TEXT,
  published BOOLEAN NOT NULL DEFAULT FALSE, published_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS index_rows (
  id SERIAL PRIMARY KEY, edition_id INT NOT NULL REFERENCES index_editions ON DELETE CASCADE,
  rank INT NOT NULL, name TEXT NOT NULL, named_count INT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS partners (
  user_id INT PRIMARY KEY REFERENCES users ON DELETE CASCADE, code TEXT UNIQUE NOT NULL, company TEXT, kind TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ref_clicks (id SERIAL PRIMARY KEY, code TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ref_clicks_code ON ref_clicks(code);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('project','notify','contact')),
  name TEXT, contact TEXT, site TEXT, intent TEXT, payload JSONB NOT NULL DEFAULT '{}',
  ref_code TEXT, lang TEXT, status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

/* v6: subscriptions, payments, automated checks, jobs, email log */
const SCHEMA2 = `
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS competitors JSONB NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS aliases TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS biz_name TEXT;
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS run_id INT;
ALTER TABLE score_reports ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE score_reports ADD COLUMN IF NOT EXISTS run_id INT;
ALTER TABLE ai_checks ADD COLUMN IF NOT EXISTS run_id INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS check_key TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS category_ar TEXT;
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS area TEXT;
CREATE TABLE IF NOT EXISTS plans (
  key TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_ar TEXT NOT NULL, blurb_en TEXT, blurb_ar TEXT,
  price_fils INT NOT NULL DEFAULT 0 CHECK (price_fils >= 0), currency TEXT NOT NULL DEFAULT 'aed',
  interval TEXT NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year','once')),
  features_en JSONB NOT NULL DEFAULT '[]', features_ar JSONB NOT NULL DEFAULT '[]', limits JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE, featured BOOLEAN NOT NULL DEFAULT FALSE, sort INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE, business_id INT REFERENCES businesses ON DELETE SET NULL,
  plan_key TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','expired','canceled')), source TEXT NOT NULL DEFAULT 'ziina',
  current_period_end TIMESTAMPTZ, reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS subscriptions_user ON subscriptions(user_id);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY, user_id INT REFERENCES users ON DELETE SET NULL, provider_ref TEXT UNIQUE NOT NULL,
  amount_fils INT NOT NULL, currency TEXT NOT NULL, description TEXT, status TEXT NOT NULL, url TEXT, plan_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS checkouts (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE, plan_key TEXT NOT NULL, kind TEXT NOT NULL,
  amount_fils INT NOT NULL, bonus_seconds INT NOT NULL DEFAULT 0, intent_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','canceled')),
  test BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts INT NOT NULL DEFAULT 0, run_at TIMESTAMPTZ NOT NULL DEFAULT now(), locked_at TIMESTAMPTZ, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), done_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status, run_at);
CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY, business_id INT REFERENCES businesses ON DELETE CASCADE, request_id INT REFERENCES score_requests ON DELETE CASCADE,
  kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', site TEXT, business_name TEXT,
  audit JSONB NOT NULL DEFAULT '{}', answers_total INT NOT NULL DEFAULT 0, answers_named INT NOT NULL DEFAULT 0,
  assistants JSONB NOT NULL DEFAULT '[]', competitors JSONB NOT NULL DEFAULT '[]', error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS runs_business ON runs(business_id, id);
CREATE TABLE IF NOT EXISTS run_answers (
  id SERIAL PRIMARY KEY, run_id INT NOT NULL REFERENCES runs ON DELETE CASCADE, assistant TEXT NOT NULL, question TEXT NOT NULL, lang TEXT,
  named BOOLEAN NOT NULL DEFAULT FALSE, answer TEXT, sources JSONB NOT NULL DEFAULT '[]', mentions JSONB NOT NULL DEFAULT '[]', error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS run_answers_run ON run_answers(run_id);
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY, to_addr TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT, status TEXT NOT NULL, error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;

/* Proposed plans, editable in the admin panel (Plans tab). Prices are in fils (AED x 100). */
const SEED_PLANS = [
  { key: 'free', name_en: 'Free report', name_ar: 'التقرير المجاني', price: 0, interval: 'month', sort: 0,
    blurb_en: 'See where you stand with AI today.', blurb_ar: 'اعرف موقعك لدى الذكاء الاصطناعي اليوم.',
    f_en: ['Full AI visibility report with a score out of 100', 'What the major AI assistants say about you', 'Who AI recommends instead of you', 'An action plan you can start today'],
    f_ar: ['تقرير كامل لظهورك في الذكاء الاصطناعي بدرجة من 100', 'ماذا تقول عنك أشهر مساعدات الذكاء الاصطناعي', 'مَن يرشّحه الذكاء الاصطناعي بدلاً منك', 'خطة عمل تبدأ بها اليوم'],
    limits: { questions: 4, weekly: false, competitors: 0, manual_runs_per_week: 0 } },
  { key: 'track', name_en: 'Track', name_ar: 'المتابعة', price: 19900, interval: 'month', sort: 1,
    blurb_en: 'You do the fixes. We measure every week.', blurb_ar: 'أنت تنفّذ الإصلاحات ونحن نقيس كل أسبوع.',
    f_en: ['Everything in the free report', 'Automatic re-scan every week', '10 customer questions in Arabic and English', 'Track 3 competitors', 'Step-by-step action plan you do yourself', 'Before and after report to share', 'Weekly email summary', 'Tawsiya Verified page and badge'],
    f_ar: ['كل ما في التقرير المجاني', 'إعادة فحص تلقائية كل أسبوع', '10 أسئلة عملاء بالعربية والإنجليزية', 'متابعة 3 منافسين', 'خطة عمل خطوة بخطوة تنفّذها بنفسك', 'تقرير «قبل وبعد» للمشاركة', 'ملخص أسبوعي بالبريد', 'صفحة «موثَّق من توصية» والشارة'],
    limits: { questions: 10, weekly: true, competitors: 3, manual_runs_per_week: 1 } },
  { key: 'grow', name_en: 'Grow', name_ar: 'النمو', price: 79900, interval: 'month', sort: 2, featured: true,
    blurb_en: 'We do the fixes for you.', blurb_ar: 'نحن ننفّذ الإصلاحات عنك.',
    f_en: ['Everything in Track', 'We do the fixes for you (with access to your site and Google profile)', '20 customer questions in Arabic and English', 'Track 10 competitors', 'Extra scan any time (2 a week)', 'Monthly progress review on WhatsApp', 'Priority support'],
    f_ar: ['كل ما في المتابعة', 'ننفّذ الإصلاحات عنك (مع صلاحية الوصول لموقعك وملفك على Google)', '20 سؤال عملاء بالعربية والإنجليزية', 'متابعة 10 منافسين', 'فحص إضافي في أي وقت (مرتان أسبوعياً)', 'مراجعة شهرية للتقدّم عبر واتساب', 'دعم ذو أولوية'],
    limits: { questions: 20, weekly: true, competitors: 10, manual_runs_per_week: 2 } }
];

/* v7: deep scans, live progress, before/after, action plans */
const SCHEMA3 = `
ALTER TABLE runs ADD COLUMN IF NOT EXISTS token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS runs_token ON runs(token);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS profile JSONB;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS scan JSONB;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS summary_en TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS summary_ar TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS lang TEXT;
CREATE INDEX IF NOT EXISTS runs_request ON runs(request_id, id);
ALTER TABLE run_answers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'discover';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS baseline_run_id INT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_share ON businesses(share_token);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'client';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT 'tawsiya';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS finding_key TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS client_note TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 2;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('open','doing','done'));
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS lead_status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE score_requests ADD COLUMN IF NOT EXISTS lead_note TEXT;
`;

/* v8: admin settings, estimated AI cost per answer and per scan */
const SCHEMA4 = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE run_answers ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,5) NOT NULL DEFAULT 0;
ALTER TABLE run_answers ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE run_answers ADD COLUMN IF NOT EXISTS searched BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0;
`;
const PLAN_SQL = `INSERT INTO plans(key,name_en,name_ar,blurb_en,blurb_ar,price_fils,interval,features_en,features_ar,limits,featured,sort) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;
const planArgs = (p) => [p.key, p.name_en, p.name_ar, p.blurb_en, p.blurb_ar, p.price, p.interval, JSON.stringify(p.f_en), JSON.stringify(p.f_ar), p.limits, !!p.featured, p.sort];

async function migrate() {
  await pool.query(SCHEMA);
  await pool.query(SCHEMA2);
  await pool.query(SCHEMA3);
  await pool.query(SCHEMA4);
  /* plans: seed once; refresh the three standard plans to the v8 offer once (later admin edits are kept) */
  const n = (await pool.query('SELECT count(*)::int n FROM plans')).rows[0].n;
  const v8 = (await pool.query("SELECT 1 FROM settings WHERE key='_plans_v8'")).rows.length;
  if (!n) for (const p of SEED_PLANS) await pool.query(PLAN_SQL + ' ON CONFLICT DO NOTHING', planArgs(p));
  else if (!v8) for (const p of SEED_PLANS) await pool.query(PLAN_SQL + ` ON CONFLICT (key) DO UPDATE SET name_en=EXCLUDED.name_en, name_ar=EXCLUDED.name_ar, blurb_en=EXCLUDED.blurb_en, blurb_ar=EXCLUDED.blurb_ar,
    price_fils=EXCLUDED.price_fils, features_en=EXCLUDED.features_en, features_ar=EXCLUDED.features_ar, limits=EXCLUDED.limits, featured=EXCLUDED.featured, sort=EXCLUDED.sort`, planArgs(p));
  if (!v8) await pool.query("INSERT INTO settings(key,value) VALUES('_plans_v8','true') ON CONFLICT DO NOTHING");
}
const q = (text, params) => pool.query(text, params);
module.exports = { pool, q, migrate };
