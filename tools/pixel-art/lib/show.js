import { P } from './env.js';
import { tok } from './palette.js';

/** A buffer on a flat colour, scaled up (so sprites can be judged on navy and on cream). */
function onBg(buf, bg, scale = 1, pad = 0) {
  const out = new P.Buf((buf.w + pad * 2) * scale, (buf.h + pad * 2) * scale);
  const c = P.col(bg);
  out.px.fill(c);
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++) {
      const px = buf.px[y * buf.w + x];
      if (!(px >>> 24)) continue;
      for (let j = 0; j < scale; j++)
        for (let i = 0; i < scale; i++)
          out.px[((y + pad) * scale + j) * out.w + (x + pad) * scale + i] = px;
    }
  return out;
}
const NAVY = tok('neutral-10'),
  CREAM = tok('paper-96');
/** Two backgrounds side by side. */
function pair(buf, scale, pad = 2) {
  const a = onBg(buf, NAVY, scale, pad),
    b = onBg(buf, CREAM, scale, pad);
  const o = new P.Buf(a.w + b.w, a.h);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) o.px[y * o.w + x] = a.px[y * a.w + x];
    for (let x = 0; x < b.w; x++) o.px[y * o.w + a.w + x] = b.px[y * b.w + x];
  }
  return o;
}
/** Paste src into dst at (x, y) (opaque pixels only). */
function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const px = src.px[y * src.w + x];
      if (px >>> 24) {
        const X = x0 + x,
          Y = y0 + y;
        if (X >= 0 && Y >= 0 && X < dst.w && Y < dst.h) dst.px[Y * dst.w + X] = px;
      }
    }
}
export { onBg, pair, paste, NAVY, CREAM };
