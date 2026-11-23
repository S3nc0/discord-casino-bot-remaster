// Scene painter for the finance screens. A scene is drawn twice, once for the light theme ("day")
// and once for the dark theme ("night"), with the same shapes and only the colours swapped, so the
// shipped data can name each pixel by its (day, night) pair of palette tokens. Every pixel holds a
// token name (see design/bitbloom/tokens.css), never a raw colour. One light, from the top left.
import { P } from '../lib/env.js';
import { HEX, tok } from '../lib/palette.js';
import { selectiveOutline } from '../lib/hi.js';

const RGB2TOK = new Map();
for (const [name, hex] of Object.entries(HEX)) {
  const key = P.col([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  if (!RGB2TOK.has(key)) RGB2TOK.set(key, name);
}

class Scene {
  constructor(w, h, theme = 'day') {
    this.w = w;
    this.h = h;
    this.theme = theme;
    this.tk = new Array(w * h).fill(null);
  }
  /** Pick the day or the night value. */
  D(day, night) {
    return this.theme === 'day' ? day : night;
  }
  set(x, y, t) {
    x = Math.round(x);
    y = Math.round(y);
    if (t && x >= 0 && y >= 0 && x < this.w && y < this.h) this.tk[y * this.w + x] = t;
    return this;
  }
  get(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.tk[y * this.w + x] : null;
  }
  rect(x, y, w, h, t) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, t);
    return this;
  }
  hl(x, y, w, t) {
    return this.rect(x, y, w, 1, t);
  }
  vl(x, y, h, t) {
    return this.rect(x, y, 1, h, t);
  }
  frame(x, y, w, h, t) {
    this.hl(x, y, w, t).hl(x, y + h - 1, w, t);
    return this.vl(x, y, h, t).vl(x + w - 1, y, h, t);
  }
  /** A raised box: lit top and left edge, shaded bottom and right edge. `r` is [shade, base, lit]. */
  bevel(x, y, w, h, [shade, base, lit]) {
    this.rect(x, y, w, h, base);
    this.hl(x, y, w, lit).vl(x, y, h, lit);
    this.hl(x, y + h - 1, w, shade).vl(x + w - 1, y, h, shade);
    return this;
  }
  /** A sunken box (a recess): shade on top and left, lit on bottom and right. */
  inset(x, y, w, h, [shade, base, lit]) {
    this.rect(x, y, w, h, base);
    this.hl(x, y + h - 1, w, lit).vl(x + w - 1, y, h, lit);
    this.hl(x, y, w, shade).vl(x, y, h, shade);
    return this;
  }
  /** Every other pixel (checker), for a dither strip. `odd` picks the other half. */
  checker(x, y, w, h, t, odd = 0) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) if ((x + i + y + j + odd) % 2 === 0) this.set(x + i, y + j, t);
    return this;
  }
  /** Flat horizontal bands top to bottom, each a token; one checker row where two bands meet. */
  vbands(x, y, w, h, tokens, strip = true) {
    const n = tokens.length;
    for (let j = 0; j < h; j++) {
      const k = Math.min(n - 1, Math.floor((j / h) * n));
      this.hl(x, y + j, w, tokens[k]);
    }
    if (strip)
      for (let k = 1; k < n; k++) {
        const j = Math.floor((k / n) * h);
        this.checker(x, y + j, w, 1, tokens[k - 1]);
      }
    return this;
  }
  /** Bresenham line, pixel perfect (no L corners). */
  line(x0, y0, x1, y1, t) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0),
      sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.set(x0, y0, t);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y0 += sy;
      }
    }
    return this;
  }
  disc(cx, cy, r, t) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, t);
    return this;
  }
  /** Pixel rows: one character per pixel, `.` or space empty, others looked up in `map`. */
  rows(x, y, rows, map) {
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (map[ch]) this.set(x + i, y + j, map[ch]);
      }),
    );
    return this;
  }
  /** 3 by 5 pixel letters and digits (the kit font). */
  text(x, y, str, t) {
    [...String(str).toUpperCase()].forEach((ch, k) => {
      const g = P.FONT[ch];
      if (!g) return;
      for (let i = 0; i < 15; i++)
        if (g[i] === '1') this.set(x + k * 4 + (i % 3), y + Math.floor(i / 3), t);
    });
    return this;
  }
  /** Paste a Hi drawing (lit shapes, see lib/hi.js) rendered into cells. */
  hi(hi, x, y, opt = {}) {
    const { buf, owner } = hi.render({ cover: opt.cover ?? 0.5 });
    const b = opt.outline === false ? buf : selectiveOutline(buf, owner, hi.parts);
    return this.buf(b, x, y);
  }
  /** Paste an RGB buffer whose colours are palette tokens. */
  buf(b, x, y) {
    for (let j = 0; j < b.h; j++)
      for (let i = 0; i < b.w; i++) {
        const px = b.px[j * b.w + i];
        if (!(px >>> 24)) continue;
        const t = RGB2TOK.get(px);
        if (!t) throw new Error(`colour at ${i},${j} is not a palette token`);
        this.set(x + i, y + j, t);
      }
    return this;
  }
  /** The scene as an RGB buffer (empty pixels clear). */
  toBuf() {
    const b = new P.Buf(this.w, this.h);
    for (let i = 0; i < this.tk.length; i++) if (this.tk[i]) b.px[i] = P.col(tok(this.tk[i]));
    return b;
  }
}

/** Draw `fn(scene)` for both themes. */
function both(w, h, fn) {
  const day = new Scene(w, h, 'day'),
    night = new Scene(w, h, 'night');
  fn(day);
  fn(night);
  for (let i = 0; i < w * h; i++)
    if (!day.tk[i] !== !night.tk[i])
      throw new Error(`pixel ${i % w},${Math.floor(i / w)} differs in shape`);
  return { day, night };
}

export { Scene, both, RGB2TOK, P, tok };
