// Profile: a player card. A gold frame with corner gems on a violet face, a portrait frame for
// the avatar, a ribbon banner for the name, three brass plaques for stats and a velvet tray with
// six sockets for cosmetics. The app puts the avatar, the text and the icons over the slots
// listed in SLOTS (art pixels).
import { P, C, CR, prop, paste, set, rect, field, frame } from './kit.js';

const W = 176,
  H = 98;
const SLOTS = {
  portrait: { x: 12, y: 12, w: 36, h: 36 },
  ribbon: { x: 62, y: 9, w: 102, h: 14 },
  plaques: [0, 1, 2].map((i) => ({ x: 58, y: 28 + i * 14, w: 110, h: 12 })),
  sockets: Array.from({ length: 6 }, (_, i) => ({ x: 13 + i * 26, y: 74, w: 18, h: 18 })),
};

function ribbon() {
  return prop(118, 20, (hi, part) => {
    const tail = part('red', { bevel: true, steps: [0, 0, 1] });
    hi.poly(tail, [
      [1, 5],
      [14, 5],
      [14, 19],
      [1, 19],
      [6, 12],
    ]).poly(tail, [
      [117, 5],
      [104, 5],
      [104, 19],
      [117, 19],
      [112, 12],
    ]);
    const fold = part('red', { fixed: 0 });
    hi.poly(fold, [
      [8, 15],
      [14, 15],
      [14, 19],
    ]).poly(fold, [
      [110, 15],
      [104, 15],
      [104, 19],
    ]);
    const band = part('red', { bevel: true, steps: [0, 1, 2] });
    hi.rect(band, 8, 1, 102, 14);
    const edge = part('gold', { fixed: 3, outline: false });
    hi.rect(edge, 9, 2, 100, 1).rect(edge, 9, 13, 100, 1);
  });
}

function portrait() {
  return prop(46, 46, (hi, part) => {
    const rim = part('gold', { bevel: true, steps: [1, 2, 4] });
    hi.rrect(rim, 1, 1, 44, 44, 3);
    const inner = part('gold', { bevel: true, steps: [3, 1, 0] });
    hi.rect(inner, 4, 4, 38, 38);
    const slot = part('ink', { fixed: 1, outline: false });
    hi.rect(slot, 5, 5, 36, 36);
    const gem = part('sky', { round: 1, steps: [1, 2, 4] });
    hi.ellipse(gem, 23, 2.5, 2, 2).ellipse(gem, 23, 43.5, 2, 2);
  });
}

function plaque() {
  return prop(112, 14, (hi, part) => {
    const p = part(['amber-40', 'amber-60', 'amber-70', 'yellow-80', 'yellow-90'], {
      bevel: true,
      steps: [1, 2, 3],
    });
    hi.rrect(p, 1, 1, 110, 12, 2);
    const screw = part('steel', { round: 0.8, steps: [0, 1, 3] });
    hi.ellipse(screw, 4.5, 7, 1.2, 1.2).ellipse(screw, 107.5, 7, 1.2, 1.2);
  });
}

function profileCard() {
  const b = new P.Buf(W, H);
  // card face: violet with a faint diamond lattice
  field(
    b,
    2,
    2,
    W - 4,
    H - 4,
    CR(['violet-10', 'violet-20', 'violet-30']),
    (x, y) => {
      const lat = (x + y) % 12 === 0 || (x - y + 240) % 12 === 0;
      return lat ? 0.95 : 0.45 - (y / H) * 0.3;
    },
    0.01,
  );
  // gold border inside the frame, corner gems
  for (let x = 4; x < W - 4; x++) {
    set(b, x, 4, C('yellow-80'));
    set(b, x, 5, C('orange-40'));
    set(b, x, H - 6, C('yellow-70'));
    set(b, x, H - 5, C('orange-40'));
  }
  for (let y = 4; y < H - 4; y++) {
    set(b, 4, y, C('yellow-80'));
    set(b, 5, y, C('orange-40'));
    set(b, W - 6, y, C('yellow-70'));
    set(b, W - 5, y, C('orange-40'));
  }
  const gem = prop(9, 9, (hi, part) => {
    const g = part('red', { round: 1.4, steps: [1, 2, 4] });
    hi.poly(g, [
      [4.5, 0.5],
      [8.5, 4.5],
      [4.5, 8.5],
      [0.5, 4.5],
    ]);
  });
  for (const [x, y] of [
    [1, 1],
    [W - 10, 1],
    [1, H - 10],
    [W - 10, H - 10],
  ])
    paste(b, gem, x, y);
  paste(b, portrait(), 7, 7);
  paste(b, ribbon(), 54, 6);
  for (const s of SLOTS.plaques) paste(b, plaque(), s.x - 1, s.y - 1);
  // velvet tray with sockets
  rect(b, 8, 70, W - 16, 24, C('red-20'));
  for (let x = 8; x < W - 8; x++) {
    set(b, x, 70, C('red-40'));
    set(b, x, 93, C('red-10'));
  }
  for (const s of SLOTS.sockets) {
    rect(b, s.x, s.y, s.w, s.h, C('red-10'));
    for (let i = 0; i < s.w; i++) set(b, s.x + i, s.y, C('neutral-4'));
    for (let j = 0; j < s.h; j++) set(b, s.x, s.y + j, C('neutral-4'));
    for (let i = 0; i < s.w; i++) set(b, s.x + i, s.y + s.h, C('red-40'));
    for (let j = 0; j <= s.h; j++) set(b, s.x + s.w, s.y + j, C('red-40'));
  }
  frame(b, { lit: 'yellow-70', shade: 'orange-30', dark: 'neutral-4' });
  return b;
}

export function preview() {
  return [profileCard()];
}

export { profileCard, SLOTS, W, H };
