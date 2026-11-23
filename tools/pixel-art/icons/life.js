import { icon } from './kit.js';

icon('shop', (hi, part) => {
  const bag = part('orange', { bevel: true, steps: [1, 2, 3] });
  hi.rect(bag, 2.0, 5.0, 12, 10);
  const handle = part('orange', { fixed: 0 });
  hi.rect(handle, 5.0, 1.6, 1, 4).rect(handle, 10.0, 1.6, 1, 4).rect(handle, 5.0, 1.6, 6, 1);
  const tag = part('paper', { bevel: true, steps: [1, 3, 4] }),
    coin = part('gold', { fixed: 3 });
  hi.rect(tag, 5.0, 8.0, 6, 4);
  hi.rect(coin, 7.0, 9.0, 2, 2);
});

icon('market', (hi, part) => {
  const w = part('paper', { fixed: 4 }),
    r = part('red', { fixed: 2 }),
    rd = part('red', { fixed: 1 });
  hi.rect(r, 1.0, 3.0, 14, 3);
  for (let i = 0; i < 7; i++) if (i % 2) hi.rect(w, 1.0 + i * 2, 3.0, 2, 3);
  hi.poly(rd, [
    [1, 6],
    [15, 6],
    [14, 7.4],
    [2, 7.4],
  ]);
  const post = part('wood', { fixed: 2 });
  hi.rect(post, 2.0, 7.4, 1, 7).rect(post, 13.0, 7.4, 1, 7);
  const top = part('wood', { bevel: true, steps: [1, 2, 3] });
  hi.rect(top, 2.0, 10.4, 12, 1.6).rect(top, 2.0, 12.0, 12, 3);
  const fruit = [
    part('red', { round: 0.9 }),
    part('green', { round: 0.9 }),
    part('gold', { round: 0.9 }),
  ];
  hi.ellipse(fruit[0], 4.6, 9.2, 1.2, 1.2)
    .ellipse(fruit[1], 7.6, 9.2, 1.2, 1.2)
    .ellipse(fruit[2], 10.4, 9.2, 1.2, 1.2);
});

icon('crypto', (hi, part) => {
  const hex = part('violet', { round: 2.0, steps: [0, 1, 2] });
  hi.poly(hex, [
    [8, 0.9],
    [14.4, 4.4],
    [14.4, 11.6],
    [8, 15.1],
    [1.6, 11.6],
    [1.6, 4.4],
  ]);
  const face = part('violet', { round: 1.5, steps: [1, 2, 3] });
  hi.poly(face, [
    [8, 2.6],
    [12.9, 5.3],
    [12.9, 10.7],
    [8, 13.4],
    [3.1, 10.7],
    [3.1, 5.3],
  ]);
  const bolt = part('gold', { fixed: 3 });
  hi.poly(bolt, [
    [9.4, 3.4],
    [5.4, 8.6],
    [7.7, 8.6],
    [6.6, 12.6],
    [10.8, 7.2],
    [8.4, 7.2],
  ]);
});

icon('bank', (hi, part) => {
  const roof = part('stone', { bevel: true, steps: [1, 3, 4] }),
    base = part('stone', { bevel: true, steps: [1, 3, 4] });
  hi.poly(roof, [
    [8, 1.0],
    [15, 5.2],
    [1, 5.2],
  ]);
  hi.rect(base, 1.0, 5.2, 14, 1.4);
  const col = part('stone', { bevel: true, steps: [1, 3, 4] });
  for (const x of [2.4, 5.6, 8.8, 12.0]) hi.rect(col, x, 7.0, 1.8, 5.4);
  hi.rect(base, 1.0, 12.6, 14, 2.4);
  const coin = part('gold', { round: 1.0, steps: [1, 2, 4] });
  hi.ellipse(coin, 8, 3.8, 1.2, 1.2);
});

icon('loan', (hi, part) => {
  const bill = part('green', { bevel: true, steps: [1, 2, 3] });
  hi.rect(bill, 1.0, 3.0, 14, 10);
  const mark = part('green', { fixed: 4 }),
    inset = part('green', { fixed: 0 });
  hi.rect(inset, 2.0, 4.0, 12, 8).erase((x, y) => x < 2 || y < 4 || x > 14 || y > 12);
  hi.rect(part('green', { fixed: 2 }), 2.4, 4.4, 11.2, 7.2);
  // percent sign: two dots and a slash
  hi.rect(mark, 5.0, 5.4, 2, 2).rect(mark, 9.0, 8.6, 2, 2);
  hi.line(mark, 10.2, 5.2, 5.8, 10.8, 1.0);
});

icon('company', (hi, part) => {
  const b = part('stone', { bevel: true, steps: [0, 1, 2] }),
    t = part('stone', { bevel: true, steps: [1, 2, 3] });
  hi.rect(t, 2.0, 3.0, 8, 12).rect(b, 9.0, 6.0, 5, 9);
  const win = part('sky', { fixed: 3 }),
    lit = part('gold', { fixed: 3 });
  for (let y = 4.4; y < 14; y += 2.6) {
    hi.rect(win, 3.4, y, 1.6, 1.4).rect(lit, 6.4, y, 1.6, 1.4);
  }
  for (let y = 7.4; y < 14; y += 2.6) hi.rect(lit, 10.6, y, 1.4, 1.2);
  hi.rect(part('ink', { fixed: 1 }), 5.0, 12.6, 2, 2.4);
});

icon('transfer', (hi, part) => {
  const g = part('green', { bevel: true, steps: [1, 2, 3] }),
    b = part('sky', { bevel: true, steps: [1, 2, 3] });
  hi.rect(g, 1.0, 3.4, 9, 3.2).poly(g, [
    [9, 1.2],
    [15, 5],
    [9, 8.8],
  ]);
  hi.rect(b, 6.0, 9.4, 9, 3.2).poly(b, [
    [7, 7.2],
    [1, 11],
    [7, 14.8],
  ]);
});

icon('trophy', (hi, part) => {
  const cup = part('gold', { round: 1.6, steps: [0, 2, 3], dither: false });
  hi.poly(cup, [
    [3.4, 1.6],
    [12.6, 1.6],
    [12.0, 7.4],
    [9.2, 10.0],
    [6.8, 10.0],
    [4.0, 7.4],
  ]);
  const handle = part('gold', { fixed: 1 });
  hi.rect(handle, 1.0, 2.6, 2, 1).rect(handle, 1.0, 2.6, 1, 3.6).rect(handle, 1.0, 5.4, 3, 1);
  hi.rect(handle, 13.0, 2.6, 2, 1).rect(handle, 14.0, 2.6, 1, 3.6).rect(handle, 12.0, 5.4, 3, 1);
  hi.rect(part('gold', { bevel: true }), 7.0, 10.0, 2, 2.4);
  hi.rect(part('gold', { bevel: true }), 4.4, 12.4, 7.2, 2.6);
  hi.poly(part('gold', { fixed: 4 }), [
    [8, 3.4],
    [8.8, 5.2],
    [10.6, 5.3],
    [9.2, 6.4],
    [9.7, 8.2],
    [8, 7.2],
    [6.3, 8.2],
    [6.8, 6.4],
    [5.4, 5.3],
    [7.2, 5.2],
  ]);
});

icon('quiz', (hi, part) => {
  const bub = part('sky', { round: 2.0, steps: [0, 1, 2] });
  hi.rrect(bub, 1.2, 1.2, 13.6, 10.6, 3.2);
  hi.poly(bub, [
    [3.4, 10.4],
    [3.4, 15],
    [8, 11],
  ]);
  const q = part('paper', { fixed: 4 });
  hi.cells(
    5,
    3,
    ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'].map((r) =>
      r.replace(/#/g, '#'),
    ),
    { '#': q },
  );
});

icon('lottery', (hi, part) => {
  const ball = part('gold', { round: 3.0, steps: [0, 2, 3] });
  hi.ellipse(ball, 8, 8, 7, 7);
  hi.ellipse(part('paper', { fixed: 4 }), 8, 8, 4.1, 4.1);
  hi.cells(6, 5, ['###', '..#', '.#.', '.#.', '.#.'], { '#': part('red', { fixed: 2 }) });
});

icon('poll', (hi, part) => {
  const box = part('blue', { bevel: true, steps: [1, 2, 3] });
  hi.rect(box, 1.6, 7.0, 12.8, 8);
  hi.rect(part('ink', { fixed: 1 }), 4.0, 7.6, 8, 1.4);
  const paper = part('paper', { bevel: true, steps: [1, 3, 4] });
  hi.rect(paper, 4.6, 1.2, 6.8, 7.0);
  const chk = part('green', { fixed: 2 });
  hi.cells(
    5.6,
    2.8,
    ['.....#', '....#.', '#..#..', '.##...'].map((r) => r),
    { '#': chk },
  );
  hi.rect(part('paper', { fixed: 4 }), 6.4, 11.4, 3.2, 1);
});

icon('missions', (hi, part) => {
  const board = part('wood', { bevel: true, steps: [1, 2, 3] }),
    sheet = part('paper', { bevel: true, steps: [1, 3, 4] });
  hi.rect(board, 2.0, 1.6, 12, 13.4);
  hi.rect(sheet, 3.2, 3.4, 9.6, 10.4);
  hi.rect(part('steel', { bevel: true, steps: [0, 2, 4] }), 5.6, 0.8, 4.8, 2.4);
  const ink = part('ink', { fixed: 2 }),
    chk = part('green', { fixed: 2 });
  for (let i = 0; i < 3; i++) {
    hi.rect(chk, 4.2, 5.0 + i * 2.8, 1.4, 1.4);
    hi.rect(ink, 6.8, 5.4 + i * 2.8, 4.6, 0.8);
  }
});

icon('daily', (hi, part) => {
  const box = part('red', { bevel: true, steps: [1, 2, 3] }),
    lid = part('red', { bevel: true, steps: [1, 2, 3] });
  hi.rect(box, 2.2, 7.0, 11.6, 8);
  hi.rect(lid, 1.2, 4.6, 13.6, 3.0);
  const rib = part('gold', { bevel: true, steps: [1, 2, 3] });
  hi.rect(rib, 7.0, 4.6, 2.2, 10.4);
  hi.ellipse(rib, 5.8, 3.4, 1.8, 1.4).ellipse(rib, 10.4, 3.4, 1.8, 1.4);
  hi.ellipse(part('gold', { round: 1.0 }), 8.1, 4.1, 1.2, 1.2);
});

icon('inventory', (hi, part) => {
  const chest = part('wood', { bevel: true, steps: [1, 2, 3] }),
    lid = part('wood', { round: 1.6, steps: [1, 2, 3] });
  hi.rect(chest, 1.4, 7.4, 13.2, 7.6);
  hi.rrect(lid, 1.4, 2.4, 13.2, 5.8, 2.6);
  const band = part('gold', { bevel: true, steps: [0, 2, 3] });
  hi.rect(band, 1.4, 7.4, 13.2, 1.4)
    .rect(band, 3.4, 2.6, 1.4, 12.4)
    .rect(band, 11.2, 2.6, 1.4, 12.4);
  hi.rect(part('gold', { bevel: true, steps: [1, 3, 4] }), 6.8, 6.6, 2.4, 3.2);
  hi.rect(part('ink', { fixed: 1 }), 7.6, 7.8, 0.9, 1.3);
});

icon('relic', (hi, part) => {
  const v = part('orange', { round: 2.2, steps: [0, 1, 2], dither: false });
  hi.ellipse(v, 8, 10.2, 4.8, 4.4);
  hi.rect(v, 6.4, 3.2, 3.2, 4.4);
  hi.rect(part('orange', { bevel: true, steps: [1, 2, 3] }), 5.2, 1.4, 5.6, 2);
  hi.rect(part('orange', { bevel: true, steps: [1, 2, 3] }), 6.0, 14.2, 4, 1.2);
  const h = part('orange', { fixed: 1 });
  hi.rect(h, 3.4, 4.2, 3, 1).rect(h, 3.4, 4.2, 1, 4.6).rect(h, 3.4, 7.8, 1.6, 1);
  hi.rect(h, 9.6, 4.2, 3, 1).rect(h, 11.6, 4.2, 1, 4.6).rect(h, 11.0, 7.8, 1.6, 1);
  const band = part('teal', { fixed: 3 }),
    band2 = part('teal', { fixed: 1 });
  hi.rect(band, 3.6, 9.0, 8.8, 1.4).rect(band2, 3.6, 10.4, 8.8, 0.8);
  const crack = part('orange', { fixed: 0 });
  hi.rect(crack, 7.0, 11.8, 1, 1).rect(crack, 8.0, 12.8, 1, 1).rect(crack, 6.0, 4.8, 1, 1);
});

icon('history', (hi, part) => {
  const rim = part('steel', { round: 1.8, steps: [0, 2, 3] }),
    face = part('paper', { round: 1.5, steps: [2, 3, 4] });
  hi.ellipse(rim, 8.5, 8.5, 6.5, 6.5);
  hi.ellipse(face, 8.5, 8.5, 5.1, 5.1);
  const hand = part('ink', { fixed: 1 });
  hi.rect(hand, 8.0, 4.4, 1, 4.6).rect(hand, 8.0, 8.4, 3.4, 1);
  const arrow = part('sky', { fixed: 2 });
  hi.poly(arrow, [
    [0.6, 4.0],
    [4.0, 3.6],
    [2.0, 7.0],
  ]);
});

icon('profile', (hi, part) => {
  const sh = part('blue', { round: 2.0, steps: [0, 1, 2] });
  hi.ellipse(sh, 8, 16, 6.6, 5.4);
  const head = part('skin', { round: 2.0, steps: [1, 2, 3] });
  hi.ellipse(head, 8, 6, 3.7, 4.1);
  const hair = part('wood', { round: 1.4, steps: [0, 1, 2] });
  hi.ellipse(hair, 8, 4.0, 3.9, 2.3).rect(hair, 4.2, 4.0, 1.2, 3.0);
  hi.erase((x, y) => y < 4.4 && x > 9.8 && (x - 8) ** 2 + (y - 4) ** 2 > 14);
  hi.rect(part('ink', { fixed: 1 }), 6.2, 6.4, 1, 1).rect(
    part('ink', { fixed: 1 }),
    9.4,
    6.4,
    1,
    1,
  );
});
