// Writes the app icon PNGs: docs/images/app-icon-512.png (Discord Developer Portal) and
// apps/web/public/favicon-32.png, favicon-16.png (Activity favicons). Set ART_OUT to also write
// preview images and sheet. Run from the repo root:
//   node tools/pixel-art/app-icon/build.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { P, OUT, out } from '../lib/env.js';
import { Hi, selectiveOutline } from '../lib/hi.js';
import { mat, tok } from '../lib/palette.js';

const N = 32;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---- background tile: rounded square, night sky bands, stars, skyline
function background() {
  const b = new P.Buf(N, N);
  const sky = ['neutral-10', 'neutral-13', 'neutral-16', 'blue-20'].map(tok);
  const r = 5;
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x + 0.5, r), N - r);
    const cy = Math.min(Math.max(y + 0.5, r), N - r);
    return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      if (!inside(x, y)) continue;
      const v = y / (N - 1);
      b.pset(x, y, sky[P.band(v, sky.length, x, y, 0.08)]);
    }
  const star = tok('yellow-90');
  const dim = tok('neutral-40');
  for (const [x, y, c] of [
    [5, 4, star],
    [26, 3, dim],
    [22, 7, dim],
    [3, 11, dim],
    [28, 12, star],
  ])
    b.pset(x, y, c);
  // skyline
  const bld = tok('neutral-4');
  const win = tok('yellow-70');
  const tops = [
    27, 25, 26, 23, 26, 24, 27, 25, 22, 26, 25, 27, 24, 26, 25, 23, 26, 27, 24, 26, 25, 27, 26, 24,
    25, 27, 26, 23, 25, 26, 27, 26,
  ];
  for (let x = 0; x < N; x++) for (let y = tops[x]; y < N; y++) if (inside(x, y)) b.pset(x, y, bld);
  for (const [x, y] of [
    [3, 25],
    [8, 26],
    [9, 24],
    [15, 25],
    [16, 27],
    [27, 25],
    [24, 27],
  ])
    if (inside(x, y)) b.pset(x, y, win);
  return b;
}

// ---- foreground: die (left, tilted) and Pelica coin (right), same materials and light as the game icons
function objects() {
  const hi = new Hi(N, N);
  const part = (m, o) => hi.part(typeof m === 'string' ? mat(m) : m, o);
  // die in 3/4 view: lit top face, front face with the big red pip, darker right face with two pips
  const F = part('paper', { bevel: true, steps: [2, 3, 3] });
  const T = part('paper', { fixed: 4 });
  const R = part('paper', { fixed: 1 });
  const x0 = 3;
  const y0 = 9.5;
  const w = 13;
  const h = 13;
  const dx = 4.5;
  const dy = 4.5;
  hi.poly(T, [
    [x0, y0],
    [x0 + dx, y0 - dy],
    [x0 + w + dx, y0 - dy],
    [x0 + w, y0],
  ]);
  hi.poly(R, [
    [x0 + w, y0],
    [x0 + w + dx, y0 - dy],
    [x0 + w + dx, y0 + h - dy],
    [x0 + w, y0 + h],
  ]);
  hi.rect(F, x0, y0, w, h);
  const red = part('red', { round: 1.2, steps: [1, 2, 3] });
  hi.ellipse(red, x0 + w / 2, y0 + h / 2, 2.6, 2.6);
  const ink = part('ink', { fixed: 2 });
  hi.ellipse(ink, x0 + w + dx * 0.3, y0 + h * 0.28, 0.75, 1.1);
  hi.ellipse(ink, x0 + w + dx * 0.72, y0 + h * 0.62 - dy * 0.4, 0.75, 1.1);
  // coin, bottom right, overlapping the die
  const cx = 23.5;
  const cy = 22.5;
  const cr = 7.4;
  const rim = part('gold', { round: 2.6, steps: [0, 1, 2] });
  const face = part('gold', { round: 1.6, steps: [1, 2, 3] });
  hi.ellipse(rim, cx, cy, cr, cr);
  hi.ellipse(face, cx, cy, cr * 0.74, cr * 0.74);
  const mark = part('gold', { fixed: 0 });
  hi.cells(
    Math.round(cx) - 3,
    Math.round(cy) - 4,
    ['PPPP.', 'P...P', 'P...P', 'PPPP.', 'P....', 'P....', 'P....'].map((r) =>
      r.replace(/P/g, '#'),
    ),
    { '#': mark },
  );
  const { buf, owner } = hi.render({ cover: 0.5 });
  return selectiveOutline(buf, owner, hi.parts);
}

/** Build the 32x32 app icon buffer using only Bitbloom palette tokens. */
export function buildIcon() {
  const bg = background();
  const fg = objects();
  const icon = new P.Buf(N, N);
  for (let i = 0; i < N * N; i++) icon.px[i] = bg.px[i];
  // a one-pixel dark drop shadow under the objects, then the objects
  const shadow = P.col(tok('neutral-4'));
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const a = fg.px[y * fg.w + x];
      if (
        a >>> 24 &&
        x + 1 < N &&
        y + 1 < N &&
        bg.px[(y + 1) * N + x + 1] >>> 24 &&
        !(fg.px[(y + 1) * fg.w + x + 1] >>> 24)
      ) {
        icon.px[(y + 1) * N + x + 1] = shadow;
      }
    }
  for (let y = 0; y < Math.min(N, fg.h); y++)
    for (let x = 0; x < Math.min(N, fg.w); x++) {
      const a = fg.px[y * fg.w + x];
      if (a >>> 24) icon.px[y * N + x] = a;
    }
  // sparkle on the coin's top-left rim
  const spark = tok('paper-99');
  for (const [x, y] of [
    [26, 9],
    [25, 10],
    [27, 10],
    [26, 11],
    [26, 8],
    [26, 12],
    [24, 10],
    [28, 10],
  ])
    icon.pset(x, y, spark);
  return icon;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const icon = buildIcon();
  const favicon16 = P.resize(icon, 16, 16, { mode: true });

  const icon512Path = path.join(root, 'docs/images/app-icon-512.png');
  const publicDir = path.join(root, 'apps/web/public');
  fs.mkdirSync(path.dirname(icon512Path), { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  P.save(icon.scaled(16), icon512Path);
  P.save(icon, path.join(publicDir, 'favicon-32.png'));
  P.save(favicon16, path.join(publicDir, 'favicon-16.png'));

  if (process.env.ART_OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    P.save(icon, out('app-icon-32.png'));
    P.save(favicon16, out('app-icon-16.png'));
    const cream = new P.Buf(N + 8, N + 8);
    cream.rect(0, 0, N + 8, N + 8, tok('paper-96'));
    cream.sprite(icon, 4, 4);
    const dark = new P.Buf(N + 8, N + 8);
    dark.rect(0, 0, N + 8, N + 8, tok('neutral-17'));
    dark.sprite(icon, 4, 4);
    P.save(
      P.sheet([
        { buf: icon, label: '512 PREVIEW', scale: 8 },
        { buf: icon, label: '1X', scale: 1 },
        { buf: icon, label: '2X', scale: 2 },
        { buf: dark, label: 'ON DARK', scale: 3 },
        { buf: cream, label: 'ON LIGHT', scale: 3 },
      ]),
      out('app-icon-sheet.png'),
    );
  }
  console.log('app-icon written: 512x512, favicon-32.png, favicon-16.png');
}
