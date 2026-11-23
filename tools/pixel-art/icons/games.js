import { icon } from './kit.js';

// Light is always from the top left; every colour is a step of a palette.js material.
// bevel: lit edge on the top and left, shaded edge on the bottom and right, flat inside.
// dome:  round parts lit by their shape (3 steps, dither only where two bands meet).
// fixed: one step, no shading (symbols and faces that must stay flat).

icon('dice', (hi, part) => {
  const F = part('paper', { bevel: true, steps: [2, 4, 4] }),
    T = part('paper', { fixed: 4 }),
    R = part('paper', { fixed: 1 });
  hi.poly(T, [
    [1.2, 5.2],
    [4.4, 1.6],
    [14.4, 1.6],
    [11.2, 5.2],
  ]);
  hi.poly(R, [
    [11.2, 5.2],
    [14.4, 1.6],
    [14.4, 11.4],
    [11.2, 14.8],
  ]);
  hi.rect(F, 1.2, 5.2, 10, 9.6);
  const ink = part('ink', { fixed: 1 });
  for (const [x, y] of [
    [2, 7],
    [7, 7],
    [2, 12],
    [7, 12],
  ])
    hi.rect(ink, x, y, 2, 2);
});

icon('slots', (hi, part) => {
  const body = part('red', { bevel: true }),
    gold = part('gold', { bevel: true }),
    win = part('ink', { fixed: 0 });
  hi.rect(body, 1.0, 1.0, 11.6, 14);
  hi.rect(gold, 2.0, 2.0, 9.6, 2.0);
  hi.rect(win, 2.0, 5.0, 9.6, 5.0);
  const reel = part('paper', { fixed: 3 });
  for (let i = 0; i < 3; i++) hi.rect(reel, 3.0 + i * 3, 5.0, 2.0, 5.0);
  const a = part('red', { fixed: 2 }),
    b = part('gold', { fixed: 3 }),
    c = part('blue', { fixed: 2 });
  hi.rect(a, 3.0, 6.0, 2.0, 2.0).rect(b, 6.0, 7.0, 2.0, 2.0).rect(c, 9.0, 6.0, 2.0, 2.0);
  hi.rect(win, 3.0, 11.0, 7.0, 2.0);
  const steel = part('steel', { fixed: 3 }),
    ball = part('red', { round: 1.1 });
  hi.rect(steel, 13.0, 5.0, 1.0, 5.0);
  hi.ellipse(ball, 13.5, 3.6, 1.5, 1.5);
});

icon('cards', (hi, part) => {
  const back = part('blue', { bevel: true, steps: [0, 1, 2] }),
    pat = part('blue', { fixed: 3 });
  hi.rot(back, 5.6, 8.6, 8.0, 11.4, -9);
  hi.rot(pat, 5.6, 8.6, 4.6, 7.8, -9);
  const front = part('paper', { bevel: true, steps: [1, 3, 4] }),
    red = part('red', { fixed: 2 });
  hi.rot(front, 10.0, 8.0, 8.2, 11.8, 6);
  hi.ellipse(red, 9.3, 7.1, 1.3, 1.3)
    .ellipse(red, 11.9, 7.5, 1.3, 1.3)
    .poly(red, [
      [8.1, 7.9],
      [13.2, 8.3],
      [10.7, 10.9],
    ]);
});

icon('roulette', (hi, part) => {
  const rim = part('wood', { round: 1.6 });
  hi.ellipse(rim, 8, 8, 7.2, 7.2);
  const red = part('red', { fixed: 2 }),
    ink = part('ink', { fixed: 2 }),
    green = part('green', { fixed: 2 });
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2 - 0.2,
      a1 = ((i + 1) / N) * Math.PI * 2 - 0.2,
      pts = [];
    for (let k = 0; k <= 2; k++) {
      const a = a0 + ((a1 - a0) * k) / 2;
      pts.push([8 + 5.8 * Math.cos(a), 8 + 5.8 * Math.sin(a)]);
    }
    for (let k = 2; k >= 0; k--) {
      const a = a0 + ((a1 - a0) * k) / 2;
      pts.push([8 + 3.3 * Math.cos(a), 8 + 3.3 * Math.sin(a)]);
    }
    hi.poly(i === 0 ? green : i % 2 ? ink : red, pts);
  }
  const hub = part('gold', { round: 1.6 });
  hi.ellipse(hub, 8, 8, 2.6, 2.6);
  const ball = part('paper', { fixed: 4 });
  hi.ellipse(ball, 11.6, 3.6, 1.0, 1.0);
});

icon('pachinko', (hi, part) => {
  const frame = part('red', { bevel: true }),
    board = part('sky', { fixed: 1 });
  hi.rect(frame, 1.0, 1.0, 14, 14);
  hi.rect(board, 2.0, 2.0, 12, 9.0);
  const pin = part('gold', { fixed: 4 });
  for (const [x, y] of [
    [4, 3],
    [8, 3],
    [12, 3],
    [6, 5],
    [10, 5],
    [4, 7],
    [12, 7],
  ])
    hi.rect(pin, x, y, 1, 1);
  const cup = part('gold', { bevel: true });
  hi.poly(cup, [
    [5.6, 11.0],
    [5.6, 8.6],
    [10.4, 8.6],
    [10.4, 11.0],
  ]);
  const ball = part('steel', { round: 1.0, steps: [1, 3, 4] });
  hi.ellipse(ball, 8, 5.6, 1.2, 1.2);
  const tray = part('ink', { fixed: 1 });
  hi.rect(tray, 2.0, 12.0, 12.0, 2.0);
  hi.ellipse(ball, 4.5, 13.0, 0.9, 0.9)
    .ellipse(ball, 7.5, 13.0, 0.9, 0.9)
    .ellipse(ball, 10.5, 13.0, 0.9, 0.9);
});

icon('stocks', (hi, part) => {
  const panel = part('blue', { bevel: true, steps: [0, 0, 1] });
  hi.rect(panel, 1.0, 1.0, 14, 14);
  const up = part('green', { bevel: true }),
    dn = part('red', { bevel: true }),
    wick = part('paper', { fixed: 1 });
  hi.rect(wick, 3.5, 9, 1, 5).rect(up, 3.0, 10, 2, 3);
  hi.rect(wick, 6.5, 5, 1, 7).rect(dn, 6.0, 6, 2, 4);
  hi.rect(wick, 9.5, 7, 1, 6).rect(up, 9.0, 8, 2, 3);
  hi.rect(wick, 12.5, 2.5, 1, 7).rect(up, 12.0, 3.5, 2, 4);
});

icon('pickaxe', (hi, part) => {
  const wood = part('wood', { round: 0.9, steps: [1, 2, 3] });
  hi.line(wood, 3.0, 13.0, 11.0, 5.0, 1.8);
  const head = part('steel', { round: 1.1, steps: [1, 2, 4] });
  hi.poly(head, [
    [4.4, 3.0],
    [8.6, 1.4],
    [12.6, 2.4],
    [14.8, 5.6],
    [14.8, 10.2],
    [13.0, 8.8],
    [12.2, 6.0],
    [10.2, 4.6],
    [6.6, 4.4],
  ]);
});

icon('sword', (hi, part) => {
  const blade = part('steel', { round: 1.0, steps: [1, 3, 4] });
  hi.line(blade, 13.0, 3.0, 7.0, 9.0, 2.7).poly(blade, [
    [14.6, 1.2],
    [15.2, 1.2],
    [15.2, 4.6],
    [13.6, 4.2],
    [12.2, 2.4],
  ]);
  const guard = part('gold', { fixed: 2 }),
    guardLit = part('gold', { fixed: 4 });
  hi.line(guard, 4.2, 6.4, 9.6, 11.8, 1.8);
  hi.line(guardLit, 4.4, 6.2, 6.6, 8.4, 0.9);
  const grip = part('wood', { fixed: 2 });
  hi.line(grip, 6.0, 10.2, 4.0, 12.2, 1.6);
  const pom = part('gold', { round: 1.1 });
  hi.ellipse(pom, 3.2, 13.0, 1.3, 1.3);
});
