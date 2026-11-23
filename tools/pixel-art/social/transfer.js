// Transfer: two players on a street at dusk, the sender on the left, the receiver on the right.
// An envelope with a wax seal flies between them on an arc with coins trailing, and lands in the
// receiver's hand.
import { P, C, CR, prop, paste, set, rect, vbands, field, frame, clone } from './kit.js';
import { person } from './person.js';

const W = 176,
  H = 64;
const GROUND = 54;

function envelope() {
  return prop(15, 11, (hi, part) => {
    const p = part('paper', { bevel: true, steps: [2, 3, 4] });
    hi.rect(p, 1, 1, 13, 9);
    const flap = part('paper', { fixed: 1, outline: false });
    for (let k = 0; k < 6; k++) {
      hi.rect(flap, 1.5 + k, 1.5 + k * 0.7, 1, 1);
      hi.rect(flap, 12.5 - k, 1.5 + k * 0.7, 1, 1);
    }
    const seal = part('red', { round: 1, steps: [1, 2, 3] });
    hi.ellipse(seal, 7.5, 5.8, 1.8, 1.8);
  });
}

function coin() {
  return prop(7, 7, (hi, part) => {
    const c = part('gold', { round: 1.2, steps: [1, 3, 4] });
    hi.ellipse(c, 3.5, 3.5, 2.5, 2.5);
  });
}

function house(wall, roof) {
  return prop(34, 30, (hi, part) => {
    const r = part(roof, { bevel: true, steps: [1, 2, 3] });
    hi.poly(r, [
      [0, 12],
      [17, 1],
      [34, 12],
    ]);
    const w = part(wall, { bevel: true, steps: [1, 2, 3] });
    hi.rect(w, 3, 12, 28, 17);
    const win = part(['amber-60', 'amber-70', 'yellow-80', 'yellow-90', 'yellow-95'], {
      bevel: true,
      steps: [2, 3, 4],
    });
    hi.rect(win, 7, 15, 7, 6);
    const door = part('wood', { bevel: true, steps: [0, 1, 2] });
    hi.rect(door, 19, 17, 7, 12);
    const knob = part('gold', { fixed: 4, outline: false });
    hi.rect(knob, 24, 23, 1, 1);
  });
}

function transferBase() {
  const b = new P.Buf(W, H);
  // dusk sky: navy at the top to warm at the horizon, in flat bands
  vbands(b, 2, 2, W - 4, GROUND - 2, CR(['indigo-10', 'indigo-20', 'violet-30', 'pink-40', 'orange-50']), (t) =>
    t * 0.95,
  );
  // stars in the dark part
  const R = P.rng(5);
  for (let i = 0; i < 18; i++) set(b, 4 + Math.floor(R() * (W - 8)), 4 + Math.floor(R() * 14), C('sky-90'));
  // far roofs, flat silhouettes
  const far = C('violet-20');
  for (let x = 2; x < W - 2; x++) {
    const h = 6 + Math.round(4 * Math.abs(Math.sin(x * 0.11)) + 3 * (Math.floor(x / 13) % 2));
    for (let y = GROUND - h - 8; y < GROUND; y++) set(b, x, y, far);
  }
  for (let x = 6; x < W - 6; x += 9) if ((x * 7) % 5 < 2) set(b, x, GROUND - 12, C('amber-70'));
  // houses at the sides
  paste(b, house(['teal-20', 'teal-30', 'teal-40', 'teal-50', 'teal-60'], 'red'), 4, GROUND - 29);
  paste(b, house(['brown-20', 'brown-30', 'brown-40', 'brown-50', 'brown-60'], 'blue'), W - 38, GROUND - 29);
  // street: cobbles
  field(b, 2, GROUND, W - 4, H - 2 - GROUND, CR(['neutral-17', 'neutral-25', 'neutral-35']), (x, y) => {
    const row = Math.floor((y - GROUND) / 3);
    const u = (x - 2 + (row % 2) * 3) % 6;
    return u === 0 || (y - GROUND) % 3 === 0 ? 0.1 : 0.45 + 0.4 * (1 - (y - GROUND) / (H - GROUND));
  }, 0.01);
  for (let x = 2; x < W - 2; x++) set(b, x, GROUND, C('neutral-40'));
  // players
  paste(b, person({ coat: 'teal', hair: 'black', pose: 'out' }), 38, GROUND - 31);
  paste(b, person({ coat: 'orange', hair: 'blond', pose: 'up' }), 112, GROUND - 31, true);
  frame(b);
  return b;
}

/** Where the envelope is at u in 0..1: a parabola from the sender's hand to the receiver's. */
const path = (u) => {
  const x0 = 62,
    y0 = GROUND - 15,
    x1 = 108,
    y1 = GROUND - 27;
  return [Math.round(x0 + (x1 - x0) * u), Math.round(y0 + (y1 - y0) * u - 26 * 4 * u * (1 - u))];
};

/** Frame t of T: the envelope flies for most of the loop, coins trail, a sparkle at the catch. */
function transferFrame(base, t, T) {
  const b = clone(base);
  const fly = Math.floor(T * 0.75);
  const env = envelope(),
    cn = coin();
  if (t < fly) {
    const u = P.ease.sine(t / (fly - 1));
    for (const lag of [0.18, 0.1]) {
      if (u - lag <= 0) continue;
      const [cx, cy] = path(u - lag);
      paste(b, cn, cx - 3, cy - 3 + (lag > 0.15 ? 4 : -3));
    }
    const [x, y] = path(u);
    paste(b, env, x - 7, y - 5);
  } else {
    const [x, y] = path(1);
    paste(b, env, x - 7, y - 5);
    const k = t - fly;
    const r = 3 + k * 2;
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ])
      set(b, x + dx, y + dy, C('yellow-95'));
  }
  return b;
}

export function preview(T = 8) {
  const b = transferBase();
  return Array.from({ length: T }, (_, t) => transferFrame(b, t, T));
}

export { transferBase, transferFrame, envelope, coin, W, H };
