'use strict';
/* Small settings store the admin can change from the panel (no redeploy): free reports per day, monthly AI budget,
   fixed monthly costs and the model each assistant uses. Secrets (API keys) never live here; they stay in Render. */
const { q } = require('./db');
const C = require('./config');
const KEYS = { free_per_day: 'int', ai_budget_aed: 'int', fixed_costs_aed: 'int', model_openai: 'str', model_gemini: 'str', model_anthropic: 'str', model_perplexity: 'str' };
async function load() {
  try {
    const rows = (await q('SELECT key, value FROM settings')).rows;
    Object.keys(C.OV).forEach((k) => delete C.OV[k]);
    rows.forEach((r) => { C.OV[r.key] = r.value; });
  } catch (e) { /* table not there yet */ }
}
async function set(key, value) {
  if (!KEYS[key] && !/^_/.test(key)) return false;
  let v = value;
  if (KEYS[key] === 'int') { if (v === '' || v == null) v = null; else { v = Math.floor(Number(v)); if (!Number.isFinite(v) || v < 0 || v > 1e6) return false; } }
  if (KEYS[key] === 'str') { v = String(v == null ? '' : v).trim().slice(0, 80); if (v && !/^[\w.\-/:]+$/.test(v)) return false; if (!v) v = null; }
  if (v == null) await q('DELETE FROM settings WHERE key=$1', [key]);
  else await q('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(v)]);
  await load();
  return true;
}
const get = (key) => C.OV[key];
function start() { load(); const t = setInterval(load, 60000); if (t.unref) t.unref(); }
module.exports = { load, set, get, start, KEYS };
