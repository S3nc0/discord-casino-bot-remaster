// Ores and relics dug up in the mine: 16 by 16, drawn like the game icons (icons/kit.js: shapes
// at 8x, lit from the top left, cut into cells, selective outline in each part's own colours).
import { icon, make } from '../icons/kit.js';
import { mat } from '../lib/palette.js';

export const ORES = ['coal', 'copper', 'silver', 'gold', 'diamond', 'legend'];
export const RELICS = [
  'relic_fossil',
  'relic_bone',
  'relic_meteor',
  'relic_vase',
  'relic_crown',
  'relic_tear',
];

/** A lump of rock: an irregular polygon around (cx, cy). */
const lump = (cx, cy, r, seed = 1) =>
  Array.from({ length: 9 }, (_, i) => {
    const a = (i / 9) * Math.PI * 2;
    const k = 0.78 + (((i * 37 + seed * 11) % 10) / 10) * 0.3;
    return [cx + Math.cos(a) * r * k * 1.15, cy + Math.sin(a) * r * k * 0.9];
  });

icon('ore-coal', (hi, part) => {
  const rock = part('ink', { round: 1.6, steps: [1, 2, 4] });
  hi.poly(rock, lump(8, 9, 5.6, 1));
  const shine = part('steel', { fixed: 3 });
  hi.rect(shine, 5, 6, 1, 1).rect(shine, 9, 8, 1, 1).rect(shine, 6, 11, 1, 1);
});

icon('ore-copper', (hi, part) => {
  const rock = part('stone', { round: 1.6, steps: [0, 1, 2] });
  hi.poly(rock, lump(8, 9.4, 5.6, 2));
  const cu = part('orange', { round: 0.9, steps: [0, 1, 3] });
  hi.ellipse(cu, 6.2, 8, 1.8, 1.4).ellipse(cu, 10, 10.4, 1.6, 1.3);
  const patina = part('teal', { fixed: 3 });
  hi.rect(patina, 9, 6, 1, 1).rect(patina, 4, 11, 1, 1).rect(patina, 11, 12, 1, 1);
});

icon('ore-silver', (hi, part) => {
  const rock = part('ink', { round: 1.6, steps: [2, 3, 4] });
  hi.poly(rock, lump(8, 9.4, 5.6, 3));
  const vein = part('steel', { round: 0.6, steps: [3, 4, 4] });
  hi.line(vein, 4.5, 11, 8, 8, 1.4)
    .line(vein, 8, 8, 11.5, 7.4, 1.4)
    .ellipse(vein, 9.6, 10.4, 1.3, 1.1);
});

icon('ore-gold', (hi, part) => {
  const rock = part('stone', { round: 1.6, steps: [0, 1, 2] });
  hi.poly(rock, lump(8, 9.6, 5.4, 4));
  const au = part('gold', { round: 1.2, steps: [1, 2, 4] });
  hi.poly(au, [
    [5, 7],
    [8.4, 5.6],
    [11, 7.4],
    [10.6, 10.6],
    [7.4, 11.6],
    [5, 10],
  ]);
});

icon('ore-diamond', (hi, part) => {
  const crown = part('sky', { fixed: 4 }),
    pav = part('sky', { bevel: true, steps: [1, 2, 3] });
  hi.poly(crown, [
    [4, 5],
    [12, 5],
    [14, 7.4],
    [2, 7.4],
  ]);
  hi.poly(pav, [
    [2, 7.4],
    [14, 7.4],
    [8, 14],
  ]);
  const facet = part('sky', { fixed: 1 });
  hi.line(facet, 8, 7.4, 8, 13.4, 0.9).line(facet, 5.2, 7.4, 7.6, 13, 0.7);
});

icon('ore-legend', (hi, part) => {
  const base = part('stone', { round: 1.4, steps: [0, 1, 2] });
  hi.poly(base, lump(8, 12.4, 4.6, 6));
  const c1 = part('violet', { bevel: true, steps: [1, 3, 4] }),
    c2 = part('blue', { bevel: true, steps: [1, 3, 4] });
  hi.poly(c1, [
    [6, 12],
    [6.4, 4],
    [8, 1.6],
    [9.6, 4],
    [10, 12],
  ]);
  hi.poly(c2, [
    [9.6, 12.4],
    [11.4, 6.4],
    [13, 5.4],
    [13.4, 8],
    [12, 12.6],
  ]);
  hi.poly(c2, [
    [3, 12.6],
    [2.6, 8.4],
    [3.6, 6.8],
    [5.4, 8.6],
    [6, 12.6],
  ]);
});

icon('relic_fossil', (hi, part) => {
  const slab = part('stone', { round: 1.2, steps: [1, 2, 3] });
  hi.rrect(slab, 1.4, 2.4, 13.2, 11.6, 2.2);
  const tri = part('wood', { round: 1.2, steps: [1, 2, 3] });
  hi.ellipse(tri, 8, 8.2, 3.6, 4.6);
  const seg = part('wood', { fixed: 0 });
  for (const y of [6, 7.6, 9.2, 10.8]) hi.rect(seg, 5, y, 6, 0.5);
  hi.rect(seg, 7.75, 4, 0.5, 8);
});

icon('relic_bone', (hi, part) => {
  const bone = part('paper', { round: 1.3, steps: [0, 2, 4] });
  hi.line(bone, 4.4, 11.6, 11.6, 4.4, 2.4);
  hi.ellipse(bone, 3.2, 11, 1.6, 1.6).ellipse(bone, 5, 12.8, 1.6, 1.6);
  hi.ellipse(bone, 11, 3.2, 1.6, 1.6).ellipse(bone, 12.8, 5, 1.6, 1.6);
});

icon('relic_meteor', (hi, part) => {
  const rock = part('ink', { round: 1.8, steps: [2, 3, 4] });
  hi.poly(rock, lump(8, 8.6, 6, 8));
  const hot = part('orange', { fixed: 3 }),
    core = part('gold', { fixed: 4 });
  hi.line(hot, 5, 6, 8, 9, 0.9).line(hot, 8, 9, 11.4, 8, 0.9).line(hot, 8, 9, 7.4, 12.4, 0.9);
  hi.rect(core, 7.6, 8.6, 1, 1);
});

icon('relic_vase', (hi, part) => {
  const clay = part('orange', { round: 1.8, steps: [0, 1, 2] });
  hi.ellipse(clay, 8, 9.8, 4.4, 4.4);
  hi.rect(clay, 6.4, 2.6, 3.2, 4);
  hi.rect(clay, 5.4, 1.6, 5.2, 1.4);
  const band = part('ink', { fixed: 2 });
  hi.rect(band, 3.8, 8.6, 8.4, 1.2);
  const handle = part('orange', { fixed: 0 });
  hi.rect(handle, 4.6, 4.2, 1, 3).rect(handle, 10.4, 4.2, 1, 3);
});

icon('relic_crown', (hi, part) => {
  const gold = part('gold', { bevel: true, steps: [1, 2, 3] });
  hi.poly(gold, [
    [2, 12.4],
    [2, 5],
    [5, 8],
    [8, 3.4],
    [11, 8],
    [14, 5],
    [14, 12.4],
  ]);
  const band = part('gold', { fixed: 1 });
  hi.rect(band, 2, 11, 12, 1.6);
  const ruby = part('red', { fixed: 3 }),
    sap = part('blue', { fixed: 3 });
  hi.rect(ruby, 7.4, 8.4, 1.4, 1.4).rect(sap, 4, 9.6, 1, 1).rect(sap, 11, 9.6, 1, 1);
});

icon('relic_tear', (hi, part) => {
  const gem = part('teal', { round: 2.2, steps: [1, 2, 3] });
  hi.ellipse(gem, 8, 10, 4.2, 4.2);
  hi.poly(gem, [
    [4.2, 8.6],
    [8, 1.6],
    [11.8, 8.6],
  ]);
  const glint = part('sky', { fixed: 4 });
  hi.rect(glint, 6, 7, 1, 2).rect(glint, 7, 6, 1, 1);
});

const KEY = {
  coal: 'ore-coal',
  copper: 'ore-copper',
  silver: 'ore-silver',
  gold: 'ore-gold',
  diamond: 'ore-diamond',
  legend: 'ore-legend',
};
/** The finished 16x16 buffer of an ore id or relic id. */
export const find = (id) => make(KEY[id] ?? id).buf;
export { mat };
