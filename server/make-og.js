'use strict';
/* Regenerates the two home-page link preview pictures: node server/make-og.js */
const fs = require('fs'), path = require('path'), O = require('./og');
const out = path.join(__dirname, '..', 'src', 'static', 'assets', 'img');
['ar', 'en'].forEach((l) => { const f = path.join(out, `og-${l}.png`); fs.writeFileSync(f, O.homePng(l)); console.log(f, (fs.statSync(f).size / 1024) | 0, 'KB'); });
