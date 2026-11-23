// Horse portrait: head and neck in profile, facing left, from a CC0 photograph (see CREDITS.md).
// Output is a role buffer with the same characters as the race sprite (a-e coat, l-n mane, p-r
// silks for the halter, s/t outline, u eye), so the coat and silks classes of horse.css colour it.
//   needs $ART_REF/head_tb.png: "Head of a thoroughbred racehorse.jpg" (Wikimedia Commons, CC0)
//   converted to a 900 px wide PNG.
import { P, ref } from '../lib/env.js';
import { COATS, SILKS, tok } from '../lib/palette.js';

export const PW = 44,
  PH = 36,
  TOP = 3; // rows above the photo's top edge, for the ear tip the photo cuts off

// Outline of the head and neck in the photo, in a 300 px wide frame (photo is 900 by 675).
const HEAD = [
  [162, 0],
  [169, 26],
  [150, 40],
  [140, 55],
  [128, 70],
  [118, 85],
  [108, 100],
  [96, 118],
  [84, 135],
  [74, 150],
  [66, 163],
  [62, 172],
  [62, 185],
  [66, 198],
  [74, 206],
  [82, 211],
  [94, 213],
  [106, 208],
  [122, 202],
  [142, 194],
  [166, 185],
  [188, 176],
  [204, 168],
  [220, 190],
  [238, 225],
  [300, 225],
  [300, 72],
  [270, 55],
  [240, 42],
  [215, 32],
  [200, 24],
  [190, 14],
  [186, 0],
];
// Cheek strap of the bridle: drawn again as a halter in the owner's silks colours.
const STRAP = [
  [214, 30],
  [176, 94],
  [150, 134],
  [128, 160],
  [113, 172],
];
// Crest of the neck where the mane lies, and the forelock between the ears.
const CREST = [
  [186, 4],
  [205, 24],
  [240, 40],
  [270, 53],
  [300, 70],
];
const FORELOCK = [
  [150, 38],
  [175, 30],
  [178, 55],
  [155, 55],
];
const EYE = [140, 82];

const segD = (x, y, pts) => {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++)
    best = Math.min(
      best,
      Math.sqrt(P.segDist2(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])),
    );
  return best;
};

const ROLE = 'abcdefghijklmnopqrstu';
export const roleCol = (r) => P.col([ROLE.indexOf(r) * 11 + 5, 90, 200]);
const ROLE_OF = new Map([...ROLE].map((r) => [roleCol(r), r]));
export const roleOf = (c) => ROLE_OF.get(c >>> 0);

/** Role buffer of the portrait, PW by PH, facing left. */
export function portrait() {
  const src = P.load(ref('head_tb.png'));
  const k = src.w / 300; // photo pixels per frame unit
  const S = 300 / PW; // frame units per art pixel
  const cells = [];
  for (let j = 0; j < PH - TOP; j++)
    for (let i = 0; i < PW; i++) {
      let n = 0,
        inside = 0,
        lum = 0,
        strap = 0,
        dark = 0;
      for (let v = 0; v < 6; v++)
        for (let u = 0; u < 6; u++) {
          const fx = (i + (u + 0.5) / 6) * S,
            fy = (j + (v + 0.5) / 6) * S;
          n++;
          if (!P.inPoly(fx, fy, HEAD)) continue;
          inside++;
          const c = src.get(
            Math.min(src.w - 1, Math.floor(fx * k)),
            Math.min(src.h - 1, Math.floor(fy * k)),
          );
          const [r, g, b] = P.unpack(c);
          const l = 0.3 * r + 0.59 * g + 0.11 * b;
          if (segD(fx, fy, STRAP) < 5 && l < 70) {
            strap++; // painted over below, the halter is drawn as clean lines
            continue;
          }
          if (l < 60) dark++;
          lum += l;
        }
      if (inside / n < 0.5) continue;
      const coatN = inside - strap;
      cells.push({
        i,
        j: j + TOP,
        lum: coatN ? lum / coatN : 0,
        strap: strap === inside,
        dark: coatN ? dark / coatN : 0,
        fx: (i + 0.5) * S,
        fy: (j + 0.5) * S,
      });
    }
  // coat shading: spread the photo's light over the five coat steps
  const ls = cells
    .filter((c) => !c.strap && c.dark < 0.5)
    .map((c) => c.lum)
    .sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.04)],
    hi = ls[Math.floor(ls.length * 0.97)];
  const b = new P.Buf(PW, PH);
  for (const c of cells) {
    let r;
    const onCrest = segD(c.fx, c.fy, CREST) < 12;
    const forelock = P.inPoly(c.fx, c.fy, FORELOCK) && c.lum < lo + (hi - lo) * 0.45;
    if (c.strap) r = 'c';
    else if (onCrest || forelock) {
      const v = P.clamp((c.lum - 15) / 70);
      r = 'lmn'[P.band(v, 3, c.i, c.j, 0.3)];
    } else {
      const v = P.clamp((c.lum - lo) / (hi - lo));
      r = 'abcde'[P.band(v, 5, c.i, c.j, 0.3)];
    }
    b.pset(c.i, c.j, roleCol(r));
  }
  // halter in the silks colours: cheek piece from behind the ear down to the noseband
  const line = (pts, role) => {
    const m = new Uint8Array(PW * PH);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i].map((v) => v / S),
        [bx, by] = pts[i + 1].map((v) => v / S);
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
      for (let t = 0; t <= n; t++) {
        const x = Math.round(ax + ((bx - ax) * t) / n),
          y = Math.round(ay + ((by - ay) * t) / n) + TOP;
        if (x >= 0 && y >= 0 && x < PW && y < PH) m[y * PW + x] = 1;
      }
    }
    const pm = P.pixelPerfect(m, PW, PH);
    for (let i = 0; i < pm.length; i++) if (pm[i] && b.px[i] >>> 24) b.px[i] = roleCol(role);
  };
  line(
    [
      [208, 30],
      [170, 96],
      [120, 166],
    ],
    'q',
  );
  line(
    [
      [90, 128],
      [106, 150],
      [126, 168],
      [134, 196],
    ],
    'q',
  );
  // lit pixel on the upper left side of each strap pixel
  for (let y = PH - 1; y > 0; y--)
    for (let x = 1; x < PW; x++)
      if (roleOf(b.get(x, y)) === 'q') {
        const up = roleOf(b.get(x, y - 1));
        if (up && 'abcde'.includes(up)) b.pset(x, y - 1, roleCol('r'));
      }
  // ear tip above the photo's edge: a narrow point
  const earX = Math.round(172 / S);
  b.pset(earX, 0, roleCol('c'));
  b.pset(earX, 1, roleCol('d'));
  b.pset(earX + 1, 1, roleCol('c'));
  for (let x = earX - 1; x <= earX + 1; x++) b.pset(x, 2, roleCol(x === earX - 1 ? 'd' : 'c'));
  // eye: two dark pixels with a light one above
  const ex = Math.round(EYE[0] / S),
    ey = Math.round(EYE[1] / S) + TOP;
  b.pset(ex - 1, ey, roleCol('t'));
  b.pset(ex, ey, roleCol('t'));
  b.pset(ex - 1, ey - 1, roleCol('a'));
  return b;
}

/** Outline in the coat's own colours (lit toward the top left), as the race sprite. */
export function withOutline(b) {
  const o = new P.Buf(b.w, b.h);
  o.px.set(b.px);
  const at = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && b.px[y * b.w + x] >>> 24;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (at(x, y)) continue;
      const r = at(x + 1, y),
        d = at(x, y + 1),
        l = at(x - 1, y),
        u = at(x, y - 1);
      if (!(r || d || l || u)) continue;
      o.pset(x, y, roleCol(r || d ? 's' : 't'));
    }
  return o;
}

/** Colour a role buffer as one coat and silks (the same mapping as horse.css). */
export function colour(b, coatKey, silks = 'blue') {
  const c = COATS[coatKey],
    darkLegs = !!c.points || coatKey === 'aoge';
  const lo = darkLegs ? 0 : 1;
  const v = {};
  'abcde'.split('').forEach((r, i) => (v[r] = c.body[i]));
  for (let k = 0; k < 3; k++) v['lmn'[k]] = c.mane[Math.min(4, lo + 1 + k)];
  ['p', 'q', 'r'].forEach((r, i) => (v[r] = SILKS[silks][i]));
  v.s = coatKey === 'aoge' ? 'neutral-35' : c.body[2];
  v.t = c.points || coatKey === 'aoge' || coatKey === 'tochiguri' ? 'neutral-4' : c.body[0];
  v.u = 'neutral-65';
  const o = new P.Buf(b.w, b.h);
  for (let i = 0; i < b.px.length; i++) {
    const r = roleOf(b.px[i]);
    if (r) o.px[i] = P.col(tok(v[r]));
  }
  return o;
}
