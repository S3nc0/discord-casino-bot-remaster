// Relics: a museum hall. Six glass display cases on plinths under ceiling lamps, one per relic
// kind. A relic the player owns stands in its case with a rarity glow (by its best star level);
// one not found yet shows as a dark silhouette. The relic sprites are the ones from the labor
// screen's finds (loaded from `$ART_REF/relics/find_relic_<kind>.png` for the preview).
import { P, C, CR, prop, paste, set, rect, vbands, field, frame } from './kit.js';
import { find } from '../scenes/finds.js';

const W = 176,
  H = 72;
const KINDS = ['fossil', 'bone', 'meteor', 'vase', 'crown', 'tear'];
const CASE_W = 26,
  GAP = 2,
  X0 = Math.round((W - (KINDS.length * CASE_W + (KINDS.length - 1) * GAP)) / 2);
const FLOOR = 58;
/** Top-left of the relic sprite (16 by 16) inside case i. */
const relicAt = (i) => [X0 + i * (CASE_W + GAP) + 5, FLOOR - 37];

/** Glow colours by tier: 0 plain, 1 one star, 2 two stars, 3 three or more. */
const GLOW = [
  ['sky-60', 'sky-80'],
  ['teal-60', 'teal-80'],
  ['violet-50', 'violet-70'],
  ['amber-60', 'yellow-80'],
];

function plinth() {
  return prop(CASE_W, 18, (hi, part) => {
    const top = part('stone', { bevel: true, steps: [2, 3, 4] });
    hi.rect(top, 1, 1, CASE_W - 2, 3);
    const body = part(['red-20', 'red-30', 'red-40', 'red-50', 'red-60'], {
      bevel: true,
      steps: [1, 2, 3],
    });
    hi.rect(body, 3, 4, CASE_W - 6, 11);
    const plate = part('gold', { bevel: true, steps: [1, 3, 4] });
    hi.rect(plate, 9, 7, CASE_W - 18, 3);
    const foot = part('stone', { bevel: true, steps: [1, 2, 3] });
    hi.rect(foot, 2, 15, CASE_W - 4, 2);
  });
}

function museumBase() {
  const b = new P.Buf(W, H);
  // wall: deep red with a gold rail and a darker dado
  vbands(b, 2, 2, W - 4, FLOOR - 2, CR(['red-10', 'red-20', 'red-30']), (t) => 0.2 + t * 0.55);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, 9, C('orange-40'));
    set(b, x, 10, C('yellow-70'));
    set(b, x, 11, C('orange-40'));
    set(b, x, FLOOR - 14, C('orange-40'));
    set(b, x, FLOOR - 13, C('yellow-70'));
  }
  for (let y = FLOOR - 12; y < FLOOR; y++)
    for (let x = 2; x < W - 2; x++) set(b, x, y, C('red-10'));
  // ceiling: dark band with lamps
  rect(b, 2, 2, W - 4, 7, C('neutral-10'));
  for (let x = 2; x < W - 2; x++) set(b, x, 8, C('neutral-24'));
  // floor: marble checker, lighter tiles near the front
  field(
    b,
    2,
    FLOOR,
    W - 4,
    H - 2 - FLOOR,
    CR(['neutral-24', 'neutral-30', 'neutral-50', 'neutral-60']),
    (x, y) => {
      const chk = (Math.floor((x - 2) / 10) + Math.floor((y - FLOOR) / 5)) % 2;
      return chk ? 0.15 + ((y - FLOOR) / 12) * 0.2 : 0.6 + ((y - FLOOR) / 12) * 0.3;
    },
    0.01,
  );
  for (let x = 2; x < W - 2; x++) set(b, x, FLOOR, C('neutral-17'));
  // cases
  for (let i = 0; i < KINDS.length; i++) {
    const x = X0 + i * (CASE_W + GAP);
    // lamp and a cone of light (one step lighter on the wall)
    rect(b, x + 9, 6, 8, 3, C('neutral-40'));
    rect(b, x + 10, 6, 6, 1, C('neutral-70'));
    rect(b, x + 11, 9, 4, 1, C('yellow-95'));
    const map = new Map(
      [
        ['red-10', 'red-20'],
        ['red-20', 'red-30'],
        ['red-30', 'red-40'],
      ].map(([a, c]) => [C(a), C(c)]),
    );
    for (let y = 12; y < FLOOR - 14; y++) {
      const half = 2 + (y - 12) * 0.28;
      for (let xx = Math.round(x + 13 - half); xx <= Math.round(x + 13 + half); xx++) {
        const c = b.px[y * W + xx];
        if (map.has(c)) set(b, xx, y, map.get(c));
      }
    }
    // glass case: back panel (dark), glass edges, a shine line
    const gx = x + 2,
      gy = FLOOR - 42,
      gw = CASE_W - 4,
      gh = 26;
    rect(b, gx, gy, gw, gh, C('neutral-12'));
    for (let yy = gy; yy < gy + gh; yy++) {
      set(b, gx, yy, C('sky-80'));
      set(b, gx + gw - 1, yy, C('sky-40'));
    }
    for (let xx = gx; xx < gx + gw; xx++) {
      set(b, xx, gy, C('sky-90'));
      set(b, xx, gy + 1, C('sky-40'));
    }
    paste(b, plinth(), x, FLOOR - 17);
  }
  frame(b);
  return b;
}

/** Rarity glow hugging the relic: a 1 px band in the inner colour, a dithered band outside it. */
function glow(b, x0, y0, sprite, tier) {
  const [inner, outer] = GLOW[tier].map(C);
  const back = C('neutral-12');
  const solid = (x, y) =>
    x >= 0 && y >= 0 && x < sprite.w && y < sprite.h && sprite.px[y * sprite.w + x] >>> 24;
  const near = (x, y, r) => {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++)
        if (i * i + j * j <= r * r + 1 && solid(x + i, y + j)) return true;
    return false;
  };
  for (let y = -4; y < sprite.h + 4; y++)
    for (let x = -4; x < sprite.w + 4; x++) {
      if (solid(x, y) || b.px[(y0 + y) * W + x0 + x] !== back) continue;
      if (near(x, y, 1)) set(b, x0 + x, y0 + y, inner);
      else if (near(x, y, 2)) set(b, x0 + x, y0 + y, P.bt(x0 + x, y0 + y) < 0.5 ? inner : outer);
      else if (near(x, y, 3) && P.bt(x0 + x, y0 + y) < 0.3) set(b, x0 + x, y0 + y, outer);
    }
}

/** The relic sprite dug up in the mine (scenes/finds.js), so both screens show the same relic. */
const relicSprite = (kind) => find(`relic_${kind}`);
/** Dark silhouette of a sprite: every opaque pixel in one wall-dark tone with a lit top edge. */
function silhouette(s) {
  const o = new P.Buf(s.w, s.h);
  for (let i = 0; i < s.px.length; i++) if (s.px[i] >>> 24) o.px[i] = C('neutral-20');
  for (let y = 1; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (o.px[y * s.w + x] && !o.px[(y - 1) * s.w + x]) o.px[y * s.w + x] = C('neutral-35');
  return o;
}

/**
 * The hall with relics: `owned` maps kind → best star level (0..3) or is missing when not found.
 * `t` of `T` twinkles a star over three-star relics.
 */
function museum(owned, t = 0, T = 1) {
  const b = museumBase();
  KINDS.forEach((kind, i) => {
    const [x, y] = relicAt(i);
    const s = relicSprite(kind);
    if (owned[kind] === undefined) {
      paste(b, silhouette(s), x, y);
      return;
    }
    glow(b, x, y, s, Math.min(3, owned[kind]));
    paste(b, s, x, y);
    if (owned[kind] >= 2) {
      const on = (t + i) % T < T / 2;
      if (on) {
        set(b, x + 14, y + 1, C('paper-99'));
        set(b, x + 13, y + 1, C('yellow-95'));
        set(b, x + 15, y + 1, C('yellow-95'));
        set(b, x + 14, y, C('yellow-95'));
        set(b, x + 14, y + 2, C('yellow-95'));
      }
    }
  });
  return b;
}

export function preview(T = 2) {
  return Array.from({ length: T }, (_, t) =>
    museum({ fossil: 0, bone: 1, vase: 2, crown: 3 }, t, T),
  );
}

export { museumBase, museum, glow, silhouette, relicAt, relicSprite, KINDS, GLOW, W, H };
