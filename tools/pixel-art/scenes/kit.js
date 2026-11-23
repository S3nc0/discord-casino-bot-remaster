// Shared helpers for the scene art: every pixel is a palette token, a scene is drawn once per theme
// (light = day, dark = night) by the same code with another palette, and the two buffers are
// encoded together as row strings plus a legend `char -> [light token, dark token]`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P } from '../lib/env.js';
import { tok, HEX } from '../lib/palette.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Packed colour of a token. */
export const T = (name) => P.col(tok(name));
/** [r, g, b] arrays of tokens, for the core's ramp arguments. */
export const R = (names) => names.map(tok);

const BY = new Map();
for (const name of Object.keys(HEX)) {
  const c = P.col(tok(name));
  if (!BY.has(c)) BY.set(c, name);
}
/** Token name of a packed colour (exact match), or undefined. */
export const tokenOf = (c) => BY.get(c >>> 0);

/** Every colour in a palette object (packed numbers or [r, g, b] arrays, nested in lists). */
export function colsOf(p) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'number') out.push(v >>> 0);
    else if (
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((n) => typeof n === 'number' && n <= 255)
    )
      out.push(P.col(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(p);
  return [...new Set(out)];
}

/** Map every opaque pixel that is not one of `cols` (packed) to the nearest of them (after blends). */
export function snap(buf, cols) {
  const set = new Set(cols.map((c) => c >>> 0));
  const pal = cols.map((c) => P.unpack(c));
  for (let i = 0; i < buf.px.length; i++) {
    const c = buf.px[i];
    if (!(c >>> 24) || set.has(c >>> 0)) continue;
    const [r, g, b] = P.unpack(c);
    let best = 0,
      bd = 1e9;
    pal.forEach(([R2, G, B], k) => {
      const d = (r - R2) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11;
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    buf.px[i] = P.col(pal[best]);
  }
  return buf;
}

const CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-/:;<=>?@[]^_{|}~';

/**
 * Encode one picture (or a list of same-size frames) drawn per theme. `light` and `dark` are a
 * Buf or an array of Bufs. Returns { w, h, frames: string[][], legend: { ch: [light, dark] } }.
 */
export function encode(light, dark = light) {
  const L = Array.isArray(light) ? light : [light],
    D = Array.isArray(dark) ? dark : [dark];
  const { w, h } = L[0];
  const combos = new Map();
  const frames = L.map((lb, f) => {
    const db = D[f];
    const rows = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        const a = lb.px[y * w + x],
          b = db.px[y * w + x];
        const ao = a >>> 24,
          bo = b >>> 24;
        if (!ao && !bo) {
          row += '.';
          continue;
        }
        if (!ao || !bo) throw new Error(`pixel ${x},${y} is opaque in one theme only`);
        const ka = tokenOf(a),
          kb = tokenOf(b);
        if (!ka || !kb) throw new Error(`pixel ${x},${y} is not a palette token`);
        const key = `${ka}|${kb}`;
        if (!combos.has(key)) {
          if (combos.size >= CHARS.length)
            throw new Error(`more than ${CHARS.length} colour pairs`);
          combos.set(key, CHARS[combos.size]);
        }
        row += combos.get(key);
      }
      rows.push(row);
    }
    return rows;
  });
  const legend = {};
  for (const [key, ch] of combos) legend[ch] = key.split('|');
  return { w, h, frames, legend };
}

/** Back to a buffer, for previews of what ships. */
export function decode(art, theme = 'light', frame = 0) {
  const b = new P.Buf(art.w, art.h);
  const k = theme === 'dark' ? 1 : 0;
  art.frames[frame].forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.') b.px[y * art.w + x] = T(art.legend[ch][k]);
    }),
  );
  return b;
}

/** Draw `fn(theme)` for both themes and encode. */
export const themed = (fn) => encode(fn('light'), fn('dark'));

/** TypeScript source for a set of encoded pictures. */
export function tsModule(header, arts) {
  const lines = [`/**\n${header.map((l) => ` * ${l}`).join('\n')}\n */`];
  lines.push(`import type { SceneArt } from '@casino/ui';`, '');
  for (const [name, art] of Object.entries(arts)) {
    lines.push(`export const ${name}: SceneArt = {`);
    lines.push(`  w: ${art.w},`, `  h: ${art.h},`);
    lines.push(`  legend: {`);
    for (const [ch, [l, d]] of Object.entries(art.legend))
      lines.push(`    ${ch}: ['${l}', '${d}'],`);
    lines.push(`  },`);
    lines.push(`  frames: [`);
    for (const rows of art.frames) {
      lines.push(`    [`);
      for (const r of rows) lines.push(`      '${r}',`);
      lines.push(`    ],`);
    }
    lines.push(`  ],`, `};`, '');
  }
  return lines.join('\n');
}

export function writeTs(rel, header, arts) {
  const file = path.join(ROOT, rel);
  fs.writeFileSync(file, tsModule(header, arts));
  return file;
}

/** Copy `src` onto `dst` at (x, y), opaque pixels only, optionally mirrored. */
export function paste(dst, src, x0, y0, flip = false) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const c = src.px[y * src.w + (flip ? src.w - 1 - x : x)];
      if (!(c >>> 24)) continue;
      const X = x0 + x,
        Y = y0 + y;
      if (X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.px[Y * dst.w + X] = c;
    }
  return dst;
}

/** Mirror a buffer left to right. */
export function flipX(src) {
  const b = new P.Buf(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) b.px[y * src.w + x] = src.px[y * src.w + src.w - 1 - x];
  return b;
}

/** Fill a buffer with one colour. */
export function fill(buf, c) {
  buf.px.fill(typeof c === 'number' ? c : P.col(c));
  return buf;
}

/** Shade value 0..1 into a list of packed colours, flat bands with a thin dither strip. */
export const pick = (ramp, v, x, y, strip = 0.25) =>
  ramp[P.band(P.clamp(v), ramp.length, x, y, strip)];

/** A list of packed token colours. */
export const C = (names) => names.map(T);

/** Outline on the outside of the opaque pixels: lit colour toward the top left, shade elsewhere. */
export function selout(buf, lit, shade) {
  const o = new P.Buf(buf.w, buf.h);
  o.px.set(buf.px);
  const at = (x, y) => x >= 0 && y >= 0 && x < buf.w && y < buf.h && buf.px[y * buf.w + x] >>> 24;
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      if (at(x, y)) continue;
      const r = at(x + 1, y),
        d = at(x, y + 1),
        l = at(x - 1, y),
        u = at(x, y - 1);
      if (!(r || d || l || u)) continue;
      o.px[y * buf.w + x] = r || d ? lit : shade;
    }
  return o;
}
