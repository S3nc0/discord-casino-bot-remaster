// Slot reel symbols, 32 by 32, one per SLOT_SYMBOLS entry: cherry, lemon, grape, bell, diamond, 7.
// Round parts are lit by their shape, flat parts (leaf, the 7) by bevel and fixed steps.
import { cmat, hiSprite, sphere } from './kit.js';

const S = 32;

function cherry() {
  return hiSprite(S, S, (hi, part) => {
    const stem = part('leaf', { fixed: 1 }),
      leaf = part('leaf', { round: 2.2, steps: [1, 2, 3] }),
      vein = part('leaf', { fixed: 0 }),
      red = part('cherry', { round: 5.5, steps: [1, 2, 3] }),
      red2 = part('cherry', { round: 5.5, steps: [0, 1, 2] }),
      shine = part('cherry', { fixed: 4 });
    // stems from the knot at the top to each cherry
    hi.line(stem, 17, 5, 10, 18, 1.6).line(stem, 17, 5, 22, 20, 1.6);
    hi.poly(leaf, [
      [17.5, 5],
      [21, 2.2],
      [26.5, 2.6],
      [29, 5.2],
      [25, 8],
      [20, 7.6],
    ]);
    hi.line(vein, 18.6, 5.2, 26.4, 4.8, 0.9);
    hi.ellipse(red2, 21.6, 22.6, 7.2, 7.0);
    hi.ellipse(red, 10.6, 21.2, 7.4, 7.2);
    hi.ellipse(shine, 8.0, 17.6, 1.4, 1.6).ellipse(shine, 19.4, 19.2, 1.1, 1.3);
  });
}

function lemon() {
  return hiSprite(S, S, (hi, part) => {
    const body = part('lemon', { round: 9, steps: [1, 3, 4], gain: 2.0 }),
      tip = part('lemon', { round: 2, steps: [1, 2, 3] }),
      leaf = part('leaf', { round: 2, steps: [1, 2, 3] }),
      shine = part('paper', { fixed: 4 });
    hi.ellipse(tip, 4.6, 19.6, 2.6, 2.2, -0.35).ellipse(tip, 27.2, 12.6, 2.6, 2.2, -0.35);
    hi.ellipse(body, 16, 16.4, 12.2, 9.4, -0.35);
    hi.poly(leaf, [
      [22, 6.2],
      [25.4, 1.8],
      [30.6, 1.4],
      [28.8, 5.2],
      [24.6, 7.6],
    ]);
    hi.ellipse(shine, 10.6, 12.4, 3.2, 1.3, -0.4);
  });
}

function grape() {
  return hiSprite(S, S, (hi, part) => {
    const stem = part('wood', { fixed: 2 }),
      leaf = part('leaf', { round: 2.4, steps: [1, 2, 3] }),
      vein = part('leaf', { fixed: 1 });
    hi.line(stem, 16, 2, 15.4, 8, 1.8);
    hi.poly(leaf, [
      [16.6, 5],
      [20, 1.4],
      [27, 1.6],
      [30, 5.6],
      [26, 9.2],
      [19.6, 9],
    ]);
    hi.line(vein, 17.6, 5.4, 27, 5.2, 0.9);
    return (buf) => {
      // berries, back rows first so the front ones sit on top, each with a dark rim
      const g = cmat('grape');
      const rows = [
        [10.5, [8.5, 16, 23.5]],
        [16.5, [5, 12.2, 19.8, 27]],
        [22.5, [8.5, 16, 23.5]],
        [28, [12.2, 19.8]],
      ];
      for (const [y, xs] of rows)
        for (const x of xs) sphere(buf, x, y, 3.6, g, { rim: true, hlr: 0.3 });
    };
  });
}

function bell() {
  return hiSprite(S, S, (hi, part) => {
    const knob = part('gold', { round: 1.6 }),
      body = part('gold', { round: 8, steps: [0, 2, 3] }),
      lip = part('gold', { round: 2, steps: [0, 1, 3] }),
      clap = part('brass', { round: 2, steps: [0, 1, 2] }),
      band = part('orange', { fixed: 1 }),
      shine = part('gold', { fixed: 4 });
    hi.ellipse(clap, 16, 28.4, 3, 2.6);
    hi.ellipse(knob, 16, 3.6, 2.4, 2.4);
    // bell: a dome on top, sides that flare out to the lip
    hi.ellipse(body, 16, 13.4, 9, 8.4);
    hi.poly(body, [
      [7, 13.4],
      [25, 13.4],
      [26.6, 22],
      [29.4, 25.2],
      [2.6, 25.2],
      [5.4, 22],
    ]);
    hi.ellipse(lip, 16, 25.4, 14, 2.6);
    hi.rect(band, 6, 20.6, 20, 1.1);
    hi.line(shine, 10.4, 8.6, 8.8, 18.4, 1.6);
  });
}

function diamond() {
  return hiSprite(S, S, (hi, part) => {
    // brilliant cut seen from the side: a crown of facets over a pointed pavilion
    const f = [0, 1, 2, 3, 4].map((s) => part('diamond', { fixed: s }));
    const top = 7,
      girdle = 14,
      tip = 30;
    // crown: table and two rows of facets, light from the top left
    hi.poly(f[3], [
      [10, top],
      [22, top],
      [20, girdle - 3],
      [12, girdle - 3],
    ]);
    hi.poly(f[4], [
      [4, girdle],
      [10, top],
      [12, girdle - 3],
      [9, girdle],
    ]);
    hi.poly(f[2], [
      [22, top],
      [28, girdle],
      [23, girdle],
      [20, girdle - 3],
    ]);
    hi.poly(f[3], [
      [9, girdle],
      [12, girdle - 3],
      [16, girdle],
    ]);
    hi.poly(f[2], [
      [12, girdle - 3],
      [20, girdle - 3],
      [16, girdle],
    ]);
    hi.poly(f[1], [
      [16, girdle],
      [20, girdle - 3],
      [23, girdle],
    ]);
    // pavilion: long facets meeting at the tip, darker toward the right
    const pav = [
      [4, 9, 3],
      [9, 16, 2],
      [16, 23, 1],
      [23, 28, 0],
    ];
    for (const [a, b, s] of pav)
      hi.poly(f[s], [
        [a, girdle],
        [b, girdle],
        [16, tip],
      ]);
    hi.poly(f[4], [
      [9, girdle],
      [12.6, girdle],
      [16, tip],
    ]);
    hi.rect(f[4], 12, top + 1, 2, 1);
  });
}

function seven() {
  return hiSprite(S, S, (hi, part) => {
    const edge = part('gold', { bevel: true, steps: [1, 3, 4] }),
      body = part('cherry', { bevel: true, steps: [1, 2, 3] });
    const outer = [
      [3.4, 2.6],
      [28.8, 2.6],
      [28.8, 8.4],
      [18.6, 29.4],
      [9.8, 29.4],
      [19.8, 9.2],
      [9.6, 9.2],
      [9.6, 12],
      [3.4, 12],
    ];
    hi.poly(edge, outer);
    hi.poly(body, [
      [5.6, 4.8],
      [26.6, 4.8],
      [26.6, 7.8],
      [17.2, 27.2],
      [13.4, 27.2],
      [23.2, 7.0],
      [7.6, 7.0],
      [7.6, 9.8],
      [5.6, 9.8],
    ]);
  });
}

const SYMBOLS = { '🍒': cherry, '🍋': lemon, '🍇': grape, '🔔': bell, '💎': diamond, '7️⃣': seven };
const SYMBOL_NAMES = {
  '🍒': 'cherry',
  '🍋': 'lemon',
  '🍇': 'grape',
  '🔔': 'bell',
  '💎': 'diamond',
  '7️⃣': 'seven',
};
export { SYMBOLS, SYMBOL_NAMES, cherry, lemon, grape, bell, diamond, seven };
