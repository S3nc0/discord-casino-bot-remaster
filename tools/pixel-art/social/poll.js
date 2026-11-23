// Poll: a town hall corner. A voting booth with a striped curtain, the ballot box on a table with
// a ballot dropping into the slot, and a tally easel with a yes bar and a no bar.
import { P, C, CR, prop, paste, set, vbands, field, frame, clone } from './kit.js';
import { person } from './person.js';

const W = 176,
  H = 64;
const FLOOR = 52;

function box() {
  return prop(40, 28, (hi, part) => {
    const lid = part(['blue-20', 'blue-40', 'blue-50', 'blue-60', 'sky-90'], {
      bevel: true,
      steps: [2, 3, 4],
    });
    hi.rect(lid, 2, 2, 36, 4);
    const body = part(['blue-20', 'blue-30', 'blue-40', 'blue-50', 'blue-70'], {
      bevel: true,
      steps: [1, 2, 3],
    });
    hi.rect(body, 3, 6, 34, 20);
    const slot = part('ink', { fixed: 0, outline: false });
    hi.rect(slot, 13, 3, 14, 1);
    const plate = part('paper', { bevel: true, steps: [2, 3, 4] });
    hi.rect(plate, 12, 10, 16, 11);
    const tick = part('green', { fixed: 1, outline: false });
    hi.cells(
      15,
      12,
      ['.......##', '......##.', '##...##..', '.##.##...', '..###....', '...#.....'],
      {
        '#': tick,
      },
    );
    const lock = part('gold', { bevel: true, steps: [1, 3, 4] });
    hi.rect(lock, 18, 22, 4, 3);
  });
}

function table() {
  return prop(52, 16, (hi, part) => {
    const top = part('wood', { bevel: true, steps: [2, 3, 4] });
    hi.rect(top, 1, 1, 50, 3);
    const cloth = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.poly(cloth, [
      [2, 4],
      [50, 4],
      [49, 10],
      [3, 10],
    ]);
    const leg = part('wood', { fixed: 1 });
    hi.rect(leg, 5, 10, 2, 5).rect(leg, 45, 10, 2, 5);
  });
}

function booth() {
  return prop(42, 46, (hi, part) => {
    const frameP = part('wood', { bevel: true, steps: [1, 2, 3] });
    hi.rect(frameP, 1, 4, 40, 3).rect(frameP, 1, 4, 3, 41).rect(frameP, 38, 4, 3, 41);
    const roof = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.poly(roof, [
      [0, 6],
      [21, 0.5],
      [42, 6],
    ]);
  });
}

function easel() {
  return prop(40, 46, (hi, part) => {
    const leg = part('wood', { round: 0.8, steps: [1, 2, 3] });
    hi.line(leg, 8, 44, 14, 4, 2).line(leg, 32, 44, 26, 4, 2).line(leg, 20, 40, 20, 30, 2);
    const board = part('paper', { bevel: true, steps: [1, 2, 3] });
    hi.rect(board, 3, 4, 34, 26);
    const clip = part('steel', { bevel: true });
    hi.rect(clip, 16, 2, 8, 3);
    const yes = part('green', { bevel: true, steps: [1, 2, 3] }),
      no = part('red', { bevel: true, steps: [1, 2, 3] });
    hi.rect(yes, 7, 10, 24, 6);
    hi.rect(no, 7, 19, 10, 6);
    const ink = part('ink', { fixed: 3, outline: false });
    hi.rect(ink, 6, 9, 1, 17).rect(ink, 6, 26, 27, 1);
  });
}

/** Static scene (without the ballot). Returns the buffer. */
function pollBase() {
  const b = new P.Buf(W, H);
  // wall: indigo with a picture rail, wood wainscot below
  vbands(b, 2, 2, W - 4, 34, CR(['indigo-10', 'indigo-20', 'indigo-30']), (t) => 0.2 + t * 0.6);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, 10, C('indigo-30'));
    set(b, x, 11, C('indigo-10'));
  }
  // wall pattern: small diamonds
  for (let y = 16; y < 34; y += 6)
    for (let x = 6 + ((y / 6) % 2) * 6; x < W - 4; x += 12) set(b, x, y, C('indigo-30'));
  const wood = CR(['brown-10', 'brown-20', 'brown-30', 'brown-40']);
  vbands(b, 2, 36, W - 4, FLOOR - 36, wood, (t) => 0.75 - t * 0.5, 0.2);
  for (let x = 2; x < W - 2; x++) {
    set(b, x, 36, C('brown-50'));
    set(b, x, 37, C('brown-30'));
    set(b, x, FLOOR - 1, C('brown-10'));
  }
  for (let x = 12; x < W - 4; x += 20)
    for (let y = 39; y < FLOOR - 2; y++) {
      set(b, x, y, C('brown-10'));
      set(b, x + 1, y, C('brown-40'));
    }
  // floor tiles
  field(
    b,
    2,
    FLOOR,
    W - 4,
    H - 2 - FLOOR,
    CR(['neutral-17', 'neutral-24', 'neutral-30']),
    (x, y) => ((Math.floor((x - 2) / 8) + Math.floor((y - FLOOR) / 4)) % 2 ? 0.25 : 0.7),
    0.01,
  );
  // booth on the left: frame, striped curtain, shadow inside
  const BX = 10,
    BY = FLOOR - 45;
  for (let y = BY + 8; y < FLOOR - 1; y++)
    for (let x = BX + 4; x < BX + 38; x++) set(b, x, y, C('neutral-10'));
  field(
    b,
    BX + 5,
    BY + 8,
    32,
    FLOOR - 2 - (BY + 8),
    CR(['sky-30', 'sky-50', 'paper-80', 'paper-95']),
    (x, y) => {
      const u = (x - BX - 5) / 32;
      const gather = y > FLOOR - 14 ? 0.05 : 0;
      if (u > 0.62 + gather && u < 0.7) return null; // the gap the voter slips through
      const stripe = Math.floor((x - BX - 5) / 4) % 2;
      const fold = 0.5 + 0.5 * Math.cos(((x - BX - 5) % 4) * 1.4);
      return stripe ? 0.55 + 0.4 * fold : 0.05 + 0.4 * fold;
    },
  );
  paste(b, booth(), BX, BY);
  // table with the ballot box
  paste(b, table(), 62, FLOOR - 15);
  paste(b, box(), 68, FLOOR - 42);
  // a voter beside the table, holding up a ballot
  paste(b, person({ coat: 'teal', hair: 'black', pose: 'up' }), 42, FLOOR - 31);
  paste(b, ballot(), 62, FLOOR - 33);
  // easel on the right
  paste(b, easel(), 128, FLOOR - 44);
  frame(b);
  return b;
}

/** A ballot, 10 by 8, folded once, with a tick. */
function ballot() {
  return prop(10, 9, (hi, part) => {
    const p = part('paper', { bevel: true, steps: [2, 3, 4] });
    hi.rect(p, 1, 1, 8, 7);
    const ink = part('green', { fixed: 1, outline: false });
    hi.cells(3, 3, ['...#', '#.#.', '.#..'], { '#': ink });
  });
}

/** Frame t of T: the ballot drops into the slot, then the box is still. */
function pollFrame(base, t, T) {
  const b = clone(base);
  const drop = [-10, -8, -6, -4, -2, null, null, null];
  const y = drop[Math.floor((t / T) * drop.length)];
  if (y !== null && y !== undefined) {
    const bl = ballot();
    // only the part above the slot shows
    const sx = 83,
      sy = FLOOR - 42 + 3;
    for (let j = 0; j < bl.h; j++)
      for (let i = 0; i < bl.w; i++) {
        const c = bl.px[j * bl.w + i];
        const Y = sy + y + j;
        if (c >>> 24 && Y < sy) set(b, sx + i, Y, c);
      }
  }
  return b;
}

export function preview(T = 8) {
  const b = pollBase();
  return Array.from({ length: T }, (_, t) => pollFrame(b, t, T));
}

export { pollBase, pollFrame, ballot, W, H };
