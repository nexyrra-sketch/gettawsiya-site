'use strict';
/* The business's own logo, taken from its website (structured-data logo, the logo image in the page, the touch icon,
   then a large favicon). Stored with the run so reports and link previews show the real brand. Never throws. */
const F = require('./fetchsafe');

const MAX = 300 * 1024;
function sniff(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return { type: 'image/png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: 'image/jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return { type: 'image/jpeg', w: 0, h: 0 };
  }
  if (b.toString('ascii', 0, 3) === 'GIF') return { type: 'image/gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const k = b.toString('ascii', 12, 16);
    if (k === 'VP8X') return { type: 'image/webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (k === 'VP8L') { const x = b.readUInt32LE(21); return { type: 'image/webp', w: 1 + (x & 0x3fff), h: 1 + ((x >> 14) & 0x3fff) }; }
    return { type: 'image/webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { type: 'image/x-icon', w: b[6] || 256, h: b[7] || 256 };
  const head = b.toString('utf8', 0, Math.min(b.length, 2048)).replace(/^﻿/, '').trim();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return { type: 'image/svg+xml', w: 0, h: 0 };
  return null;
}
/* strip anything active from an SVG before we keep it (it is only ever shown as an image, this is belt and braces) */
const cleanSvg = (b) => Buffer.from(b.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#'), 'utf8');

async function grab(url) {
  try {
    const r = await F.get(url, { binary: true, timeout: 8000, maxBytes: MAX + 1, accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5' });
    if (r.status !== 200 || r.truncated || !r.body || r.body.length > MAX) return null;
    const k = sniff(r.body);
    if (!k) return null;
    return Object.assign(k, { data: k.type === 'image/svg+xml' ? cleanSvg(r.body) : r.body, src: r.finalUrl || url });
  } catch (e) { return null; }
}

/* pick the first good candidate: a vector or a raster at least 48 px wide; a small icon only if nothing better */
async function find(signals = {}, host = '') {
  const list = [].concat(signals.logos || [], signals.icons || []);
  if (host && !/\.(test|localhost|local)$/i.test(host)) list.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`);
  let small = null;
  for (const u of [...new Set(list)].slice(0, 8)) {
    const x = await grab(u);
    if (!x) continue;
    const g = /google\.com\/s2\/favicons/.test(u);
    if (x.type === 'image/svg+xml' || (x.w >= (g ? 64 : 48) && x.h >= 24 && x.type !== 'image/x-icon')) return x;
    if (!small && !g) small = x;
  }
  return small;
}
const dataUri = (x) => `data:${x.type};base64,${Buffer.from(x.data).toString('base64')}`;
module.exports = { find, sniff, grab, dataUri, cleanSvg };
