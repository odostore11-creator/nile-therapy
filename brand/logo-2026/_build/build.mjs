// Builds the Nile Therapy logo candidates: marks on a 100x100 grid, outlined wordmarks
// (Outfit for English, Readex Pro for Arabic), lockups, app icons, one-color versions and a board.
import opentype from 'opentype.js';
import fs from 'fs';
import path from 'path';

const OUT = process.argv[2];
const F = p => opentype.loadSync('node_modules/@fontsource/' + p);
const en600 = F('outfit/files/outfit-latin-600-normal.woff');
const en400 = F('outfit/files/outfit-latin-400-normal.woff');
const ar600 = F('readex-pro/files/readex-pro-arabic-600-normal.woff');
const ar400 = F('readex-pro/files/readex-pro-arabic-400-normal.woff');

const r = n => Math.round(n * 100) / 100;
// Text -> outlined path at (x, baseline y). Returns { d, w }.
function txt(font, s, size, x = 0, y = 0) {
  const p = font.getPath(s, x, y, size);
  return { d: p.toPathData(2), w: font.getAdvanceWidth(s, size) };
}
// Arabic: words set one by one, right to left (the Arabic subset has no space glyph).
function arTxt(font, words, size, xRight, y) {
  const gap = size * 0.3; let x = xRight, d = '';
  for (const w of words) { const wd = font.getAdvanceWidth(w, size); x -= wd; d += font.getPath(w, x, y, size).toPathData(2); x -= gap; }
  return { d, w: xRight - x - gap };
}

// ---------- palettes ----------
const P = {
  lotus: { name: 'Lotus wave', dark: '#0b4f5c', a: '#0f7d74', b: '#5cc9b5', c: '#0b4f5c', snow: '#f4faf8', nile: '#0b4f5c', therapy: '#0f7d74', ar: '#5b7f83', bg: '#eef8f6', tile: '#0b4f5c' },
  home: { name: 'Home visit', dark: '#0f3a66', a: '#0f3a66', b: '#1a5fa8', c: '#93c4dc', d: '#e0583f', nile: '#0f3a66', therapy: '#1a5fa8', ar: '#5b6b7b', bg: '#eef5fb', tile: '#0f3a66' },
  drop: { name: 'Care drop', dark: '#0f3a66', a: '#1a5fa8', b: '#0a78b4', c: '#ffffff', d: '#e0583f', nile: '#0f3a66', therapy: '#1a5fa8', ar: '#5b6b7b', bg: '#eef5fb', tile: '#1a5fa8' },
};

// Colors of each mark on dark backgrounds (dark parts turn light so nothing disappears).
const DARK = {
  lotus: { a: '#f4faf8', b: '#5cc9b5', c: '#f4faf8' },
  home: { a: '#ffffff', b: '#5fb0e8', c: '#93c4dc', d: '#ff7a5c' },
  drop: { a: '#4d9be0', b: '#8fd0f2', c: '#ffffff', d: '#ff7a5c' },
};
// ---------- marks (100 x 100 grid, content inside 10..90) ----------
// mono: every part in one color (for stamps, embroidery, one-color print).
const marks = {
  lotus: (c, mono, id) => {
    const k = mono ? [mono, mono, mono] : [c.a, c.b, c.c];
    return `<path d="M50 12 C61.5 25 65 43 50 63 C35 43 38.5 25 50 12 Z" fill="${k[0]}"/>
      <path d="M46.5 66 C32 64.5 18.5 54 15 35 C30.5 37.5 42.5 48 46.5 66 Z" fill="${k[1]}"/>
      <path d="M53.5 66 C68 64.5 81.5 54 85 35 C69.5 37.5 57.5 48 53.5 66 Z" fill="${k[1]}"/>
      <path d="M16 79 C26.5 71.5 37.5 86.5 50 79 S 73.5 71.5 84 79" fill="none" stroke="${k[2]}" stroke-width="6.5" stroke-linecap="round"/>
      <path d="M30 90.5 C37 86 43.5 95 50 90.5 S 63 86 70 90.5" fill="none" stroke="${mono || c.b}" stroke-width="4.5" stroke-linecap="round"/>`;
  },
  home: (c, mono) => {
    const k = mono ? [mono, mono, mono, mono] : [c.a, c.b, c.c, c.d];
    return `<path d="M15 48 L50 17 L85 48" fill="none" stroke="${k[0]}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="50" cy="40" r="7.5" fill="${k[3]}"/>
      <path d="M37.5 61 C37.5 53.5 43 49.5 50 49.5 C57 49.5 62.5 53.5 62.5 61 Z" fill="${k[3]}"/>
      <path d="M12 72 C24.5 63.5 37.5 80.5 50 72 S 75.5 63.5 88 72" fill="none" stroke="${k[1]}" stroke-width="7.5" stroke-linecap="round"/>
      <path d="M22 86 C31.5 80 40.5 92 50 86 S 68.5 80 78 86" fill="none" stroke="${k[2]}" stroke-width="6" stroke-linecap="round"/>`;
  },
  drop: (c, mono, id) => {
    const body = 'M50 8 C58.5 21 81 40 81 60 A31 31 0 0 1 19 60 C19 40 41.5 21 50 8 Z';
    if (mono) return `<defs><mask id="m${id}"><rect width="100" height="100" fill="#fff"/>
        <path d="M19 64 C24 57.5 29.5 57.5 34.5 64 S 45 70.5 50 64 S 60.5 57.5 65.5 64 S 76 70.5 81 64" fill="none" stroke="#000" stroke-width="5.5" stroke-linecap="round"/>
        <circle cx="50" cy="43" r="11" fill="#000"/></mask></defs>
      <path d="${body}" fill="${mono}" mask="url(#m${id})"/><circle cx="50" cy="43" r="7.5" fill="${mono}"/>`;
    return `<defs><clipPath id="c${id}"><path d="${body}"/></clipPath></defs>
      <path d="${body}" fill="${c.a}"/>
      <path d="M4 64 L19 64 C24 57.5 29.5 57.5 34.5 64 S 45 70.5 50 64 S 60.5 57.5 65.5 64 S 76 70.5 81 64 L96 64 L96 100 L4 100 Z" fill="${c.b}" clip-path="url(#c${id})"/>
      <path d="M19 64 C24 57.5 29.5 57.5 34.5 64 S 45 70.5 50 64 S 60.5 57.5 65.5 64 S 76 70.5 81 64" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" clip-path="url(#c${id})"/>
      <circle cx="50" cy="43" r="7.5" fill="${c.d}"/>`;
  },
};
let uid = 0;
const markG = (key, x, y, s, { mono, c } = {}) => `<g transform="translate(${r(x)} ${r(y)}) scale(${r(s / 100)})">${marks[key](c || P[key], mono, ++uid)}</g>`;

// ---------- lockups ----------
// Horizontal: mark + "Nile Therapy" (two weights) + Arabic underneath, all sized from the mark height.
function horizontal(key, { dark = false, mono = null, arabic = true } = {}) {
  const c = P[key], M = 100, gap = 26, size = 44;
  const nileCol = mono || (dark ? '#ffffff' : c.nile), thCol = mono || (dark ? (key === 'lotus' ? '#bfeee4' : '#bfe6f0') : c.therapy), arCol = mono || (dark ? '#a9c4cf' : c.ar);
  const n = txt(en600, 'Nile', size, M + gap, arabic ? 56 : 66);
  const t = txt(en400, 'Therapy', size, M + gap + n.w + size * 0.24, arabic ? 56 : 66);
  const W = M + gap + n.w + size * 0.24 + t.w;
  let ar = '';
  if (arabic) { const a = arTxt(ar600, ['نايل', 'ثيرابي'], 27, W, 92); ar = `<path d="${a.d}" fill="${arCol}"/>`; }
  return { w: Math.ceil(W), h: 100, svg: `${markG(key, 0, 0, M, { mono, c: dark && !mono ? { ...c, ...DARK[key] } : undefined })}<path d="${n.d}" fill="${nileCol}"/><path d="${t.d}" fill="${thCol}"/>${ar}` };
}
// Stacked: mark on top, English, then Arabic, centered.
function stacked(key, { dark = false, mono = null } = {}) {
  const c = P[key], M = 120, size = 40;
  const nw = en600.getAdvanceWidth('Nile', size), tw = en400.getAdvanceWidth('Therapy', size), sp = size * 0.24;
  const W = Math.max(M, nw + sp + tw), x0 = (W - (nw + sp + tw)) / 2;
  const n = txt(en600, 'Nile', size, x0, M + 52), t = txt(en400, 'Therapy', size, x0 + nw + sp, M + 52);
  const aw = ar600.getAdvanceWidth('نايل', 26) + ar600.getAdvanceWidth('ثيرابي', 26) + 26 * 0.3;
  const a = arTxt(ar600, ['نايل', 'ثيرابي'], 26, (W + aw) / 2, M + 92);
  const col = (l, d) => mono || (dark ? d : l);
  return { w: Math.ceil(W), h: M + 104, svg: `${markG(key, (W - M) / 2, 0, M, { mono, c: dark && !mono ? { ...c, ...DARK[key] } : undefined })}<path d="${n.d}" fill="${col(c.nile, '#fff')}"/><path d="${t.d}" fill="${col(c.therapy, '#bfe6f0')}"/><path d="${a.d}" fill="${col(c.ar, '#a9c4cf')}"/>` };
}
// App icon: rounded tile, mark at 62% size (white tile reads cleanest on most phones).
function icon(key, { filled = false, size = 512 } = {}) {
  const c = P[key], rx = size * 0.225, m = size * 0.64;
  const bg = filled ? c.tile : '#ffffff';
  const inner = markG(key, (size - m) / 2, (size - m) / 2, m, filled ? { c: { ...c, ...DARK[key] } } : {});
  return { w: size, h: size, svg: `<rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>${inner}` };
}
const wrap = ({ w, h, svg }, pad = 0, bg = null) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}" width="${w + pad * 2}" height="${h + pad * 2}">${bg ? `<rect x="${-pad}" y="${-pad}" width="${w + pad * 2}" height="${h + pad * 2}" fill="${bg}"/>` : ''}${svg}</svg>`;

// ---------- write files ----------
const files = {};
for (const key of Object.keys(P)) {
  const dir = path.join(OUT, key); fs.mkdirSync(dir, { recursive: true });
  const put = (name, s) => { fs.writeFileSync(path.join(dir, name), s); files[key + '/' + name] = s; };
  put('mark.svg', wrap({ w: 100, h: 100, svg: markG(key, 0, 0, 100) }));
  put('logo-horizontal.svg', wrap(horizontal(key), 10));
  put('logo-horizontal-en.svg', wrap(horizontal(key, { arabic: false }), 10));
  put('logo-horizontal-white.svg', wrap(horizontal(key, { dark: true }), 10));
  put('logo-stacked.svg', wrap(stacked(key), 10));
  put('logo-one-color-black.svg', wrap(horizontal(key, { mono: '#111111' }), 10));
  put('logo-one-color-white.svg', wrap(horizontal(key, { mono: '#ffffff' }), 10));
  put('app-icon.svg', wrap(icon(key)));
  put('app-icon-filled.svg', wrap(icon(key, { filled: true })));
}

// ---------- board ----------
const inl = (o, pad = 0, bg = null) => wrap(o, pad, bg).replace(/width="[\d.]+" height="[\d.]+"/, '');
const sec = key => {
  const c = P[key];
  return `<section>
  <h2>${c.name}</h2>
  <div class="row">
    <div class="tile wide" style="background:#fff">${inl(horizontal(key), 10)}</div>
    <div class="tile" style="background:${c.bg}">${inl(stacked(key), 10)}</div>
  </div>
  <div class="row">
    <div class="tile wide" style="background:${c.dark}">${inl(horizontal(key, { dark: true }), 10)}</div>
    <div class="tile icons">
      <div class="phone">${['', '', key, '', key + 'f', '', '', ''].map(k => `<div class="app">${k === key ? inl(icon(key)) : k === key + 'f' ? inl(icon(key, { filled: true })) : '<i></i>'}<span>${k ? 'Nile Therapy' : ''}</span></div>`).join('')}</div>
    </div>
  </div>
  <div class="row small">
    <div class="tile" style="background:#fff">${inl(horizontal(key, { mono: '#111' }), 10)}</div>
    <div class="tile sizes" style="background:#fff">
      ${[16, 24, 32, 48, 64].map(s => `<span style="width:${s}px;height:${s}px">${inl({ w: 100, h: 100, svg: markG(key, 0, 0, 100) })}</span>`).join('')}
      <em>16 · 24 · 32 · 48 · 64 px</em></div>
    <div class="tile portal"><div class="side" style="background:linear-gradient(170deg,${c.dark},${c.b === '#ffffff' ? c.a : key === 'lotus' ? c.a : c.b})">${inl(horizontal(key, { dark: true, arabic: false }), 6)}<b>Overview</b><b>Sessions</b><b>Schedule</b></div></div>
  </div>
  <p class="swatches">${[c.a, c.b, c.c, c.d, c.snow].filter(x => x && x !== '#ffffff').map(x => `<span style="background:${x}"></span><code>${x}</code>`).join('')}</p>
</section>`;
};
fs.writeFileSync(path.join(OUT, 'board.html'), `<!doctype html><html><head><meta charset="utf-8"><title>Nile Therapy logo candidates</title>
<style>
body{margin:0;background:#f3f5f8;font:15px/1.5 system-ui,sans-serif;color:#1d2733;padding:32px}
h1{margin:0 0 6px;font-weight:600}h2{margin:40px 0 14px;font-weight:600}
.row{display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px}.row.small{grid-template-columns:1.3fr 1fr 1fr}
.tile{border-radius:18px;padding:28px;display:grid;place-items:center;min-height:150px;box-shadow:0 1px 2px #0001}
.tile svg{max-width:100%;max-height:180px}.wide svg{max-height:120px}.small svg{max-height:70px}
.icons{background:linear-gradient(160deg,#c9d6e3,#e8eef5)}.phone{display:grid;grid-template-columns:repeat(4,64px);gap:18px 16px}
.app{display:grid;justify-items:center;gap:4px}.app svg,.app i{width:56px;height:56px;border-radius:13px;display:block;box-shadow:0 2px 6px #0002}.app i{background:#ffffff88}
.app span{font-size:10px;height:13px;color:#334}
.sizes{display:flex;gap:14px;align-items:end;flex-wrap:wrap}.sizes span{display:block}.sizes svg{width:100%;height:100%}.sizes em{width:100%;font-size:12px;color:#667;text-align:center}
.portal{padding:0;overflow:hidden;place-items:stretch}.side{background:linear-gradient(170deg,#0f3a66,#1a5fa8);padding:16px;display:grid;gap:8px;align-content:start;color:#d6e4f2;font-size:13px}.side svg{height:34px;width:auto;margin-bottom:6px}
.swatches{display:flex;gap:8px;align-items:center}.swatches span{width:22px;height:22px;border-radius:6px;display:inline-block}.swatches code{margin-inline-end:14px;color:#556}
</style></head><body><h1>Nile Therapy logo candidates</h1><p>Marks on a 100-unit grid · Outfit (English) and Readex Pro (Arabic), converted to outlines · full color, white, one-color, app icon and small-size checks.</p>
${Object.keys(P).map(sec).join('')}</body></html>`);
console.log('built', Object.keys(files).length, 'files');
