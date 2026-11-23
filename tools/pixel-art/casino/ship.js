// Writes the shipped casino scene data: apps/web/src/screens/casino/art/*-art.ts. Run from the
// repository root:
//   node tools/pixel-art/casino/ship.js
// Every sprite is row strings, one character per pixel, `.` = empty, with its own legend (the
// palette tokens the characters stand for, in character order). Parts that change (lights, lever,
// a highlighted pocket) ship as a base with holes plus one small overlay per state, so a screen
// never carries two copies of a whole machine.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { P } from '../lib/env.js';
import { HEX } from '../lib/palette.js';
import { coin, chip, burst, CHIPS } from './shared.js';
import { C } from './kit.js';
import { SYMBOLS } from './symbols.js';
import * as slots from './slots.js';
import * as chin from './chinchiro.js';
import * as cards from './cards.js';
import * as table from './table.js';
import * as roul from './roulette.js';
import * as pachi from './pachinko.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(root, 'apps/web/src/screens/casino/art');

// ---- encoding ------------------------------------------------------------------------------
const rgbToToken = new Map();
for (const [name, hex] of Object.entries(HEX)) {
  const key = P.col([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  if (!rgbToToken.has(key)) rgbToToken.set(key, name);
}
/** Printable ASCII without the space, `.`, quotes and the backslash: 90 characters. */
const CHARS = [...Array(95)]
  .map((_, i) => String.fromCharCode(32 + i))
  .filter((c) => !' .\'"\\`'.includes(c))
  .join('');
export { CHARS };

const opaque = (p) => p >>> 24 !== 0;

/** Bounds of the opaque pixels of `buf` that pass `keep(x, y)`. */
function bounds(buf, keep = () => true) {
  let x0 = buf.w,
    y0 = buf.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < buf.h; y++)
    for (let x = 0; x < buf.w; x++)
      if (opaque(buf.px[y * buf.w + x]) && keep(x, y)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A sprite: the pixels of `buf` in `box` (default: all of it) that pass `keep`. */
function enc(buf, name, { box = null, keep = () => true } = {}) {
  const b = box ?? { x: 0, y: 0, w: buf.w, h: buf.h };
  const legend = [];
  const rows = [];
  for (let y = b.y; y < b.y + b.h; y++) {
    let row = '';
    for (let x = b.x; x < b.x + b.w; x++) {
      const p = buf.px[y * buf.w + x];
      if (!opaque(p) || !keep(x, y)) {
        row += '.';
        continue;
      }
      const token = rgbToToken.get(p);
      if (!token) throw new Error(`${name}: colour at ${x},${y} is not a palette token`);
      let i = legend.indexOf(token);
      if (i < 0) {
        i = legend.length;
        legend.push(token);
      }
      if (i >= CHARS.length) throw new Error(`${name}: more than ${CHARS.length} colours`);
      row += CHARS[i];
    }
    rows.push(row);
  }
  return { x: b.x, y: b.y, w: b.w, h: b.h, legend: legend.join(' '), rows };
}

/**
 * A base with changing parts. `variants` maps a family to its states (whole images the size of
 * `base`). The base keeps the pixels no state of any family changes; each state ships the pixels
 * its family changes, cropped. Families must not touch the same pixels.
 */
function parts(name, base, variants) {
  const n = base.w * base.h;
  const masks = {};
  const owner = new Int16Array(n).fill(-1);
  Object.entries(variants).forEach(([fam, states], fi) => {
    const m = new Uint8Array(n);
    for (const s of states) for (let i = 0; i < n; i++) if (s.px[i] !== base.px[i]) m[i] = 1;
    for (let i = 0; i < n; i++)
      if (m[i]) {
        if (owner[i] >= 0)
          throw new Error(
            `${name}: ${fam} overlaps another family at ${i % base.w},${Math.floor(i / base.w)}`,
          );
        owner[i] = fi;
      }
    masks[fam] = m;
  });
  const out = { base: enc(base, `${name} base`, { keep: (x, y) => owner[y * base.w + x] < 0 }) };
  for (const [fam, states] of Object.entries(variants)) {
    const m = masks[fam];
    const inFam = (x, y) => m[y * base.w + x] === 1;
    // box over every state's pixels in the family, so all states share one place
    const boxes = states.map((s) => bounds(s, inFam)).filter(Boolean);
    const box = {
      x: Math.min(...boxes.map((b) => b.x)),
      y: Math.min(...boxes.map((b) => b.y)),
    };
    box.w = Math.max(...boxes.map((b) => b.x + b.w)) - box.x;
    box.h = Math.max(...boxes.map((b) => b.y + b.h)) - box.y;
    out[fam] = states.map((s, i) => enc(s, `${name} ${fam} ${i}`, { box, keep: inFam }));
  }
  return out;
}

/** The pixels of `variant` that differ from `base`, cropped (an overlay drawn on top). */
function diff(name, variant, base) {
  const keep = (x, y) => variant.px[y * base.w + x] !== base.px[y * base.w + x];
  const box = bounds(variant, keep);
  if (!box) throw new Error(`${name}: no difference`);
  return enc(variant, name, { box, keep });
}

const copyBuf = (b) => {
  const o = new P.Buf(b.w, b.h);
  o.px.set(b.px);
  return o;
};

// ---- writing -------------------------------------------------------------------------------
const written = [];
function write(file, doc, consts) {
  const body = Object.entries(consts)
    .map(
      ([name, [comment, value, type]]) =>
        `/** ${comment} */\nexport const ${name}${type ? `: ${type}` : ''} = ${JSON.stringify(value)}${type ? '' : ' as const'};\n`,
    )
    .join('\n');
  const ts = `/**\n * ${doc.join('\n * ')}\n * GENERATED by tools/pixel-art/casino/ship.js: edit the generator, not this file.\n */\nimport type { Sprite } from './sprite.ts';\n\n${body}`;
  const full = path.join(outDir, file);
  fs.writeFileSync(full, ts);
  written.push(full);
}
const S = 'Sprite';
const SL = 'readonly Sprite[]';
const SR = 'Readonly<Record<string, Sprite>>';

// ---- shared: chips, coin, win burst ---------------------------------------------------------
{
  const chipSprites = {};
  for (const c of Object.keys(CHIPS))
    chipSprites[c] = [0, 1, 2].map((ph) => enc(chip(c, 14, ph), `chip ${c}`));
  write(
    'shared-art.ts',
    ['Casino art used by more than one game: chips, the Pelica coin and the win burst.'],
    {
      CHIP_ART: [
        'Chips 14 wide, three stripe phases each (a stack turns them so it does not look stamped).',
        chipSprites,
        'Readonly<Record<string, readonly Sprite[]>>',
      ],
      COIN_ART: [
        'The Pelica coin, 16 by 16, six frames of one turn.',
        [0, 1, 2, 3, 4, 5].map((f) => enc(coin(f / 6), 'coin')),
        SL,
      ],
      BURST_ART: [
        'Win burst, 48 by 48, eight frames: rays grow and turn, sparks fly, it fades.',
        [0, 1, 2, 3, 4, 5, 6, 7].map((f) => enc(burst(f), 'burst')),
        SL,
      ],
    },
  );
}

// ---- slots ---------------------------------------------------------------------------------
{
  const cab = parts('cabinet', slots.cabinet(), {
    lights: [slots.cabinet(), slots.cabinet({ phase: 1 })],
    lever: [slots.cabinet(), slots.cabinet({ lever: 1 })],
  });
  // the win flash: the cabinet lit up, drawn over the base and the lights
  const flash = diff('flash', slots.cabinet({ flash: true }), slots.cabinet());
  const reels = {};
  for (const s of slots.ORDER) reels[s] = enc(slots.reel(s), `reel ${s}`);
  const reelFlash = diff('reel flash', slots.reel('7️⃣', true), slots.reel('7️⃣'));
  // the payline: red in the gaps between the reels, gold right across in a win
  const composed = (reelsShown, flashOn) => {
    const b = slots.cabinet({ flash: flashOn });
    reelsShown.forEach((r, i) => {
      const layer = slots.reel(r, false);
      for (let y = 0; y < slots.REEL.h; y++)
        for (let x = 0; x < slots.REEL.w; x++)
          b.pset(slots.REEL.xs[i] + x, slots.REEL.y + y, layer.px[y * slots.REEL.w + x]);
    });
    return b;
  };
  const three = ['🍒', '🍋', '7️⃣'];
  const payline = diff('payline', slots.machine(three), composed(three, false));
  const paylineWin = enc(slots.machine(three, { flash: true }), 'payline win', {
    box: { x: payline.x, y: payline.y, w: payline.w, h: 1 },
  });
  const symbols = {};
  for (const [s, f] of Object.entries(SYMBOLS)) symbols[s] = enc(f(), `symbol ${s}`);
  write(
    'slots-art.ts',
    [
      'Slot machine art: the cabinet (176 by 140) with its bulbs in two phases, the lever up and',
      'pulled, the win flash; one reel strip per symbol (42 by 64, the symbol in the middle), three',
      'spin blur frames, the payline, and the six 32 by 32 reel symbols for the pay table.',
    ],
    {
      SLOTS_SIZE: ['Cabinet size in art pixels.', { w: slots.W, h: slots.H }],
      REEL_BOX: [
        'Where the reels sit in the cabinet (left edges), their size and the symbol pitch.',
        slots.REEL,
      ],
      CABINET_ART: ['The cabinet without its bulbs and lever.', cab.base, S],
      LIGHTS_ART: [
        'The bulbs: phase A, phase B (they alternate while the reels spin).',
        cab.lights,
        SL,
      ],
      LEVER_ART: ['The lever: up, pulled.', cab.lever, SL],
      FLASH_ART: ['The cabinet lit up in a win, over everything else on the cabinet.', flash, S],
      REEL_ART: ['One reel at rest per symbol, the symbol on the payline.', reels, SR],
      REEL_FLASH_ART: ['Gold frame round a winning symbol, drawn over its reel.', reelFlash, S],
      BLUR_ART: [
        'Spin blur, three frames a third of a symbol apart.',
        [0, 1, 2].map((f) => enc(slots.blur(f), 'blur')),
        SL,
      ],
      PAYLINE_ART: ['The payline between the reels.', payline, S],
      PAYLINE_WIN_ART: ['The payline lit right across the window in a win.', paylineWin, S],
      SYMBOL_ART: ['The six reel symbols, 32 by 32, for the pay table.', symbols, SR],
    },
  );
}

// ---- chinchiro -----------------------------------------------------------------------------
{
  const SEED = { dealer: 3, player: 4 };
  const tile = (dealer) => {
    // seat() with no dice: tatami, the bowl, and for the dealer the tray and the bank
    return chin.seat({ dealer });
  };
  const innerOf = () => {
    const b = chin.tatami();
    return chin.bowl(b, chin.TW / 2, chin.TH / 2 - 4, 34);
  };
  const inner = innerOf();
  const spots = Object.fromEntries(
    Object.entries(SEED).map(([k, seed]) => [
      k,
      chin.diceSpots(inner, P.rng(seed)).map((p) => p.map(Math.round)),
    ]),
  );
  const shadows = (who, lift) =>
    spots[who].map(([x, y], i) => {
      const b = tile(who === 'dealer');
      const s = copyBuf(b);
      chin.shadowUnder(s, x, y, 17, lift);
      return diff(`shadow ${who} ${i}`, s, b);
    });
  const rest = chin.restDice();
  const blank = chin.die(1, { size: 17, pipsFrom: 2, tilt: 0.36 });
  // pips: 2 by 2 squares (top left corners) per face, and the red one as its own sprite
  const pips = {};
  for (let f = 2; f <= 6; f++) {
    const d = rest[f][0];
    const list = [];
    for (let y = 0; y < 17; y++)
      for (let x = 0; x < 17; x++)
        if (
          d.px[y * 17 + x] !== blank.px[y * 17 + x] &&
          !list.some(([a, b]) => x >= a && x < a + 2 && y >= b && y < b + 2)
        )
          list.push([x, y]);
    pips[f] = list;
  }
  const one = diff('die one', rest[1][0], blank);
  write(
    'chinchiro-art.ts',
    [
      'Chinchiro art: a seat tile (tatami and the donburi bowl, 88 by 84; the dealer has a lacquer',
      'tray and the bank), the die (17 by 17) at rest with its pips placed by hand, six tumble',
      'frames, where the three dice land, and their shadows on the bowl (at rest and in the air).',
    ],
    {
      SEAT_SIZE: ['Seat tile size in art pixels.', { w: chin.TW, h: chin.TH }],
      SEAT_ART: ["A player's seat.", enc(tile(false), 'seat'), S],
      DEALER_SEAT_ART: ["The dealer's seat.", enc(tile(true), 'dealer seat'), S],
      DIE_ART: ['A die at rest, face up, no pips.', enc(blank, 'die'), S],
      DIE_ONE_ART: ['The red pip of the 1.', one, S],
      DIE_PIPS: [
        'Top left corners of the 2 by 2 pips for 2 to 6.',
        pips,
        'Readonly<Record<number, readonly (readonly [number, number])[]>>',
      ],
      TUMBLE_ART: [
        'A die turning in the air, six frames.',
        chin.tumble().map((b, i) => enc(b, `tumble ${i}`)),
        SL,
      ],
      DICE_SPOTS: [
        'Top left corners of the three dice in the bowl, per seat.',
        spots,
        'Readonly<Record<"dealer" | "player", readonly (readonly [number, number])[]>>',
      ],
      DICE_SHADOWS: [
        'Shadows of the three dice on the bowl: at rest, and in the air (lifted 4 pixels).',
        {
          dealer: { rest: shadows('dealer', 0), air: shadows('dealer', 4) },
          player: { rest: shadows('player', 0), air: shadows('player', 4) },
        },
        'Readonly<Record<"dealer" | "player", { rest: readonly Sprite[]; air: readonly Sprite[] }>>',
      ],
    },
  );
}

// ---- blackjack -----------------------------------------------------------------------------
{
  const faces = {};
  for (const s of ['♠', '♥', '♦', '♣'])
    for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'])
      faces[`${r}${s}`] = enc(cards.face(r, s), `card ${r}${s}`);
  // the felt is the page's background colour there, so these keep only what lies on it
  const felt = C('emerald-30');
  const onFelt = (b, name) => enc(b, name, { keep: (x, y) => b.px[y * b.w + x] !== felt });
  const railBottom = new P.Buf(table.W, 6);
  table.rail(railBottom, 0, 6, true);
  write(
    'blackjack-art.ts',
    [
      'Blackjack art: the 52 card faces and the back (31 by 43; J, Q and K with portraits), the',
      "dealer's strip (padded rail, chip rack, shoe, discard tray), the printed arc and the bottom",
      'rail, 176 wide, and the betting ring. The felt itself is the plain `emerald-30` token.',
    ],
    {
      CARD_SIZE: ['Card size in art pixels.', { w: cards.CW, h: cards.CH }],
      CARD_ART: ['Card faces by rank and suit, e.g. "10♥".', faces, SR],
      CARD_BACK_ART: ['The card back.', enc(cards.back(), 'back'), S],
      DEALER_STRIP_ART: [
        "The dealer's side of the table, 176 by 44, on the felt.",
        onFelt(table.dealerStrip(), 'dealer strip'),
        S,
      ],
      ARC_ART: [
        'The printed arc between the dealer and the players, 176 by 18, on the felt.',
        onFelt(table.arcStrip(), 'arc'),
        S,
      ],
      RAIL_ART: ["The players' rail at the bottom, 176 by 6.", enc(railBottom, 'rail'), S],
      BET_RING_ART: [
        'The betting ring printed on the felt, 24 by 26 (chips sit in it).',
        enc(table.betSpot(0), 'bet ring'),
        S,
      ],
    },
  );
}

// ---- roulette ------------------------------------------------------------------------------
{
  const base = roul.wheel();
  const highlight = {};
  for (const n of roul.WHEEL)
    highlight[n] = diff(`pocket ${n}`, roul.wheel({ highlight: n }), base);
  const ringBox = {
    x: roul.CX - roul.R.numOut,
    y: roul.CY - roul.R.numOut,
    w: roul.R.numOut * 2,
    h: roul.R.numOut * 2,
  };
  const blur = [0, 1].map((f) =>
    enc(roul.wheel({ blur: f }), `blur ${f}`, {
      box: ringBox,
      keep: (x, y) => {
        const r = Math.hypot(x + 0.5 - roul.CX, y + 0.5 - roul.CY);
        return r <= roul.R.numOut - 0.5 && r >= roul.R.pocketIn + 0.5;
      },
    }),
  );
  const cells = {};
  for (const k of ['low', 'even', 'red', 'black', 'odd', 'high', 'dozen1', 'dozen2', 'dozen3'])
    cells[k] = roul.cellOfKind(k);
  write(
    'roulette-art.ts',
    [
      'Roulette art: the European wheel (148 by 148) seen from above, one gold highlight per pocket,',
      'two spin blur rings, the ball (5 by 5), and the betting board (176 by 60). The geometry lets',
      'the screen put the ball on the track or in a pocket and chips on a bet.',
    ],
    {
      WHEEL_ORDER: ['Pocket numbers clockwise from the top.', roul.WHEEL],
      WHEEL_GEOMETRY: [
        'Wheel size, centre and radii in art pixels.',
        { size: roul.SIZE, cx: roul.CX, cy: roul.CY, ...roul.R },
      ],
      WHEEL_ART: ['The wheel at rest.', enc(base, 'wheel'), S],
      POCKET_ART: ['The highlight over a pocket, by number.', highlight, SR],
      WHEEL_BLUR_ART: ['The number and pocket rings blurred by the spin, two frames.', blur, SL],
      BALL_ART: ['The ball.', enc(roul.ball(), 'ball'), S],
      BOARD_ART: ['The betting board.', enc(roul.board(), 'board'), S],
      BOARD_CELLS: ['Board cells for the outside bets: x, y, w, h.', cells],
      NUMBER_CELL: [
        'The 3 by 12 number grid: left, top and cell size; the zero sits left of it.',
        { x0: 13, y0: 2, w: 13, h: 11, zero: [2, 2, 11, 33] },
      ],
    },
  );
}

// ---- pachinko ------------------------------------------------------------------------------
{
  const idle = { digits: '' };
  const m = (o) => pachi.machine({ ...idle, ...o });
  const base = m({});
  const p = parts('pachinko', base, {
    lamp: [-1, 0, 1, 2, 3].map((l) => m({ lampOn: l })),
    tulip0: [false, true].map((o) => m({ tulipOpen: [o, false, false] })),
    tulip1: [false, true].map((o) => m({ tulipOpen: [false, o, false] })),
    tulip2: [false, true].map((o) => m({ tulipOpen: [false, false, o] })),
    mills: [0, 1].map((f) => m({ millF: f })),
    flash: [false, true].map((f) => m({ flash: f })),
  });
  // digit windows: the window and its digit, one sprite per digit, placed at DIGIT_XS
  const L = pachi.LCD;
  const digits = {};
  for (const d of '0123456789') {
    const withD = pachi.machine({ ...idle, digits: d });
    digits[d] = enc(withD, `digit ${d}`, { box: { x: L.x + 7, y: L.y + 8, w: 14, h: 22 } });
  }
  // flat x, y pairs per ball; the path ends when the ball reaches the floor
  const ps = pachi.paths(7, 70, 5).map((pts) => pts.filter(Boolean).flat());
  write(
    'pachinko-art.ts',
    [
      'Pachinko art: the machine face (176 by 180) with its brass pins, the lamp and the LEDs round',
      'the frame (off, four frames on), three tulips (shut, open), the windmills (two frames),',
      'the jackpot flash, the digit windows of the centre display, the ball, and seven ball paths',
      'through the pins (one point per frame until the ball reaches the floor).',
    ],
    {
      PACHINKO_SIZE: ['Machine size in art pixels.', { w: pachi.W, h: pachi.H }],
      MACHINE_ART: ['The machine without the parts below.', p.base, S],
      LAMP_ART: [
        'The lamp and the LEDs: off, then four frames of the beam turning (LEDs blink with it).',
        p.lamp,
        SL,
      ],
      TULIP_ART: [
        'Each tulip: shut, open.',
        [p.tulip0, p.tulip1, p.tulip2],
        'readonly (readonly Sprite[])[]',
      ],
      MILL_ART: ['The windmills, two frames.', p.mills, SL],
      SCREEN_ART: ['The centre display: normal, flashing.', p.flash, SL],
      DIGIT_ART: ['A digit window (14 by 22) with its digit, drawn at DIGIT_XS.', digits, SR],
      DIGIT_XS: [
        'Left edges of the three digit windows; their top.',
        { xs: [0, 1, 2].map((i) => L.x + 7 + i * 18), y: L.y + 8 },
      ],
      BALL_ART: ['The ball.', enc(pachi.ball(), 'ball'), S],
      BALL_PATHS: [
        'Ball paths: the top left corner per frame (30 a second) as x, y pairs.',
        ps,
        'readonly (readonly number[])[]',
      ],
    },
  );
}

execFileSync('pnpm', ['exec', 'prettier', '--write', ...written], { cwd: root, stdio: 'ignore' });
for (const f of written) console.log(path.relative(root, f), fs.statSync(f).size);
