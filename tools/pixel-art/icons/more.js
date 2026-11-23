import { icon } from './kit.js';

icon('coin', (hi, part) => {
  const rim = part('gold', { round: 2.0, steps: [0, 1, 2] }),
    face = part('gold', { round: 1.2, steps: [1, 2, 3] });
  hi.ellipse(rim, 8, 8, 7, 7);
  hi.ellipse(face, 8, 8, 5.3, 5.3);
  const mark = part('gold', { fixed: 0 });
  // a P for Pelica, 3 by 5 cells
  hi.cells(
    6,
    5,
    ['PPP', 'P.P', 'PPP', 'P..', 'P..'].map((r) => r.replace(/P/g, '#')),
    { '#': mark },
  );
});

icon('clover', (hi, part) => {
  const leaf = part('green', { round: 1.6, steps: [1, 2, 3], dither: false });
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const cx = 8 + dx * 3.1,
      cy = 7 + dy * 3.1,
      px = -dy * 0.5,
      py = dx * 0.5;
    hi.ellipse(leaf, cx + px * 1.4, cy + py * 1.4, 2.1, 2.1).ellipse(
      leaf,
      cx - px * 1.4,
      cy - py * 1.4,
      2.1,
      2.1,
    );
    hi.poly(leaf, [
      [8, 7],
      [cx + px * 3.2, cy + py * 3.2],
      [cx - px * 3.2, cy - py * 3.2],
    ]);
  }
  const crease = part('green', { fixed: 0 });
  hi.rect(crease, 7.5, 2.6, 1, 10).rect(crease, 2.6, 6.5, 10.8, 1);
  hi.erase(
    (x, y) =>
      (Math.abs(x - 8) < 0.5 && y < 2.6) || (Math.abs(y - 7) < 0.5 && (x < 2.6 || x > 13.4)),
  );
  const stem = part('green', { fixed: 1 });
  hi.line(stem, 8, 8, 8.4, 12, 0.9).line(stem, 8.4, 12, 6.8, 14.8, 0.9);
});

icon('crown', (hi, part) => {
  const c = part('gold', { round: 1.3, steps: [0, 2, 3] });
  hi.poly(c, [
    [2, 11],
    [1.4, 4.6],
    [5.4, 8.0],
    [8, 3.0],
    [10.6, 8.0],
    [14.6, 4.6],
    [14, 11],
  ]);
  hi.rect(part('gold', { bevel: true }), 2, 10.4, 12, 3.8);
  for (const x of [1.4, 8, 14.6])
    hi.ellipse(part('gold', { round: 1, steps: [1, 3, 4] }), x, x === 8 ? 2.8 : 4.4, 1.2, 1.2);
  hi.rect(part('red', { fixed: 2 }), 7, 11.4, 2, 2);
  hi.rect(part('blue', { fixed: 2 }), 3.4, 11.4, 1.6, 1.6).rect(
    part('blue', { fixed: 2 }),
    11,
    11.4,
    1.6,
    1.6,
  );
});

icon('ticket', (hi, part) => {
  const t = part('orange', { bevel: true, steps: [1, 2, 3] });
  hi.rect(t, 1, 3.4, 14, 9.2);
  hi.erase(
    (x, y) => (x - 1) ** 2 + (y - 8) ** 2 < 1.6 ** 2 || (x - 15) ** 2 + (y - 8) ** 2 < 1.6 ** 2,
  );
  const line = part('orange', { fixed: 0 });
  for (let y = 4.2; y < 12; y += 1.8) hi.rect(line, 10.2, y, 1, 0.9);
  const star = part('paper', { fixed: 4 });
  hi.poly(star, [
    [5.8, 5],
    [6.8, 7.2],
    [9, 7.4],
    [7.3, 8.8],
    [7.9, 11],
    [5.8, 9.8],
    [3.7, 11],
    [4.3, 8.8],
    [2.6, 7.4],
    [4.8, 7.2],
  ]);
});

icon('shield', (hi, part) => {
  const s = part('blue', { round: 1.8, steps: [0, 1, 2] });
  hi.poly(s, [
    [2, 2.2],
    [8, 1],
    [14, 2.2],
    [13.6, 9],
    [8, 15],
    [2.4, 9],
  ]);
  const inner = part('sky', { round: 1.4, steps: [1, 2, 3] });
  hi.poly(inner, [
    [3.6, 3.6],
    [8, 2.8],
    [12.4, 3.6],
    [12, 8.6],
    [8, 13],
    [4, 8.6],
  ]);
  const star = part('gold', { fixed: 3 });
  hi.poly(star, [
    [8, 4.6],
    [9, 7],
    [11.4, 7.1],
    [9.5, 8.7],
    [10.2, 11],
    [8, 9.6],
    [5.8, 11],
    [6.5, 8.7],
    [4.6, 7.1],
    [7, 7],
  ]);
});

icon('flame', (hi, part) => {
  const o = part('red', { round: 2.2, steps: [0, 1, 2] });
  hi.ellipse(o, 8, 10, 5.2, 5);
  hi.poly(o, [
    [3.6, 8.6],
    [5.6, 4.6],
    [8.4, 1.0],
    [8.8, 5.0],
    [11.4, 3.4],
    [12.8, 9],
  ]);
  const m = part('orange', { round: 1.8, steps: [1, 2, 3] });
  hi.ellipse(m, 8.2, 10.8, 3.4, 3.6);
  hi.poly(m, [
    [5.2, 9.4],
    [8.4, 4.4],
    [9.6, 7.4],
    [11, 9.4],
  ]);
  const c = part('gold', { round: 1.2, steps: [2, 3, 4] });
  hi.ellipse(c, 8.2, 11.8, 1.9, 2.1);
  hi.poly(c, [
    [6.4, 11],
    [8.2, 8],
    [10, 11],
  ]);
});

icon('gem', (hi, part) => {
  const T = part('sky', { fixed: 4 }),
    L = part('sky', { fixed: 3 }),
    M = part('sky', { fixed: 2 }),
    D = part('sky', { fixed: 1 }),
    DD = part('sky', { fixed: 0 });
  hi.poly(L, [
    [4.4, 2.2],
    [8, 2.2],
    [6.2, 6.4],
    [1.2, 6.4],
  ]);
  hi.poly(T, [
    [8, 2.2],
    [11.6, 2.2],
    [14.8, 6.4],
    [9.8, 6.4],
  ]);
  hi.poly(M, [
    [6.2, 6.4],
    [8, 2.2],
    [9.8, 6.4],
  ]);
  hi.poly(M, [
    [1.2, 6.4],
    [6.2, 6.4],
    [8, 14.8],
  ]);
  hi.poly(D, [
    [6.2, 6.4],
    [9.8, 6.4],
    [8, 14.8],
  ]);
  hi.poly(DD, [
    [9.8, 6.4],
    [14.8, 6.4],
    [8, 14.8],
  ]);
});

icon('carrot', (hi, part) => {
  const c = part('orange', { round: 1.1, steps: [1, 2, 3] });
  hi.poly(c, [
    [3.4, 6.0],
    [8.6, 5.0],
    [14.6, 14.6],
    [4.8, 10.8],
  ]);
  hi.line(c, 3.6, 6.4, 12.8, 13.6, 3.6);
  const g = part('green', { round: 0.8, steps: [1, 2, 3] });
  hi.line(g, 4.4, 5.2, 2.0, 1.6, 1.3)
    .line(g, 5.0, 5.0, 5.6, 1.2, 1.3)
    .line(g, 5.6, 5.8, 9.2, 2.6, 1.3);
  const l = part('orange', { fixed: 0 });
  hi.rect(l, 7, 8.2, 1.6, 0.8).rect(l, 9.4, 10.4, 1.6, 0.8).rect(l, 6, 6.8, 1.2, 0.8);
});

icon('drink', (hi, part) => {
  const cap = part('red', { bevel: true });
  hi.rect(cap, 5.4, 1.2, 5.2, 2.0);
  const glass = part('paper', { bevel: true, steps: [1, 3, 4] });
  hi.rect(glass, 6.2, 3.2, 3.6, 2.4);
  hi.poly(glass, [
    [6.2, 5.4],
    [9.8, 5.4],
    [12.2, 8],
    [12.2, 14.6],
    [3.8, 14.6],
    [3.8, 8],
  ]);
  const liquid = part('green', { bevel: true, steps: [1, 2, 3] });
  hi.rect(liquid, 4.6, 8.4, 6.8, 5.4);
  const label = part('gold', { fixed: 3 }),
    bolt = part('gold', { fixed: 0 });
  hi.rect(label, 4.6, 9.6, 6.8, 2.8);
  hi.poly(bolt, [
    [8.6, 9.6],
    [6.6, 11.2],
    [7.8, 11.2],
    [7.2, 12.4],
    [9.4, 10.8],
    [8.2, 10.8],
  ]);
});
