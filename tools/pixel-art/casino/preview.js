// Preview sheets (4x) and GIFs of the casino scenes. Writes into ART_OUT:
//   ART_OUT=/some/folder node tools/pixel-art/casino/preview.js
import fs from 'node:fs';
import { P, out } from '../lib/env.js';
import { HEX } from '../lib/palette.js';
import { onBg, NAVY } from '../lib/show.js';
import { paste, tokensOf } from './kit.js';
import { coin, chip, chipStack, burst, CHIPS } from './shared.js';
import { SYMBOLS, SYMBOL_NAMES } from './symbols.js';
import * as slots from './slots.js';
import * as chin from './chinchiro.js';
import * as cards from './cards.js';
import * as table from './table.js';
import * as roul from './roulette.js';
import * as pachi from './pachinko.js';

const it = (buf, label, scale = 4) => {
  tokensOf(buf, HEX);
  return { buf: onBg(buf, NAVY, scale, 1), label };
};
const row = (bufs, gap = 2) => {
  const h = Math.max(...bufs.map((b) => b.h));
  const o = new P.Buf(
    bufs.reduce((n, b) => n + b.w + gap, -gap),
    h,
  );
  let x = 0;
  for (const b of bufs) {
    paste(o, b, x, h - b.h);
    x += b.w + gap;
  }
  return o;
};
const onNavy = (b) => onBg(b, NAVY, 1, 0);
const save = (items, name, cols = 1) => P.save(P.sheet(items, { cols }), out(name));
const gif = (frames, name, delay, scale = 2) => {
  fs.writeFileSync(out(name), P.gif(frames.map(onNavy), { delay, scale }));
  // numbered frame sheet (up to 12 frames, evenly picked, last frame included) to check the motion
  const pick =
    frames.length <= 12
      ? frames.map((_, i) => i)
      : [...Array(12)].map((_, i) => Math.round((i * (frames.length - 1)) / 11));
  P.save(
    P.sheet(
      pick.map((i) => ({ buf: onNavy(frames[i]), label: String(i) })),
      { cols: 6, scale: frames[0].w > 60 ? 1 : 3 },
    ),
    out(`work/frames-${name.replace('.gif', '.png')}`),
  );
};

// ---- shared
save(
  [
    it(row([0, 1, 2, 3, 4, 5].map((f) => coin(f / 6))), 'pelica coin, 6 turn frames'),
    it(row(Object.keys(CHIPS).map((c) => chip(c))), 'chips'),
    it(row(Object.keys(CHIPS).map((c, i) => chipStack(c, 3 + i))), 'chip stacks'),
    it(row([0, 1, 2, 3, 4, 5, 6, 7].map((f) => burst(f))), 'win burst, 8 frames', 2),
  ],
  'sheet-shared-4x.png',
);
gif(
  [0, 1, 2, 3, 4, 5, 6, 7].map((f) => burst(f)),
  'anim-win-burst.gif',
  70,
  4,
);
gif(
  [0, 1, 2, 3, 4, 5].map((f) => coin(f / 6)),
  'anim-coin.gif',
  110,
  6,
);

// ---- slots
save(
  [
    it(row(Object.values(SYMBOLS).map((f) => f())), Object.values(SYMBOL_NAMES).join(' ')),
    it(row([0, 1, 2].map((f) => slots.blur(f))), 'spin blur, 3 frames'),
    it(row([slots.reel('7️⃣'), slots.reel('7️⃣', true)]), 'reel, reel in a win'),
    it(slots.machine(['🍒', '🔔', '7️⃣']), 'cabinet, lights A', 2),
    it(slots.machine([0, 1, 2], { phase: 1, lever: 1 }), 'spinning: lights B, lever pulled', 2),
    it(slots.machine(['7️⃣', '7️⃣', '7️⃣'], { flash: true, winning: [0, 1, 2] }), 'win flash', 2),
  ],
  'sheet-slots-4x.png',
);
{
  const fr = [],
    d = [];
  const target = ['🔔', '🔔', '🍒'];
  fr.push(slots.machine(['🍒', '🍋', '7️⃣']));
  d.push(500);
  for (let k = 0; k < 4; k++) {
    fr.push(
      slots.machine([k % 3, (k + 1) % 3, (k + 2) % 3], { phase: k % 2, lever: k < 2 ? 1 : 0 }),
    );
    d.push(90);
  }
  for (let stop = 1; stop <= 3; stop++)
    for (let k = 0; k < 6; k++) {
      const reels = target.map((s, i) => (i < stop ? s : (k + i) % 3));
      fr.push(slots.machine(reels, { phase: k % 2 }));
      d.push(90);
    }
  for (let k = 0; k < 6; k++) {
    const m = slots.machine(target, { flash: k % 2 === 0, winning: [0, 1], phase: k % 2 });
    paste(m, burst(Math.min(7, k + 1)), 2, 0);
    fr.push(m);
    d.push(160);
  }
  gif(fr, 'anim-slots-spin.gif', d);
}

// ---- chinchiro
const rest = chin.restDice();
save(
  [
    it(row([1, 2, 3, 4, 5, 6].map((f) => rest[f][0])), 'dice 1-6 (red 1, as in Japan)'),
    it(row(chin.tumble()), 'tumble, 6 frames'),
    it(
      row([
        chin.seat({ dice: [4, 5, 6], dealer: true, seed: 3 }),
        chin.seat({ dice: [1, 2, 3], seed: 4 }),
      ]),
      "dealer's side (lacquer tray, bank) and a player's bowl",
      2,
    ),
    it(chin.seat({ dice: [3, 3, 5], rolling: 2, seed: 4 }), 'dice in the air', 2),
  ],
  'sheet-chinchiro-4x.png',
);
{
  const fr = [],
    d = [];
  for (let k = 0; k < 7; k++) {
    fr.push(chin.seat({ dice: [1, 1, 1], rolling: k, seed: 4 }));
    d.push(90);
  }
  fr.push(chin.seat({ dice: [4, 5, 6], seed: 4 }));
  d.push(1200);
  gif(fr, 'anim-chinchiro-roll.gif', d, 3);
}

// ---- blackjack
const R = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
save(
  [
    ...['♠', '♥', '♦', '♣'].map((s) => it(row(R.map((r) => cards.face(r, s))), `${s} A-K`, 3)),
    it(
      row([cards.back(), ...cards.flip(cards.face('Q', '♦')).slice(1)]),
      'back and flip frames',
      3,
    ),
    it(table.dealerStrip(), "dealer's strip: rail, chip rack, shoe, discards", 3),
    it(table.arcStrip(), 'printed arc', 3),
    it(
      row([table.betSpot(0), table.betSpot(3, 'red'), table.betSpot(6, 'black')]),
      'betting spot',
      3,
    ),
  ],
  'sheet-blackjack-4x.png',
);
gif(cards.flip(cards.face('K', '♥')), 'anim-card-flip.gif', [400, 70, 70, 70, 800], 4);

// ---- roulette
save(
  [
    it(roul.withBall(roul.wheel({ highlight: 17 }), roul.ballAt(17)), 'wheel, ball in 17', 2),
    it(
      roul.withBall(roul.wheel({ blur: 1 }), roul.ballAt(null, 0.6)),
      'spin blur, ball on the track',
      2,
    ),
    it(
      roul.board([
        { kind: 'red' },
        { kind: 'dozen3' },
        { kind: 'number', number: 17 },
        { kind: 'odd' },
      ]),
      'betting board with chips on the slip',
      2,
    ),
    it(roul.ball(), 'ball'),
  ],
  'sheet-roulette-4x.png',
  2,
);
{
  // ball runs round the track against the wheel, slows, drops in: 32 frames
  const fr = [],
    d = [];
  const w0 = roul.wheel({ blur: 0 }),
    w1 = roul.wheel({ blur: 1 });
  const target = 17,
    ti = roul.WHEEL.indexOf(target);
  const end = roul.angleOf(ti);
  const n = 26;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const a = end - (1 - (1 - Math.pow(1 - t, 3))) * Math.PI * 5;
    const slow = t > 0.8;
    const w = slow ? roul.wheel() : k % 2 ? w1 : w0;
    fr.push(roul.withBall(w, roul.ballAt(null, a)));
    d.push(70 + Math.round(t * t * 120));
  }
  fr.push(roul.withBall(roul.wheel(), roul.ballAt(target)));
  d.push(300);
  for (let k = 0; k < 4; k++) {
    fr.push(roul.withBall(roul.wheel({ highlight: k % 2 ? null : target }), roul.ballAt(target)));
    d.push(250);
  }
  gif(fr, 'anim-roulette-spin.gif', d);
}

// ---- pachinko
save(
  [
    it(pachi.machine(), 'machine, idle', 2),
    it(
      pachi.machine({ lampOn: 1, digits: '777', tulipOpen: [true, true, true], flash: true }),
      'jackpot: lamp on, LEDs, 777, tulips open',
      2,
    ),
    it(pachi.ball(), 'ball'),
  ],
  'sheet-pachinko-4x.png',
  2,
);
{
  const ps = pachi.paths(9, 70, 5);
  const fr = [],
    d = [];
  const len = Math.max(...ps.map((p) => p.length)) + 16;
  for (let f = 0; f < len; f += 2) {
    const hitTulip = f > 30;
    const m = pachi.machine({ millF: (f / 2) % 2, tulipOpen: [hitTulip, false, false] });
    ps.forEach((p, i) => {
      const k = f - i * 4;
      if (k >= 0 && k < p.length && p[k]) paste(m, pachi.ball(), ...p[k]);
    });
    fr.push(m);
    d.push(60);
  }
  for (let k = 0; k < 8; k++) {
    fr.push(
      pachi.machine({
        lampOn: k % 4,
        digits: '777',
        tulipOpen: [true, true, true],
        flash: k % 2 === 0,
        millF: k % 2,
      }),
    );
    d.push(140);
  }
  gif(fr, 'anim-pachinko.gif', d);
}
console.log('preview written to', out(''));
