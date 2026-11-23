// Teiai Bank hall: stone wall, three teller windows over a marble counter, a round vault door on
// the right, brass rope posts and a tiled floor. Lamps light the wall from above.
import { P } from './lib.js';
import { R, wallValue, pendant, tiles, column } from './props.js';

export const W = 128,
  H = 48;

export function bank(S, opt = {}) {
  const r = R(S);
  const lamps = [
    [31, 12],
    [55, 12],
  ];
  // wall: stone blocks in running bond, lit by the lamps
  for (let y = 0; y < 42; y++)
    for (let x = 0; x < W; x++) {
      const v = wallValue(S, x, y, lamps, 42);
      S.set(x, y, r.stone[1 + P.band(v, 3, x, y, 0.3)]);
    }
  for (let y = 9; y < 42; y += 5) {
    S.hl(0, y, W, r.stone[0]);
    const off = ((y - 9) / 5) % 2 ? 6 : 0;
    for (let x = off; x < W; x += 12) S.vl(x, y + 1, 4, r.stone[0]);
  }
  // ceiling and cornice with dentils
  S.rect(0, 0, W, 4, r.ceil[1]).hl(0, 0, W, r.ceil[0]);
  S.hl(0, 4, W, r.stone[4]).hl(0, 5, W, r.stone[2]);
  for (let x = 0; x < W; x += 4) S.rect(x, 6, 2, 2, r.stone[3]).set(x + 1, 7, r.stone[1]);
  S.hl(0, 8, W, r.stone[0]);

  // pilasters at both edges and between counter and vault
  for (const x of [1, 84, 121]) column(S, x, 9, 33, r.stone);

  // teller windows: a header with the window number, a brass grille, the back office behind
  [10, 34, 58].forEach((x0, n) => {
    S.bevel(x0, 13, 18, 7, [r.wood[0], r.wood[1], r.wood[3]]);
    S.text(x0 + 8, 14, String(n + 1), r.gold[3]);
    S.set(x0 + 2, 16, r.gold[2]).set(x0 + 15, 16, r.gold[2]);
    S.bevel(x0, 19, 18, 11, [r.wood[0], r.wood[2], r.wood[4]]);
    S.rect(x0 + 2, 20, 14, 9, r.back[1]);
    S.hl(x0 + 2, 23, 14, r.back[0])
      .rect(x0 + 3, 21, 3, 2, r.paper[2])
      .rect(x0 + 11, 21, 2, 2, r.wood[3]);
    S.set(x0 + 13, 21, r.gold[4]);
    for (let x = x0 + 4; x < x0 + 15; x += 3) S.vl(x, 20, 6, r.gold[1]).set(x, 20, r.gold[3]);
    S.hl(x0 + 2, 26, 14, r.gold[3])
      .hl(x0 + 2, 27, 14, r.gold[1])
      .hl(x0 + 2, 28, 14, r.back[0]);
  });

  // counter: marble top, wood front with raised panels
  S.hl(6, 29, 74, r.marble[4]).hl(6, 30, 74, r.marble[2]).hl(6, 31, 74, r.marble[0]);
  S.rect(7, 32, 72, 10, r.wood[2]);
  for (let x = 9; x < 77; x += 12) {
    S.bevel(x, 33, 10, 7, [r.wood[0], r.wood[2], r.wood[3]]);
    S.rect(x + 2, 35, 6, 3, r.wood[1]).hl(x + 2, 35, 6, r.wood[0]);
  }
  S.hl(7, 41, 72, r.wood[0]).vl(78, 32, 10, r.wood[0]).vl(7, 32, 10, r.wood[3]);
  // on the counter: coin stacks, a bell, a banker's lamp, papers
  coinStack(S, r, 18, 28, 3);
  coinStack(S, r, 21, 28, 5);
  coinStack(S, r, 25, 28, 2);
  S.rect(44, 27, 5, 2, r.gold[2])
    .hl(45, 26, 3, r.gold[3])
    .set(46, 25, r.gold[4])
    .hl(44, 28, 5, r.gold[1]);
  S.rect(60, 28, 8, 1, r.paper[3]).hl(61, 27, 6, r.paper[4]).set(66, 27, r.ink);
  // banker's lamp: green glass shade on a brass foot
  S.hl(70, 28, 5, r.gold[1]).vl(72, 25, 3, r.gold[2]);
  S.rect(69, 23, 7, 2, r.green[2])
    .hl(70, 22, 5, r.green[3])
    .hl(69, 24, 7, r.green[1])
    .set(70, 22, r.green[4]);
  S.hl(70, 25, 5, r.glow);

  // vault: a steel block with a round door
  vault(S, r, 90, 9, opt.wheel ?? 0);

  // floor tiles and the rope posts
  tiles(S, 0, 42, W, 6, r.marble, 8);
  ropePosts(S, r, 84, 33, [84, 100]);

  for (const [x] of lamps) pendant(S, r, x, 9);
}

function coinStack(S, r, x, base, n) {
  for (let k = 0; k < n; k++) {
    const y = base - k;
    S.hl(x, y, 3, k % 2 ? r.gold[2] : r.gold[1]).set(x, y, r.gold[3]);
  }
  S.hl(x, base - n, 3, r.gold[4]).set(x + 2, base - n, r.gold[3]);
}

function vault(S, r, x0, y0, wheel) {
  const w = 30,
    h = 31;
  S.bevel(x0, y0, w, h, [r.steel[0], r.steel[2], r.steel[4]]);
  S.frame(x0 + 1, y0 + 1, w - 2, h - 2, r.steel[3]);
  // rivets on the frame
  for (const [x, y] of [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ])
    S.set(x0 + x, y0 + y, r.steel[0]).set(x0 + x - 1, y0 + y - 1, r.steel[4]);
  const cx = x0 + w / 2,
    cy = y0 + h / 2;
  roundDoor(S, r, cx, cy, 13.5, wheel);
  // hinges on the left
  for (const y of [cy - 7, cy + 5])
    S.rect(x0 + 2, Math.round(y), 3, 3, r.steel[1]).hl(x0 + 2, Math.round(y), 3, r.steel[3]);
}

/**
 * A round vault door lit from the top left: raised rim, flat face with locking bolts, a groove,
 * the inner face and a brass wheel with six spokes. Each ring is a flat band; no noise.
 */
export function roundDoor(S, r, cx, cy, R0, wheel = 0) {
  const L = [-0.7071, -0.7071];
  const st = r.steel,
    au = r.gold;
  const tone = (ramp, v, x, y) =>
    ramp[Math.max(0, Math.min(ramp.length - 1, P.band(v, ramp.length, x, y, 0.15)))];
  for (let y = Math.floor(cy - R0 - 1); y <= Math.ceil(cy + R0); y++)
    for (let x = Math.floor(cx - R0 - 1); x <= Math.ceil(cx + R0); x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy,
        d = Math.hypot(dx, dy);
      if (d > R0) continue;
      const nx = dx / (d || 1),
        ny = dy / (d || 1),
        facing = nx * L[0] + ny * L[1]; // 1 = faces the light
      let c;
      if (d > R0 - 1.2) c = tone(st, 0.5 + facing * 0.5, x, y);
      else if (d > R0 - 3) c = st[2];
      else if (d > R0 - 4.2) c = facing > 0.3 ? st[0] : facing < -0.3 ? st[3] : st[1];
      else c = tone(st, 0.45 + 0.18 * (-(dx + dy) / R0), x, y);
      S.set(x, y, c);
    }
  // locking bolts on the flat face
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + Math.PI / 10,
      bx = Math.round(cx - 1 + Math.cos(a) * (R0 - 2.1)),
      by = Math.round(cy - 1 + Math.sin(a) * (R0 - 2.1));
    S.rect(bx, by, 2, 2, au[1]).set(bx, by, au[4]);
  }
  // wheel: rim ring, six spokes, hub
  const WR = 6.5;
  for (let y = Math.floor(cy - WR - 1); y <= Math.ceil(cy + WR); y++)
    for (let x = Math.floor(cx - WR - 1); x <= Math.ceil(cx + WR); x++) {
      const dx = x + 0.5 - cx,
        dy = y + 0.5 - cy,
        d = Math.hypot(dx, dy);
      if (d <= WR && d > WR - 1.3) {
        const f = (dx * L[0] + dy * L[1]) / d;
        S.set(x, y, f > 0.35 ? au[4] : f < -0.35 ? au[0] : au[2]);
      }
    }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6 + wheel;
    S.line(
      cx - 0.5 + Math.cos(a) * 2,
      cy - 0.5 + Math.sin(a) * 2,
      cx - 0.5 + Math.cos(a) * (WR - 1),
      cy - 0.5 + Math.sin(a) * (WR - 1),
      au[1],
    );
  }
  S.disc(cx, cy, 2.2, au[2])
    .set(cx - 1, cy - 1, au[4])
    .set(cx, cy, au[1])
    .set(cx - 1, cy, au[3]);
}

function ropePosts(S, r, _x, top, xs) {
  for (const x of xs) {
    S.rect(x - 1, top + 10, 4, 2, r.gold[1]).hl(x - 1, top + 10, 4, r.gold[3]);
    S.vl(x, top + 2, 8, r.gold[3]).vl(x + 1, top + 2, 8, r.gold[1]);
    S.rect(x, top, 2, 2, r.gold[2]).set(x, top, r.gold[4]);
  }
  // rope sags between the posts
  const [a, b] = xs;
  for (let x = a + 2; x < b; x++) {
    const t = (x - a) / (b - a),
      y = Math.round(top + 3 + Math.sin(t * Math.PI) * 3);
    S.set(x, y, r.rope[1]).set(x, y + 1, r.rope[0]);
  }
}
