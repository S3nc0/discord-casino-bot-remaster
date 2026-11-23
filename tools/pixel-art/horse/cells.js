import { pathToFileURL } from 'node:url';
// Step 1: cut the twelve cells out of the reference plate and show the dark mask of each.
import fs from 'node:fs';
import { P, OUT, out, ref } from '../lib/env.js';

fs.mkdirSync(OUT, { recursive: true });
const plate = P.load(ref('muy_half.png'));
const X = [
  [67, 722],
  [747, 1404],
  [1428, 2086],
  [2110, 2771],
];
const Y = [
  [72, 493],
  [515, 939],
  [961, 1388],
];
const lum = (c) => ((c & 255) + ((c >> 8) & 255) + ((c >> 16) & 255)) / 3;

const cells = [];
for (const [y0, y1] of Y)
  for (const [x0, x1] of X) cells.push(P.crop(plate, x0, y0, x1 - x0 + 1, y1 - y0 + 1));
export { cells, lum };

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const items = cells.map((cell, i) => {
    const m = new P.Buf(cell.w, cell.h);
    for (let k = 0; k < cell.w * cell.h; k++) if (lum(cell.px[k]) < 70) m.px[k] = P.rgb(20, 20, 30);
    return { buf: P.resize(m, (cell.w / 3) | 0, (cell.h / 3) | 0), label: '#' + (i + 1), scale: 1 };
  });
  P.save(P.sheet(items, { cols: 4, scale: 1 }), out('cells_mask.png'));
}
