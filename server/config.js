'use strict';
/* Integrations are switched on by environment variables. Nothing secret is ever sent to the browser. */
const env = (k, d) => (process.env[k] || d || '').trim();
/* Settings saved from the admin panel (settings.js fills this). They win over environment variables. */
const OV = {};
const ov = (k) => (OV[k] == null || OV[k] === '' ? null : OV[k]);
/* Model names change often. Each assistant tries its chosen model first, then these, and remembers the one that works. */
const FALLBACK = {
  openai: ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-5-mini'],
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  anthropic: ['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
  perplexity: ['perplexity/sonar', 'sonar']
};
const model = (k, envKey) => () => String(ov('model_' + k) || env(envKey, FALLBACK[k][0]));
const models = (k, envKey) => () => [...new Set([model(k, envKey)()].concat(FALLBACK[k]))];
const C = {
  publicUrl: () => env('PUBLIC_URL', 'https://gettawsiya.com').replace(/\/+$/, ''),
  ziina: { key: () => env('ZIINA_API_KEY'), whsec: () => env('ZIINA_WEBHOOK_SECRET'), base: () => env('ZIINA_API_BASE', 'https://api-v2.ziina.com/api'), test: () => env('ZIINA_TEST_MODE') === '1',
    checkIp: () => env('ZIINA_CHECK_IP') === '1' },
  mail: { key: () => env('RESEND_API_KEY'), from: () => env('MAIL_FROM', 'Tawsiya <hello@gettawsiya.com>'), base: () => env('RESEND_API_BASE', 'https://api.resend.com'), admin: () => env('ADMIN_EMAIL') },
  places: { key: () => env('GOOGLE_PLACES_API_KEY'), base: () => env('PLACES_API_BASE', 'https://places.googleapis.com') },
  ai: {
    openai: { label: 'ChatGPT', key: () => env('OPENAI_API_KEY'), model: model('openai', 'OPENAI_MODEL'), models: models('openai', 'OPENAI_MODEL'), base: () => env('OPENAI_API_BASE', 'https://api.openai.com') },
    gemini: { label: 'Gemini', key: () => env('GEMINI_API_KEY'), model: model('gemini', 'GEMINI_MODEL'), models: models('gemini', 'GEMINI_MODEL'), base: () => env('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com') },
    anthropic: { label: 'Claude', key: () => env('ANTHROPIC_API_KEY'), model: model('anthropic', 'ANTHROPIC_MODEL'), models: models('anthropic', 'ANTHROPIC_MODEL'), base: () => env('ANTHROPIC_API_BASE', 'https://api.anthropic.com') },
    perplexity: { label: 'Perplexity', key: () => env('PERPLEXITY_API_KEY'), model: model('perplexity', 'PERPLEXITY_MODEL'), models: models('perplexity', 'PERPLEXITY_MODEL'), base: () => env('PERPLEXITY_API_BASE', 'https://api.perplexity.ai') }
  },
  worker: () => env('WORKER', 'on') !== 'off',
  autoPublish: () => env('AUTO_PUBLISH_SCORE', 'on') !== 'off',
  freePerDay: () => { const v = ov('free_per_day'); return v != null ? Math.max(0, Number(v) || 0) : (Number(env('FREE_SCORES_PER_DAY', '10')) || 10); },
  /* money settings (AED). Budget 0 = no cap. */
  aiBudget: () => { const v = ov('ai_budget_aed'); return v != null ? Math.max(0, Number(v) || 0) : (Number(env('AI_BUDGET_AED', '300')) || 0); },
  fixedCosts: () => { const v = ov('fixed_costs_aed'); return v != null ? Math.max(0, Number(v) || 0) : 60; },
  usdAed: 3.6725, OV, FALLBACK,
  allowPrivateFetch: () => env('ALLOW_PRIVATE_FETCH') === '1'
};
C.assistantsOn = () => Object.keys(C.ai).filter((k) => !!C.ai[k].key());
C.status = () => ({
  ziina: !!C.ziina.key(), ziina_webhook: !!C.ziina.whsec(), ziina_mode: C.ziina.key() ? (C.ziina.test() ? 'test' : 'live') : null,
  email: !!C.mail.key(), mail_from: C.mail.from(), places: !!C.places.key(),
  assistants: Object.keys(C.ai).map((k) => ({ key: k, label: C.ai[k].label, on: !!C.ai[k].key(), model: C.ai[k].model() })),
  worker: C.worker(), auto_publish: C.autoPublish(), free_per_day: C.freePerDay(), public_url: C.publicUrl()
});
module.exports = C;
