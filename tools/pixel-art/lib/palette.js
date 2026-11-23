// The round 2 palette (design/bitbloom/tokens.css). Every colour in the art is one of these
// steps, so the art stays inside the approved palette and the shipped CSS can name each one.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../design/bitbloom/tokens.css'),
  'utf8',
);
const HEX = {};
for (const m of css.matchAll(/--([a-z]+-\d+):\s*(#[0-9a-fA-F]{6})/g))
  if (!(m[1] in HEX)) HEX[m[1]] = m[2];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `tok('red-40')` is [r, g, b] of the token `--red-40`. */
function tok(name) {
  const h = HEX[name];
  if (!h) throw new Error(`unknown token ${name}`);
  return rgb(h);
}
const ramp = (names) => names.map(tok);

/**
 * Coat ramps, dark to light (5 steps, hue shifted: the dark end leans to red/violet/blue, the light
 * end to warm yellow). `mane` is the ramp of mane and tail, `points` the lower legs.
 */
const BLACKISH = ['blue-10', 'neutral-12', 'neutral-20', 'neutral-30', 'neutral-50'];
const COATS = {
  // chestnut 栗毛
  kurige: {
    body: ['red-20', 'red-30', 'orange-40', 'orange-50', 'orange-70'],
    mane: ['red-20', 'red-30', 'red-40', 'orange-50', 'orange-60'],
  },
  // bay 鹿毛
  kage: {
    body: ['brown-10', 'red-30', 'orange-30', 'orange-40', 'orange-60'],
    mane: BLACKISH,
    points: BLACKISH,
  },
  // dark bay 黒鹿毛
  kurokage: {
    body: ['brown-10', 'brown-20', 'orange-20', 'brown-30', 'brown-50'],
    mane: BLACKISH,
    points: BLACKISH,
  },
  // black 青毛
  aoge: {
    body: ['blue-10', 'neutral-12', 'neutral-20', 'neutral-30', 'neutral-50'],
    mane: ['neutral-4', 'blue-10', 'neutral-12', 'neutral-20', 'neutral-30'],
  },
  // grey 芦毛
  ashige: {
    body: ['neutral-30', 'neutral-40', 'neutral-60', 'neutral-78', 'neutral-90'],
    mane: ['neutral-25', 'neutral-35', 'neutral-50', 'neutral-65', 'neutral-80'],
  },
  // white 白毛
  shirage: {
    body: ['neutral-50', 'neutral-70', 'neutral-90', 'paper-96', 'paper-99'],
    mane: ['neutral-60', 'neutral-78', 'neutral-92', 'paper-96', 'paper-99'],
  },
  // liver chestnut 栃栗毛
  tochiguri: {
    body: ['red-10', 'red-20', 'red-30', 'red-40', 'orange-50'],
    mane: ['red-10', 'red-20', 'red-20', 'red-30', 'red-40'],
  },
  // palomino 月毛
  tsukige: {
    body: ['brown-40', 'orange-50', 'orange-70', 'yellow-80', 'yellow-90'],
    mane: ['orange-70', 'orange-80', 'yellow-90', 'paper-96', 'paper-99'],
  },
};
const COAT_OF = {
  栗毛: 'kurige',
  鹿毛: 'kage',
  黒鹿毛: 'kurokage',
  青毛: 'aoge',
  芦毛: 'ashige',
  白毛: 'shirage',
  栃栗毛: 'tochiguri',
  月毛: 'tsukige',
};

/** Silks: shade, base, light of one hue (the rider's colours, from the silks emoji). */
const SILKS = {
  red: ['red-30', 'red-50', 'red-70'],
  orange: ['orange-40', 'orange-60', 'orange-80'],
  yellow: ['yellow-50', 'yellow-70', 'yellow-90'],
  green: ['green-30', 'green-50', 'green-70'],
  blue: ['blue-30', 'blue-50', 'blue-70'],
  violet: ['violet-30', 'violet-50', 'violet-70'],
  black: ['neutral-10', 'neutral-24', 'neutral-40'],
  white: ['neutral-60', 'neutral-87', 'paper-99'],
  brown: ['brown-20', 'brown-40', 'brown-60'],
};

export { tok, ramp, HEX, COATS, COAT_OF, SILKS, BLACKISH };

/** Materials for the icons: 5 steps dark to light, hue shifted (dark toward cool, light toward warm). */
const MAT = {
  gold: ['orange-40', 'orange-60', 'yellow-70', 'yellow-80', 'yellow-95'],
  red: ['red-20', 'red-40', 'red-60', 'red-70', 'orange-80'],
  orange: ['red-30', 'orange-50', 'orange-60', 'orange-70', 'yellow-90'],
  green: ['green-20', 'green-40', 'green-60', 'green-80', 'yellow-90'],
  sky: ['blue-20', 'sky-40', 'sky-60', 'sky-80', 'sky-95'],
  blue: ['blue-20', 'blue-40', 'blue-60', 'blue-70', 'sky-90'],
  violet: ['violet-20', 'violet-40', 'violet-60', 'violet-70', 'blue-90'],
  teal: ['teal-20', 'teal-40', 'teal-60', 'teal-80', 'green-90'],
  paper: ['neutral-50', 'neutral-70', 'neutral-87', 'paper-96', 'paper-99'],
  steel: ['neutral-24', 'neutral-40', 'neutral-60', 'neutral-80', 'neutral-97'],
  wood: ['brown-10', 'brown-30', 'brown-40', 'brown-60', 'brown-80'],
  ink: ['neutral-4', 'neutral-10', 'neutral-17', 'neutral-25', 'neutral-40'],
  skin: ['brown-40', 'orange-60', 'orange-70', 'orange-80', 'orange-90'],
  stone: ['neutral-40', 'neutral-60', 'neutral-78', 'paper-90', 'paper-98'],
};
const mat = (name) => ramp(MAT[name]);
export { MAT, mat };
