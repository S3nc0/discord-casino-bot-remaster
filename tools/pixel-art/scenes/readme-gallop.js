// The gallop gif for the README: the eight race frames (shipped data, horse-art.ts) coloured as
// horse.css colours them, galloping in place on the night turf of the race scene with dust behind.
// Run from the repo root:  node tools/pixel-art/scenes/readme-gallop.js [outFile]
import fs from 'node:fs';
import path from 'node:path';
import { P } from '../lib/env.js';
import { ROOT, T, paste } from './kit.js';
import { lane, laneDark, innerRail, dust } from './race.js';

const css = fs.readFileSync(path.join(ROOT, 'apps/web/src/screens/horse/horse.css'), 'utf8');
const art = fs.readFileSync(path.join(ROOT, 'apps/web/src/screens/horse/horse-art.ts'), 'utf8');
const vars = (sel) => {
  const body = css.slice(css.indexOf(`${sel} {`)).split('}')[0];
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*var\(--([\w-]+)\)/g)].map((m) => [m[1], m[2]]),
  );
};
const fills = Object.fromEntries(
  [...css.matchAll(/\.hr-px-(\w) \{\s*fill: var\((--[\w-]+)\);/g)].map((m) => [m[1], m[2]]),
);
const theme = { ...vars('.hr-horse'), ...vars('.hr-coat-kage'), ...vars('.hr-silks-red') };
const frames = [
  ...art.slice(art.indexOf('HORSE_FRAMES')).matchAll(/\[\s*((?:'[^']*',\s*)+)\]/g),
].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((r) => r[1]));

const W = 72,
  H = 42;
const puffs = dust('dark');
const out = frames.slice(0, 8).map((rows, i) => {
  const b = new P.Buf(W, H);
  const tile = [lane('dark'), laneDark('dark')];
  for (let y = 0; y < H - 10; y += 8)
    for (let x = 0; x < W; x += 48) paste(b, tile[(y / 8) % 2 === 0 ? 0 : 1], x, y);
  for (let x = 0; x < W; x += 48) paste(b, innerRail('dark'), x, H - 10);
  paste(b, puffs[i % puffs.length], 6, 26);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const token = theme[fills[ch]];
      if (ch !== '.' && token) b.pset(x + 18, y + 2, T(token));
    }),
  );
  return b;
});
const file = path.resolve(
  process.argv[2] ?? path.join(ROOT, 'docs/images/readme/horse-gallop.gif'),
);
fs.writeFileSync(file, P.gif(out, { delay: 80, scale: 4 }));
console.log(file, fs.statSync(file).size, 'bytes', out.length, 'frames');
