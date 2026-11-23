// Quiz answer effects, 24 by 24, four frames each; the last frame is the still one (reduced
// motion shows only it). Right: a green ring that opens with sparks. Wrong: a red cross that
// shakes and settles.
import { P, C, set } from './kit.js';

const S = 24;

function ring(b, r, w, cols) {
  const [lit, mid, dark] = cols.map(C);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x - 11.5,
        dy = y - 11.5,
        d = Math.hypot(dx, dy);
      if (d > r || d < r - w) continue;
      const outer = d > r - 1,
        inner = d < r - w + 1;
      const facing = dx + dy < 0;
      set(b, x, y, outer ? (facing ? lit : dark) : inner ? (facing ? dark : lit) : mid);
    }
}

function spark(b, x, y, big) {
  const c = C('amber-60'),
    k = C('yellow-90');
  set(b, x, y, k);
  for (let i = 1; i <= (big ? 2 : 1); i++) {
    set(b, x + i, y, c);
    set(b, x - i, y, c);
    set(b, x, y + i, c);
    set(b, x, y - i, c);
  }
}

function right() {
  const out = [];
  const R = [6, 9, 11, 11];
  for (let f = 0; f < 4; f++) {
    const b = new P.Buf(S, S);
    ring(b, R[f], f === 0 ? 3 : 4, ['green-80', 'green-60', 'green-30']);
    if (f === 1 || f === 2) {
      const d = f === 1 ? 10 : 11;
      for (const [a, big] of [
        [-2.4, true],
        [-0.6, false],
        [0.9, true],
        [2.4, false],
      ])
        spark(b, Math.round(11.5 + Math.cos(a) * d), Math.round(11.5 + Math.sin(a) * d), big && f === 1);
    }
    if (f === 3) spark(b, 4, 4, false);
    out.push(b);
  }
  return out;
}

function cross(b, dx, size) {
  const lit = C('red-70'),
    mid = C('red-50'),
    dark = C('red-30');
  const c = 11.5 + dx;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x - c,
        v = y - 11.5;
      if (Math.max(Math.abs(u), Math.abs(v)) > size) continue;
      const a = Math.abs(u - v),
        bb = Math.abs(u + v);
      const on = a <= 2.2 || bb <= 2.2;
      if (!on) continue;
      const edgeA = a > 1.2 && a <= 2.2,
        edgeB = bb > 1.2 && bb <= 2.2;
      const onA = a <= 2.2,
        onB = bb <= 2.2;
      let col = mid;
      if ((onA && edgeA && !onB) || (onB && edgeB && !onA)) col = u + v < 0 || u - v < 0 ? lit : dark;
      set(b, x, y, col);
    }
}

function wrong() {
  const out = [];
  const shake = [0, -2, 2, 0],
    size = [6, 9, 9, 9];
  for (let f = 0; f < 4; f++) {
    const b = new P.Buf(S, S);
    cross(b, shake[f], size[f]);
    out.push(b);
  }
  return out;
}

export function preview() {
  return [...right(), ...wrong()];
}

export { right, wrong, S };
