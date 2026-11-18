'use strict';
/* Fetch a public web page safely: http(s) only, public IPs only (checked at connect time, so DNS tricks fail),
   max 5 redirects, 12 s timeout, 1.5 MB cap. */
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const C = require('../config');

const UA = 'Mozilla/5.0 (compatible; TawsiyaBot/1.0; +https://gettawsiya.com/en/method/)';

function privateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('64:ff9b');
  }
  const p = ip.split('.').map(Number);
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224 || (p[0] === 192 && p[1] === 0 && p[2] === 0) || (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}
function safeLookup(host, opts, cb) {
  dns.lookup(host, Object.assign({}, opts, { all: true }), (err, addrs) => {
    if (err) return cb(err);
    const list = (addrs || []).filter((a) => C.allowPrivateFetch() || !privateIp(a.address));
    if (!list.length) return cb(Object.assign(new Error('blocked_address'), { code: 'EBLOCKED' }));
    if (opts && opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function once(url, timeoutMs, maxBytes, binary, accept) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(new Error('bad_url')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('bad_protocol'));
    if (net.isIP(u.hostname) && !C.allowPrivateFetch() && privateIp(u.hostname)) return reject(new Error('blocked_address'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', lookup: safeLookup, timeout: timeoutMs, headers: { 'User-Agent': UA, Accept: accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'en,ar;q=0.8' } }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8'), truncated: true, url }); } else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8'), url }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}
async function get(url, opts = {}) {
  const timeoutMs = opts.timeout || 12000, maxBytes = opts.maxBytes || 1.5e6;
  const chain = [];
  for (let i = 0; i < 6; i++) {
    const r = await once(url, timeoutMs, maxBytes, !!opts.binary, opts.accept);
    chain.push({ url, status: r.status });
    if (r.status >= 300 && r.status < 400 && r.headers.location) { url = new URL(r.headers.location, url).toString(); continue; }
    r.chain = chain; r.finalUrl = url; return r;
  }
  throw new Error('too_many_redirects');
}
module.exports = { get, privateIp, UA };
