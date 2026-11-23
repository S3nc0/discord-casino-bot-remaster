// README art: the pixel banner and the small pixel game icons, drawn from the same pixel data
// and Bitbloom (round 2) tones the Activity uses. No server needed. The horse gallop gif is made
// by tools/pixel-art/horse/readme.js.
//
//   node scripts/readme-art.mjs [outDir]      (default: ../../docs/images/readme)
//
// Writes <outDir>/banner.png, <outDir>/icons/<name>.svg and <outDir>/badges/<name>.svg. Set CHROME_PATH when Chrome is not
// at the macOS default.
/* global console, document */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from 'playwright-core';
import { GAME_ICON_ROWS, ICON_LEGEND, SKYLINE_ROWS } from '../../../packages/ui/src/pixel/art.ts';
import { rowsToPaths } from '../../../packages/ui/src/pixel/paths.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = resolve(process.argv[2] ?? join(here, '../../../docs/images/readme'));
mkdirSync(join(out, 'icons'), { recursive: true });
mkdirSync(join(out, 'badges'), { recursive: true });
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Icon tones: each icon character is a palette step (ICON_LEGEND), resolved against the Bitbloom
// tokens, so the README icons are the same art and colours as the app.
const tokensCss = readFileSync(join(here, '../../../design/bitbloom/tokens.css'), 'utf8');
const TOKEN_HEX = {};
for (const m of tokensCss.matchAll(/--([a-z]+-\d+):\s*(#[0-9a-fA-F]{6})/g)) {
  if (!(m[1] in TOKEN_HEX)) TOKEN_HEX[m[1]] = m[2];
}
const ICON_TONES = Object.fromEntries(
  Object.entries(ICON_LEGEND).map(([char, token]) => [char, TOKEN_HEX[token]]),
);
const SKY_TONES = { s: '#f0e2b9', m: '#f0e2b9', f: '#131c2b', n: '#0d1625', v: '#dfc738' };

function paths(rows, tones) {
  return rowsToPaths(rows)
    .map(([key, d]) => `<path fill="${tones[key]}" d="${d}"/>`)
    .join('');
}

function iconSvg(name, px = 16) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${px}" height="${px}" ` +
    `shape-rendering="crispEdges">${paths(GAME_ICON_ROWS[name], ICON_TONES)}</svg>`
  );
}

for (const name of Object.keys(GAME_ICON_ROWS)) {
  writeFileSync(join(out, 'icons', `${name}.svg`), `${iconSvg(name)}\n`);
}

// Flat badges drawn here so the README needs no outside badge host (CI uses GitHub's own badge).
function badgeSvg(label, value, color) {
  const lw = label.length * 7 + 12;
  const vw = value.length * 7 + 12;
  const w = lw + vw;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${value}">` +
    `<rect width="${lw}" height="20" fill="#202839"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>` +
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" font-weight="700">` +
    `<text x="6" y="14" textLength="${label.length * 7}" lengthAdjust="spacingAndGlyphs">${label}</text>` +
    `<text x="${lw + 6}" y="14" textLength="${value.length * 7}" lengthAdjust="spacingAndGlyphs">${value}</text></g></svg>\n`
  );
}
const BADGES = {
  license: ['license', 'MIT', '#216c26'],
  node: ['node', '24', '#216c26'],
  activity: ['Discord', 'Activity', '#1981a4'],
  typescript: ['made with', 'TypeScript', '#6b5f09'],
};
for (const [name, [label, value, color]] of Object.entries(BADGES)) {
  writeFileSync(join(out, 'badges', `${name}.svg`), badgeSvg(label, value, color));
}

const font = readFileSync(
  join(here, '../../../packages/ui/node_modules/@fontsource/pixelify-sans/files') +
    '/pixelify-sans-latin-700-normal.woff2',
).toString('base64');

const SCALE = 8;
const W = 1280;
const H = 400;
const skyW = 96 * SCALE;
const skyH = SKYLINE_ROWS.length * SCALE;
const BANNER_ICONS = ['dice', 'slots', 'cards', 'roulette', 'horse', 'coin', 'crown'];
const iconRow = BANNER_ICONS.map((n) => `<div class="ic">${iconSvg(n, 80)}</div>`).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Px;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:700}
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;position:relative;font-family:Px,monospace;
 background:linear-gradient(#0d1625 0,#16203a 55%,#202839 100%)}
.sky{position:absolute;left:0;right:0;bottom:0;height:${skyH}px;
 background:url("data:image/svg+xml;utf8,${encodeURIComponent(
   `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 ${SKYLINE_ROWS.length}' width='${skyW}' height='${skyH}' shape-rendering='crispEdges'>${paths(SKYLINE_ROWS, SKY_TONES)}</svg>`,
 )}") repeat-x left bottom/${skyW}px ${skyH}px}
.stars{position:absolute;inset:0 0 ${skyH}px 0}
.title{position:absolute;top:34px;left:0;right:0;text-align:center;line-height:1;letter-spacing:2px}
.t1{font-size:92px;color:#dfc738;text-shadow:5px 5px 0 #a49113}
.t2{font-size:64px;color:#80db7c;text-shadow:4px 4px 0 #216c26;margin-top:6px}
.tag{position:absolute;top:218px;left:0;right:0;text-align:center;font-size:24px;color:#71d2fc;letter-spacing:1px}
.icons{position:absolute;left:0;right:0;bottom:${skyH - 44}px;display:flex;justify-content:center;gap:34px}
.ic{display:block;filter:drop-shadow(0 4px 0 rgba(13,22,37,.8))}
.ic svg{display:block}
</style>
<div class="stars"></div>
<div class="title"><div class="t1">Discord Casino</div><div class="t2">Remaster</div></div>
<div class="tag">play-money pixel casino · Discord Activity + chat bot</div>
<div class="sky"></div>
<div class="icons">${iconRow}</div>`;

const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, 'banner.png') });
} finally {
  await browser.close();
}
console.log(`banner and ${Object.keys(GAME_ICON_ROWS).length} icons in ${out}`);
